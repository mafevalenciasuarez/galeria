// Camera: pose (Ex, Ey, Ez, yaw) applied to each wall (and plane).
// Walls are placed from route.segments by heading k (walls/route-demo.html):
// d = direction of the wall's reading axis (k=0 +x, 1 +z, 2 -x, 3 -z), n = (-d.z, d.x)
// is the normal toward the viewer. corner_90 (inside, right) does k += 1 and
// corner_90_outside (outside, left, the "cube" turn) does k -= 1.

const FILL_EXTRA = 2000; // px a wall-fill strip extends beyond the wall
const PLANE_DENSITY = 0.75; // canvas texels per CSS px for the ceiling and floor
const PLANE_MAX_TEXELS = 6144; // longest side of a plane canvas

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const DIRS = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
const dirOf = (k) => DIRS[((k % 4) + 4) % 4];

export function createCamera({ scene, world, route = null, entrance = null, P: defaultP = 1200, debug = false }) {
  const segments = (route && route.segments) || [];
  const cornerSeg = segments.find((s) => s.type === 'corner_90') || null;

  const walls = new Map(); // wallId -> { id, index, el, frames: Map(frameId -> {x,y,w,h}) }
  const layout = new Map(); // wallId -> { O: {x, z}, k, d: {x, z}, n: {x, z} }
  const corners = []; // { id, type, between: [aId, bId], seg }
  const doors = []; // door_enter segments: { id, type, between: [doorWallId, classWallId], seg, Lr }
  const props = []; // extra 3D elements that follow the camera: { el, getTf, skip }
  // Dist = perspective / s. perspective is the wall width, reset on every resize (route-demo.html).
  const dims = {
    vw: 0, vh: 0, wallPx: 0, wallTop: 0, dist: 0,
    persp: (route && route.world && route.world.perspective_px) || defaultP,
  };
  // Camera pose: position in world px, yaw in degrees.
  const cam = { x: 0, y: 0, z: 0, yaw: 0 };
  let target = null;
  let tween = null;

  const api = {
    get P() { return dims.persp; },
    corner: cornerSeg,
    corners,
    doors,
    dims,
    onFrame: null, // (pose) after every apply
    onTarget: null, // (fitScale, wallId, frameId) when a goTo / place picks a frame
    onMeasure: null, // after the layout is recomputed
    userInstant: false,
    onArrive: null,
    // The OS reduced-motion setting does not drive this. Only the gallery button does.
    get instant() { return api.userInstant || !window.gsap; },
    get current() { return target; },
    get state() { return { x: cam.x, y: cam.y, z: cam.z, yaw: cam.yaw }; },
  };

  scene.style.perspective = dims.persp + 'px';

  // The camera matrix is applied to each wall (and its fills) instead of to #world.
  // Chrome stops hit-testing the children of a preserve-3d ancestor that is rotated
  // edge-on (yaw 90), so hotspots on the walls after the corner would not receive clicks.
  const layoutTf = new Map(); // wallId -> layout transform string
  const planes = []; // { el, yUnits, layoutTf } horizontal ceiling / floor
  function register(wall) { walls.set(wall.id, wall); }

  // Route-driven placement by heading k. A straight segment places its walls one
  // after another (O += d * wallPx). The next wall after a corner starts at the
  // corner point C, the end of the last placed wall.
  function computeLayout() {
    const W = dims.wallPx;
    layout.clear();
    corners.length = 0;
    doors.length = 0;
    let k = 0;
    let O = { x: 0, z: 0 };
    const put = (id) => {
      if (layout.has(id)) return; // already placed
      const d = dirOf(k);
      layout.set(id, { O: { ...O }, k, d, n: { x: -d.z, z: d.x } });
      O = { x: O.x + d.x * W, z: O.z + d.z * W };
    };
    for (const seg of segments) {
      if (seg.type === 'corner_90' || seg.type === 'corner_90_outside') {
        corners.push({ id: seg.id, type: seg.type, between: seg.between || [], seg });
        k += seg.type === 'corner_90_outside' ? -1 : 1;
      } else if (seg.type === 'door_enter') {
        // The classroom wall has the SAME heading as the door wall; its origin is the door wall's origin - n * Lr.
        const [doorId, classId] = seg.between || [];
        const LD = layout.get(doorId);
        if (!LD || !walls.has(classId) || layout.has(classId)) continue;
        const factor = (entrance && entrance.room && entrance.room.depth_factor) || seg.room_depth_factor || 1.8;
        const Lr = factor * dims.dist;
        doors.push({ id: seg.id, type: 'door_enter', between: [doorId, classId], seg, Lr });
        k = LD.k;
        O = { x: LD.O.x - LD.n.x * Lr, z: LD.O.z - LD.n.z * Lr };
        put(classId);
      } else {
        (seg.walls || []).forEach((id) => { if (walls.has(id)) put(id); });
      }
    }
    // Walls missing from the route continue the last heading.
    [...walls.values()].sort((a, b) => a.index - b.index).forEach((w) => { if (!layout.has(w.id)) put(w.id); });
  }

  const wallTransform = (L) => `translate3d(${L.O.x}px, 0, ${L.O.z}px) rotateY(${-90 * L.k}deg)`;

  // Recompute wall size/position from the viewport.
  function measure() {
    dims.vw = scene.clientWidth;
    dims.vh = scene.clientHeight;
    dims.wallPx = Math.min(dims.vw, dims.vh * 16 / 9);
    const fullH = dims.wallPx * 9 / 16;
    dims.wallTop = (dims.vh - fullH) / 2;
    // perspective = wallPx, so the hallway scales with the wall instead of a fixed pixel distance.
    if (dims.wallPx > 0) {
      dims.persp = dims.wallPx;
      scene.style.perspective = dims.persp + 'px';
    }
    dims.dist = dims.persp / Math.min(dims.vw / dims.wallPx, dims.vh / fullH);
    computeLayout();
    const floorUnits = (route && route.world && route.world.hall_shell && route.world.hall_shell.walls_end_at_floor_units) || 822;
    const visH = fullH * floorUnits / 900; // the wall ends at the floor; the svg stays full height and is clipped
    const wh = visH;
    for (const w of walls.values()) {
      layoutTf.set(w.id, wallTransform(layout.get(w.id)));
      w.el.style.setProperty('--wallH', fullH + 'px');
      Object.assign(w.el.style, {
        width: dims.wallPx + 'px',
        height: visH + 'px',
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
    if (api.onMeasure) api.onMeasure();
  }

  function setPlanes(list) { planes.length = 0; planes.push(...list); }

  // ONE rectangle: the (x, z) bounding box of every wall footprint, expanded on every side by
  // max(margin_factor * wallPx, min_margin_p_factor * P). Walls are opaque, so what sits
  // behind them stays hidden.
  function planeBox() {
    const W = dims.wallPx;
    const cfg = (route && route.world && route.world.planes) || {};
    const margin = Math.max((cfg.margin_factor || 0) * W, (cfg.min_margin_p_factor || 0) * dims.persp);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const L of layout.values()) {
      const ex = L.O.x + L.d.x * W;
      const ez = L.O.z + L.d.z * W;
      minX = Math.min(minX, L.O.x, ex); maxX = Math.max(maxX, L.O.x, ex);
      minZ = Math.min(minZ, L.O.z, ez); maxZ = Math.max(maxZ, L.O.z, ez);
    }
    if (!isFinite(minX)) return null;
    return { xa: minX - margin, xb: maxX + margin, za: minZ - margin, zb: maxZ + margin };
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
      if (!mat || !L || L.k !== 0) continue;
      hideMatHighlight(w);
      const bb = mat.getBBox();
      if (!bb.width) continue;
      notches.push({
        a: L.O.x + (bb.x / 1600) * W,
        b: L.O.x + ((bb.x + bb.width) / 1600) * W,
        yUnits: bb.y + bb.height,
      });
    }
    return notches;
  }

  // Rectangle a minus rectangle b (axis aligned): up to four rectangles.
  function subtractRect(a, b) {
    const xa = Math.max(a.xa, b.xa), xb = Math.min(a.xb, b.xb);
    const za = Math.max(a.za, b.za), zb = Math.min(a.zb, b.zb);
    if (xa >= xb || za >= zb) return [a];
    const out = [];
    if (b.xa > a.xa) out.push({ xa: a.xa, xb: xa, za: a.za, zb: a.zb });
    if (b.xb < a.xb) out.push({ xa: xb, xb: a.xb, za: a.za, zb: a.zb });
    if (b.za > a.za) out.push({ xa, xb, za: a.za, zb: za });
    if (b.zb < a.zb) out.push({ xa, xb, za: zb, zb: a.zb });
    return out;
  }

  // Footprints for the ceiling and floor. The classroom (door_enter) is its own piece between the side
  // walls; the hall is the bounding box minus that room and minus everything behind its far wall, so
  // no plane ever crosses a wall plane.
  function planeRects(box) {
    const W = dims.wallPx;
    let hall = [box];
    const rooms = [];
    for (const dr of doors) {
      const LD = layout.get(dr.between[0]);
      if (!LD) continue;
      const pts = [
        LD.O,
        { x: LD.O.x + LD.d.x * W, z: LD.O.z + LD.d.z * W },
        { x: LD.O.x + LD.d.x * W - LD.n.x * dr.Lr, z: LD.O.z + LD.d.z * W - LD.n.z * dr.Lr },
        { x: LD.O.x - LD.n.x * dr.Lr, z: LD.O.z - LD.n.z * dr.Lr },
      ];
      const room = {
        xa: Math.min(...pts.map((p) => p.x)), xb: Math.max(...pts.map((p) => p.x)),
        za: Math.min(...pts.map((p) => p.z)), zb: Math.max(...pts.map((p) => p.z)),
      };
      rooms.push(room);
      // Extend the room away from the door (-n) to the box edge: that strip lies behind the far wall.
      const shadow = { ...room };
      if (LD.n.x > 0) shadow.xa = box.xa; else if (LD.n.x < 0) shadow.xb = box.xb;
      if (LD.n.z > 0) shadow.za = box.za; else if (LD.n.z < 0) shadow.zb = box.zb;
      hall = hall.flatMap((r) => subtractRect(r, shadow));
    }
    return { hall, rooms };
  }

  // Cut a rectangle into tiles of at most MAX px per side; interior joints overlap by 1px (no seams).
  const PLANE_TILE = 3900;
  function tileRect(r) {
    const nx = Math.max(1, Math.ceil((r.xb - r.xa) / PLANE_TILE));
    const nz = Math.max(1, Math.ceil((r.zb - r.za) / PLANE_TILE));
    const out = [];
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        out.push({
          xa: r.xa + (r.xb - r.xa) * i / nx - (i > 0 ? 0.5 : 0),
          xb: r.xa + (r.xb - r.xa) * (i + 1) / nx + (i < nx - 1 ? 0.5 : 0),
          za: r.za + (r.zb - r.za) * j / nz - (j > 0 ? 0.5 : 0),
          zb: r.za + (r.zb - r.za) * (j + 1) / nz + (j < nz - 1 ? 0.5 : 0),
        });
      }
    }
    return out;
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

  function paintPlane(el, piece, paint, k) {
    const cv = el.querySelector('canvas');
    if (!cv) return;
    const w = piece.xb - piece.xa;
    const h = piece.zb - piece.za;
    cv.width = Math.max(1, Math.round(w * k));
    cv.height = Math.max(1, Math.round(h * k));
    const ctx = cv.getContext('2d');
    ctx.setTransform(cv.width / w, 0, 0, cv.height / h, 0, 0);
    paint(ctx, piece, w, h);
  }

  function layoutPlanes() {
    if (!planes.length || !dims.wallPx) return;
    const box = planeBox();
    if (!box) return;
    const wallH = dims.wallPx * 9 / 16;
    const floorEl = planes.find((p) => p.el.classList.contains('floor'));
    const notches = floorEl ? matNotches() : [];
    const { hall, rooms } = planeRects(box);
    const rects = [...hall, ...rooms].flatMap(tileRect);
    planes.forEach((p) => {
      (p.extras || []).forEach((el) => el.remove());
      p.extras = [];
      const isFloor = p.el.classList.contains('floor');
      const pieces = rects.flatMap((r) => (isFloor
        ? splitX(r, notches)
        : [{ xa: r.xa, xb: r.xb, za: r.za, zb: r.zb, yUnits: null }]));
      const yNorm = dims.wallTop + (p.yUnits / 900) * wallH;
      p.parts = [];
      p.partTf = [];
      pieces.forEach((piece, i) => {
        const el = i === 0 ? p.el : p.el.cloneNode(true);
        if (i > 0) { p.el.after(el); p.extras.push(el); }
        const y = piece.yUnits != null ? dims.wallTop + (piece.yUnits / 900) * wallH + 1 : yNorm;
        el.style.width = (piece.xb - piece.xa) + 'px';
        el.style.height = (piece.zb - piece.za) + 'px';
        // Canvas texels per CSS px: the backing store is a texture, so its size is the plane's cost.
        const k = Math.min(PLANE_DENSITY, PLANE_MAX_TEXELS / Math.max(piece.xb - piece.xa, piece.zb - piece.za));
        if (p.paint) paintPlane(el, piece, p.paint, k);
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
    // E = O + d*u + n*Dist, with Dist = P / s.
    const dist = dims.persp / s;
    return { x: L.O.x + L.d.x * u + L.n.x * dist, y, z: L.O.z + L.d.z * u + L.n.z * dist, yaw: 90 * L.k, s };
  }

  function apply() {
    // world transform = translate3d(vw/2, vh/2, P) rotateY(yaw) translate3d(-Ex, -Ey, -Ez), then the wall's own placement.
    const camTf = `translate3d(${dims.vw / 2}px, ${dims.vh / 2}px, ${dims.persp}px) rotateY(${cam.yaw}deg) translate3d(${-cam.x}px, ${-cam.y}px, ${-cam.z}px)`;
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
    for (const pr of props) if (!pr.skip) pr.el.style.transform = `${camTf} ${pr.getTf()}`;
    if (api.onFrame) api.onFrame(cam);
  }

  // Extra element that follows the camera (classroom shell, desks, door leaf holder).
  function addProp(el, getTf) {
    const pr = { el, getTf, skip: false };
    props.push(pr);
    return pr;
  }

  // Door entrance drives the camera itself: set the pose and redraw.
  function drive(pose) {
    setPose(pose);
    apply();
  }

  function arrive(wallId, frameId) {
    if (tween) tween.kill();
    tween = null;
    target = { wallId, frameId };
    const t = compute(wallId, frameId);
    if (t) setPose(t);
    apply();
    log(`${wallId}/${frameId}`);
    if (api.onArrive) api.onArrive(wallId, frameId);
  }

  const layoutOf = (id) => layoutTf.get(id) || '';

  function log(tag) {
    if (debug) console.log('[camera]', tag, { Ex: +cam.x.toFixed(1), Ey: +cam.y.toFixed(1), Ez: +cam.z.toFixed(1), yaw: +cam.yaw.toFixed(2) });
  }

  function setPose(t) { cam.x = t.x; cam.y = t.y; cam.z = t.z; cam.yaw = t.yaw; }

  function goTo(wallId, frameId, { duration = 1.2, ease = 'power2.inOut' } = {}) {
    const t = compute(wallId, frameId);
    if (!t) { console.warn('[camera] unknown frame', wallId, frameId); return Promise.resolve(); }
    target = { wallId, frameId };
    if (api.onTarget) api.onTarget(t.s, wallId, frameId);
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

  // Corner turn between two walls' focus frames (walls/route-demo.html math). The corner is
  // found from route.segments (between: [a, b]); going b -> a runs the same path with t reversed.
  //  corner_90 (inside): eased E lerp, yaw lerp, pull back along -look by pull_back * P * sin(pi * e).
  //  corner_90_outside (cube): E orbits the corner point C at a radius lerped between |A - C| and
  //  |B - C|, yaw lerps (decreasing), so at e = 0.5 the edge is centred on screen.
  function turn(fromId, toId, { duration, ease, pullBack, instant = false } = {}) {
    const corner = corners.find((c) => (c.between[0] === fromId && c.between[1] === toId)
      || (c.between[0] === toId && c.between[1] === fromId));
    const rev = !!corner && corner.between[0] === toId;
    const idA = corner ? corner.between[0] : fromId;
    const idB = corner ? corner.between[1] : toId;
    const A = compute(idA, 'focus-frame');
    const B = compute(idB, 'focus-frame');
    const to = rev ? A : B;
    if (!A || !B) return Promise.resolve();
    const seg = (corner && corner.seg) || cornerSeg || {};
    const outside = !!corner && corner.type === 'corner_90_outside';
    const dur = duration != null ? duration : seg.duration_s || 2.8;
    // The cube turn is already shaped by easeInOutCubic (e) like in the demo, so its time runs linear.
    const eas = ease || (outside ? 'none' : seg.ease) || 'power2.inOut';
    const pb = pullBack != null ? pullBack : (seg.pull_back != null ? seg.pull_back : 0.1);
    if (tween) tween.kill();
    target = { wallId: toId, frameId: 'focus-frame' };

    // Corner point C = end of the earlier wall (A's wall).
    const LA = layout.get(idA);
    const C = LA ? { x: LA.O.x + LA.d.x * dims.wallPx, z: LA.O.z + LA.d.z * dims.wallPx } : null;
    let phiS = 0, dPhi = 0, rS = 0, rE = 0;
    if (outside && C) {
      phiS = Math.atan2(A.z - C.z, A.x - C.x);
      dPhi = Math.atan2(B.z - C.z, B.x - C.x) - phiS;
      while (dPhi > Math.PI) dPhi -= 2 * Math.PI;
      while (dPhi < -Math.PI) dPhi += 2 * Math.PI; // shortest signed angle
      rS = Math.hypot(A.x - C.x, A.z - C.z);
      rE = Math.hypot(B.x - C.x, B.z - C.z);
    }

    const at = (t) => {
      const tt = rev ? 1 - t : t; // path is always A -> B
      const e = easeInOutCubic(tt);
      const ey = lerp(A.y, B.y, e);
      const yaw = lerp(A.yaw, B.yaw, e);
      let ex, ez;
      if (outside && C) {
        const r = lerp(rS, rE, e);
        const phi = phiS + dPhi * e;
        ex = C.x + r * Math.cos(phi);
        ez = C.z + r * Math.sin(phi);
      } else {
        const r = yaw * Math.PI / 180;
        const pull = pb * dims.persp * Math.sin(Math.PI * e); // pull back mid-turn to see both walls
        ex = lerp(A.x, B.x, e) - pull * Math.sin(r);
        ez = lerp(A.z, B.z, e) + pull * Math.cos(r);
      }
      cam.x = ex; cam.y = ey; cam.z = ez; cam.yaw = yaw;
      apply();
      log('turn t=' + t.toFixed(3));
    };

    const cut = instant || api.instant || dur <= 0
      || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    return new Promise((resolve) => {
      const done = () => {
        tween = null;
        setPose(to);
        apply();
        log(`${toId}/focus-frame`);
        if (api.onArrive) api.onArrive(toId, 'focus-frame');
        resolve();
      };
      if (cut) { done(); return; }
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
    if (api.onTarget) api.onTarget(t.s, wallId, frameId);
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
  Object.assign(api, { register, setPlanes, measure, compute, goTo, turn, place, relayout, refresh: apply, addProp, drive, arrive, layoutOf, layout });
  return api;
}
