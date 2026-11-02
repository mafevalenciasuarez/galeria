// Aula entrance (route segment door_enter): door leaf, classroom shell, desks and the dolly timeline.
// Math ported from walls/aula-entrance-demo.html, generalised by the wall heading k (the camera moves
// along -n, n = the door wall's normal). Everything here follows the camera through camera.addProp.
import { hotspot, bboxBox, placeBox } from './walls.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const DESK_RATIO = 936.49 / 978.76; // height / width of props/student-desk.svg
// gallery.json still names assets/student-desk.svg and walls/classroom-wall-tile.svg.
// Both drawings live in props/. The JSON is left untouched.
const DESK_SRC = 'props/student-desk.svg';
const TILE_SRC = 'props/classroom-wall-tile.svg';

// Provisional corridor wall (same drawing as the demo): transparent doorway made with an SVG mask,
// honey door frame and a leaf group. Used only when the real wall SVG does not exist.
function provisionalDoorSvg(door) {
  const [x, y, w, h] = door.opening_units;
  const ids = door.ids || {};
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><mask id="doorhole"><rect width="1600" height="900" fill="#fff"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/></mask></defs>
<g mask="url(#doorhole)"><rect width="1600" height="553" fill="#f2e7cb"/><rect y="552" width="1600" height="21" fill="#cca471"/><rect y="573" width="1600" height="222" fill="#376648"/><rect y="795" width="1600" height="27" fill="#4b352c"/><rect y="822" width="1600" height="78" fill="#8d6547"/></g>
<rect id="${ids.opening || 'door-opening'}" x="${x}" y="${y}" width="${w}" height="${h}" fill="none"/>
<rect id="${ids.frame || 'door-frame'}" x="${x - 8}" y="${y - 8}" width="${w + 16}" height="${h + 10}" fill="none" stroke="#8a5a2b" stroke-width="16"/>
<rect x="640" y="120" width="320" height="70" fill="#b98a5a" stroke="#241b18" stroke-width="3"/>
<g id="${ids.leaf || 'door-leaf'}" transform="translate(${x} ${y})"><rect width="${w}" height="${h}" fill="#b98a5a" stroke="#241b18" stroke-width="4"/><rect x="50" y="60" width="120" height="190" fill="#f2d37a" stroke="#241b18" stroke-width="4"/><circle cx="190" cy="330" r="9" fill="#d9a441" stroke="#241b18" stroke-width="3"/><rect x="20" y="300" width="160" height="230" fill="none" stroke="#8a5a2b" stroke-width="5"/></g></svg>`;
}

// URL to load the door wall from: the real SVG, or a provisional one (warns once).
export async function resolveDoorWall(door) {
  try {
    const res = await fetch(door.svg);
    if (res.ok) return { url: door.svg, provisional: false };
  } catch (e) { /* falls through to the provisional wall */ }
  console.warn(`[entrance] ${door.svg} no existe: se usa una pared de pasillo provisional`);
  const blob = new Blob([provisionalDoorSvg(door)], { type: 'image/svg+xml' });
  return { url: URL.createObjectURL(blob), provisional: true };
}

export function initEntrance({ camera, world, cfg, doorWall, classWall, floorUnits = 822, signText = '', debug = false, onOpen }) {
  const door = camera.doors[0];
  if (!door || !cfg || !doorWall || !classWall) return null;
  const [doorId, classId] = door.between;
  const ids = cfg.door_wall.ids || {};
  const [ox, oy, ow, oh] = cfg.door_wall.opening_units;
  const dk = cfg.desks || {};
  const blur = dk.blur || {};
  const fz = dk.fade_on_zoom || {};
  const leafCfg = cfg.leaf || {};
  const leafTiming = leafCfg.timing || [0, 0.3];
  const dolly = (cfg.camera && cfg.camera.dolly_timing) || [0.12, 1];
  const duration = (door.seg && door.seg.duration_s) || (cfg.camera && cfg.camera.duration_s) || 4.2;
  const sw = cfg.room.side_walls;
  const gsap = window.gsap;
  const reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const cut = (instant) => !!instant || camera.instant || !!(reduceMq && reduceMq.matches);

  const state = { t: 0, active: false, faded: false };
  let tween = null;

  doorWall.el.style.background = 'transparent'; // the doorway shows the classroom: no wall colour behind it

  // ---------- Door leaf: HTML clone of #door-leaf. viewBox is the leaf bbox; the hinge is the opening's left edge ----------
  const holder = document.createElement('div');
  holder.className = 'door-holder';
  holder.setAttribute('aria-hidden', 'true');
  const leafBox = cfg.door_wall.leaf_bbox_units || [671.2, 239.1, 255.3, 582.9];
  const clip = (cfg.door_wall.leaf_clone && cfg.door_wall.leaf_clone.clip_inset_units) || { top: 3.9, right: 4.5, bottom: 0, left: 3.8 };
  let leafEl = null;
  const leaf = doorWall.svg && doorWall.svg.querySelector('#' + (ids.leaf || 'door-leaf'));
  if (leaf) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(svgNS, 'svg');
    s.setAttribute('viewBox', leafBox.join(' '));
    const clone = leaf.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    s.append(clone);
    leafEl = document.createElement('div');
    leafEl.className = 'door-leaf';
    leafEl.append(s);
    holder.append(leafEl);
    leaf.style.display = 'none';
  } else {
    console.warn(`[entrance] #${ids.leaf || 'door-leaf'} no está en ${doorWall.id}: no hay hoja que abrir`);
  }
  world.append(holder);
  camera.addProp(holder, () => camera.layoutOf(doorId));

  const signEl = doorWall.svg && doorWall.svg.querySelector('#' + (ids.sign_label || 'door-sign-label'));
  const signBox = bboxBox(signEl);
  if (signBox && signText) {
    const label = document.createElement('div');
    label.className = 'door-sign-label';
    label.textContent = signText;
    placeBox(label, signBox);
    doorWall.overlay.append(label);
  }

  // ---------- Classroom shell: two flat side walls ----------
  const sides = [0, 1].map(() => {
    const el = document.createElement('div');
    el.className = 'plane aula-side';
    el.setAttribute('aria-hidden', 'true');
    world.append(el);
    const pr = camera.addProp(el, () => el._tf || '');
    return { el, pr };
  });

  // ---------- Desks ----------
  const desks = [];
  const nRows = dk.rows || 0;
  for (let r = 0; r < nRows; r++) {
    const cols = r < (dk.rows_before_camera_end || 0) ? dk.columns_before_camera_end : dk.columns_ahead_of_camera;
    (cols || []).forEach((c) => {
      const el = document.createElement('div');
      el.className = 'desk';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = `<img src="${DESK_SRC}" alt="">`;
      el.style.display = 'none';
      el.style.opacity = '1';
      world.append(el);
      const desk = { el, r, c, dN: 0, shown: false, filter: '' };
      desk.pr = camera.addProp(el, () => desk.tf || '');
      desk.pr.skip = true;
      desks.push(desk);
    });
  }

  const poses = () => ({ A: camera.compute(doorId, 'focus-frame'), B: camera.compute(classId, 'focus-frame') });

  // ---------- Layout (called whenever the camera re-measures) ----------
  function layout() {
    const { wallPx: W, wallTop, dist } = camera.dims;
    const LD = camera.layout.get(doorId);
    if (!LD || !W) return;
    const live = camera.doors[0] || door;
    const Lr = live.Lr;
    const H = W * 9 / 16;
    const K = W / 1600;
    const floorY = wallTop + floorUnits * K;
    const sideH = floorUnits * K;
    const tileW = ((sw && sw.tile_width_units) || 1516.8) * K;

    Object.assign(holder.style, { width: W + 'px', height: H + 'px', top: wallTop + 'px' });
    if (leafEl) {
      const [lx, ly, lw, lh] = leafBox;
      Object.assign(leafEl.style, {
        left: (lx * K) + 'px', top: (ly * K) + 'px', width: (lw * K) + 'px', height: (lh * K) + 'px',
        clipPath: `inset(${clip.top * K}px ${clip.right * K}px ${clip.bottom * K}px ${clip.left * K}px)`,
        transformOrigin: `${clip.left * K}px 0px`,
      });
    }

    // Both side walls start on the far wall (local z = -Lr) and rotateY(-90). An origin on the
    // near edge sits behind the camera once it has crossed the door, and some browsers drop the plane.
    const base = camera.layoutOf(doorId);
    const locals = [
      `translate3d(0,0,${-Lr}px) rotateY(-90deg)`,
      `translate3d(${W}px,0,${-Lr}px) rotateY(-90deg)`,
    ];
    sides.forEach((s, i) => {
      s.el._tf = `${base} ${locals[i]}`;
      s.el.style.top = wallTop + 'px';
      s.el.style.width = Lr + 'px';
      s.el.style.height = sideH + 'px';
      s.el.style.backgroundImage = `url(${TILE_SRC})`;
      s.el.style.backgroundSize = `${tileW}px ${H}px`;
      s.el.style.backgroundRepeat = 'repeat-x';
      s.el.style.backgroundPosition = 'left top';
    });

    // Desks stand on the floor, in rows receding along -n; x offsets are fractions of wallPx from the doorway centre.
    const dw = dk.width_factor * W;
    const dh = dw * DESK_RATIO;
    desks.forEach((d) => {
      d.dN = dk.first_row_z_factor * dist - d.r * dk.row_spacing_factor * dist;
      const u = W / 2 + d.c * W - dw / 2;
      const px = LD.O.x + LD.d.x * u + LD.n.x * d.dN;
      const pz = LD.O.z + LD.d.z * u + LD.n.z * d.dN;
      d.tf = `translate3d(${px}px, ${floorY - dh}px, ${pz}px) rotateY(${-90 * LD.k}deg)`;
      d.el.style.width = dw + 'px';
      d.el.style.height = dh + 'px';
      d.el.dataset.z = d.dN.toFixed(1);
    });
  }

  // ---------- Per frame: leaf, desk visibility and proximity blur ----------
  function frame(cam) {
    if (!state.active) return;
    const LD = camera.layout.get(doorId);
    if (!LD) return;
    const P = camera.P;
    const cn = (cam.x - LD.O.x) * LD.n.x + (cam.z - LD.O.z) * LD.n.z; // camera distance in front of the door wall
    const rest = 1 - (1 - blur.rest_factor) * smooth(0.85, 1, state.t);
    for (const d of desks) {
      const dist = cn - d.dN;
      if (dist < dk.hide_when_d_below) {
        if (d.shown) { d.el.style.display = 'none'; d.shown = false; }
        continue;
      }
      if (!d.shown) { d.el.style.display = ''; d.shown = true; }
      // The CSS filter acts before the perspective scale: css px = screen px * d / P.
      const css = blur.max_screen_px * (1 - smooth(blur.near_d, blur.far_d, dist)) * rest * dist / P;
      const f = css < blur.skip_below_css_px ? 'none' : `blur(${css.toFixed(2)}px)`;
      if (f !== d.filter) { d.el.style.filter = f; d.filter = f; }
    }
  }
  camera.onFrame = frame;

  function setActive(on) {
    if (state.active === on) return;
    state.active = on;
    desks.forEach((d) => {
      d.pr.skip = !on;
      if (!on) { d.el.style.display = 'none'; d.shown = false; }
    });
  }

  const setLeaf = (t) => {
    if (leafEl) leafEl.style.transform = `translateZ(1px) rotateY(${(leafCfg.open_deg || 100) * smooth(leafTiming[0], leafTiming[1], t)}deg)`;
  };

  // Timeline state without moving the camera (used when the camera arrives by other means).
  function setState(t) {
    state.t = t;
    setActive(t > 0);
    setLeaf(t);
  }

  // One progress value t in [0, 1]: leaf open and camera dolly along -n, yaw constant.
  function setT(t) {
    const { A, B } = poses();
    if (!A || !B) return;
    setState(t);
    const e = easeInOutCubic(clamp((t - dolly[0]) / (dolly[1] - dolly[0]), 0, 1));
    camera.drive({ x: lerp(A.x, B.x, e), y: lerp(A.y, B.y, e), z: lerp(A.z, B.z, e), yaw: A.yaw });
    if (debug) console.log('[entrance]', { Ex: +lerp(A.x, B.x, e).toFixed(1), Ez: +lerp(A.z, B.z, e).toFixed(1), t: +t.toFixed(3) });
  }

  // dir 'in': door stop -> classroom stop. dir 'out': the same timeline backwards.
  function play(dir, { instant = false } = {}) {
    if (tween) tween.kill();
    const from = dir === 'in' ? 0 : 1;
    const to = 1 - from;
    return new Promise((resolve) => {
      const done = () => {
        tween = null;
        setT(to);
        camera.arrive(to === 1 ? classId : doorId, 'focus-frame');
        resolve();
      };
      if (cut(instant)) { done(); return; }
      const prog = { t: from };
      setT(from);
      tween = gsap.to(prog, { t: to, duration, ease: 'none', onUpdate: () => setT(prog.t), onComplete: done });
    });
  }

  // Fade the desks when the camera zooms into a wall element (focus-* frames of the classroom wall).
  camera.onTarget = (s, wallId) => {
    if (wallId !== classId && wallId !== doorId) return;
    if (!fz.enabled) return;
    const zoomed = s > fz.when_fit_scale_above;
    if (zoomed === state.faded) return;
    state.faded = zoomed;
    const to = zoomed ? fz.fade_to_opacity : 1;
    const els = desks.map((d) => d.el);
    if (cut(false)) { gsap.killTweensOf(els); els.forEach((el) => { el.style.opacity = String(to); }); return; }
    gsap.to(els, { opacity: to, duration: fz.duration_s, overwrite: 'auto' });
  };

  // Called by the engine on every arrival: keep the leaf and desks in step with where the camera is.
  function arrived(wallId) {
    if (tween) return;
    if (wallId === classId && state.t !== 1) { setState(1); camera.refresh(); }
    else if (wallId === doorId && state.t !== 0) { setState(0); camera.refresh(); }
  }

  const prevMeasure = camera.onMeasure;
  camera.onMeasure = () => { if (prevMeasure) prevMeasure(); layout(); };
  layout();
  setLeaf(0);

  // Clicking the doorway starts the entrance.
  const hs = hotspot(doorWall, { getBBox: () => ({ x: ox, y: oy, width: ow, height: oh }) }, {
    label: 'Entrar al aula de reflexión',
    onActivate: () => onOpen && onOpen(),
  });
  if (hs) hs.classList.add('aula-door-hotspot');

  return { play, arrived, setT, state, doorId, classId, duration };
}
