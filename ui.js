// Screen-space UI: card, popup, tooltip, audio panel.

export const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return n;
};

const has = (v) => (Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== '');

// Render a list item that may be a string or an object like {name, description}.
function itemNodes(it) {
  if (typeof it === 'string') return [it];
  if (it && typeof it === 'object') {
    const title = it.name || it.title || it.label;
    const body = it.description || it.text || it.summary;
    if (title || body) return [title ? el('strong', {}, title) : null, title && body ? ': ' : null, body || null];
    return [Object.values(it).filter((v) => typeof v === 'string').join(' · ')];
  }
  return [String(it)];
}

const list = (items, ordered) => (has(items) ? el(ordered ? 'ol' : 'ul', {}, items.map((i) => el('li', {}, itemNodes(i)))) : null);
const para = (t, cls) => (has(t) ? el('p', { class: cls }, t) : null);
const sub = (title, ...content) => {
  const nodes = content.flat().filter(Boolean);
  return nodes.length ? [el('h4', {}, title), ...nodes] : [];
};

function chart(values, note) {
  if (!has(values)) return [];
  const max = Math.max(...values.map((v) => v.count || 0), 1);
  const ul = el('ul', { class: 'chart', 'aria-label': 'Frecuencia de categorías codificadas' });
  values.forEach((v) => {
    ul.append(el('li', {},
      el('span', { class: 'chart-label' }, v.category),
      el('span', { class: 'chart-track', 'aria-hidden': 'true' }, el('span', { class: 'chart-bar', style: `width:${(v.count / max) * 100}%` })),
      el('strong', { class: 'chart-value' }, String(v.count))));
  });
  return sub('Frecuencia de categorías (ATLAS.ti)', para(note, 'muted'), ul);
}

const fmt = (n) => new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(n);

// Horizontal bars for evidence.videos (score out of 100); videos_below_50 are flagged in text and colour.
function videoBars(ev) {
  const vids = ev && ev.videos;
  if (!has(vids)) return [];
  const low = new Set(ev.videos_below_50 || []);
  const ul = el('ul', { class: 'chart video-chart', 'aria-label': 'Promedio de autoevaluación por video, sobre 100' });
  vids.forEach((v) => {
    const isLow = low.has(v.n);
    const score = v.mean_selfcheck_score_100;
    ul.append(el('li', { class: isLow ? 'is-low' : null },
      el('span', { class: 'chart-label' },
        `${v.n}. ${v.title}`,
        has(v.duration) ? el('span', { class: 'muted' }, ` (${v.duration})`) : null,
        isLow ? el('span', { class: 'low-flag' }, ' · menos de 50') : null),
      el('span', { class: 'chart-track', 'aria-hidden': 'true' }, el('span', { class: 'chart-bar', style: `width:${Math.max(0, Math.min(100, score))}%` })),
      el('strong', { class: 'chart-value' }, fmt(score))));
  });
  const flagged = [...low].sort((a, b) => a - b);
  const note = flagged.length ? `Marcados: videos con promedio inferior a 50 (n.º ${flagged.join(', ')}).` : null;
  return sub('Videos: promedio de autoevaluación (sobre 100)', para(note, 'muted'), ul);
}

const FUNNEL_LABELS = [
  ['initial', 'Estudiantes al inicio'],
  ['final', 'Muestra final'],
  ['experimental_final', 'Grupo experimental (final)'],
  ['control_final', 'Grupo de control (final)'],
  ['excluded_experimental_low_participation', 'Excluidos del grupo experimental por baja participación en la plataforma'],
  ['excluded_control_missing_posttest', 'Excluidos del grupo de control por no completar el post-test'],
];
function sampleFunnel(ev) {
  const f = ev && ev.sample_funnel;
  if (!f) return [];
  const items = FUNNEL_LABELS.filter(([k]) => f[k] != null).map(([k, label]) => `${label}: ${f[k]}`);
  return sub('Muestra', list(items));
}

