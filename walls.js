// Wall loading (inline SVG or placeholder) and overlay construction.

const VB = { w: 1600, h: 900 };

export const basename = (p) => p.split('/').pop().replace(/\.svg$/i, '');

// getBBox of an SVG element as percentages of the 1600x900 viewBox.
export function bboxBox(el) {
  if (!el || !el.getBBox) return null;
  try {
    const b = el.getBBox();
    return { left: b.x / VB.w * 100, top: b.y / VB.h * 100, width: b.width / VB.w * 100, height: b.height / VB.h * 100 };
  } catch (e) {
    return null;
  }
}

// Rect with an optional rotate() transform: centre and angle in viewBox percentages.
export function tiltedBox(rect) {
  const x = +rect.getAttribute('x'), y = +rect.getAttribute('y');
  const w = +rect.getAttribute('width'), h = +rect.getAttribute('height');
  const list = rect.transform.baseVal;
  const m = list.numberOfItems ? list.consolidate().matrix : new DOMMatrix();
  const c = new DOMPoint(x + w / 2, y + h / 2).matrixTransform(m);
  return { cx: c.x / VB.w * 100, cy: c.y / VB.h * 100, width: w / VB.w * 100, height: h / VB.h * 100, angle: Math.atan2(m.b, m.a) * 180 / Math.PI };
}

export function placeBox(node, box) {
  Object.assign(node.style, { left: box.left + '%', top: box.top + '%', width: box.width + '%', height: box.height + '%' });
}

const make = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// Query inside one wall only: ids such as #speaker repeat across walls.
export const q = (wall, sel) => wall.el.querySelector(sel);

export async function loadWall({ index, id, svgPath, title, framesFallback }) {
  const el = make('section', 'wall');
  el.dataset.wall = id;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', title);
  const wall = { id, index, el, title, frames: new Map(), placeholder: false, overlay: null, svg: null };

  try {
    const res = await fetch(svgPath);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = (await res.text()).replace(/<\?xml[\s\S]*?\?>/, '').replace(/<!DOCTYPE[\s\S]*?>/i, '').trim();
    el.insertAdjacentHTML('afterbegin', text);
    const svg = el.querySelector(':scope > svg');
    if (!svg) throw new Error('No <svg> root');
    // Exported root ids (Layer_1, bg-1) are normalized in the DOM only; the file stays untouched.
    svg.id = id;
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    wall.svg = svg;

    const group = svg.querySelector('#focus-frames');
    const rects = group ? group.querySelectorAll('rect[id^="focus-"]') : [];
    rects.forEach((r) => {
      wall.frames.set(r.id, { x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') });
    });
    if (group) group.style.display = 'none'; // never render focus rects
    if (!wall.frames.size) {
      const list = framesFallback && framesFallback[id];
      if (list) {
        list.forEach((f) => wall.frames.set(f.id, { x: f.x, y: f.y, w: f.w, h: f.h }));
        console.info(`[walls] ${id}: no <g id="focus-frames"> in the SVG; using tools/frames.json`);
      }
    }
    if (!wall.frames.has('focus-frame')) wall.frames.set('focus-frame', { x: 0, y: 0, w: VB.w, h: VB.h });
  } catch (err) {
    console.info(`[walls] ${id}: SVG unavailable (${err.message}); rendering placeholder`);
    wall.placeholder = true;
    el.innerHTML = '';
    const ph = make('div', 'placeholder');
    ph.append(
      make('div', 'ph-wainscot'),
      make('div', 'ph-floor'),
      make('div', 'ph-lintel', title),
      make('p', 'ph-caption', 'Pared en construcción'),
    );
    el.append(ph);
    wall.frames.set('focus-frame', { x: 0, y: 0, w: VB.w, h: VB.h });
  }

  wall.overlay = make('div', 'overlay');
  el.append(wall.overlay);
  return wall;
}

// Accessible hotspot sized from the element's getBBox.
export function hotspot(wall, svgEl, { label, onActivate, cls = '', onEnter, onLeave }) {
  const box = bboxBox(svgEl);
  if (!box) return null;
  const d = make('div', 'hotspot ' + cls);
  d.tabIndex = 0;
  d.setAttribute('role', 'button');
  d.setAttribute('aria-label', label);
  placeBox(d, box);
  d.addEventListener('click', (e) => { e.preventDefault(); onActivate(d); });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(d); }
  });
  if (onEnter) {
    d.addEventListener('pointerenter', () => onEnter(d));
    d.addEventListener('focus', () => onEnter(d));
  }
  if (onLeave) {
    d.addEventListener('pointerleave', () => onLeave(d));
    d.addEventListener('blur', () => onLeave(d));
  }
  wall.overlay.append(d);
  return d;
}

