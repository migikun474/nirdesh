// Page logic: run the engine, fill the four chapters, copy/share, power-ups, edit panel, language.
(() => {
  const D = NIRDESH_DATA;
  const RN = window.RoughNotation; // missing when the CDN is blocked; marks then fall back to CSS
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COCOA = '#3B2A24';

  // Storage can throw (private mode, blocked site data); the page must work without it.
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  const form = $('#idea-form');
  const input = $('#idea');
  const msg = $('#idea-msg');
  const result = $('#result');
  const promptEl = $('#prompt');
  const typedEl = $('#typed');
  const langBtn = $('#lang');

  let lang = store.get('nirdesh-lang') === 'hi' ? 'hi' : 'en';
  let state = null; // { idea, topic, parts, extras: [followup ids] }
  let typingTimer = null;
  let strike = null;

  document.body.classList.add(RN ? 'rn' : 'no-rn');

  const t = (key) => D.i18n[lang][key] ?? D.i18n.en[key] ?? '';

  function applyLang() {
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $$('#lang [data-l]').forEach((el) => el.classList.toggle('on', el.dataset.l === lang));
    langBtn.setAttribute('aria-label', t('langLabel'));
    $('#hi-note').hidden = lang !== 'hi';
    if (state) renderScore();
  }

  function currentPrompt() {
    return joinParts(state.parts, state.extras.map((id) => D.followups[id]));
  }

  function typeOut(text) {
    clearInterval(typingTimer);
    if (reduced) { promptEl.textContent = text; return; }
    const step = Math.ceil(text.length / 120); // ~120 ticks x 16 ms = about 2 seconds
    let i = 0;
    promptEl.setAttribute('aria-busy', 'true');
    typingTimer = setInterval(() => {
      i += step;
      promptEl.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(typingTimer); promptEl.removeAttribute('aria-busy'); }
    }, 16);
  }

  function renderScore() {
    const { score, missing } = scoreParts(state.parts);
    $('#score').textContent = `${score}/5`;
    $('#tips').replaceChildren(...missing.map((k) => {
      const li = document.createElement('li');
      li.textContent = t('tip_' + k);
      return li;
    }));
  }

  // Prompt box, share links and score. `animate` types the prompt out.
  function renderPrompt(animate) {
    const text = currentPrompt();
    if (animate) typeOut(text);
    else { clearInterval(typingTimer); promptEl.removeAttribute('aria-busy'); promptEl.textContent = text; }
    $$('[data-wa]').forEach((a) => { a.href = 'https://wa.me/?text=' + encodeURIComponent(text); });
    renderScore();
  }

  // ---------- Chapter 3: one panel per RTCCO part, marked as it scrolls in ----------

  const panels = $$('.part-panel').map((panel) => ({
    panel,
    key: panel.dataset.key,
    badge: panel.querySelector('.badge'),
    text: panel.querySelector('.part-text'),
    shown: false,
    marks: [],
  }));

  function markPanel(p, animate) {
    p.marks.forEach((m) => m.remove());
    const color = getComputedStyle(p.panel).getPropertyValue('--hl').trim();
    const opts = { animate, animationDuration: 500 };
    p.marks = [
      RN.annotate(p.badge, { ...opts, type: 'circle', color: COCOA, strokeWidth: 2, padding: 5 }),
      RN.annotate(p.text, { ...opts, type: 'highlight', color, multiline: true, iterations: 1 }),
    ];
    RN.annotationGroup(p.marks).show();
  }

  function renderParts() {
    panels.forEach((p) => {
      p.text.textContent = state.parts[p.key];
      if (p.shown && RN) markPanel(p, false);
    });
    $('#without-topic').textContent = state.topic;
  }

  // Panels that scroll in together still mark one after another.
  let markQueue = Promise.resolve();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(({ isIntersecting, target }) => {
      if (!isIntersecting) return;
      observer.unobserve(target);
      if (target.classList.contains('burst')) { target.classList.add('pop'); return; }
      const p = panels.find((x) => x.panel === target);
      p.shown = true;
      if (!RN) return;
      markQueue = markQueue.then(() => new Promise((done) => {
        markPanel(p, !reduced);
        setTimeout(done, reduced ? 0 : 1000);
      }));
    });
  }, { threshold: 0.5 });

  function drawStrike() {
    if (strike) strike.remove();
    if (!RN) return;
    strike = RN.annotate(typedEl, { type: 'strike-through', color: COCOA, strokeWidth: 3, multiline: true, animate: !reduced });
    strike.show();
  }

  // ---------- Events ----------

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const level = form.elements.level.value;
    const r = buildPrompt(input.value, level);
    if (r.error) { msg.hidden = false; input.focus(); return; }
    msg.hidden = true;
    store.set('nirdesh-idea', input.value.trim());
    store.set('nirdesh-level', level);

    state = { idea: input.value.trim(), topic: r.topic, parts: { ...r.parts }, extras: [] };
    $$('[data-followup]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    $$('[data-edit]').forEach((ta) => { ta.value = state.parts[ta.dataset.edit]; });

    result.hidden = false;
    typedEl.textContent = `"${state.idea}"`;
    renderParts();
    renderPrompt(true);
    drawStrike();
    $$('.burst').forEach((b) => { b.classList.remove('pop'); observer.observe(b); });
    panels.forEach((p) => { if (!p.shown) observer.observe(p.panel); });

    const ch2 = $('#chapter-2');
    ch2.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    ch2.focus({ preventScroll: true });
  });

  input.addEventListener('input', () => { msg.hidden = true; });

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;opacity:0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  $$('[data-copy]').forEach((btn) => btn.addEventListener('click', async () => {
    const ok = await copyText(currentPrompt());
    btn.textContent = t(ok ? 'copied' : 'copyFail');
    clearTimeout(btn.resetTimer);
    btn.resetTimer = setTimeout(() => { btn.textContent = t(btn.dataset.i18n); }, 2000);
  }));

  $$('[data-followup]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.followup;
    const on = !state.extras.includes(id);
    state.extras = on ? [...state.extras, id] : state.extras.filter((x) => x !== id);
    btn.setAttribute('aria-pressed', String(on));
    renderPrompt(false);
  }));

  $$('[data-edit]').forEach((ta) => ta.addEventListener('input', () => {
    state.parts[ta.dataset.edit] = ta.value;
    renderParts();
    renderPrompt(false);
  }));

  langBtn.addEventListener('click', () => {
    lang = lang === 'en' ? 'hi' : 'en';
    store.set('nirdesh-lang', lang);
    applyLang();
  });

  // ---------- Start ----------

  input.value = store.get('nirdesh-idea') || '';
  form.elements.level.value = store.get('nirdesh-level') || '9-10'; // unknown values check nothing
  applyLang();
})();
