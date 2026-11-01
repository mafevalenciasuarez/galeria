// Sala 2: locker banks (one door per student + "who was left out" toggle),
// plaque labels and the flip board. Everything is built from the room JSON;
// a missing SVG id is reported with console.warn and that feature is skipped.
import { q, placeBox } from './walls.js';

const NS = 'http://www.w3.org/2000/svg';
const VB = { w: 1600, h: 900 };
// Centre of the toggle + caption stack on the floor strip under the banks (viewBox units).
const UI_CENTER = { x: 367, y: 868 };

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
const pctBox = (b) => ({ left: b.x / VB.w * 100, top: b.y / VB.h * 100, width: b.width / VB.w * 100, height: b.height / VB.h * 100 });

// The shell is seven rects: shadow, outer frame, top lip, left rail, interior, base, highlight.
// Insets match the drawn bank, so a new interior keeps the same trim.
function fitShell(bank, box) {
  const rects = [...bank.children].filter((n) => n.localName === 'rect');
  if (rects.length < 7) return;
  const set = (r, x, y, w, h) => {
    r.setAttribute('x', r3(x)); r.setAttribute('y', r3(y));
    r.setAttribute('width', r3(w)); r.setAttribute('height', r3(h));
  };
  set(rects[0], box.x - 3, box.y + box.h + 12, box.w + 6, 6);
  set(rects[1], box.x - 6, box.y - 6, box.w + 12, box.h + 20);
  set(rects[2], box.x - 6, box.y - 6, box.w + 12, 6);
  set(rects[3], box.x - 6, box.y, 6, box.h);
  set(rects[4], box.x, box.y, box.w, box.h);
  set(rects[5], box.x - 8, box.y + box.h, box.w + 16, 14);
  set(rects[6], box.x - 8, box.y + box.h, box.w + 16, 3);
}