export function buildIntro(wall, gallery, h) {
  const { meta, intro } = gallery;
  const sign = q(wall, '#lintel-sign');
  if (sign) {
    const box = bboxBox(sign);
    const t = make('div', 'lintel-title', meta.title);
    placeBox(t, box);
    wall.overlay.append(t);
  }

  // Title of the directory board (invisible shape drawn in the SVG).
  const dirTitle = q(wall, '#directory-board-title');
  const dtBox = bboxBox(dirTitle);
  if (dtBox && intro.directory_board && intro.directory_board.title) {
    const t = make('h2', 'dir-title', intro.directory_board.title);
    placeBox(t, dtBox);
    wall.overlay.append(t);
  }

  const entries = (intro.directory_board && intro.directory_board.entries) || [];
  entries.forEach((entry, i) => {
    const slot = q(wall, `#dir-slot-${i + 1}`);
    const box = bboxBox(slot);
    if (!box) return;
    const b = make('button', 'dir-label', entry.label);
    b.type = 'button';
    placeBox(b, box);
    b.addEventListener('click', () => h.goToTarget(entry.target));
    wall.overlay.append(b);
  });

  // Bulletin board: one rule per paper sheet (invisible rects, possibly rotated).
  const items = (intro.bulletin_board && intro.bulletin_board.items) || [];
  let sheets = [...wall.el.querySelectorAll('#bulletin-board rect[id^="sheet"]')];
  if (sheets.length < items.length) {
    // Fallback while sheet2/sheet3 have no id in the SVG: all invisible rects, in document order.
    sheets = [...wall.el.querySelectorAll('#bulletin-board rect[fill="none"]')];
  }
  const board = q(wall, '#bulletin-board');
  if (intro.bulletin_board) {
    if (sheets.length >= items.length && items.length) {
      // Title band: on the cork, below the wooden frame and above the sheets.
      // The cork is inset from the frame; of the two largest inset shapes, the lower one is the cork.
      const boardBox = bboxBox(board);
      const boardTop = board.getBBox().y;
      const inset = [];
      board.childNodes.forEach((k) => {
        if (!k.getBBox) return;
        const b = k.getBBox();
        if (b.y > boardTop + 2) inset.push({ top: b.y, area: b.width * b.height });
      });
      inset.sort((a, b) => b.area - a.area);
      const corkTop = inset.length > 1 ? Math.max(inset[0].top, inset[1].top) : (inset[0] ? inset[0].top : boardTop);
      const bandTop = corkTop / VB.h * 100;
      // Use the rotated bounding box: a tilted sheet's corner sits above its unrotated top edge.
      const sheetTop = Math.min(...sheets.slice(0, items.length).map((s) => {
        const b = tiltedBox(s);
        const a = Math.abs(b.angle) * Math.PI / 180;
        return b.cy - (b.height / 2) * Math.cos(a) - (b.width / 2) * Math.sin(a);
      })) - 1.2;
      if (boardBox && sheetTop > bandTop) {
        const h2 = make('h2', 'bulletin-title', intro.bulletin_board.title);
        Object.assign(h2.style, {
          left: boardBox.left + '%', width: boardBox.width + '%',
          top: bandTop + '%', height: (sheetTop - bandTop) + '%',
        });
        wall.overlay.append(h2);
      }
      items.forEach((text, i) => {
        const b = tiltedBox(sheets[i]);
        const note = make('p', 'sheet-text', text);
        Object.assign(note.style, {
          left: (b.cx - b.width / 2) + '%', top: (b.cy - b.height / 2) + '%',
          width: b.width + '%', height: b.height + '%', transform: `rotate(${b.angle}deg)`,
        });
        wall.overlay.append(note);
      });
    } else {
      const bbox = bboxBox(board);
      if (bbox) {
        const wrap = make('div', 'bulletin');
        placeBox(wrap, bbox);
        wrap.append(make('h2', 'bulletin-title', intro.bulletin_board.title));
        const ul = make('ul');
        items.forEach((it) => ul.append(make('li', '', it)));
        wrap.append(ul);
        wall.overlay.append(wrap);
      }
    }
  }
  const door = q(wall, '#door-main');
  if (door) hotspot(wall, door, { label: intro.cta || 'Entrar a la galería', cls: 'door-hotspot', onActivate: h.enter });

  const mat = q(wall, '#doormat');
  const mbox = bboxBox(mat);
  if (mbox) {
    const cta = make('button', 'cta', intro.cta);
    cta.type = 'button';
    placeBox(cta, mbox);
    cta.addEventListener('click', h.enter);
    wall.overlay.append(cta);

    const skip = make('button', 'skip-link', intro.cta_secondary);
    skip.type = 'button';
    Object.assign(skip.style, { left: mbox.left + '%', width: mbox.width + '%', top: (mbox.top + mbox.height + 0.8) + '%' });
    skip.addEventListener('click', h.skip);
    wall.overlay.append(skip);
  }

  const sp = q(wall, '#speaker');
  if (sp) hotspot(wall, sp, { label: 'Altavoz de bienvenida: activar o pausar el audio', cls: 'speaker-hotspot', onActivate: h.speaker });
}

