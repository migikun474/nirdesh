// Turns a plain-words idea into an RTCCO prompt. Pure functions, no DOM code.
const PART_KEYS = ['role', 'task', 'context', 'constraints', 'output'];

// Whole-word match. Subjects also accept a plural "s" ("rockets"); intents don't, so "exams" stays out of practise.
function hasWord(text, word, plural) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + esc + (plural ? 's?' : '') + '\\b', 'i').test(text);
}

function findIntent(text) {
  const hit = NIRDESH_DATA.intents.find(([, words]) => words.some(w => hasWord(text, w)));
  return hit ? hit[0] : 'learn';
}

function findTopic(original) {
  const fillers = [...NIRDESH_DATA.fillers].sort((a, b) => b.length - a.length);
  let topic = original;
  for (let again = true; again;) {
    const low = topic.toLowerCase();
    const f = fillers.find(f => low === f || low.startsWith(f + ' '));
    again = Boolean(f);
    if (f) topic = topic.slice(f.length).trim();
  }
  const clean = s => s.replace(/[\s?.!]+$/, '');
  return clean(topic) || clean(original);
}

// Most keyword hits wins; ties go to the subject listed first.
function findSubject(topic) {
  let best = NIRDESH_DATA.general, bestHits = 0;
  for (const s of NIRDESH_DATA.subjects) {
    const hits = s.keywords.filter(k => hasWord(topic, k, true)).length;
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
  const intent = findIntent(original);
  const topic = findTopic(original);
  const subject = findSubject(topic);
  // "a physics teacher who is also a friendly teacher" reads badly, so teachers become "a friendly physics teacher".
  const isTeacher = /teacher$/.test(subject.role || '');
  const role = isTeacher ? subject.role.replace(/^an? /, 'a friendly ') : subject.role;
  const vars = { topic, role, example: subject.example };
  const fill = t => t.replace(/\{(\w+)\}/g, (_, k) => vars[k]);

  const raw = {
    role: subject.id === 'general' ? D.recipes.roleGeneral : isTeacher ? D.recipes.roleTeacher : D.recipes.role,
    task: D.recipes.task[intent],
    context: L.context,
    constraints: L.constraints,
    output: D.recipes.output[intent],
  };
  const parts = {};
  for (const k of PART_KEYS) parts[k] = tidy(fill(raw[k]));

  return { intent, topic, subject: subject.id, parts, prompt: joinParts(parts), score: scoreParts(parts).score };
}
