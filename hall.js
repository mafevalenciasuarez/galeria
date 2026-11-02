// Hall shell, ported from walls/route-demo.html. Each straight run (same heading, classroom excluded)
// is a rectangle in front of its walls. Floor and ceiling are the union of those rectangles with no
// overlaps, cut into small blocks whose textures stay aligned to world coordinates. Wall-fill panels
// sit on the contour of that union, plus a reverse panel behind every real wall except the door.
import { makeWoodTexture, woodCeilingStyle } from './wood-ceiling.js';

const DIRS = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
const dirOf = (k) => DIRS[((k % 4) + 4) % 4];
const mod = (v, m) => ((v % m) + m) % m;

// Rectangle a minus rectangle b. Shared edges (zero area) are left alone.
function subtract(p, o) {
  const ix0 = Math.max(p.xa, o.xa);
  const ix1 = Math.min(p.xb, o.xb);
  const iz0 = Math.max(p.za, o.za);
  const iz1 = Math.min(p.zb, o.zb);
  if (ix0 >= ix1 || iz0 >= iz1) return [p];
  const out = [];
  if (p.za < iz0) out.push({ xa: p.xa, xb: p.xb, za: p.za, zb: iz0 });
  if (iz1 < p.zb) out.push({ xa: p.xa, xb: p.xb, za: iz1, zb: p.zb });
  if (p.xa < ix0) out.push({ xa: p.xa, xb: ix0, za: iz0, zb: iz1 });
  if (ix1 < p.xb) out.push({ xa: ix1, xb: p.xb, za: iz0, zb: iz1 });
  return out;
}