// One builder per tab label from gallery.json card_tabs.tabs.
const BUILDERS = {
  'Contexto educativo': (d) => [
    para(d.context && d.context.summary),
    list(d.context && d.context.details),
  ],
  'Enfoque pedagógico': (d) => {
    const p = d.pedagogical_approach || {};
    return [para(p.summary), ...sub('Marcos de referencia', list(p.frameworks))];
  },
  'Metodología activa': (d, o = {}) => {
    const m = d.active_methodology || {};
    const phases = list(m.phases, true);
    if (phases && o.highlightPhase) {
      [...phases.children].forEach((li, i) => {
        const p = m.phases[i];
        if (p && p.name && p.name.toLowerCase() === o.highlightPhase.toLowerCase()) {
          li.classList.add('phase-highlight');
          li.setAttribute('aria-current', 'step');
        }
      });
    }
    return [
      has(o.line) ? el('p', { class: 'map-line' }, o.line) : null,
      has(m.name) ? el('h3', {}, m.name) : null,
      para(m.summary),
      ...sub('Fases', phases),
      ...sub('Evaluación', para(m.assessment)),
    ];
  },
  'Uso de TIC': (d) => {
    const t = d.tic_use || {};
    return [
      ...sub('Herramientas digitales', list(t.tools)),
      ...sub('Materiales no digitales', list(t.materials_non_digital)),
      ...sub('Evaluación pedagógica', para(t.pedagogical_evaluation)),
    ];
  },
  'Aportes innovadores': (d) => {
    const i = d.innovative_contributions || {};
    const tv = d.traditional_vs_transformative || {};
    const cols = has(tv.traditional) || has(tv.transformative)
      ? el('div', { class: 'compare' },
        has(tv.traditional) ? el('div', {}, el('h5', {}, 'Práctica tradicional'), el('p', {}, tv.traditional)) : null,
        has(tv.transformative) ? el('div', {}, el('h5', {}, 'Práctica transformadora'), el('p', {}, tv.transformative)) : null)
      : null;
    return [
      ...sub('Lo que declaran', para(i.claimed)),
      ...sub('Evaluación', para(i.evaluation)),
      ...sub('Tradicional frente a transformador', cols),
    ];
  },
  'Lectura crítica': (d) => {
    const c = d.critical_analysis || {};
    const freq = d.evidence && d.evidence.coding_frequencies_atlasti;
    const verify = has(d.verify)
      ? el('details', { class: 'verify' }, el('summary', {}, 'Pendiente de verificar'), list(d.verify))
      : null;
    return [
      ...sub('Fortalezas', list(c.strengths)),
      ...sub('Límites', list(c.limits)),
      ...(freq ? chart(freq.values, freq.note) : []),
      ...sampleFunnel(d.evidence),
      ...videoBars(d.evidence),
      ...sub('Fuente (APA 7)', para(d.source && d.source.apa, 'apa')),
      verify,
    ];
  },
};

export function createCard({ root, backdrop, tabs, onClose }) {
  let data = null;
  let openOpts = {};
  let buttons = [];
  let panel = null;
  let opener = null;
  let active = 0;

  const isOpen = () => !backdrop.hidden;

  function select(i, focus) {
    active = i;
    buttons.forEach((b, k) => {
      const on = k === i;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    const label = tabs[i];
    const build = BUILDERS[label];
    const nodes = build && data ? build(data, openOpts).flat().filter(Boolean) : [];
    panel.replaceChildren(...(nodes.length ? nodes : [el('p', { class: 'muted' }, 'No hay información para esta pestaña en el archivo de datos.')]));
    panel.setAttribute('aria-labelledby', `tab-${i}`);
    panel.scrollTop = 0;
  }

  function open(d, { tab = 0, highlightPhase, line } = {}) {
    data = d;
    openOpts = { highlightPhase, line };
    opener = document.activeElement;
    const room = d.room || {};
    const close = el('button', { type: 'button', class: 'card-close', 'aria-label': 'Cerrar tarjeta' }, 'Cerrar');
    close.addEventListener('click', () => closeCard());
    const tablist = el('div', { role: 'tablist', 'aria-label': 'Secciones de la tarjeta', class: 'tablist' });
    buttons = tabs.map((label, i) => {
      const b = el('button', { type: 'button', role: 'tab', id: `tab-${i}`, 'aria-controls': 'card-panel', class: 'tab' }, label);
      b.addEventListener('click', () => select(i, false));
      b.addEventListener('keydown', (e) => {
        const n = tabs.length;
        const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key];
        if (next != null) { e.preventDefault(); select(next, true); }
      });
      tablist.append(b);
      return b;
    });
    panel = el('div', { role: 'tabpanel', id: 'card-panel', class: 'card-panel', tabindex: '0' });
    root.replaceChildren(
      el('header', { class: 'card-head' },
        el('div', {}, el('h2', { id: 'card-title' }, room.title || ''), el('p', { class: 'tech-role' }, room.technology_role || '')),
        close),
      tablist, panel);
    backdrop.hidden = false;
    select(Math.min(tab, tabs.length - 1), false);
    buttons[active].focus();
  }

  function closeCard(silent) {
    if (!isOpen()) return;
    backdrop.hidden = true;
    root.replaceChildren();
    if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
    if (!silent && onClose) onClose();
  }

  // Keep Tab inside the dialog.
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...root.querySelectorAll('button, [tabindex="0"], summary')].filter((n) => !n.disabled && n.tabIndex >= 0);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeCard(); });

  return { open, close: closeCard, isOpen };
}

