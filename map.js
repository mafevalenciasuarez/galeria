// Interactive, horizontally pannable map for Sala 1 (nested <svg> inside the wall SVG).
// All geometry that depends on the CSS 3D camera uses getBoundingClientRect, never getScreenCTM.
import { placeBox } from './walls.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const PIN_REF_VIEW_W = 701.14; // view width at which pin.width_map_units applies (gallery.json pan.pin_screen_size)

async function fetchSvgText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.text()).replace(/<\?xml[\s\S]*?\?>/, '').replace(/<!DOCTYPE[\s\S]*?>/i, '').trim();
}

const make = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export async function initMap({ wall, cfg, isInstant, tip, onActivate }) {
  const gsap = window.gsap;
  const svg = wall.svg;
  if (!svg) return null;

  // 1. Map slot and assets
  const slot = svg.querySelector('#' + cfg.slot_id);
  if (!slot) {
    console.warn(`[map] #${cfg.slot_id} not found in ${wall.id}; keeping the old window`);
    return null;
  }
  let mapText, pinText;
  try {
    [mapText, pinText] = await Promise.all([fetchSvgText(cfg.map_svg), fetchSvgText(cfg.pin_svg)]);
  } catch (err) {
    console.warn('[map] could not load map assets:', err.message);
    return null;
  }

  slot.insertAdjacentHTML('afterend', mapText);
  const nested = slot.nextElementSibling;
  if (!nested || nested.localName !== 'svg') {
    console.warn('[map] map_svg did not parse as <svg>');
    return null;
  }
  const full = nested.viewBox.baseVal; // untouched map extent
  nested.removeAttribute('id');
  nested.removeAttribute('data-name');
  ['x', 'y', 'width', 'height'].forEach((a) => nested.setAttribute(a, slot.getAttribute(a)));
  nested.setAttribute('overflow', 'hidden');
  nested.setAttribute('class', 'cerros-map');
  nested.setAttribute('role', 'group');
  nested.setAttribute('aria-label', 'Mapa de los cerros de Medellín. Arrastra o usa las flechas izquierda y derecha para desplazarlo.');
  nested.setAttribute('tabindex', '0');
  // The UA focus ring follows the unclipped drawing, so it spills past the wooden
  // frame once the viewBox slides. The ring is drawn on .map-ui instead.
  nested.style.outline = 'none';

  // Slightly larger than the drawn frame, and lifted. Shared centre so the wood,
  // the backing and the map stay aligned. getBBox ignores this transform, so the
  // HTML overlay is placed from the same numbers.
  const frame = svg.querySelector('#map-frame');
  const backing = svg.querySelector('#map-backing');
  const MAP_SCALE = 1.06;
  const MAP_LIFT = 22;
  const anchor = (frame || slot).getBBox();
  const cx = anchor.x + anchor.width / 2;
  const cy = anchor.y + anchor.height / 2;
  const assembly = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  assembly.setAttribute('transform', `translate(${cx} ${cy - MAP_LIFT}) scale(${MAP_SCALE}) translate(${-cx} ${-cy})`);
  (backing || frame || slot).before(assembly);
  [backing, nested, frame, slot].filter(Boolean).forEach((n) => assembly.append(n));
  const project = (x, y) => ({ x: (x - cx) * MAP_SCALE + cx, y: (y - cy) * MAP_SCALE + cy - MAP_LIFT });

  // Transparent catcher so drags work over empty areas of the map.
  const catcher = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  catcher.setAttribute('x', full.x); catcher.setAttribute('y', full.y);
  catcher.setAttribute('width', full.width); catcher.setAttribute('height', full.height);
  catcher.setAttribute('fill', 'transparent');
  nested.insertBefore(catcher, nested.firstChild);

  // Views (never rendered)
  const viewsG = nested.querySelector('#' + cfg.views.container_id);
  const views = {};
  cfg.views.ids.forEach((id) => {
    const r = viewsG && viewsG.querySelector('#' + id);
    if (r) views[id] = { x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') };
  });
  if (viewsG) viewsG.style.display = 'none';
  if (!views[cfg.views.initial]) {
    console.warn('[map] initial view missing; map not initialised');
    return null;
  }

  // 2. Pin, inlined once (hidden)
  const pinG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  pinG.setAttribute('id', 'pin');
  pinG.setAttribute('pointer-events', 'none');
  pinG.setAttribute('aria-hidden', 'true');
  pinG.style.display = 'none';
  nested.append(pinG);
  pinG.insertAdjacentHTML('beforeend', pinText);
  const pinSvg = pinG.querySelector('svg');
  if (pinSvg) pinSvg.removeAttribute('id');
  const pinVB = pinSvg ? pinSvg.viewBox.baseVal : { width: 1, height: 1 };

  // Zones
  const zones = [];
  cfg.zones.forEach((z) => {
    const el = nested.querySelector('#' + z.zone_id);
    if (!el) { console.warn('[map] zone not found:', z.zone_id); return; }
    const dimmed = z.style === 'dimmed';
    const zone = { cfg: z, el, bbox: el.getBBox(), interactive: z.interactive !== false && !dimmed, rect: null };
    if (dimmed) {
      el.style.opacity = '0.45';
      el.style.pointerEvents = 'none';
    } else if (zone.interactive) {
      el.classList.add('map-zone');
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', labelOf(z));
    }
    zones.push(zone);
  });
  const active = zones.filter((z) => z.interactive);

  function labelOf(z) { return z.group ? `${z.group} · ${z.label}` : z.label; }

  // Live region
  const live = make('div', 'sr-only');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('role', 'status');
  document.body.append(live);

  // ---------- View state ----------
  const { min_x: minX, max_x: maxX } = cfg.pan;
  const tweenCfg = cfg.pan.tween || { duration_s: 0.9, ease: 'power2.inOut' };
  let view = { ...views[cfg.views.initial] };
  const proxy = { ...view };
  let tween = null;
  let reveal = null; // { zone, prev, via }
  let pinned = null;
  let drag = null;
  let nudged = false;

  function setView(v) {
    view = { x: v.x, y: v.y, w: v.w, h: v.h };
    nested.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  }
  setView(view);

  // ---------- Overlay UI (chevron + buttons) ----------
  const ui = make('div', 'map-ui');
  const slotBox = slot.getBBox();
  const slotTL = project(slotBox.x, slotBox.y);
  const slotBR = project(slotBox.x + slotBox.width, slotBox.y + slotBox.height);
  placeBox(ui, {
    left: slotTL.x / 1600 * 100, top: slotTL.y / 900 * 100,
    width: (slotBR.x - slotTL.x) / 1600 * 100, height: (slotBR.y - slotTL.y) / 900 * 100,
  });
  const chevron = make('div', 'map-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  chevron.append(make('span', 'map-chevron-glyph', '‹'), make('span', 'map-chevron-label', cfg.pan.buttons.left));
  const btnLeft = make('button', 'map-btn map-btn-left', `‹ ${cfg.pan.buttons.left}`);
  const btnRight = make('button', 'map-btn map-btn-right', `${cfg.pan.buttons.right} ›`);
  btnLeft.type = 'button'; btnRight.type = 'button';
  ui.append(chevron, btnLeft, btnRight);
  wall.overlay.append(ui);

  function syncUI() {
    chevron.classList.toggle('is-hidden', view.x < maxX - 20);
    btnLeft.disabled = view.x <= minX + 0.5;
    btnRight.disabled = view.x >= maxX - 0.5;
  }

  // ---------- Geometry cache (CSS 3D safe) ----------
  const world = document.getElementById('world');
  let slotRect = null;
  let sig = '';
  const signature = () => `${world.style.transform}|${nested.getAttribute('viewBox')}|${innerWidth}x${innerHeight}`;
  function cache() {
    slotRect = slot.getBoundingClientRect();
    zones.forEach((z) => { z.rect = z.el.getBoundingClientRect(); });
    sig = signature();
  }
  const ensureCache = () => { if (sig !== signature()) cache(); };

  function nearest(px, py) {
    ensureCache();
    let best = null;
    let bestD = Infinity;
    active.forEach((z) => {
      const r = z.rect;
      if (!r || !r.width) return;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < slotRect.left || cx > slotRect.right || cy < slotRect.top || cy > slotRect.bottom) return;
      const dx = Math.max(r.left - px, 0, px - r.right);
      const dy = Math.max(r.top - py, 0, py - r.bottom);
      const d = Math.hypot(dx, dy);
      const threshold = cfg.hover_radius_map_units * (r.width / z.bbox.width);
      if (d <= threshold && d < bestD) { best = z; bestD = d; }
    });
    return best;
  }

  // ---------- Pin ----------
  function showPin(z) {
    if (pinned === z && pinG.style.display !== 'none') return;
    pinned = z;
    const w = cfg.pin.width_map_units * (view.w / PIN_REF_VIEW_W);
    const h = w * pinVB.height / pinVB.width;
    const tipX = z.bbox.x + z.bbox.width / 2; // tip at the top-center of the zone bbox
    const tipY = z.bbox.y;
    if (pinSvg) {
      pinSvg.setAttribute('x', tipX - w / 2);
      pinSvg.setAttribute('y', tipY - h);
      pinSvg.setAttribute('width', w);
      pinSvg.setAttribute('height', h);
    }
    pinG.style.display = '';
    if (gsap && !isInstant()) {
      gsap.killTweensOf(pinG);
      gsap.fromTo(pinG, { y: -6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.15, ease: 'power1.out' });
    } else {
      if (gsap) gsap.set(pinG, { y: 0, opacity: 1 });
    }
    const note = z.cfg.note ? `\n${z.cfg.note}` : '';
    tip.show(pinSvg || z.el, labelOf(z.cfg) + note);
    live.textContent = '';
    live.textContent = labelOf(z.cfg) + (z.cfg.note ? `. ${z.cfg.note}` : '');
  }

  function hidePin() {
    pinned = null;
    if (gsap) gsap.killTweensOf(pinG);
    pinG.style.display = 'none';
    tip.hide();
  }

  // ---------- Panning ----------
  function finish() {
    tween = null;
    setView(proxy);
    syncUI();
    cache();
  }

  function panTo(target, { instant = false } = {}) {
    if (tween) { tween.kill(); tween = null; }
    hidePin();
    const t = { x: clamp(target.x, minX, maxX), y: target.y, w: target.w, h: target.h };
    Object.assign(proxy, view);
    if (!gsap || instant || isInstant()) {
      Object.assign(proxy, t);
      finish();
      return;
    }
    tween = gsap.to(proxy, {
      ...t, duration: tweenCfg.duration_s, ease: tweenCfg.ease,
      onUpdate: () => setView(proxy), onComplete: finish,
    });
  }

  const offView = (z) => z.bbox.x + z.bbox.width < view.x || z.bbox.x > view.x + view.w;

  function revealZone(z, via) {
    if (!reveal) reveal = { zone: z, prev: { ...view }, via };
    else reveal.zone = z;
    const rv = z.cfg.reveal_view && views[z.cfg.reveal_view];
    panTo(rv || { x: z.bbox.x + z.bbox.width / 2 - view.w / 2, y: view.y, w: view.w, h: view.h });
  }

  function clearReveal(restore) {
    if (!reveal) return;
    const r = reveal;
    reveal = null;
    if (restore) panTo(r.prev);
  }

  function userPan(target) {
    clearReveal(false);
    panTo(target);
  }

  btnLeft.addEventListener('click', () => userPan(views['view-norte'] || { ...view, x: minX }));
  btnRight.addEventListener('click', () => userPan(views['view-medellin'] || { ...view, x: maxX }));

  // ---------- Activation ----------
  function activate(z, viaKeyboard) {
    const rv = z.cfg.reveal_view;
    if (!viaKeyboard && rv && views[rv] && !(reveal && reveal.zone === z)) {
      revealZone(z, 'pointer');
      return;
    }
    hidePin();
    onActivate(z.cfg);
  }

  // ---------- Pointer ----------
  nested.style.touchAction = 'none';
  nested.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (tween) { tween.kill(); tween = null; Object.assign(proxy, view); }
    const sr = slot.getBoundingClientRect();
    drag = { id: e.pointerId, sx: e.clientX, viewX: view.x, k: view.w / sr.width, moved: false, type: e.pointerType };
    try { nested.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
  });

  nested.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.sx;
      if (!drag.moved && Math.abs(dx) > 4) {
        drag.moved = true;
        clearReveal(false);
        hidePin();
        nested.classList.add('dragging');
      }
      if (drag.moved) {
        // Dragging right moves the content right, so the view moves left.
        setView({ ...view, x: clamp(drag.viewX - dx * drag.k, minX, maxX) });
        Object.assign(proxy, view);
        syncUI();
      }
      return;
    }
    if (e.pointerType === 'touch') return;
    const z = nearest(e.clientX, e.clientY);
    if (z) showPin(z); else if (pinned && document.activeElement !== (pinned && pinned.el)) hidePin();
  });

  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    nested.classList.remove('dragging');
    try { nested.releasePointerCapture(e.pointerId); } catch (err) { /* not captured */ }
    if (d.moved) { finish(); return; }
    if (cancelled) return;
    const z = nearest(e.clientX, e.clientY);
    if (!z) { hidePin(); return; }
    if (d.type === 'touch') {
      if (pinned === z) activate(z); else showPin(z); // first tap shows the pin, second opens the card
    } else {
      activate(z);
    }
  }
  nested.addEventListener('pointerup', (e) => endDrag(e, false));
  nested.addEventListener('pointercancel', (e) => endDrag(e, true));
  nested.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'touch' || drag) return;
    if (!(document.activeElement && zones.some((z) => z.el === document.activeElement))) hidePin();
    if (reveal && reveal.via === 'pointer') clearReveal(true);
  });

  // ---------- Keyboard ----------
  nested.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      const step = view.w / 4;
      userPan({ ...view, x: view.x + (k === 'ArrowLeft' ? -step : step) });
    } else if (k === 'Home') {
      e.preventDefault(); e.stopPropagation();
      userPan(views['view-norte'] || { ...view, x: minX });
    } else if (k === 'End') {
      e.preventDefault(); e.stopPropagation();
      userPan(views['view-medellin'] || { ...view, x: maxX });
    }
  });

  active.forEach((z) => {
    z.el.addEventListener('focus', () => {
      if (offView(z)) revealZone(z, 'focus');
      // The pin is placed after the pan ends only if no pan is running; otherwise show it right away
      // because the pin is positioned in map units and follows the view.
      showPin(z);
    });
    z.el.addEventListener('blur', () => {
      if (pinned === z) hidePin();
      if (reveal && reveal.via === 'focus' && reveal.zone === z) clearReveal(true);
    });
    z.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation();
        activate(z, true);
      }
    });
    // Assistive-technology "click" (detail 0); real pointer clicks go through pointerup.
    z.el.addEventListener('click', (e) => { if (e.detail === 0) activate(z, true); });
  });

  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(cache);
  });

  syncUI();
  cache();

  return {
    // Call whenever a camera tween ends (or the camera is relaid out).
    refresh() { cache(); },
    // First arrival at the room: nudge toward the north and back.
    arrived() {
      cache();
      if (nudged) return;
      nudged = true;
      const n = cfg.pan.affordance && cfg.pan.affordance.first_visit_nudge_map_units;
      if (!n || !gsap || isInstant() || view.x < maxX - 0.5) return;
      Object.assign(proxy, view);
      tween = gsap.timeline({ delay: 0.5, onComplete: finish })
        .to(proxy, { x: view.x - n, duration: 0.45, ease: 'power2.out', onUpdate: () => setView(proxy) })
        .to(proxy, { x: view.x, duration: 0.55, ease: 'power2.inOut', onUpdate: () => setView(proxy) });
    },
  };
}
