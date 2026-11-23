// Turns a plain-words idea into an RTCCO prompt. Pure functions, no DOM code.
const PART_KEYS = ['role', 'task', 'context', 'constraints', 'output'];

// Whole-word match. Subjects also accept a plural "s" ("rockets"); intents don't, so "exams" stays out of practise.
function hasWord(text, word, plural) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + esc + (plural ? '(?:e?s)?' : '') + '\\b', 'i').test(text);
}

// Nouns like "website" or "game" only mean "make" when the student asks to make something.
function findIntent(text) {
  const hit = NIRDESH_DATA.intents.find(([id, words]) =>
    (id !== 'make' || MAKE_ASK.test(text)) && words.some(w => hasWord(text, w)));
  return hit ? hit[0] : 'learn';
}

const clean = s => s.replace(/[\s?.!]+$/, '').trim();

function stripFillers(text) {
  const fillers = [...NIRDESH_DATA.fillers].sort((a, b) => b.length - a.length);
  let topic = text.trim();
  for (let again = true; again;) {
    const low = topic.toLowerCase();
    const f = fillers.find(f => low === f || low.startsWith(f + ' '));
    again = Boolean(f);
    if (f) topic = topic.slice(f.length).trim();
  }
  return topic;
}

function findTopic(original) {
  return clean(stripFillers(original)) || clean(original);
}

// Small words that sit between the verb and the thing: "make me a ...", "... and make a comic".
const LINK_WORDS = new Set(['a', 'an', 'the', 'me', 'my', 'and', 'with', 'to', 'some', 'make', 'create', 'build', 'write',
  'design', 'draw', 'do', 'on', 'about', 'for', 'of', 'i', 'want', 'please', 'help', 'prepare',
  'explain', 'learn', 'understand', 'teach', 'tell', 'know', 'what', 'is', 'how', 'does', 'why', 'revise', 'practise', 'practice']);

// "explain Mendel's experiment" is a question about an experiment, not a request to build one.
// A make-word only counts when the student asks to make it, or starts with it ("a poster on ...").
const MAKE_ASK = /\b(make|create|build|design|draw|write|prepare|do|help me with)\b|^code\b/i;
const OPENERS = new Set(['a', 'an', 'the', 'my', 'some', 'i', 'want', 'to', 'please', 'need']);

// "make a comic on Newton's laws" -> { label: 'comic', thing: 'a comic on Newton's laws', topic: "Newton's laws" }.
function findMake(original) {
  for (const a of NIRDESH_DATA.artifacts) {
    for (const w of a.words) {
      const m = new RegExp('\\b' + w.replace(/ /g, '\\s+') + 's?\\b', 'i').exec(original);
      if (!m) continue;

      // Up to two describing words right before it: "interactive comic", "working model".
      const before = original.slice(0, m.index).trim().split(/\s+/).filter(Boolean);
      const adjectives = [];
      while (before.length && adjectives.length < 2 && !LINK_WORDS.has(before[before.length - 1].toLowerCase())) {
        adjectives.unshift(before.pop());
      }
      const asked = MAKE_ASK.test(before.join(' ')) || before.every(x => OPENERS.has(x.toLowerCase()));
      if (!asked) return null;
      const label = [...adjectives, m[0]].join(' ');

      const after = original.slice(m.index + m[0].length);
      const prep = /^\s*(on|about|for|of|explaining|to explain|to teach|that teaches|that explains)\s+(.+)$/i.exec(after);
      let joiner = 'about', topic;
      if (prep) {
        if (/^(on|for|of)$/i.test(prep[1])) joiner = prep[1].toLowerCase();
        topic = clean(prep[2]);
      } else {
        // No "on/about": the topic is whatever is left once the filler and link words go.
        const words = stripFillers(before.join(' ') + ' ' + after).split(/\s+/).filter(Boolean);
        while (words.length && LINK_WORDS.has(words[0].toLowerCase())) words.shift();
        while (words.length && LINK_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
        topic = clean(words.join(' '));
      }

      const article = a.plural ? '' : /^[aeiou]/i.test(label) ? 'an ' : 'a ';
      const thing = article + label + (topic ? ` ${joiner} ${topic}` : '');
      return { thing, topic: topic || label, output: a.output };
    }
  }
  return null;
}

// Most keyword hits wins, a two-word keyword counting twice ("power sharing" beats "power");
// ties go to the subject listed first.
function findSubject(topic) {
  let best = NIRDESH_DATA.general, bestHits = 0;
  for (const s of NIRDESH_DATA.subjects) {
    const hits = s.keywords.filter(k => hasWord(topic, k, true)).reduce((n, k) => n + k.split(' ').length, 0);
    if (hits > bestHits) { best = s; bestHits = hits; }
  }
  return best;
}

// One capital at the start, one full stop at the end, no double spaces.
function tidy(text) {
  let s = String(text || '').replace(/\s+/g, ' ').replace(/\.{2,}/g, '.').trim();
  if (!s) return '';
  s = s[0].toUpperCase() + s.slice(1);
  return /[.?!]$/.test(s) ? s : s + '.';
}

function joinParts(parts, extras = []) {
  return [...PART_KEYS.map(k => parts[k]), ...extras].map(tidy).filter(Boolean).join(' ');
}

function scoreParts(parts) {
  const missing = PART_KEYS.filter(k => !String(parts[k] || '').trim());
  return { score: PART_KEYS.length - missing.length, missing };
}

function buildPrompt(idea, level) {
  const original = String(idea || '').replace(/\s+/g, ' ').trim();
  if (original.length < 3) return { error: 'short' };

  const D = NIRDESH_DATA;
  const L = D.levels[level] || D.levels['9-10'];
  const make = findMake(original);
  const intent = make ? 'make' : findIntent(original);
  const topic = make ? make.topic : findTopic(original);
  const tSubject = findSubject(topic);
  const subject = tSubject.id === 'general' ? findSubject(original) : tSubject;
  // "why is the sky blue" stays a question instead of becoming "Explain why is the sky blue".
  const question = intent === 'learn' && /^(how|why|what|when|where|which|who|is|are|can|do|does)\b/i.test(topic);
  const struggling = D.struggle.some(w => hasWord(original, w));
  // "a physics teacher who is also a friendly teacher" reads badly, so teachers become "a friendly physics teacher".
  const isTeacher = /teacher$/.test(subject.role || '');
  const role = isTeacher ? subject.role.replace(/^an? /, 'a friendly ') : subject.role;
  const vars = { topic: question ? topic[0].toUpperCase() + topic.slice(1) : topic, role, example: subject.example, thing: make && make.thing };
  const fill = t => t.replace(/\{(\w+)\}/g, (_, k) => vars[k]);

  const raw = {
    role: subject.id !== 'general' ? (isTeacher ? D.recipes.roleTeacher : D.recipes.role)
      : question ? D.recipes.roleQuestion : D.recipes.roleGeneral,
    task: make ? D.makeTask : question ? D.recipes.taskQuestion : D.recipes.task[intent],
    context: L.context + (struggling ? ' ' + D.struggleContext : ''),
    constraints: L.constraints,
    output: make ? make.output : question ? D.recipes.outputQuestion : D.recipes.output[intent],
  };
  const parts = {};
  for (const k of PART_KEYS) parts[k] = tidy(fill(raw[k]));

  return { intent, topic, subject: subject.id, parts, prompt: joinParts(parts), score: scoreParts(parts).score };
}
