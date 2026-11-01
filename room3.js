// Sala 3 (realidad aumentada): the "who could use it" garland, the draggable lens with its
// province hologram, the scene bar and the info hotspots. Everything comes from the room JSON
// and the exp-3 data; a missing SVG id is reported with console.warn and that feature is skipped.
// The wall SVG is never edited: the engine only changes fills, adds stars and adds overlay nodes.
import { q, placeBox, hotspot } from './walls.js';

const NS = 'http://www.w3.org/2000/svg';
const VB = { w: 1600, h: 900 };

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
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const units = (b) => ({ left: b.x / VB.w * 100, top: b.y / VB.h * 100, width: b.width / VB.w * 100, height: b.height / VB.h * 100 });

// Seeded PRNG so the garland always shows the same (illustrative) arrangement.
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerpHex = (a, b, t) => {
  const A = hexToRgb(a), B = hexToRgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
};

// Star drawn in a kid's local (template) coordinates.
const STAR = { cx: 389, cy: 22, outer: 44, inner: 20, fill: '#ffd23f', stroke: '#4c3322', width: 3 };
const starPoints = () => Array.from({ length: 10 }, (_, k) => {
  const a = -Math.PI / 2 + k * Math.PI / 5;
  const r = k % 2 ? STAR.inner : STAR.outer;
  return `${r3(STAR.cx + r * Math.cos(a))},${r3(STAR.cy + r * Math.sin(a))}`;
}).join(' ');

