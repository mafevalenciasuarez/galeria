// Sala 4 (enseñar IA entrenándola): expression cards that drive the jellyfish, the webcam
// and the illustrative bars; two thermometers; and the pegboard with the missing tool.
// Everything comes from the room JSON and evidence.lab in the exp-4 data. A missing SVG id is
// reported with console.warn and that feature is skipped. The wall SVG is never edited:
// the engine only toggles attributes, adds shapes to #wall-extras and adds overlay nodes.
import { q, placeBox, hotspot } from './walls.js';
import { placedNotes, noteList, anchorPop } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const VB = { w: 1600, h: 900 };
const GOLD = '#E0A526';

const make = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
};
const r3 = (n) => Math.round(n * 1000) / 1000;
const units = (b) => ({ left: b.x / VB.w * 100, top: b.y / VB.h * 100, width: b.width / VB.w * 100, height: b.height / VB.h * 100 });

const pct0 = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 0 });
const num2 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function initRoom4({ wall, room, data, isInstant, goTo, openCard }) {
  const gsap = window.gsap;
  const ev = data.evidence || {};
  const lab = ev.lab || {};
  const classes = Array.isArray(lab.classes) ? lab.classes : [];
  const reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  // The OS setting is honoured for the small effects of this room, on top of the gallery button.
  const still = () => isInstant() || !gsap || !!(reduceMq && reduceMq.matches);

  const need = (id, feature) => {
    const n = id ? q(wall, '#' + id) : null;
    if (!n) console.warn(`[sala4] #${id} not found in ${wall.id}; skipping ${feature}`);
    return n;
  };

  // The expression cards are focusable parts of the wall svg, so it must not be aria-hidden.
  wall.svg.removeAttribute('aria-hidden');

  const extras = need('wall-extras', 'extras layer');
  if (!extras) return null;

  (room.frames || []).forEach((id) => {
    if (!wall.frames.has(id)) console.warn(`[sala4] frame ${id} is listed in gallery.json but missing in ${wall.id}`);
  });

  const live = make('div', 'sr-only');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  wall.overlay.append(live);
  const announce = (text) => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); };

  let active = false;
  let visited = false;
  const popovers = [];

  const lab4 = initClasses();
  const thermo = initThermometers();
  const tool = initPegboard();
  popovers.forEach((p) => document.body.append(p.el));

  return {
    setActive(on) {
      active = on;
      if (tool) tool.setActive(on);
      if (!on) popovers.forEach((p) => p.close(false));
    },
    arrived(frameId) {
      popovers.forEach((p) => { if (p.frame !== frameId) p.close(false); });
      if (!thermo) return;
      if (!visited) { visited = true; thermo.fill(); } else if (frameId === 'focus-thermos') thermo.fill();
    },
    get selected() { return lab4 ? lab4.selected() : null; },
  };

  // ---------------------------------------------------------------- popovers
  // One small dialog inside the wall: optional title, text, optional action, close.
  function makePopover({ label, title, text, extra, actionLabel, onAction, frame }) {
    const el = make('div', 'lab-pop screen-pop');
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', label);
    const closeBtn = make('button', 'screen-pop-x', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Cerrar y volver a la pared');
    el.append(closeBtn);
    if (title) el.append(make('h3', 'lab-pop-title', title));
    if (text) el.append(make('p', 'lab-pop-text', text));
    if (extra) el.append(extra);
    const row = make('div', 'lab-pop-row');
    let action = null;
    if (actionLabel) {
      action = make('button', 'lab-pop-btn lab-pop-action', actionLabel);
      action.type = 'button';
      row.append(action);
      el.append(row);
    }

    let opener = null;
    const pop = {
      el, frame,
      isOpen: () => !el.hidden,
      open(from) {
        popovers.forEach((p) => { if (p !== pop) p.close(false); });
        opener = from || document.activeElement;
        el.hidden = false;
        if (from && from.getBoundingClientRect) anchorPop(el, from);
        (action || closeBtn).focus({ preventScroll: true });
        if (from && from.setAttribute) from.setAttribute('aria-expanded', 'true');
      },
      close(refocus = true) {
        if (el.hidden) return;
        el.hidden = true;
        if (opener && opener.setAttribute) opener.setAttribute('aria-expanded', 'false');
        if (refocus && opener && document.contains(opener)) opener.focus({ preventScroll: true });
      },
    };
    const dismiss = () => { pop.close(); goTo('focus-frame'); };
    closeBtn.addEventListener('click', dismiss);
    if (action) action.addEventListener('click', () => { pop.close(false); onAction(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } });
    popovers.push(pop);
    return pop;
  }

  // ---------------------------------------------------------------- cards, jellyfish, webcam, bars
  function initClasses() {
    if (!classes.length) { console.warn('[sala4] evidence.lab.classes is empty; skipping the expression cards'); return null; }
    const svgIds = (room.lab && room.lab.svg_ids) || {};
    const defaultCostume = (room.lab && room.lab.default_costume) || (classes[0] && classes[0].costume);

    // ---- jellyfish costumes, one per class
    const jellies = classes.map((c) => ({ id: c.costume, el: need(c.costume, `costume ${c.costume}`) }));
    (lab.jelly_align || []).forEach((a) => {
      const j = jellies.find((x) => x.id === a.id);
      if (!j || !j.el) return;
      const old = j.el.getAttribute('transform');
      j.el.setAttribute('transform', `translate(${a.dx} 0)${old ? ' ' + old : ''}`);
    });
    const shown = (el) => el.getAttribute('display') !== 'none';
    function showCostume(id) {
      jellies.forEach(({ id: jid, el }) => {
        if (!el) return;
        if (gsap) gsap.killTweensOf(el);
        const hide = () => { el.setAttribute('display', 'none'); el.style.opacity = ''; };
        if (jid === id) {
          const wasHidden = !shown(el);
          el.removeAttribute('display');
          if (still()) { el.style.opacity = ''; return; }
          if (wasHidden) el.style.opacity = '0';
          gsap.to(el, { opacity: 1, duration: 0.25, ease: 'none', onComplete: () => { el.style.opacity = ''; } });
        } else if (shown(el)) {
          if (still()) hide();
          else gsap.to(el, { opacity: 0, duration: 0.25, ease: 'none', onComplete: hide });
        }
      });
    }

    // ---- webcam: a nested svg with a copy of the chosen card's face
    const camSlot = need((room.lab && room.lab.svg_ids && room.lab.svg_ids.webcam_slot) || (lab.webcam && lab.webcam.slot), 'webcam');
    let camSvg = null;
    function showWebcam(card) {
      if (camSvg) { camSvg.remove(); camSvg = null; }
      if (!card || !camSlot) return;
      const b = card.getBBox();
      const s = camSlot.getBBox();
      camSvg = svgEl('svg', {
        x: r3(s.x), y: r3(s.y), width: r3(s.width), height: r3(s.height),
        viewBox: `${r3(b.x)} ${r3(b.y)} ${r3(b.width)} ${r3(b.height)}`,
        preserveAspectRatio: 'xMidYMid meet', overflow: 'hidden', 'aria-hidden': 'true',
      });
      [...card.children].forEach((k) => {
        const c = k.cloneNode(true);
        c.removeAttribute('id');
        c.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
        camSvg.append(c);
      });
      extras.append(camSvg);
    }

    // ---- selection ring: flat gold outline, no glow
    const ring = svgEl('rect', { fill: 'none', stroke: GOLD, 'stroke-width': 4, rx: 10, 'aria-hidden': 'true', display: 'none' });
    extras.append(ring);
    function showRing(card) {
      if (!card) { ring.setAttribute('display', 'none'); return; }
      const b = card.getBBox();
      const pad = 4;
      ring.setAttribute('x', r3(b.x - pad)); ring.setAttribute('y', r3(b.y - pad));
      ring.setAttribute('width', r3(b.width + pad * 2)); ring.setAttribute('height', r3(b.height + pad * 2));
      ring.removeAttribute('display');
    }

    // ---- bars (HTML overlay in the dark panel)
    const barsSlot = need(svgIds.bars_slot || 'bars-slot', 'bars');
    const capSlot = need(svgIds.bars_caption_slot || 'bars-caption-slot', 'bars caption');
    const sim = lab.sim_bars || {};
    let hint = null;
    const rows = [];
    if (barsSlot) {
      const box = make('div', 'lab-bars');
      placeBox(box, units(barsSlot.getBBox()));
      hint = make('p', 'lab-bars-hint', 'Elige una tarjeta de expresión');
      box.append(hint);
      classes.forEach((c) => {
        const row = make('div', 'lab-bar-row');
        const fill = make('span', 'lab-bar-fill');
        fill.style.background = c.color;
        const track = make('span', 'lab-bar-track');
        track.setAttribute('aria-hidden', 'true');
        track.append(fill);
        const pct = make('span', 'lab-bar-pct');
        row.append(make('span', 'lab-bar-label', c.label), track, pct);
        box.append(row);
        rows.push({ fill, pct });
      });
      wall.overlay.append(box);
    }
    if (capSlot && sim.caption) {
      const cap = make('p', 'lab-caption', sim.caption);
      const cb = units(capSlot.getBBox());
      Object.assign(cap.style, { left: cb.left + '%', top: cb.top + '%', width: cb.width + '%', minHeight: cb.height + '%' });
      wall.overlay.append(cap);
    }
    function setBars(n) {
      if (hint) hint.style.visibility = n ? 'hidden' : '';
      rows.forEach((r, i) => {
        const value = n ? (i + 1 === n ? sim.selected : sim.others_each) : 0;
        r.pct.textContent = n && typeof value === 'number' ? pct0.format(value) : '';
        const w = (typeof value === 'number' ? value * 100 : 0) + '%';
        if (gsap) gsap.killTweensOf(r.fill);
        if (still()) r.fill.style.width = w;
        else gsap.to(r.fill, { width: w, duration: 0.4, ease: 'power2.out' });
      });
    }

    // ---- the four cards are the controls
    let selected = null;
    const cards = classes.map((c) => {
      const el = need(c.card || `face-card-${c.n}`, `card ${c.n}`);
      if (!el) return { c, el: null };
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', c.label);
      el.setAttribute('aria-pressed', 'false');
      el.style.cursor = 'pointer';
      return { c, el };
    });
    // Tab order follows document order; the SVG stacks the cards 3, 1, 4, 2. They sit side by
    // side, so putting them in class order in the same slot changes no overlap.
    const found = cards.filter((x) => x.el);
    const parent = found.length && found[0].el.parentNode;
    if (parent && found.every((x) => x.el.parentNode === parent)) {
      const last = found.reduce((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? b : a));
      const after = last.el.nextSibling;
      found.forEach((x) => parent.insertBefore(x.el, after));
    }
    function select(n) {
      selected = n && selected !== n ? n : null;
      const cur = cards.find((x) => x.c.n === selected);
      cards.forEach(({ c, el }) => { if (el) el.setAttribute('aria-pressed', String(c.n === selected)); });
      showCostume(cur ? cur.c.costume : defaultCostume);
      showWebcam(cur && cur.el);
      showRing(cur && cur.el);
      setBars(selected);
      if (cur) announce(`Clase elegida: ${cur.c.label}. La medusa cambia de postura.`);
    }
    cards.forEach(({ c, el }) => {
      if (!el) return;
      el.addEventListener('click', () => select(c.n));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c.n); }
      });
    });
    setBars(null);
    return { select, selected: () => selected };
  }

  // ---------------------------------------------------------------- thermometers
  function initThermometers() {
    const T = lab.thermometers;
    const cfg = room.thermometers || {};
    if (!T || !Array.isArray(T.items) || !T.items.length) return null;
    const scale = T.scale || {};
    const color = cfg.liquid_color || '#c0453f';
    const inset = typeof cfg.liquid_inset === 'number' ? cfg.liquid_inset : 1.5;

    const liquids = [];
    T.items.forEach((item) => {
      const tube = need((cfg.tubes && cfg.tubes[item.id]) || `${item.id}-tube`, `liquid of ${item.id}`);
      if (tube && typeof item.value === 'number' && scale.max) {
        const tb = tube.getBBox();
        const bottom = scale.y_min;
        const full = (item.value / scale.max) * (scale.y_min - scale.y_max);
        const rect = svgEl('rect', {
          x: r3(tb.x + inset), y: r3(bottom), width: r3(tb.width - inset * 2), height: 0, fill: color, 'aria-hidden': 'true',
        });
        extras.append(rect);
        liquids.push({ rect, bottom, full, state: { h: 0 } });
      }

      // Label over the drawn slot: small name, large value, deviation below.
      const labelSlot = need((cfg.labels && cfg.labels[item.id]) || `${item.id}-label`, `label of ${item.id}`);
      if (labelSlot) {
        const b = make('button', 'thermo-label');
        b.type = 'button';
        b.setAttribute('aria-label', `${item.label}: ${num2.format(item.value)}, DE ${num2.format(item.sd)}`);
        b.append(
          make('span', 'tl-name', item.label),
          make('span', 'tl-value', num2.format(item.value)),
          make('span', 'tl-sd', `DE ${num2.format(item.sd)}`),
        );
        placeBox(b, units(labelSlot.getBBox()));
        b.addEventListener('click', () => goTo('focus-thermos'));
        wall.overlay.append(b);
      }

      const node = need(item.id, `hotspot ${item.id}`);
      const hs = (room.hotspots || []).find((h) => h.id === item.id);
      if (node) hotspot(wall, node, { label: (hs && hs.label) || item.label, cls: 'info-hotspot', onActivate: () => goTo('focus-thermos') });
    });

    function paint(l) {
      const h = Math.max(0, l.state.h);
      l.rect.setAttribute('height', r3(h));
      l.rect.setAttribute('y', r3(l.bottom - h));
    }
    function fill() {
      liquids.forEach((l) => {
        if (gsap) gsap.killTweensOf(l.state);
        if (still()) { l.state.h = l.full; paint(l); return; }
        l.state.h = 0;
        paint(l);
        gsap.to(l.state, { h: l.full, duration: 1.2, ease: 'power2.out', onUpdate: () => paint(l) });
      });
    }

    // "¿Mejoró?" opens the note; the note text is never drawn on the wall.
    const noteSlot = need(cfg.note_slot || 'thermo-note-slot', 'thermometer note');
    if (noteSlot && T.note) {
      const nb = noteSlot.getBBox();
      const btn = make('button', 'thermo-note-btn', '¿Mejoró?');
      btn.type = 'button';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
      placeBox(btn, units(nb));
      wall.overlay.append(btn);
      const thermoNotes = noteList(placedNotes(data, 'termometros'));
      const pop = makePopover({
        label: '¿Mejoró?', text: T.note, extra: thermoNotes, frame: 'focus-thermos',
        actionLabel: 'Ver lectura crítica',
        onAction: () => openCard('Lectura crítica'),
      });
      btn.addEventListener('click', async () => {
        if (pop.isOpen()) { pop.close(); await goTo('focus-frame'); return; }
        await goTo('focus-thermos');
        pop.open(btn);
      });
    }
    return { fill };
  }

  // ---------------------------------------------------------------- pegboard
  function initPegboard() {
    const cfg = room.pegboard || {};
    const M = lab.missing_tool;
    const node = need(cfg.missing_tool || 'missing-tool', 'missing tool');
    if (!node || !M) return null;
    const b = node.getBBox();

    // Dashed gold outline around the empty hook; pulses only while the room is active.
    const pad = 4;
    const dash = svgEl('rect', {
      x: r3(b.x - pad), y: r3(b.y - pad), width: r3(b.width + pad * 2), height: r3(b.height + pad * 2),
      fill: 'none', stroke: GOLD, 'stroke-width': 2.5, 'stroke-dasharray': '9 6', rx: 6, 'aria-hidden': 'true', display: 'none',
    });
    extras.append(dash);

    const btn = make('button', 'hotspot tool-hotspot');
    btn.type = 'button';
    btn.setAttribute('aria-label', M.title);
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    placeBox(btn, units(b));
    wall.overlay.append(btn);

    const pop = makePopover({
      label: M.title, title: M.title, text: M.text, frame: 'focus-pegboard',
    });
    btn.addEventListener('click', async () => {
      if (pop.isOpen()) { pop.close(); await goTo('focus-frame'); return; }
      await goTo('focus-pegboard');
      pop.open(btn);
    });

    let pulse = null;
    return {
      setActive(on) {
        if (pulse) { pulse.kill(); pulse = null; }
        dash.style.opacity = '';
        if (on) dash.removeAttribute('display'); else dash.setAttribute('display', 'none');
        if (on && !still()) pulse = gsap.to(dash, { opacity: 0.25, duration: 1.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
      },
    };
  }
}