export function createPopup({ root, title, action, close }) {
  let handler = null;
  let opener = null;
  const hide = () => { root.hidden = true; handler = null; if (opener && document.contains(opener)) opener.focus({ preventScroll: true }); };
  close.addEventListener('click', hide);
  action.addEventListener('click', () => { const h = handler; hide(); if (h) h(); });
  return {
    show({ label, actionLabel, onAction }) {
      opener = document.activeElement;
      title.textContent = label;
      action.textContent = actionLabel;
      handler = onAction;
      root.hidden = false;
      action.focus();
    },
    hide,
    isOpen: () => !root.hidden,
  };
}

export function createTooltip(root) {
  return {
    show(anchor, text) {
      root.textContent = text;
      root.hidden = false;
      const r = anchor.getBoundingClientRect();
      const t = root.getBoundingClientRect();
      const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
      const top = Math.max(8, r.top - t.height - 8);
      Object.assign(root.style, { left: left + 'px', top: top + 'px' });
    },
    hide() { root.hidden = true; },
  };
}

// Background loop. Quiet at rest, and quieter still while a room is speaking.
export function createAmbience({ button, file }) {
  const QUIET = 0.12;
  const DUCK = 0.03;
  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'none';
  audio.volume = 0;
  let want = false;
  let ducked = false;
  let fade = 0;

  const goal = () => (want ? (ducked ? DUCK : QUIET) : 0);
  function label(text) {
    button.setAttribute('aria-pressed', String(want));
    button.setAttribute('aria-label', text);
    button.title = text;
  }
  function ramp() {
    cancelAnimationFrame(fade);
    const from = audio.volume;
    const to = goal();
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 450);
      audio.volume = from + (to - from) * k;
      if (k < 1) fade = requestAnimationFrame(step);
      else if (!want) audio.pause();
    };
    fade = requestAnimationFrame(step);
  }
  function fail() {
    want = false;
    audio.pause();
    label('No se pudo reproducir la música de fondo');
  }

  button.addEventListener('click', () => {
    if (want) { want = false; label('Música de fondo: apagada'); ramp(); return; }
    want = true;
    label('Música de fondo: activada');
    if (!audio.getAttribute('src')) audio.src = file;
    audio.volume = 0;
    const pending = audio.play();
    if (pending && pending.catch) pending.catch((err) => { if (!err || err.name !== 'AbortError') fail(); });
    ramp();
  });
  audio.addEventListener('error', () => { if (want) fail(); });

  return {
    setDucked(on) { ducked = on; if (want) ramp(); },
  };
}

// Audio is OFF by default; a missing file is handled and the transcript stays available.
export function createAudio({ panel, status, toggle, box, text, note, onChange, onBind }) {
  let audio = null;
  let src = null;
  let playing = false;

  toggle.addEventListener('click', () => {
    const open = box.hidden;
    box.hidden = !open;
    toggle.setAttribute('aria-expanded', open);
  });

  function setPlaying(v) { playing = v; if (onChange) onChange(v, v ? audio : null); }
  function showScript(open) { box.hidden = !open; toggle.setAttribute('aria-expanded', open); }

  function stop() {
    if (audio) { audio.pause(); audio = null; }
    src = null;
    setPlaying(false);
    panel.hidden = true;
  }

  function play(opts) {
    const { file, script, scriptNote } = opts;
    panel.hidden = false;
    text.textContent = script || '';
    note.textContent = scriptNote || '';
    toggle.hidden = !script;
    showScript(false);
    status.textContent = 'Cargando audio…';
    src = file;
    const a = new Audio();
    audio = a;
    // Still inside the click, so the audio graph is allowed to make sound.
    if (onBind) onBind(a);
    const missing = () => {
      if (audio !== a) return;
      status.textContent = 'Audio pendiente de grabar';
      setPlaying(false);
      if (script) showScript(true);
    };
    a.addEventListener('error', missing);
    a.addEventListener('ended', () => { if (audio === a) { status.textContent = 'Audio terminado'; setPlaying(false); } });
    a.addEventListener('playing', () => { if (audio === a) { status.textContent = 'Reproduciendo audio'; setPlaying(true); } });
    a.src = file;
    const p = a.play();
    if (p && p.catch) p.catch((err) => { if (err && err.name !== 'AbortError') missing(); });
  }

  return {
    toggle(opts) {
      if (audio && src === opts.file && playing) {
        audio.pause();
        status.textContent = 'Audio en pausa';
        setPlaying(false);
        return;
      }
      if (audio) audio.pause();
      play(opts);
    },
    stop,
    get active() { return !panel.hidden; },
  };
}