export function initRoom3({ wall, room, data, isInstant, goTo, openCard, playAudio, tip }) {
  const gsap = window.gsap;
  const ev = data.evidence || {};
  const need = (id, feature) => {
    const n = id ? q(wall, '#' + id) : null;
    if (!n) console.warn(`[sala3] #${id} not found in ${wall.id}; skipping ${feature}`);
    return n;
  };

  // The wall svg carries focusable parts (the lens), so it must not be aria-hidden.
  wall.svg.removeAttribute('aria-hidden');

  const live = make('div', 'sr-only');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  wall.overlay.append(live);
  const announce = (text) => { live.textContent = text; };

  let wallRect = null;
  const refresh = () => { wallRect = wall.svg.getBoundingClientRect(); };
  window.addEventListener('resize', refresh);
  let scenePopClose = null;

  const garland = initGarland();
  const lensApi = initLens();
  initScenes(lensApi);
  initInfoHotspots();

  return {
    refresh,
    arrived(frameId, entered) {
      refresh();
      if (!entered) return;
      if (lensApi) lensApi.enter();
      if (scenePopClose) scenePopClose(false);
    },
    garland,
  };

  // ---------------------------------------------------------------- garland
  function initGarland() {
    const cfg = room.garland;
    const st = ev.access_states;
    if (!cfg || !st) return null;
    const ids = cfg.svg_ids || {};
    const kidCls = ids.kid_class || 'kid';
    const bodyCls = ids.body_class || 'kid-body';
    const colors = Object.assign({ default: '#ead9b8' }, cfg.state_colors);

    let group = q(wall, '#' + (ids.group || 'garland'));
    let kids = group ? [...group.querySelectorAll('.' + kidCls)] : [];
    if (!kids.length) {
      kids = buildKids(cfg, ids, st.total, kidCls, bodyCls);
      if (!kids.length) { console.warn(`[sala3] no .${kidCls} elements and no template to build them; skipping garland`); return null; }
    }
    const bodyOf = (kid) => kid.querySelector('.' + bodyCls);
    kids.forEach((k) => { const b = bodyOf(k); if (b) b.setAttribute('fill', colors.default); });

    // One state per student, shuffled with a fixed seed.
    const labels = st.labels || {};
    const keys = Object.keys(labels).filter((k) => typeof st[k] === 'number');
    const states = keys.flatMap((k) => Array(st[k]).fill(k));
    if (states.length !== kids.length) console.warn(`[sala3] access_states gives ${states.length} students but the SVG has ${kids.length} kids`);
    const rand = mulberry32(3);
    for (let i = states.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [states[i], states[j]] = [states[j], states[i]];
    }

    if (!need(cfg.toggle && cfg.toggle.slot_id, 'garland toggle')) return { kids, states };

    // The drawn slot sits in a 220×44 gap above the marker and the type cannot fit.
    // The card moves onto the wainscot under the marker, wider than that slot.
    const marker = q(wall, '#' + ((room.marker && room.marker.id) || 'marker-sheet'));
    const mb = marker && marker.getBBox();
    const width = 480;
    const box = mb
      ? { x: clamp(mb.x + (mb.width - width) / 2, 760, VB.w - width - 28), y: mb.y + mb.height + 46, width, height: 230 }
      : null;
    if (!box) { console.warn('[sala3] #marker-sheet not found; skipping garland toggle'); return { kids, states }; }

    const card = make('div', 'garland-card');
    placeBox(card, units(box));

    const btn = make('button', 'garland-toggle', st.toggle_label || '');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', 'false');

    const legend = make('div', 'garland-legend');
    const ul = make('ul', 'legend-list');
    ul.hidden = true;
    keys.forEach((k) => {
      const chip = make('span', 'legend-chip');
      chip.style.background = colors[k];
      chip.setAttribute('aria-hidden', 'true');
      const li = make('li');
      li.append(chip, make('span', 'legend-label', labels[k]), make('strong', 'legend-count', String(st[k])));
      ul.append(li);
    });
    legend.append(ul);
    if (st.caption) legend.append(make('p', 'legend-caption', st.caption));
    card.append(btn, legend);
    wall.overlay.append(card);

    const summary = keys.map((k) => `${st[k]} ${labels[k].toLowerCase()}`).join(', ');
    let on = false;
    btn.addEventListener('click', () => {
      on = !on;
      btn.setAttribute('aria-pressed', String(on));
      ul.hidden = !on;
      apply(on);
      announce(on ? `Colores activados: ${summary}.` : 'Colores desactivados.');
    });

    function apply(show) {
      const instant = isInstant();
      if (gsap) gsap.killTweensOf(kids.map(bodyOf).filter(Boolean));
      kids.forEach((kid, i) => {
        const body = bodyOf(kid);
        const state = states[i];
        const color = show && state ? colors[state] : colors.default;
        if (body) {
          if (instant || !gsap) body.setAttribute('fill', color);
          else gsap.to(body, { attr: { fill: color }, duration: 0.3, delay: i * 0.03, ease: 'none', overwrite: true });
        }
        kid.querySelectorAll('.kid-star').forEach((s) => s.remove());
        if (show && cfg.star_for && state === cfg.star_for) {
          const star = svgEl('polygon', {
            class: 'kid-star', points: starPoints(), fill: STAR.fill, stroke: STAR.stroke,
            'stroke-width': STAR.width, 'stroke-linejoin': 'round',
          });
          kid.append(star);
          if (!instant && gsap) gsap.fromTo(star, { opacity: 0 }, { opacity: 1, duration: 0.25, delay: i * 0.03 });
        }
      });
    }
    return { kids, states, apply };
  }

  // The SVG only ships the paper-kid template: place one kid per student along the drawn string.
  function buildKids(cfg, ids, total, kidCls, bodyCls) {
    const string = q(wall, '#' + (ids.string || 'garland-string'));
    const tpl = q(wall, '#' + cfg.template);
    const parts = cfg.template_parts || {};
    const bodyT = tpl && q(wall, '#' + parts.body);
    const lineT = tpl && q(wall, '#' + parts.line);
    if (!string || !bodyT || !lineT || !total) return [];
    console.info('[sala3] #garland is not in the SVG; placing kids from the paper-kid template');
    // The toggle used to occupy the top-right. Stretch the rope toward the speaker
    // so the same 33 kids get the spacing, and therefore the size, that room allows.
    const speaker = q(wall, '#speaker');
    const speakerBox = speaker && speaker.getBBox();
    const endX = clamp(speakerBox ? speakerBox.x - 28 : 1260, 1000, 1360);
    const span = endX - 99;
    const k = span / 820;
    string.setAttribute('d', `M99,53c${r3(273.3 * k)},113.3,${r3(546.7 * k)},113.3,${r3(span)},0`);
    const hook = q(wall, '#garland-hook-right');
    if (hook) hook.setAttribute('transform', `translate(${r3(endX - 919)} 0)`);
    const frame = wall.frames.get('focus-garland');
    if (frame && endX + 40 > frame.x + frame.w) wall.frames.set('focus-garland', { ...frame, w: endX + 40 - frame.x });

    const host = q(wall, '#wall-extras') || wall.svg;
    const group = svgEl('g', { id: ids.group || 'garland', 'aria-hidden': 'true' });
    host.append(group);

    const L = string.getTotalLength();
    const lb = lineT.getBBox();
    const ox = lb.x + lb.width / 2, oy = lb.y + 0.3 * lb.height;
    const spacing = L * 0.976 / Math.max(1, total - 1);
    const scale = spacing * 1.05 / lb.width;
    const out = [];
    for (let i = 0; i < total; i++) {
      const s = L * (0.012 + 0.976 * i / Math.max(1, total - 1));
      const p = string.getPointAtLength(s);
      const a = string.getPointAtLength(Math.max(0, s - 0.5));
      const b = string.getPointAtLength(Math.min(L, s + 0.5));
      const angle = cfg.curve && cfg.curve.rotate_with_tangent === false ? 0 : Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      const kid = svgEl('g', { class: kidCls, 'data-i': i, transform: `translate(${r3(p.x)} ${r3(p.y)}) rotate(${r3(angle)}) scale(${r3(scale)}) translate(${r3(-ox)} ${r3(-oy)})` });
      [...tpl.children].forEach((part) => {
        const c = part.cloneNode(true);
        c.removeAttribute('id');
        if (part === bodyT) {
          c.removeAttribute('class');
          c.classList.add(bodyCls);
        } else if (part === lineT) {
          c.removeAttribute('class');
          c.setAttribute('fill', getComputedStyle(part).fill);
        }
        kid.append(c);
      });
      group.append(kid);
      out.push(kid);
    }
    return out;
  }

  // ---------------------------------------------------------------- map + lens
  function initLens() {
    const cfg = room.lens;
    const mapCfg = room.map;
    const M = ev.map;
    if (!cfg || !mapCfg || !M) return null;
    const lens = need(cfg.id, 'lens');
    const sheet = need(cfg.bounds_id || mapCfg.sheet_id, 'lens bounds');
    const slot = need(mapCfg.slot_id, 'map');
    if (!lens || !sheet || !slot) return null;

    // Province space: the nested map svg (viewBox units) or, when the provinces are drawn
    // straight on the wall, wall units.
    const nested = wall.svg.querySelector('svg#' + (mapCfg.nested_svg_id || 'map-slot-svg'));
    const slotBox = slot.getBBox();
    let sp = { tx: 0, ty: 0, sx: 1, sy: 1 };
    if (nested && nested.viewBox && nested.viewBox.baseVal.width) {
      const vb = nested.viewBox.baseVal;
      sp = { tx: slotBox.x, ty: slotBox.y, sx: slotBox.width / vb.width, sy: slotBox.height / vb.height };
    }
    const toWall = (x, y) => ({ x: sp.tx + x * sp.sx, y: sp.ty + y * sp.sy });
    const toMap = (x, y) => ({ x: (x - sp.tx) / sp.sx, y: (y - sp.ty) / sp.sy });

    const names = new Map((M.provinces || []).map((p) => [p.id, p.name]));
    const provs = (mapCfg.provinces || []).map((id) => {
      const g = need(id, `province ${id}`);
      if (!g) return null;
      const paths = [...g.querySelectorAll(':scope > path')];
      if (!paths.length) { console.warn(`[sala3] #${id} has no <path>; skipping it`); return null; }
      const fill = paths[0];
      const outline = paths[paths.length - 1];
      let anchor = null;
      const raw = g.getAttribute('data-anchor');
      if (raw) {
        const [ax, ay] = raw.split(/[\s,]+/).map(Number);
        if (Number.isFinite(ax) && Number.isFinite(ay)) anchor = toWall(ax, ay);
      }
      if (!anchor) { const ip = interiorPoint(fill); anchor = ip && toWall(ip.x, ip.y); }
      return { id, name: g.getAttribute('data-name') || names.get(id) || id, g, fill, outline, anchor };
    }).filter(Boolean);
    if (!provs.length) return null;
    const byId = new Map(provs.map((p) => [p.id, p]));
    provs.forEach((p) => { if (names.has(p.id)) p.name = names.get(p.id); });

    // Lens and hologram layer go last so they draw above the map. The drawn turquoise
    // stack inside the lens is provisional: hide it when the SVG marks it as lens-holo.
    const drawnHolo = q(wall, '#lens-holo');
    if (drawnHolo) drawnHolo.setAttribute('display', 'none');
    wall.svg.append(lens);
    const pinLayer = svgEl('g', { id: 'pin-layer', 'pointer-events': 'none' });
    const holoLayer = svgEl('g', { id: 'holo-layer', 'pointer-events': 'none' });
    wall.svg.append(pinLayer, holoLayer);

    const lb = lens.getBBox();
    const probe0 = { x: lb.x + lb.width / 2, y: lb.y + 0.62 * lb.height };
    const sb = sheet.getBBox();
    const baseT = lens.getAttribute('transform') || '';
    let off = { x: 0, y: 0 };
    let tween = null;

    // Focus ring drawn by us: SVG groups do not always get the native one.
    const ring = svgEl('rect', {
      x: lb.x - 6, y: lb.y - 6, width: lb.width + 12, height: lb.height + 12, rx: 10,
      fill: 'none', stroke: '#0b57d0', 'stroke-width': 3, display: 'none', 'pointer-events': 'none',
    });
    lens.append(ring);

    lens.setAttribute('tabindex', '0');
    lens.setAttribute('role', 'application');
    lens.classList.add('lens-drag');
    const lensHs = (room.hotspots || []).find((h) => h.id === cfg.id);
    lens.setAttribute('aria-label', `${(lensHs && lensHs.label) || 'Lente de realidad aumentada'}. Usa las flechas para moverla.`);
    lens.style.cursor = 'grab';
    lens.style.touchAction = 'none';
    // A mouse press must not focus the group: the UA ring is the phone's bounding box.
    lens.addEventListener('mousedown', (e) => e.preventDefault());
    lens.addEventListener('focus', () => { if (lens.matches(':focus-visible')) ring.setAttribute('display', ''); });
    lens.addEventListener('blur', () => ring.setAttribute('display', 'none'));

    // ---- school pin (hover and keyboard focus show its label) ----
    const school = M.school || {};
    const anchorEl = need(school.anchor_id || mapCfg.school_anchor, 'school pin');
    let pin = null;
    if (anchorEl) {
      let p = { x: +anchorEl.getAttribute('cx'), y: +anchorEl.getAttribute('cy') };
      if (nested && nested.contains(anchorEl)) p = toWall(p.x, p.y);
      pin = p;
      pinLayer.append(svgEl('circle', { cx: r3(p.x), cy: r3(p.y), r: 5, fill: '#d6352e', stroke: '#fff', 'stroke-width': 2 }));
      const hit = svgEl('circle', { cx: r3(p.x), cy: r3(p.y), r: 9, fill: 'none' });
      pinLayer.append(hit);
      const text = `${school.label || 'Escuela'} (ubicación aproximada)`;
      hotspot(wall, hit, {
        label: text, cls: 'pin-hotspot',
        onActivate: (d) => tip.show(d, text),
        onEnter: (d) => tip.show(d, text),
        onLeave: () => tip.hide(),
      });
    }

    // ---- hologram ----
    const hcfg = cfg.hologram || {};
    const layers = hcfg.layers || 9;
    const step = hcfg.step_units || 4;
    const lift = hcfg.lift_units || 6;
    const holoLabel = make('div', 'holo-label');
    holoLabel.hidden = true;
    holoLabel.setAttribute('aria-hidden', 'true');
    wall.overlay.append(holoLabel);
    let holo = null; // { mode, hx, topY }
    let cur = null;
    let markerShown = null;

    function placeLabel() {
      if (!holo) return;
      const o = holo.mode === 'lens' ? off : { x: 0, y: 0 };
      Object.assign(holoLabel.style, { left: (holo.hx + o.x) / VB.w * 100 + '%', top: (holo.topY + o.y - 6) / VB.h * 100 + '%' });
    }

    function clearHolo() {
      holoLayer.replaceChildren();
      holoLayer.removeAttribute('transform');
      holoLabel.hidden = true;
      holo = null;
    }

    function showHolo(p, mode, anchor) {
      clearHolo();
      if (!p.outline) return;
      const b = p.outline.getBBox();
      const k = Math.min(145 / (b.width * sp.sx), 200 / (b.height * sp.sy));
      const ks = k * sp.sx;
      const from = hcfg.fill_from || '#78e1d2', to = hcfg.fill_to || '#2bb3a3';
      const d = p.outline.getAttribute('d');
      const els = [];
      for (let i = 0; i < layers; i++) {
        const t = layers > 1 ? i / (layers - 1) : 1;
        const g = svgEl('g');
        g.append(svgEl('path', {
          d, fill: lerpHex(to, from, t), stroke: hcfg.stroke || '#1f8f83', 'stroke-width': r3(1.4 / ks), 'stroke-linejoin': 'round',
          transform: `translate(${r3(anchor.x)} ${r3(anchor.y - i * step)}) scale(${r3(ks)}) translate(${r3(-(b.x + b.width / 2))} ${r3(-(b.y + b.height))})`,
        }));
        holoLayer.append(g);
        els.push(g);
      }
      holo = { mode, hx: anchor.x, topY: anchor.y - b.height * sp.sy * k - (layers - 1) * step };
      if (mode === 'lens') holoLayer.setAttribute('transform', `translate(${r3(off.x)} ${r3(off.y)})`);
      holoLabel.textContent = p.name;
      holoLabel.hidden = false;
      placeLabel();
      if (!isInstant() && gsap) gsap.fromTo(els, { y: lift, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, stagger: 0.012, ease: 'power2.out' });
    }

    const lensAnchor = () => ({ x: lb.x + lb.width / 2, y: lb.y + 0.65 * lb.height });

    function dim(active) {
      provs.forEach((p) => {
        const v = !active || p === active ? 1 : 0.55;
        if (isInstant() || !gsap) { gsap && gsap.killTweensOf(p.g); p.g.style.opacity = v === 1 ? '' : String(v); }
        else gsap.to(p.g, { opacity: v, duration: 0.2, overwrite: true, onComplete: () => { if (v === 1) p.g.style.opacity = ''; } });
      });
    }

    function setProvince(p) {
      if (p === cur) return;
      cur = p;
      dim(p);
      if (p) { showHolo(p, 'lens', lensAnchor()); announce(`Provincia: ${p.name}.`); } else clearHolo();
      select.value = p ? p.id : '';
    }

    function hitTest() {
      const m = toMap(probe0.x + off.x, probe0.y + off.y);
      const pt = new DOMPoint(m.x, m.y);
      return provs.find((p) => p.fill.isPointInFill(pt)) || null;
    }

    // ---- moving the lens ----
    function setOffset(x, y) {
      const px = clamp(probe0.x + x, sb.x, sb.x + sb.width);
      const py = clamp(probe0.y + y, sb.y, sb.y + sb.height);
      off = { x: px - probe0.x, y: py - probe0.y };
      lens.setAttribute('transform', `translate(${r3(off.x)} ${r3(off.y)})${baseT ? ' ' + baseT : ''}`);
      if (holo && holo.mode === 'lens') holoLayer.setAttribute('transform', `translate(${r3(off.x)} ${r3(off.y)})`);
      placeLabel();
      clearMarker();
      setProvince(hitTest());
    }

    function glideToPoint(pt) {
      if (tween) { tween.kill(); tween = null; }
      const dx = pt.x - probe0.x, dy = pt.y - probe0.y;
      if (isInstant() || !gsap) { setOffset(dx, dy); return Promise.resolve(); }
      return new Promise((resolve) => {
        const o = { x: off.x, y: off.y };
        tween = gsap.to(o, {
          x: dx, y: dy, duration: 0.9, ease: 'power2.inOut',
          onUpdate: () => setOffset(o.x, o.y),
          onComplete: () => { tween = null; setOffset(dx, dy); resolve(); },
        });
      });
    }

    const glideToProvince = (id) => {
      const p = byId.get(id);
      if (!p || !p.anchor) { console.warn(`[sala3] no anchor for ${id}`); return Promise.resolve(); }
      return glideToPoint(p.anchor);
    };

    let drag = null;
    lens.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      if (tween) { tween.kill(); tween = null; }
      refresh();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: off.x, oy: off.y, moved: 0, target: e.target };
      lens.setPointerCapture(e.pointerId);
      lens.style.cursor = 'grabbing';
      tip.hide();
      e.preventDefault();
    });
    lens.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dxPx = e.clientX - drag.x, dyPx = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dxPx, dyPx));
      if (!wallRect || !wallRect.width) refresh();
      const k = VB.w / wallRect.width;
      setOffset(drag.ox + dxPx * k, drag.oy + dyPx * k);
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      lens.style.cursor = 'grab';
      if (lens.hasPointerCapture(e.pointerId)) lens.releasePointerCapture(e.pointerId);
      if (e.type === 'pointerup' && d.moved < 4 && d.target && d.target.closest && d.target.closest('#' + (cfg.sound_id || 'lens-sound'))) playAudio();
    };
    lens.addEventListener('pointerup', endDrag);
    lens.addEventListener('pointercancel', endDrag);

    lens.addEventListener('keydown', (e) => {
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation(); // the room-to-room arrow shortcut must not fire
      if (tween) { tween.kill(); tween = null; }
      const n = e.shiftKey ? 60 : 20;
      setOffset(off.x + dir[0] * n, off.y + dir[1] * n);
    });

    // ---- native province picker ----
    const select = make('select', 'lens-select');
    select.setAttribute('aria-label', 'Elegir provincia para la lente');
    select.append(new Option('Provincia…', ''));
    provs.forEach((p) => select.append(new Option(p.name, p.id)));
    select.addEventListener('change', () => { if (select.value) glideToProvince(select.value); });

    // ---- scene helpers ----
    function clearMarker() {
      if (!markerShown) return;
      markerShown = null;
      if (holo && holo.mode === 'marker') clearHolo();
      if (cur) showHolo(cur, 'lens', lensAnchor());
    }
    function showMarkerHolo(id) {
      const p = byId.get(id);
      const marker = q(wall, '#' + ((room.marker && room.marker.id) || 'marker-sheet'));
      if (!p || !marker) { console.warn('[sala3] marker hologram needs the province and #marker-sheet'); return; }
      const mb = marker.getBBox();
      markerShown = id;
      showHolo(p, 'marker', { x: mb.x + mb.width / 2, y: mb.y + mb.height * 0.62 });
    }

    // Provinces are listed with the school's province first in the glide on entry.
    const schoolProv = school.province_id;
    return {
      select,
      provinces: provs,
      glideToProvince,
      showMarkerHolo,
      schoolProv,
      enter() {
        if (!schoolProv) return;
        glideToProvince(schoolProv);
      },
    };
  }

  // Interior point of a path: sample its bbox and take the inside sample closest to the mean.
  function interiorPoint(path) {
    try {
      const b = path.getBBox();
      const n = 28;
      const inside = [];
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const p = { x: b.x + (i + 0.5) * b.width / n, y: b.y + (j + 0.5) * b.height / n };
          if (path.isPointInFill(new DOMPoint(p.x, p.y))) inside.push(p);
        }
      }
      if (!inside.length) return null;
      const mx = inside.reduce((s, p) => s + p.x, 0) / inside.length;
      const my = inside.reduce((s, p) => s + p.y, 0) / inside.length;
      return inside.reduce((best, p) => (Math.hypot(p.x - mx, p.y - my) < Math.hypot(best.x - mx, best.y - my) ? p : best));
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- scene bar
  function initScenes(lensApi) {
    const cfg = room.scenes;
    const scenes = (data.tic_use && data.tic_use.scenes) || [];
    if (!cfg || !scenes.length) return;
    const slot = need(cfg.bar_slot_id, 'scene bar');
    if (!slot) return;
    const sb = slot.getBBox();

    const bar = make('div', 'scene-bar');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Escenas de uso');
    placeBox(bar, units(sb));
    const pop = make('div', 'scene-pop');
    pop.hidden = true;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Escena');
    const popText = make('p', 'scene-pop-text');
    const popNote = make('p', 'scene-pop-note', 'Sin ilustración en esta galería');
    const popClose = make('button', 'scene-pop-close', 'Cerrar');
    popClose.type = 'button';
    pop.append(popText, popNote, popClose);
    Object.assign(pop.style, { left: sb.x / VB.w * 100 + '%', top: (sb.y - 8) / VB.h * 100 + '%' });

    let opener = null;
    scenePopClose = (refocus = true) => {
      if (pop.hidden) return;
      pop.hidden = true;
      if (refocus && opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
    popClose.addEventListener('click', () => scenePopClose());
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); scenePopClose(); } });

    scenes.forEach((text, i) => {
      const b = make('button', 'scene-btn', `Escena ${i + 1}`);
      b.type = 'button';
      b.setAttribute('aria-label', `Escena ${i + 1}: ${text}`);
      const show = () => tip.show(b, text);
      b.addEventListener('pointerenter', show);
      b.addEventListener('focus', show);
      b.addEventListener('pointerleave', () => tip.hide());
      b.addEventListener('blur', () => tip.hide());
      b.addEventListener('click', async () => {
        tip.hide();
        scenePopClose(false);
        opener = b;
        if (i === 0) {
          await goTo('focus-map');
          if (lensApi) lensApi.glideToProvince(lensApi.schoolProv);
        } else if (i === 1) {
          await goTo('focus-marker');
          if (lensApi) lensApi.showMarkerHolo(lensApi.schoolProv);
        } else {
          popText.textContent = text;
          pop.hidden = false;
          popClose.focus();
        }
      });
      bar.append(b);
    });
    if (lensApi) bar.append(lensApi.select);
    wall.overlay.append(bar, pop);
  }

  // ---------------------------------------------------------------- info hotspots
  function initInfoHotspots() {
    (room.hotspots || []).filter((hs) => hs.type === 'info').forEach((hs) => {
      const node = need(hs.id, `hotspot ${hs.id}`);
      if (!node) return;
      const frame = room.marker && room.marker.id === hs.id ? room.marker.frame : null;
      hotspot(wall, node, {
        label: hs.label, cls: 'info-hotspot',
        onActivate: async () => {
          tip.hide();
          if (frame) await goTo(frame);
          openCard(hs.opens);
        },
        onEnter: (d) => tip.show(d, hs.label),
        onLeave: () => tip.hide(),
      });
    });
  }
}
