// Camera: a single transform on #world. Walls sit side by side on one plane.

const FILL_EXTRA = 2000; // px a wall-fill strip extends beyond the wall

export function createCamera({ scene, world, P = 1200, debug = false }) {
  const walls = new Map(); // wallId -> { id, index, el, frames: Map(frameId -> {x,y,w,h}) }
  const dims = { vw: 0, vh: 0, wallPx: 0, wallTop: 0 };
  const cam = { x: 0, y: 0, z: 0 };
  let target = null;
  let tween = null;

  const api = {
    P,
    userInstant: false,
    onArrive: null,
    // The OS reduced-motion setting does not drive this. Only the gallery button does.
    get instant() { return api.userInstant || !window.gsap; },
    get current() { return target; },
    get state() { return { ...cam, s: P / (P - cam.z) }; },
  };

  scene.style.perspective = P + 'px';

  function register(wall) { walls.set(wall.id, wall); }

  // Recompute wall size/position from the viewport.
  function measure() {
    dims.vw = scene.clientWidth;
    dims.vh = scene.clientHeight;
    dims.wallPx = Math.min(dims.vw, dims.vh * 16 / 9);
    dims.wallTop = (dims.vh - dims.wallPx * 9 / 16) / 2;
    for (const w of walls.values()) {
      Object.assign(w.el.style, {
        width: dims.wallPx + 'px',
        height: dims.wallPx * 9 / 16 + 'px',
        left: w.index * dims.wallPx + 'px',
        top: dims.wallTop + 'px',
      });
      // Wall-fill strips sit outside the wall on the same plane.
      const X = FILL_EXTRA;
      const wh = dims.wallPx * 9 / 16;
      const L = w.index * dims.wallPx;
      // Top and bottom strips reach past the outer side edges so the corners are filled too.
      const fills = w.fills || [];
      const overL = fills.some((f) => f.side === 'left') ? X : 0;
      const overR = fills.some((f) => f.side === 'right') ? X : 0;
      const boxes = {
        left: [L - X, dims.wallTop, X + 1, wh], // +1px overlap hides the seam
        right: [L + dims.wallPx - 1, dims.wallTop, X + 1, wh],
        top: [L - overL, dims.wallTop - X, dims.wallPx + overL + overR, X + 1],
        bottom: [L - overL, dims.wallTop + wh - 1, dims.wallPx + overL + overR, X + 1],
      };
      (w.fills || []).forEach(({ side, el }) => {
        const [left, top, width, height] = boxes[side];
        Object.assign(el.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
      });
    }
  }

  // Target transform for frame f (viewBox units) on wall i.
  function compute(wallId, frameId) {
    const w = walls.get(wallId);
    const f = w && w.frames.get(frameId);
    if (!f) return null;
    const { vw, vh, wallPx, wallTop } = dims;
    const k = wallPx / 1600;
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    // Apparent scale needed so the frame fills the viewport (contain).
    const s = Math.min(vw / (f.w * k), vh / (f.h * k));
    // Pan does not depend on z: the frame centre is moved onto the perspective
    // origin (viewport centre), and scaling about the origin leaves that point fixed.
    const x = vw / 2 - (w.index * wallPx + cx * k);
    const y = vh / 2 - (wallTop + cy * k);
    // Apparent scale of a plane translated by z under perspective P is P / (P - z).
    // Solving P / (P - z) = s gives z = P * (1 - 1 / s).
    const z = P * (1 - 1 / s);
    return { x, y, z, s };
  }

  function apply() {
    world.style.transform = `translate3d(${cam.x}px, ${cam.y}px, ${cam.z}px)`;
  }

  function log(tag) {
    if (debug) console.log('[camera]', tag, { x: +cam.x.toFixed(1), y: +cam.y.toFixed(1), z: +cam.z.toFixed(1), s: +(P / (P - cam.z)).toFixed(3) });
  }

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
        cam.x = t.x; cam.y = t.y; cam.z = t.z;
        done();
        return;
      }
      tween = window.gsap.to(cam, { x: t.x, y: t.y, z: t.z, duration, ease, onUpdate: apply, onComplete: done });
    });
  }

  // Cut to a frame without animation; zOffset < 0 pulls the camera back.
  function place(wallId, frameId, { zOffset = 0 } = {}) {
    const t = compute(wallId, frameId);
    if (!t) return;
    if (tween) tween.kill();
    tween = null;
    target = { wallId, frameId };
    cam.x = t.x; cam.y = t.y; cam.z = t.z + zOffset;
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
  Object.assign(api, { register, measure, compute, goTo, place, relayout });
  return api;
}