export function createHallShell({ camera, world, route }) {
  const worldCfg = (route && route.world) || {};
  const shell = worldCfg.hall_shell;
  if (!shell) return null;
  const ceiling = worldCfg.ceiling;
  const floor = worldCfg.floor;
  const segments = (route && route.segments) || [];
  const floorUnits = shell.walls_end_at_floor_units || (floor && floor.y_units) || 822;
  const tileUnits = shell.tile_width_units || 464.17;
  const depthFactor = shell.hall_depth_factor || 1.4;
  const blocks = (shell.floor_and_ceiling && shell.floor_and_ceiling.blocks_px) || { ceiling: 512, floor: 450 };

  let wood = null;
  if (ceiling && ceiling.enabled && ceiling.type === 'wood') {
    try {
      wood = {
        url: makeWoodTexture({
          tilePx: ceiling.tile_px, plankPx: ceiling.plank_px, seed: ceiling.seed, knotProb: ceiling.knot_prob,
        }),
        tilePx: ceiling.tile_px || 1024,
        base: ceiling.base_color,
      };
    } catch (err) {
      console.warn('[hall] sin lienzo para el techo', err);
    }
  }

  const root = document.createElement('div');
  root.className = 'hall-shell';
  root.setAttribute('aria-hidden', 'true');
  world.append(root);
  camera.addProp(root, () => '');

  const floorStyle = (el, x0, z0) => {
    const color = (floor && floor.color) || '#8d6547';
    const line = (floor && floor.line_color) || 'rgba(60,40,28,.30)';
    const cross = (floor && floor.cross_line_color) || 'rgba(60,40,28,.18)';
    const linePx = (floor && floor.line_px) || 150;
    const crossPx = (floor && floor.cross_px) || 300;
    const w = (floor && floor.line_width_px) || 4;
    el.style.backgroundColor = color;
    el.style.backgroundImage = `linear-gradient(180deg, transparent 0 ${linePx - w}px, ${line} ${linePx - w}px ${linePx}px), linear-gradient(90deg, transparent 0 ${crossPx - w}px, ${cross} ${crossPx - w}px ${crossPx}px)`;
    el.style.backgroundSize = `100% ${linePx}px, ${crossPx}px 100%`;
    el.style.backgroundRepeat = 'repeat-y, repeat-x';
    el.style.backgroundPosition = `0 ${-mod(z0, linePx)}px, ${-mod(x0, crossPx)}px 0`;
  };

  const ceilStyle = (el, x0, z0) => {
    if (!wood) { el.style.backgroundColor = (ceiling && ceiling.color) || '#cfa873'; return; }
    Object.assign(el.style, woodCeilingStyle(wood.url, { tilePx: wood.tilePx, base: wood.base }));
    el.style.backgroundPosition = `${-mod(x0, wood.tilePx)}px ${-mod(z0, wood.tilePx)}px`;
  };

  function block(cls, y, x0, x1, z0, z1) {
    const el = document.createElement('div');
    el.className = 'plane ' + cls;
    el.style.cssText = `width:${x1 - x0}px;height:${z1 - z0}px;transform:translate3d(${x0}px,${y}px,${z0}px) rotateX(90deg);`;
    if (cls === 'ceiling') ceilStyle(el, x0, z0);
    else floorStyle(el, x0, z0);
    root.append(el);
  }

  function blocksOf(piece, yCeil, yFloor) {
    for (const cls of ['ceiling', 'floor']) {
      if (cls === 'ceiling' && !(ceiling && ceiling.enabled)) continue;
      if (cls === 'floor' && !(floor && floor.enabled)) continue;
      const C = cls === 'ceiling' ? blocks.ceiling : blocks.floor;
      const y = cls === 'ceiling' ? yCeil : yFloor;
      for (let x0 = piece.xa; x0 < piece.xb; x0 += C) {
        for (let z0 = piece.za; z0 < piece.zb; z0 += C) {
          block(cls, y, x0, Math.min(x0 + C, piece.xb), z0, Math.min(z0 + C, piece.zb));
        }
      }
    }
  }

  // Stops in route order, with the same door / corner / room flags as route-demo.html.
  function routeStops() {
    const stops = [];
    let pendingRoom = false;
    for (const seg of segments) {
      if (seg.type === 'straight') {
        for (const id of seg.walls || []) {
          const L = camera.layout.get(id);
          if (!L || stops.some((s) => s.id === id)) continue;
          stops.push({ id, ...L, room: pendingRoom, door: false, corner: null, Lr: 0 });
          pendingRoom = false;
        }
      } else if (seg.type === 'door_enter') {
        const last = stops[stops.length - 1];
        const found = camera.doors.find((d) => d.between[0] === (last && last.id));
        if (last) { last.door = true; last.Lr = found ? found.Lr : 0; }
        pendingRoom = true;
      } else if (seg.type === 'corner_90' || seg.type === 'corner_90_outside') {
        const last = stops[stops.length - 1];
        if (last) last.corner = { type: seg.type };
      }
    }
    return stops;
  }

  function layout() {
    const { wallPx: W, wallTop, dist } = camera.dims;
    if (!W) return;
    root.replaceChildren();
    const K = W / 1600;
    const fullH = W * 9 / 16;
    const visH = floorUnits * K;
    const topY = wallTop;
    const floorY = wallTop + visH;
    const Wd = depthFactor * dist;
    const stops = routeStops();

    const runs = [];
    let cur = null;
    for (const st of stops) {
      if (st.room) continue;
      if (!cur) { cur = { k: st.k, d: st.d, n: st.n, S: { ...st.O }, count: 0, ends: null }; runs.push(cur); }
      cur.count += 1;
      if (st.corner || st.door) { cur.ends = st.corner ? st.corner.type : 'door'; cur = null; }
    }
    runs.forEach((r, i) => {
      r.len = r.count * W;
      const prev = runs[i - 1];
      // Inside corner: the next rectangle starts +Wd along its direction. Outside: -Wd.
      r.a = (prev && prev.ends && prev.ends !== 'door') ? Wd * (r.d.x * prev.n.x + r.d.z * prev.n.z) : 0;
      r.b = r.len;
    });
    const pt = (r, along, depth) => ({
      x: r.S.x + r.d.x * along + r.n.x * depth,
      z: r.S.z + r.d.z * along + r.n.z * depth,
    });
    const rects = [];
    for (const r of runs) {
      if (r.a >= r.b) continue;
      const p0 = pt(r, r.a, 0);
      const p1 = pt(r, r.b, Wd);
      rects.push({
        xa: Math.min(p0.x, p1.x), xb: Math.max(p0.x, p1.x),
        za: Math.min(p0.z, p1.z), zb: Math.max(p0.z, p1.z),
        n: r.n,
      });
    }
    const pieces = [];
    rects.forEach((R, i) => {
      let parts = [R];
      for (let j = 0; j < i; j++) parts = parts.flatMap((q) => subtract(q, rects[j]));
      pieces.push(...parts);
    });
    pieces.forEach((q) => blocksOf(q, topY, floorY));

    // Classroom floor and ceiling: one piece between the side walls, then the same blocks.
    // Anything that would cross a hall rectangle is cut away.
    for (const dr of camera.doors) {
      const LD = camera.layout.get(dr.between[0]);
      if (!LD) continue;
      const a = { x: LD.O.x - LD.n.x * dr.Lr, z: LD.O.z - LD.n.z * dr.Lr };
      const b = { x: LD.O.x + LD.d.x * W, z: LD.O.z + LD.d.z * W };
      let parts = [{
        xa: Math.min(a.x, b.x), xb: Math.max(a.x, b.x),
        za: Math.min(a.z, b.z), zb: Math.max(a.z, b.z),
      }];
      rects.forEach((h) => { parts = parts.flatMap((q) => subtract(q, h)); });
      parts.forEach((q) => blocksOf(q, topY, floorY));
    }

    const tile = tileUnits * K;
    const panel = (O, kk, len) => {
      const C = 4 * tile;
      const dd = dirOf(kk);
      for (let a0 = 0; a0 < len; a0 += C) {
        const w = Math.min(C, len - a0);
        const el = document.createElement('div');
        el.className = 'panel';
        el.style.cssText = `width:${w}px;height:${visH}px;top:${topY}px;background-image:url(${shell.wall_fill_svg});background-size:${tile}px ${fullH}px;transform:translate3d(${O.x + dd.x * a0}px,0,${O.z + dd.z * a0}px) rotateY(${-90 * kk}deg);`;
        root.append(el);
      }
    };

    // Reverse of each real wall except the door, 2px behind it, so the wall is opaque from both sides.
    for (const st of stops) {
      if (st.room || st.door) continue;
      const kk = st.k + 2;
      panel({ x: st.O.x + st.d.x * W - st.n.x * 2, z: st.O.z + st.d.z * W - st.n.z * 2 }, kk, W);
    }

    const inRects = (x, z) => rects.some((r) => x > r.xa && x < r.xb && z > r.za && z < r.zb);
    const realWalls = stops.filter((st) => !st.room).map((st) => {
      const e = { x: st.O.x + st.d.x * W, z: st.O.z + st.d.z * W };
      return st.d.z === 0
        ? { o: 'H', c: st.O.z, u0: Math.min(st.O.x, e.x), u1: Math.max(st.O.x, e.x) }
        : { o: 'V', c: st.O.x, u0: Math.min(st.O.z, e.z), u1: Math.max(st.O.z, e.z) };
    });
    const onRealWall = (o, c, m) => realWalls.some((w) => w.o === o && Math.abs(w.c - c) < 1 && m > w.u0 && m < w.u1);

    for (const R of rects) {
      const sides = [
        { o: 'H', c: R.za, u0: R.xa, u1: R.xb, nu: { x: 0, z: 1 } },
        { o: 'H', c: R.zb, u0: R.xa, u1: R.xb, nu: { x: 0, z: -1 } },
        { o: 'V', c: R.xa, u0: R.za, u1: R.zb, nu: { x: 1, z: 0 } },
        { o: 'V', c: R.xb, u0: R.za, u1: R.zb, nu: { x: -1, z: 0 } },
      ];
      for (const sd of sides) {
        if (sd.nu.x === R.n.x && sd.nu.z === R.n.z) continue; // the real-wall side carries the art
        const bps = [sd.u0, sd.u1];
        for (const o of rects) {
          for (const v of (sd.o === 'H' ? [o.xa, o.xb] : [o.za, o.zb])) {
            if (v > sd.u0 && v < sd.u1) bps.push(v);
          }
        }
        bps.sort((a, b) => a - b);
        for (let i = 0; i < bps.length - 1; i++) {
          const u0 = bps[i];
          const u1 = bps[i + 1];
          if (u1 - u0 < 1) continue;
          const m = (u0 + u1) / 2;
          const out = sd.o === 'H' ? inRects(m, sd.c - sd.nu.z) : inRects(sd.c - sd.nu.x, m);
          if (out || onRealWall(sd.o, sd.c, m)) continue;
          if (sd.o === 'H') {
            if (sd.nu.z === 1) panel({ x: u0, z: sd.c }, 0, u1 - u0);
            else panel({ x: u1, z: sd.c }, 2, u1 - u0);
          } else if (sd.nu.x === -1) panel({ x: sd.c, z: u0 }, 1, u1 - u0);
          else panel({ x: sd.c, z: u1 }, 3, u1 - u0);
        }
      }
    }

    // The hall keeps going past both sides of the door, so a wide window does not show the background.
    // A panel that lands on a real wall is skipped (the previous room already occupies that side).
    for (const st of stops) {
      if (!st.door) continue;
      [[-W, W], [W, W]].forEach(([x0, len]) => {
        const mid = x0 + len / 2;
        const mx = st.O.x + st.d.x * mid;
        const mz = st.O.z + st.d.z * mid;
        const horiz = st.d.z === 0;
        if (onRealWall(horiz ? 'H' : 'V', horiz ? st.O.z : st.O.x, horiz ? mx : mz)) return;
        panel({ x: st.O.x + st.d.x * x0, z: st.O.z + st.d.z * x0 }, st.k, len);
      });
    }
  }

  const prev = camera.onMeasure;
  camera.onMeasure = () => { if (prev) prev(); layout(); };
  return { layout };
}