export function buildRoom(wall, room, h) {
  const sp = q(wall, '#speaker');
  if (sp) hotspot(wall, sp, { label: 'Altavoz de la sala: activar o pausar el audio', cls: 'speaker-hotspot', onActivate: h.speaker });

  (room.hotspots || []).forEach((hs) => {
    const node = q(wall, '#' + hs.id);
    if (!node) return;
    if (hs.type === 'cerro') {
      hotspot(wall, node, {
        label: `Cerro ${hs.label}`,
        cls: 'cerro-hotspot',
        onActivate: (d) => h.showTip(d, hs.label),
        onEnter: (d) => h.showTip(d, hs.label),
        onLeave: () => h.hideTip(),
      });
    } else if (hs.id === 'letter-note') {
      hotspot(wall, node, { label: hs.label, cls: 'letter-hotspot', onActivate: () => h.letter(hs) });
    }
  });

  const slot = q(wall, '#content-slot');
  if (slot) hotspot(wall, slot, { label: 'Abrir la tarjeta de la sala', cls: 'content-hotspot', onActivate: h.openCard });
}

// Debug: draw each focus frame with its id.
export function drawDebug(wall) {
  wall.frames.forEach((f, id) => {
    const d = make('div', 'debug-rect');
    placeBox(d, { left: f.x / VB.w * 100, top: f.y / VB.h * 100, width: f.w / VB.w * 100, height: f.h / VB.h * 100 });
    d.append(make('span', '', id));
    wall.overlay.append(d);
  });
}

// Wall-fill: walls/wall-fill.svg is a vertical slice of the wall (viewBox height 900,
// same as the walls). Side gaps show the whole slice stretched; the top and bottom
// gaps show a 1-unit strip of its edge, so the bands line up with the wall.
const FILL_VB = { w: 464.17, h: 900 };
const FILL_SLICES = {
  left: `0 0 ${FILL_VB.w} ${FILL_VB.h}`,
  right: `0 0 ${FILL_VB.w} ${FILL_VB.h}`,
  top: `0 0 ${FILL_VB.w} 1`,
  bottom: `0 ${FILL_VB.h - 1} ${FILL_VB.w} 1`,
};
let fillTemplate = null;

export function setFillTemplate(svgText) {
  const host = document.createElement('div');
  host.innerHTML = svgText.replace(/<\?xml[\s\S]*?\?>/, '').trim();
  const svg = host.querySelector('svg');
  if (!svg) return;
  const defs = svg.querySelector('defs');
  if (defs) defs.remove();
  // The clip equals the viewBox, so dropping it changes nothing visible.
  svg.querySelectorAll('[clip-path]').forEach((n) => n.removeAttribute('clip-path'));
  svg.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  fillTemplate = svg;
}

export function buildFills(wall, { first, last }) {
  const sides = ['top', 'bottom'];
  if (first) sides.push('left');
  if (last) sides.push('right');
  wall.fills = sides.map((side) => {
    const d = make('div', `wall-fill fill-${side}`);
    d.setAttribute('aria-hidden', 'true');
    const src = fillTemplate || wall.svg;
    if (src) {
      const c = src.cloneNode(true);
      c.setAttribute('viewBox', fillTemplate ? FILL_SLICES[side] : { left: '0 0 1 900', right: '1599 0 1 900', top: '0 0 1600 1', bottom: '0 899 1600 1' }[side]);
      c.setAttribute('preserveAspectRatio', 'none');
      d.append(c);
    } else {
      d.classList.add('fill-placeholder');
    }
    return { side, el: d };
  });
  return wall.fills;
}