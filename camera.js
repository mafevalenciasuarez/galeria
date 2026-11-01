// Camera: pose (Ex, Ey, Ez, yaw) applied as one transform on #world.
// Walls are placed from route.segments: straight runs along +x, and after a
// corner_90 (right turn) the next walls run along +z. Math for the corner
// turn is the one in walls/corner-demo.html.

const FILL_EXTRA = 2000; // px a wall-fill strip extends beyond the wall

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createCamera({ scene, world, route = null, P: defaultP = 1200, debug = false }) {
  const P = (route && route.world && route.world.perspective_px) || defaultP;
  const segments = (route && route.segments) || [];
  const cornerSeg = segments.find((s) => s.type === 'corner_90') || null;

  const walls = new Map(); // wallId -> { id, index, el, frames: Map(frameId -> {x,y,w,h}) }
  const layout = new Map(); // wallId -> { h: 0|1, x0 } | { h: 1, xr, z0 }
  const dims = { vw: 0, vh: 0, wallPx: 0, wallTop: 0 };
  // Camera pose: position in world px, yaw in degrees.
  const cam = { x: 0, y: 0, z: 0, yaw: 0 };
  let target = null;
  let tween = null;

  const api = {
    P,
    corner: cornerSeg,
    userInstant: false,
    onArrive: null,
    // The OS reduced-motion setting does not drive this. Only the gallery button does.
    get instant() { return api.userInstant || !window.gsap; },
    get current() { return target; },
    get state() { return { x: cam.x, y: cam.y, z: cam.z, yaw: cam.yaw }; },
  };

  scene.style.perspective = P + 'px';

  // The camera matrix is applied to each wall (and its fills) instead of to #world.
  // Chrome stops hit-testing the children of a preserve-3d ancestor that is rotated
  // edge-on (yaw 90), so hotspots on the walls after the corner would not receive clicks.
  const layoutTf = new Map(); // wallId -> layout transform string
  const planes = []; // { el, yUnits, layoutTf } horizontal ceiling / floor
  const MAX_PLANE = 8000; // px, neither side of a plane may exceed this

  function register(wall) { walls.set(wall.id, wall); }

  // Route-driven placement. Heading 0 runs along +x; a right corner puts the
  // next walls on x = xr, running along +z with the first wall's left edge at C = (xr, 0).
  function computeLayout() {
    const W = dims.wallPx;
    layout.clear();
    let heading = 0;
    let cursor = 0; // x0 for heading 0, z0 for heading 1
    let xr = 0;
    const put = (id) => {
      if (heading === 0) layout.set(id, { h: 0, x0: cursor });
      else layout.set(id, { h: 1, xr, z0: cursor });
      cursor += W;
    };
    for (const seg of segments) {
      if (seg.type === 'corner_90') {
        xr = cursor; // right edge of the previous wall
        heading = 1;
        cursor = 0;
      } else {
        (seg.walls || []).forEach((id) => { if (walls.has(id)) put(id); });
      }
    }
    // Walls missing from the route continue the last heading.
    [...walls.values()].sort((a, b) => a.index - b.index).forEach((w) => { if (!layout.has(w.id)) put(w.id); });
  }

  const wallTransform = (L) => (L.h === 0
    ? `translate3d(${L.x0}px, 0, 0)`
    : `translate3d(${L.xr}px, 0, ${L.z0}px) rotateY(-90deg)`);

  // Recompute wall size/position from the viewport.
  function measure() {
    dims.vw = scene.clientWidth;
    dims.vh = scene.clientHeight;
    dims.wallPx = Math.min(dims.vw, dims.vh * 16 / 9);
    dims.wallTop = (dims.vh - dims.wallPx * 9 / 16) / 2;
    computeLayout();
    const wh = dims.wallPx * 9 / 16;
    for (const w of walls.values()) {
      layoutTf.set(w.id, wallTransform(layout.get(w.id)));
      Object.assign(w.el.style, {
        width: dims.wallPx + 'px',
        height: wh + 'px',
        left: '0px',
        top: dims.wallTop + 'px',
      });
      // Wall-fill strips sit outside the wall on the same plane (wall-local coordinates).
      const X = FILL_EXTRA;
      const fills = w.fills || [];
      const overL = fills.some((f) => f.side === 'left') ? X : 0;
      const overR = fills.some((f) => f.side === 'right') ? X : 0;
      const boxes = {
        left: [-X, dims.wallTop, X + 1, wh], // +1px overlap hides the seam
        right: [dims.wallPx - 1, dims.wallTop, X + 1, wh],
        top: [-overL, dims.wallTop - X, dims.wallPx + overL + overR, X + 1],
        bottom: [-overL, dims.wallTop + wh - 1, dims.wallPx + overL + overR, X + 1],
      };
      fills.forEach(({ side, el }) => {
        const [left, top, width, height] = boxes[side];
        Object.assign(el.style, {
          left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px',
          transformOrigin: '0 0',
        });
      });
    }
    layoutPlanes();
  }

  function setPlanes(list) { planes.length = 0; planes.push(...list); }

  // Bounding box of every wall footprint, extended by margin_factor * wallPx on the
  // open sides only. A heading-0 wall closes z below it; a heading-1 wall closes x past it.
  function planeBox() {
    const W = dims.wallPx;
    const margin = (((route && route.world && route.world.planes) || {}).margin_factor || 0) * W;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let closeMinZ = false, closeMaxX = false;
    for (const L of layout.values()) {
      if (!L) continue;
      if (L.h === 0) {
        minX = Math.min(minX, L.x0); maxX = Math.max(maxX, L.x0 + W);
        minZ = Math.min(minZ, 0); maxZ = Math.max(maxZ, 0);
      } else {
        minX = Math.min(minX, L.xr); maxX = Math.max(maxX, L.xr);
        minZ = Math.min(minZ, L.z0); maxZ = Math.max(maxZ, L.z0 + W);
      }
    }
    if (!isFinite(minX)) return null;
    for (const L of layout.values()) {
      if (L.h === 0) closeMinZ = true;
      if (L.h === 1 && Math.abs(L.xr - maxX) < 0.5) closeMaxX = true;
    }
    const fit = (a, b, openA, openB) => {
      let span = b - a + openA + openB;
      if (span <= MAX_PLANE) return [a - openA, b + openB];
      let over = span - MAX_PLANE;
      const cutA = Math.min(openA, over); openA -= cutA; over -= cutA;
      const cutB = Math.min(openB, over); openB -= cutB; over -= cutB;
      a -= openA; b += openB;
      if (over > 0) { a += over / 2; b -= over / 2; }
      return [a, b];
    };
    const [xa, xb] = fit(minX, maxX, margin, closeMaxX ? 0 : margin);
    const [za, zb] = fit(minZ, maxZ, closeMinZ ? 0 : margin, margin);
    return { xa, xb, za, zb };
  }

  // The notch shows a strip of the wall drawing beside the mat. Drop the light
  // highlight band there so it doesn't read as a pale slab on the tiles.
  function hideMatHighlight(w) {
    if (w.el.dataset.matHighlight) return;
    w.el.querySelectorAll('svg path').forEach((n) => {
      if (n.closest('#doormat') || n.getAttribute('fill') !== '#a78660') return;
      n.setAttribute('opacity', '0');
    });
    w.el.dataset.matHighlight = '1';
  }

  // Notch only as wide as the mat, so the tiled floor still covers the rest of that wall.
  // The mat's own drawing stays; no extra rectangle behind it.
  function matNotches() {
    const W = dims.wallPx;
    const notches = [];
    for (const w of walls.values()) {
      const mat = w.el.querySelector('#doormat');
      const L = layout.get(w.id);
      if (!mat || !L || L.h !== 0) continue;
      hideMatHighlight(w);
      const bb = mat.getBBox();
      if (!bb.width) continue;
      notches.push({
        a: L.x0 + (bb.x / 1600) * W,
        b: L.x0 + ((bb.x + bb.width) / 1600) * W,
        yUnits: bb.y + bb.height,
      });
    }
    return notches;
  }

  function splitX(box, notches) {
    const cuts = [box.xa, box.xb];
    notches.forEach(({ a, b }) => {
      const lo = Math.max(box.xa, a);
      const hi = Math.min(box.xb, b);
      if (hi - lo > 1) { cuts.push(lo); cuts.push(hi); }
    });
    const edges = [...new Set(cuts.map((n) => Math.round(n * 100) / 100))].sort((a, b) => a - b);
    const pieces = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const xa = edges[i];
      const xb = edges[i + 1];
      if (xb - xa < 1) continue;
      const mid = (xa + xb) / 2;
      const notch = notches.find(({ a, b }) => mid >= a && mid < b);
      pieces.push({ xa, xb, za: box.za, zb: box.zb, yUnits: notch ? notch.yUnits : null });
    }
    return pieces.length ? pieces : [{ xa: box.xa, xb: box.xb, za: box.za, zb: box.zb, yUnits: null }];
  }

  function layoutPlanes() {
    if (!planes.length || !dims.wallPx) return;
    const box = planeBox();
    if (!box) return;
    const wallH = dims.wallPx * 9 / 16;
    const floorEl = planes.find((p) => p.el.classList.contains('floor'));
    const notches = floorEl ? matNotches() : [];
    planes.forEach((p) => {
      (p.extras || []).forEach((el) => el.remove());
      p.extras = [];
      const pieces = p.el.classList.contains('floor')
        ? splitX(box, notches)
        : [{ xa: box.xa, xb: box.xb, za: box.za, zb: box.zb, yUnits: null }];
      const yNorm = dims.wallTop + (p.yUnits / 900) * wallH;
      p.parts = [];
      p.partTf = [];
      pieces.forEach((piece, i) => {
        const el = i === 0 ? p.el : p.el.cloneNode(true);
        if (i > 0) { p.el.after(el); p.extras.push(el); }
        const y = piece.yUnits != null ? dims.wallTop + (piece.yUnits / 900) * wallH + 1 : yNorm;
        el.style.width = (piece.xb - piece.xa) + 'px';
        el.style.height = (piece.zb - piece.za) + 'px';
        p.parts.push(el);
        p.partTf.push(`translate3d(${piece.xa}px, ${y}px, ${piece.za}px) rotateX(90deg)`);
      });
      p.layoutTf = p.partTf[0];
    });
  }

  // Target pose for frame f (viewBox units) on a wall.
  function compute(wallId, frameId) {
    const w = walls.get(wallId);
    const f = w && w.frames.get(frameId);
    const L = layout.get(wallId);
    if (!f || !L) return null;
    const { vw, vh, wallPx, wallTop } = dims;
    const k = wallPx / 1600;
    // Apparent scale needed so the frame fills the viewport (contain).
    const s = Math.min(vw / (f.w * k), vh / (f.h * k));
    const u = (f.x + f.w / 2) * k; // distance along the wall
    const y = wallTop + (f.y + f.h / 2) * k;
    if (L.h === 0) return { x: L.x0 + u, y, z: P / s, yaw: 0, s };
    return { x: L.xr - P / s, y, z: L.z0 + u, yaw: 90, s };
  }

  function apply() {
    // world transform = translate3d(vw/2, vh/2, P) rotateY(yaw) translate3d(-Ex, -Ey, -Ez), then the wall's own placement.
    const camTf = `translate3d(${dims.vw / 2}px, ${dims.vh / 2}px, ${P}px) rotateY(${cam.yaw}deg) translate3d(${-cam.x}px, ${-cam.y}px, ${-cam.z}px)`;
    for (const w of walls.values()) {
      const tf = `${camTf} ${layoutTf.get(w.id) || ''}`;
      w.el.style.transform = tf;
      (w.fills || []).forEach((f) => { f.el.style.transform = tf; });
    }
    for (const p of planes) {
      const parts = p.parts || [p.el];
      const tfs = p.partTf || [p.layoutTf];
      parts.forEach((el, i) => { el.style.transform = `${camTf} ${tfs[i] || ''}`; });
    }
  }

  function log(tag) {
    if (debug) console.log('[camera]', tag, { Ex: +cam.x.toFixed(1), Ey: +cam.y.toFixed(1), Ez: +cam.z.toFixed(1), yaw: +cam.yaw.toFixed(2) });
  }

  function setPose(t) { cam.x = t.x; cam.y = t.y; cam.z = t.z; cam.yaw = t.yaw; }

  function goTo(wallId, frameId, { duration = 1.2, ease = 'power2.inOut' } = {}) {
    const t = compute(wallId, frameId);
    if (!t) { console.warn('[camera] unknown frame', wallId, frameId); return Promise.resolve(); }
    target = { wallId, frameId };
    if (tween) tween.kill();
    return new Promise((resolve) => {
      const done = () => {
        tween = null;
        apply();
        log(`${wallId}/${frameId}`);
        if (api.onArrive) api.onArrive(wallId, frameId);
        resolve();
      };
      if (api.instant || duration <= 0) {
        setPose(t);
        done();
        return;
      }
      tween = window.gsap.to(cam, { x: t.x, y: t.y, z: t.z, yaw: t.yaw, duration, ease, onUpdate: apply, onComplete: done });
    });
  }

  // Corner turn between two walls' focus frames (demo math). Works in both
  // directions: the pose goes from fromWall's pose to toWall's pose.
  function turn(fromId, toId, { duration, ease, pullBack, instant = false } = {}) {
    const a = compute(fromId, 'focus-frame');
    const b = compute(toId, 'focus-frame');
    if (!a || !b) return Promise.resolve();
    const dur = duration != null ? duration : (cornerSeg && cornerSeg.duration_s) || 2.8;
    const eas = ease || (cornerSeg && cornerSeg.ease) || 'power2.inOut';
    const pb = pullBack != null ? pullBack : (cornerSeg && cornerSeg.pull_back) || 0.1;
    if (tween) tween.kill();
    target = { wallId: toId, frameId: 'focus-frame' };

    const at = (t) => {
      const e = easeInOutCubic(t);
      const yaw = a.yaw + (b.yaw - a.yaw) * e;
      const r = yaw * Math.PI / 180;
      let ex = a.x + (b.x - a.x) * e;
      const ey = a.y + (b.y - a.y) * e;
      let ez = a.z + (b.z - a.z) * e;
      const pull = pb * P * Math.sin(Math.PI * e); // pull back mid-turn to see both walls
      ex -= pull * Math.sin(r);
      ez += pull * Math.cos(r);
      cam.x = ex; cam.y = ey; cam.z = ez; cam.yaw = yaw;
      apply();
      log('turn t=' + t.toFixed(3));
    };

    return new Promise((resolve) => {
      const done = () => {
        tween = null;
        setPose(b);
        apply();
        log(`${toId}/focus-frame`);
        if (api.onArrive) api.onArrive(toId, 'focus-frame');
        resolve();
      };
      if (instant || api.instant || dur <= 0) { done(); return; }
      const prog = { t: 0 };
      at(0);
      tween = window.gsap.to(prog, { t: 1, duration: dur, ease: eas, onUpdate: () => at(prog.t), onComplete: done });
    });
  }

  // Cut to a frame without animation; zOffset < 0 pulls the camera back.
  function place(wallId, frameId, { zOffset = 0 } = {}) {
    const t = compute(wallId, frameId);
    if (!t) return;
    if (tween) tween.kill();
    tween = null;
    target = { wallId, frameId };
    setPose(t);
    const back = -zOffset;
    const r = cam.yaw * Math.PI / 180;
    cam.x -= back * Math.sin(r);
    cam.z += back * Math.cos(r);
    apply();
  }

  function relayout() {
    measure();
    if (!target) return;
    const wasMoving = !!tween;
    place(target.wallId, target.frameId);
    if (wasMoving && api.onArrive) api.onArrive(target.wallId, target.frameId);
  }

  window.addEventListener('resize', relayout);
  Object.assign(api, { register, setPlanes, measure, compute, goTo, turn, place, relayout });
  return api;
}