export function initRoom2({ wall, room, data, isInstant }) {
  const gsap = window.gsap;
  const ev = data.evidence || {};
  const need = (id, feature) => {
    const n = id ? q(wall, '#' + id) : null;
    if (!n) console.warn(`[sala2] #${id} not found in ${wall.id}; skipping ${feature}`);
    return n;
  };

  // Screen-reader announcements for both interactive pieces.
  const live = make('div', 'sr-only');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  wall.overlay.append(live);
  const announce = (text) => { live.textContent = text; };

  // The door groups below are role="img"; the wall svg must not hide them.
  wall.svg.removeAttribute('aria-hidden');

  initLockers();
  initBoard();

  // ---------------------------------------------------------------- lockers
  function initLockers() {
    const cfg = room.lockers;
    const L = ev.lockers;
    if (!cfg || !L || !Array.isArray(L.groups) || !L.groups.length || !L.grid) return;
    const ids = cfg.svg_ids || {};
    const container = need(ids.container || 'wall-extras', 'lockers');
    if (!container) return;
    const padlockSrc = need('padlock', 'lockers');
    if (!padlockSrc) return;
    const { cols: drawnCols, rows: drawnRows, cell_w: cw, cell_h: ch } = L.grid;
    // The two right-hand columns (five doors each, the bottom row never reaches them)
    // become one row of ten on top. The bank grows by one cell and narrows by two.
    const cols = drawnCols - 2;
    const rows = drawnRows + 1;
    // Grow both banks together, anchored to the floor and the left edge, until they
    // meet the plaques above or the chalkboard to the right. Whichever comes first wins,
    // so the doors stay in proportion and neither neighbour gets covered.
    const CLEAR = 16;
    const drawnSlots = L.groups.map((g) => q(wall, '#' + ids[`${g.id}_slot`])).filter(Boolean);
    const drawn = drawnSlots.map((n) => n.getBBox());
    const pairGap = drawn.length > 1 ? drawn[1].x - (drawn[0].x + drawn[0].width) : 0;
    if (drawn.length < L.groups.length) return;
    const floorY = drawn[0].y + drawn[0].height;
    // The base sits 8 units left of the interior. Start it near the wall so the
    // pair can grow tall enough to reach the plaques without hitting the board.
    const interiorLeft = 16;
    const plaqueBottom = Math.max(0, ...L.groups.map((g) => {
      const p = q(wall, '#plaque-' + g.id);
      if (!p) return 0;
      const b = p.getBBox();
      return b.y + b.height;
    }));
    const board = q(wall, '#board-slot');
    const boardLeft = board ? board.getBBox().x : Infinity;
    const pairSpan = 2 * cols * cw + pairGap;
    const kH = (floorY - plaqueBottom - CLEAR - 6) / (rows * ch);
    const kW = (boardLeft - CLEAR - 8 - interiorLeft) / pairSpan;
    const k = Math.max(1, Math.min(kH, kW));
    const cellW = cw * k;
    const cellH = ch * k;

    // 1. Read every door template's bbox BEFORE it leaves the render tree,
    // then regrow the shell so the new row stays inside the wood.
    const sources = L.groups.map((g, i) => {
      const tpl = need(`locker-door-${g.id}`, `lockers (${g.id})`);
      const slot = need(ids[`${g.id}_slot`], `lockers (${g.id})`);
      const bank = slot && slot.previousElementSibling;
      if (!tpl || !slot || !bank) return null;
      const bb = tpl.getBBox();
      const old = slot.getBBox();
      const box = {
        x: interiorLeft + i * (cols * cellW + pairGap * k),
        y: floorY - rows * cellH,
        w: cols * cellW,
        h: rows * cellH,
      };
      fitShell(bank, box);
      slot.setAttribute('x', r3(box.x));
      slot.setAttribute('y', r3(box.y));
      slot.setAttribute('width', r3(box.w));
      slot.setAttribute('height', r3(box.h));
      const plaque = q(wall, `#plaque-${g.id}`);
      if (plaque) plaque.setAttribute('transform', `translate(${r3((box.x + box.w / 2) - (old.x + old.width / 2))} 0)`);
      return { g, tpl, slot, bb, box };
    }).filter(Boolean);
    if (!sources.length) return;

    const frame = wall.frames.get('focus-lockers');
    if (frame) {
      const top = Math.min(...sources.map((s) => s.box.y)) - 30;
      const bottom = Math.max(...sources.map((s) => s.box.y + s.box.h)) + 28;
      frame.y = top;
      frame.h = bottom - top;
      frame.w = frame.h * 16 / 9;
    }

    const defs = svgEl('defs');
    wall.svg.insertBefore(defs, wall.svg.firstChild);
    sources.forEach((s) => defs.append(s.tpl)); // keeps its id, stops rendering

    // 2. One <g id="doors-<id>" role="img"> per group, right after its bank.
    const banks = sources.map(({ g, slot, bb }) => {
      const sb = slot.getBBox();
      const total = Math.min(g.total, cols * rows);
      if (total < g.total) console.warn(`[sala2] ${g.id}: ${g.total} doors do not fit a ${cols}x${rows} grid`);
      // Fill the cell. The drawn door (25x59) left a dark strip above it and on its right.
      const s = Math.min(cellW / bb.width, cellH / bb.height);
      const w = bb.width * s;
      const h = bb.height * s;
      const cell = (i) => ({ x: sb.x + (i % cols) * cellW, y: sb.y + Math.floor(i / cols) * cellH });

      const doors = svgEl('g', {
        id: `doors-${g.id}`, role: 'img',
        'aria-label': `${g.label}: ${g.total} estudiantes, ${g.analyzed} analizados y ${g.excluded} excluidos (${g.excluded_reason})`,
      });
      for (let i = 0; i < total; i++) {
        const c = cell(i);
        const x = c.x + (cellW - w) / 2;
        const y = c.y + (cellH - h) / 2;
        doors.append(svgEl('use', {
          href: `#locker-door-${g.id}`,
          transform: `translate(${r3(x)} ${r3(y)}) scale(${r3(s)}) translate(${r3(-bb.x)} ${r3(-bb.y)})`,
        }));
      }
      slot.after(doors);

      const marks = svgEl('g', { id: `marks-${g.id}`, 'aria-hidden': 'true' });
      doors.after(marks);
      return { g, total, cell, marks };
    });

    // 3. Excluded toggle: black veil + padlock on the last `excluded` cells.
    let on = false;
    const clearMarks = () => banks.forEach((b) => { gsap.killTweensOf(Array.from(b.marks.children)); b.marks.replaceChildren(); });
    const fill = (b) => {
      const first = Math.max(0, b.total - b.g.excluded);
      for (let i = first; i < b.total; i++) {
        const c = b.cell(i);
        const m = svgEl('g', { class: 'locker-mark' });
        m.append(
          svgEl('rect', { x: r3(c.x), y: r3(c.y), width: r3(cellW), height: r3(cellH), fill: '#000', opacity: '0.4' }),
          svgEl('use', { href: '#padlock', transform: `translate(${r3(c.x + (cellW - 10 * k) / 2)} ${r3(c.y + (cellH - 13 * k) / 2)}) scale(${r3(k)})` }),
        );
        b.marks.append(m);
      }
    };

    const stagger = cfg.stagger_s || 0.03;
    const wrap = make('div', 'lockers-ui');
    const span = sources[sources.length - 1].box;
    const midX = (sources[0].box.x + span.x + span.w) / 2;
    wrap.style.left = `${midX / VB.w * 100}%`;
    wrap.style.top = `${UI_CENTER.y / VB.h * 100}%`;
    const btn = make('button', 'lockers-toggle', L.toggle_label);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', 'false');
    wrap.append(btn);
    if (L.caption) wrap.append(make('p', 'lockers-caption', L.caption));
    wall.overlay.append(wrap);

    const message = () => 'Candados visibles: ' + banks
      .map((b) => `${b.g.excluded} del ${b.g.label.toLowerCase()} (${b.g.excluded_reason})`).join(' y ') + '.';

    btn.addEventListener('click', () => {
      on = !on;
      btn.setAttribute('aria-pressed', String(on));
      clearMarks();
      if (on) {
        banks.forEach((b) => {
          fill(b);
          if (!isInstant()) gsap.from(Array.from(b.marks.children), { opacity: 0, y: -5, duration: 0.25, stagger, ease: 'power1.out' });
        });
      }
      announce(on ? message() : 'Candados ocultos.');
    });

    // 4. Plaque labels over the invisible rects on the planks.
    const labelIds = ids.plaque_labels || {};
    banks.forEach(({ g }) => {
      const node = need(labelIds[g.id], `plaque label (${g.id})`);
      const raw = node && node.getBBox();
      let dx = 0;
      for (let n = node && node.parentNode; n && n.getAttribute; n = n.parentNode) {
        const m = /translate\(\s*([-\d.]+)/.exec(n.getAttribute('transform') || '');
        if (m) dx += +m[1];
      }
      const box = raw && pctBox({ x: raw.x + dx, y: raw.y, width: raw.width, height: raw.height });
      if (!box || (!g.plaque_label && !g.plaque_sub)) return;
      const d = make('div', 'plaque-label');
      placeBox(d, box);
      if (g.plaque_label) d.append(make('strong', '', g.plaque_label));
      if (g.plaque_sub) d.append(make('span', '', g.plaque_sub));
      wall.overlay.append(d);
    });
  }

  // ------------------------------------------------------------- flip board
  function initBoard() {
    const cfg = room.board;
    const B = ev.board;
    if (!cfg || !B || !B.front || !B.back) return;
    const ids = cfg.svg_ids || {};
    const art = need(ids.art, 'flip board');
    const slot = need(ids.slot, 'flip board');
    const area = need(ids.text_area, 'flip board');
    if (!art || !slot || !area) return;
    const flip = cfg.flip || {};
    const sb = slot.getBBox();
    const tb = area.getBBox();
    const viewBox = `${sb.x} ${sb.y} ${sb.width} ${sb.height}`;
    const backdrop = cfg.text_backdrop || {};

    const root = make('div', 'board-flip');
    root.tabIndex = 0;
    root.setAttribute('role', 'button');
    root.setAttribute('aria-label', `${B.flip_label}: ${B.front.title.toLowerCase()} / ${B.back.title.toLowerCase()}`);
    placeBox(root, pctBox(sb));
    root.style.perspective = `${flip.perspective_px || 900}px`;
    const card = make('div', 'board-card');

    const face = (content, isBack) => {
      const f = make('div', 'board-face' + (isBack ? ' board-face-back' : ''));
      f.setAttribute('aria-hidden', String(isBack));
      const svg = svgEl('svg', { viewBox, preserveAspectRatio: 'none', focusable: 'false', 'aria-hidden': 'true' });
      const clone = art.cloneNode(true);
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      svg.append(clone);
      f.append(svg);

      const text = make('div', 'board-text');
      placeBox(text, {
        left: (tb.x - sb.x) / sb.width * 100, top: (tb.y - sb.y) / sb.height * 100,
        width: tb.width / sb.width * 100, height: tb.height / sb.height * 100,
      });
      const bg = make('div', 'board-backdrop');
      if (backdrop.color) bg.style.background = backdrop.color;
      if (backdrop.opacity != null) bg.style.opacity = backdrop.opacity;
      const copy = make('div', 'board-copy');
      copy.append(make('h3', '', content.title));
      (content.lines || []).forEach((line) => {
        const p = make('p');
        const cut = line.indexOf(': ');
        if (cut > 0 && cut < 28) p.append(make('strong', '', line.slice(0, cut + 1)), ' ' + line.slice(cut + 2));
        else p.textContent = line;
        copy.append(p);
      });
      text.append(bg, copy);
      f.append(text);
      return f;
    };
    const front = face(B.front, false);
    const back = face(B.back, true);
    card.append(front, back);
    root.append(card);
    if (B.flip_label) {
      const hint = make('span', 'board-hint');
      hint.append(make('span', 'board-hint-glyph', '\u21BB'), ' ' + B.flip_label);
      hint.setAttribute('aria-hidden', 'true');
      root.append(hint);
    }
    wall.overlay.append(root);
    art.setAttribute('visibility', 'hidden'); // after both clones exist

    let flipped = false;
    const settle = (wasFlipped) => {
      gsap.killTweensOf([card, back]);
      if (card.classList.contains('xfade')) {
        card.classList.remove('xfade');
        gsap.set(back, { clearProps: 'opacity' });
        gsap.set(card, { rotationY: wasFlipped ? 180 : 0 });
      }
    };
    const toggle = () => {
      const was = flipped;
      settle(was);
      flipped = !flipped;
      front.setAttribute('aria-hidden', String(flipped));
      back.setAttribute('aria-hidden', String(!flipped));
      const shown = flipped ? B.back : B.front;
      announce(`${shown.title}. ${(shown.lines || []).join(' ')}`);
      if (!isInstant()) {
        gsap.to(card, { rotationY: flipped ? 180 : 0, duration: flip.duration_s || 0.8, ease: 'power2.inOut' });
        return;
      }
      // Reduced motion: no rotation, a short crossfade of the faces.
      gsap.set(card, { rotationY: 0 });
      card.classList.add('xfade');
      gsap.fromTo(back, { opacity: flipped ? 0 : 1 }, {
        opacity: flipped ? 1 : 0, duration: 0.2, ease: 'none',
        onComplete: () => {
          card.classList.remove('xfade');
          gsap.set(back, { clearProps: 'opacity' });
          gsap.set(card, { rotationY: flipped ? 180 : 0 });
        },
      });
    };
    root.addEventListener('click', toggle);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  }
}
