// Engine: loads data, builds stops, wires camera, walls and UI.
import { createCamera } from './camera.js';
import { loadWall, basename, buildIntro, buildRoom, drawDebug, buildFills, setFillTemplate } from './walls.js';
import { createCard, createPopup, createTooltip, createAudio, createAmbience } from './ui.js';
import { initMap } from './map.js';
import { initRoom2 } from './room2.js';
import { initRoom3 } from './room3.js';
import { initRoom4 } from './room4.js';
import { initFinal, auditPublish } from './roomFinal.js';
import { createProps } from './props.js';
import { initEntrance, resolveDoorWall } from './entrance.js';
import { makeWoodTexture, woodCeilingStyle } from './wood-ceiling.js';

// One wood tile for the whole session. A failed canvas falls back to the flat grid.
let woodTextureUrl = null;
let woodFallbackWarned = false;

function gridStyle(c) {
  const gap = Math.max(0, c.grid_px - c.grid_line_px);
  const stop = `transparent 0 ${gap}px, ${c.grid_color} ${gap}px ${c.grid_px}px`;
  return {
    backgroundColor: c.color,
    backgroundImage: `repeating-linear-gradient(0deg, ${stop}), repeating-linear-gradient(90deg, ${stop})`,
  };
}

function floorStyle(f) {
  const w = f.line_width_px;
  const zGap = Math.max(0, f.line_px - w);
  const cGap = Math.max(0, f.cross_px - w);
  return {
    backgroundColor: f.color,
    backgroundImage: [
      `repeating-linear-gradient(180deg, transparent 0 ${zGap}px, ${f.line_color} ${zGap}px ${f.line_px}px)`,
      `repeating-linear-gradient(90deg, transparent 0 ${cGap}px, ${f.cross_line_color} ${cGap}px ${f.cross_px}px)`,
    ].join(', '),
  };
}

function ceilingStyle(ceiling) {
  if (ceiling.type !== 'wood') return gridStyle(ceiling);
  try {
    if (!woodTextureUrl) {
      woodTextureUrl = makeWoodTexture({
        tilePx: ceiling.tile_px, plankPx: ceiling.plank_px,
        seed: ceiling.seed, knotProb: ceiling.knot_prob,
      });
    }
    return woodCeilingStyle(woodTextureUrl, {
      tilePx: ceiling.tile_px, base: ceiling.base_color,
      edgeLinePx: ceiling.edge_line_px, edgeLineColor: ceiling.edge_line_color,
    });
  } catch (err) {
    if (!woodFallbackWarned) {
      console.warn('[ceiling] sin lienzo, se usa la cuadrícula', err);
      woodFallbackWarned = true;
    }
    return gridStyle(ceiling);
  }
}

// Canvas painters for the planes, the same look as the CSS styles above. The planes are painted
// into a canvas with a small backing store: as CSS backgrounds they are rastered in GPU tiles at
// full size (tens of millions of px), and Edge/Brave run out of tile memory and drop wall tiles
// mid-turn (walls flicker to their bare colour). Patterns are aligned to world px, so pieces join.
const mod = (a, n) => ((a % n) + n) % n;

// Lines of width lw at the end of every period, like repeating-linear-gradient(transparent 0 gap, color gap period).
function stripes(ctx, along, origin, period, lw, w, h) {
  let s = (period - lw) - mod(origin, period);
  while (s > 0) s -= period;
  for (; s < (along === 'y' ? h : w); s += period) {
    if (along === 'y') ctx.fillRect(0, s, w, lw);
    else ctx.fillRect(s, 0, lw, h);
  }
}

function floorPaint(f) {
  return (ctx, p, w, h) => {
    ctx.fillStyle = f.color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = f.cross_line_color;
    stripes(ctx, 'x', p.xa, f.cross_px, f.line_width_px, w, h);
    ctx.fillStyle = f.line_color;
    stripes(ctx, 'y', p.za, f.line_px, f.line_width_px, w, h);
  };
}

function gridPaint(c) {
  return (ctx, p, w, h) => {
    ctx.fillStyle = c.color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.grid_color;
    stripes(ctx, 'x', p.xa, c.grid_px, c.grid_line_px, w, h);
    stripes(ctx, 'y', p.za, c.grid_px, c.grid_line_px, w, h);
  };
}

async function ceilingPaint(ceiling) {
  if (ceiling.type !== 'wood') return gridPaint(ceiling);
  try {
    if (!woodTextureUrl) {
      woodTextureUrl = makeWoodTexture({
        tilePx: ceiling.tile_px, plankPx: ceiling.plank_px,
        seed: ceiling.seed, knotProb: ceiling.knot_prob,
      });
    }
    const img = new Image();
    img.src = woodTextureUrl;
    await img.decode();
    const tile = ceiling.tile_px || img.width;
    const edge = ceiling.edge_line_px || 0;
    return (ctx, p, w, h) => {
      ctx.fillStyle = ceiling.base_color || '#cfa873';
      ctx.fillRect(0, 0, w, h);
      const pat = ctx.createPattern(img, 'repeat');
      pat.setTransform(new DOMMatrix().translate(-mod(p.xa, tile), -mod(p.za, tile)).scale(tile / img.width));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, w, h);
      if (edge > 0) {
        ctx.fillStyle = ceiling.edge_line_color;
        ctx.fillRect(0, 0, w, edge);
        ctx.fillRect(w - edge, 0, edge, h);
      }
    };
  } catch (err) {
    if (!woodFallbackWarned) {
      console.warn('[ceiling] sin lienzo, se usa la cuadrícula', err);
      woodFallbackWarned = true;
    }
    return gridPaint(ceiling);
  }
}

// Horizontal planes in the same 3D context as the walls. Nothing is built when both are off.
async function mountPlanes(world, route, camera) {
  const cfg = (route && route.world) || {};
  const ceiling = cfg.ceiling;
  const floor = cfg.floor;
  if (!(ceiling && ceiling.enabled) && !(floor && floor.enabled)) return;
  const canPaint = !!document.createElement('canvas').getContext('2d');
  const planes = [];
  const add = (kind, paint, style, yUnits) => {
    const el = document.createElement('div');
    el.className = 'plane ' + kind;
    el.setAttribute('aria-hidden', 'true');
    if (canPaint) el.append(document.createElement('canvas'));
    else Object.assign(el.style, style);
    world.append(el);
    planes.push({ el, yUnits, paint: canPaint ? paint : null });
  };
  if (ceiling && ceiling.enabled) add('ceiling', canPaint ? await ceilingPaint(ceiling) : null, ceilingStyle(ceiling), ceiling.y_units);
  if (floor && floor.enabled) add('floor', floorPaint(floor), floorStyle(floor), floor.y_units);
  camera.setPlanes(planes);
}

const $ = (id) => document.getElementById(id);
const debug = new URLSearchParams(location.search).get('debug') === '1';

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  if (location.protocol === 'file:') return;

  const gallery = await fetchJSON('galeria-data/gallery.json');
  const tokens = gallery.svg_conventions.theme_tokens;
  Object.entries(tokens).forEach(([k, v]) => document.documentElement.style.setProperty('--' + k, v));
  if (debug) document.body.classList.add('debug');

  // frames.json is only a fallback for SVGs exported without <g id="focus-frames">.
  const framesFallback = await fetchJSON('tools/frames.json').then((j) => j.walls).catch(() => null);

  // Room data: rooms[].data is relative to galeria-data/.
  const rooms = [...gallery.rooms].sort((a, b) => a.order - b.order);
  const roomData = await Promise.all(rooms.map((r) => fetchJSON('galeria-data/' + r.data).catch(() => null)));

  // Ordered stops: intro, rooms by order, then the final reflection room (listed in the directory).
  const stops = [{ id: 'intro', kind: 'intro', title: 'Vestíbulo', svg: gallery.intro.wall_svg }];
  rooms.forEach((r, i) => {
    const d = roomData[i];
    stops.push({ id: r.id, kind: 'room', room: r, data: d, title: (d && d.room && d.room.title) || r.id, svg: r.wall_svg });
  });
  const route = gallery.route || null;
  // Door wall of the classroom entrance (route segment door_enter): one more stop before the final room.
  const entranceCfg = (gallery.final_room && gallery.final_room.entrance) || null;
  const hasDoor = !!(entranceCfg && route && (route.segments || []).some((s) => s.type === 'door_enter'));
  if (hasDoor) {
    stops.push({ id: entranceCfg.door_wall.id, kind: 'door', title: 'Puerta del aula', svg: entranceCfg.door_wall.svg });
  }
  if (gallery.final_room) {
    stops.push({ id: gallery.final_room.id, kind: 'final', title: gallery.final_room.title, svg: gallery.final_room.wall_svg });
  }
  stops.forEach((s, i) => { s.index = i; s.wallId = basename(s.svg); });
  if (hasDoor) {
    const doorStop = stops.find((s) => s.kind === 'door');
    doorStop.wallId = entranceCfg.door_wall.id;
    doorStop.loadUrl = (await resolveDoorWall(entranceCfg.door_wall)).url; // provisional wall when the SVG is missing
  }

  const scene = $('scene');
  const world = $('world');
  if (route && route.world && route.world.scene_background) scene.style.background = route.world.scene_background;
  const camera = createCamera({ scene, world, route, entrance: entranceCfg, debug });

  const walls = await Promise.all(stops.map((s) => loadWall({ index: s.index, id: s.wallId, svgPath: s.loadUrl || s.svg, title: s.title, framesFallback })));
  const fillSvg = await fetch('walls/wall-fill.svg').then((r) => (r.ok ? r.text() : null)).catch(() => null);
  if (fillSvg) setFillTemplate(fillSvg);

  const worldCfg = (route && route.world) || {};
  const ceilingOn = !!(worldCfg.ceiling && worldCfg.ceiling.enabled);
  const floorOn = !!(worldCfg.floor && worldCfg.floor.enabled);
  // The hall ends at the door wall when there is one; the classroom has its own side walls.
  const lastFillIndex = hasDoor ? stops.findIndex((s) => s.kind === 'door') : walls.length - 1;
  walls.forEach((w, i) => {
    stops[i].wall = w;
    // Fills go first so the wall paints over their 1px overlap.
    buildFills(w, { first: i === 0, last: i === lastFillIndex, top: !ceilingOn, bottom: !floorOn }).forEach((f) => world.append(f.el));
    world.append(w.el);
    camera.register(w);
  });
  await mountPlanes(world, route, camera);
  camera.measure();

  // ---------- Aula entrance (door leaf, classroom shell, desks); the timeline lives in entrance.js ----------
  let entrance = null;
  if (hasDoor) {
    entrance = initEntrance({
      camera, world, cfg: entranceCfg,
      doorWall: stops.find((s) => s.kind === 'door').wall,
      classWall: stops.find((s) => s.kind === 'final').wall,
      floorUnits: (route.world && route.world.floor && route.world.floor.y_units) || 822,
      debug,
      onOpen: () => { const f = stops.find((s) => s.kind === 'final'); if (f) showStop(f.index); },
    });
  }

  // Focus can scroll an overflow:hidden container; keep the scene pinned.
  scene.addEventListener('scroll', () => { scene.scrollTop = 0; scene.scrollLeft = 0; });

  // ---------- UI components ----------
  const tabs = gallery.card_tabs.tabs;
  const card = createCard({
    root: $('card'), backdrop: $('card-backdrop'), tabs,
    onClose: () => { const s = current(); if (s) camera.goTo(s.wallId, 'focus-frame', { duration: 0.9 }); },
  });
  const popup = createPopup({ root: $('popup'), title: $('popup-title'), action: $('popup-action'), close: $('popup-close') });
  const tip = createTooltip($('tooltip'));
  const soundBtn = $('btn-sound');
  const props = createProps({ stops, isInstant: () => camera.instant });
  const ambience = createAmbience({ button: $('btn-music'), file: 'audio/ambiente.mp3' });
  const audio = createAudio({
    panel: $('audio-panel'), status: $('audio-status'), toggle: $('script-toggle'),
    box: $('script-box'), text: $('script-text'), note: $('script-note'),
    onBind: (el) => props.bind(el),
    onChange: (on, el) => {
      soundBtn.setAttribute('aria-pressed', String(on));
      const text = on ? 'Sonido de la sala: activado' : 'Sonido de la sala: apagado';
      soundBtn.setAttribute('aria-label', text);
      soundBtn.title = text;
      ambience.setDucked(on);
      props.setSpeaking(on ? current().wall : null, el);
    },
  });

  let currentIndex = 0;
  let busy = false;
  let pendingTab = 0;
  let pendingOpts = {};
  const current = () => stops[currentIndex];
  const stopByWall = (id) => stops.find((s) => s.wallId === id);
  const stopById = (id) => stops.find((s) => s.id === id);

  function audioFor(stop) {
    if (stop.kind === 'intro') {
      const sp = gallery.intro.speaker;
      return { file: sp.welcome_audio, script: sp.script_draft, scriptNote: sp.script_note };
    }
    if (stop.kind === 'final') {
      const a = gallery.final_room && gallery.final_room.audio;
      return a && a.file ? { file: a.file, script: a.script_draft, scriptNote: a.script_note } : null;
    }
    const a = stop.data && stop.data.audio;
    return a ? { file: a.file, script: a.script_draft, scriptNote: a.script_note } : null;
  }

  function toggleSpeaker() {
    const a = audioFor(current());
    if (a) audio.toggle(a);
  }

  // ---------- Navigation ----------
  const menu = $('room-menu');
  stops.forEach((s) => menu.append(new Option(s.title, s.index)));
  const prev = $('btn-prev');
  const next = $('btn-next');

  function syncNav() {
    menu.value = currentIndex;
    prev.disabled = busy || currentIndex === 0;
    next.disabled = busy || currentIndex === stops.length - 1;
    menu.disabled = busy;
    soundBtn.disabled = !audioFor(current());
    // Only the current wall is reachable by keyboard.
    stops.forEach((s) => { s.wall.el.inert = s.index !== currentIndex; });
  }

  camera.onArrive = (wallId, frameId) => {
    const s = stopByWall(wallId);
    if (!s) return;
    if (entrance) entrance.arrived(wallId);
    const entered = s.index !== currentIndex;
    if (entered) { currentIndex = s.index; audio.stop(); }
    syncNav();
    if (s.wall.map) { s.wall.map.refresh(); s.wall.map.arrived(); }
    if (s.wall.room3) s.wall.room3.arrived(frameId, entered && frameId === 'focus-frame');
    stops.forEach((st) => { if (st.wall.room4) st.wall.room4.setActive(st.index === currentIndex); });
    if (s.wall.room4) s.wall.room4.arrived(frameId);
    if (frameId === 'focus-content' && s.data && !card.isOpen() && !busy) {
      card.open(s.data, { tab: pendingTab, ...pendingOpts });
      pendingTab = 0;
      pendingOpts = {};
    }
  };

  // ---------- Corner turns (route corner_90 and corner_90_outside) ----------
  // Each corner splits the route into sides: side s runs from corners[s - 1].b to corners[s].a.
  const corners = [...camera.corners, ...(entrance ? camera.doors : [])]
    .map((c) => ({ type: c.type, a: stopByWall(c.between[0]), b: stopByWall(c.between[1]) }))
    .filter((c) => c.a && c.b)
    .sort((x, y) => x.a.index - y.a.index);
  const hasCorner = corners.length > 0;
  const sideOf = (i) => corners.filter((c) => c.a.index < i).length;
  let traveling = false;

  const live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  document.body.append(live);
  const announce = (text) => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); };

  // Takes the pointer and keyboard focus during a corner turn, so nothing on the walls can start a move.
  const shield = document.createElement('div');
  shield.id = 'turn-shield';
  shield.tabIndex = -1;
  shield.setAttribute('aria-hidden', 'true');
  document.body.append(shield);
  const startTurn = () => {
    document.body.classList.add('turning');
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.wall')) shield.focus({ preventScroll: true });
  };

  async function travel(i, opts) {
    traveling = true;
    busy = true;
    syncNav();
    try {
      // For every corner between here and the target: glide to the corner stop on the
      // current side, run the turn, then (after the last turn) glide to the target.
      while (sideOf(currentIndex) !== sideOf(i)) {
        const side = sideOf(currentIndex);
        const fwd = sideOf(i) > side;
        const corner = corners[fwd ? side : side - 1];
        const fromEdge = fwd ? corner.a : corner.b;
        const toEdge = fwd ? corner.b : corner.a;
        const cur = camera.current;
        if (currentIndex !== fromEdge.index || !cur || cur.wallId !== fromEdge.wallId || cur.frameId !== 'focus-frame') {
          await camera.goTo(fromEdge.wallId, 'focus-frame', opts);
        }
        const instant = !!opts && opts.duration === 0;
        if (corner.type === 'door_enter') {
          announce(fwd ? 'Entrando al aula de reflexión' : 'Saliendo del aula');
          startTurn();
          await entrance.play(fwd ? 'in' : 'out', { instant });
        } else {
          announce(`Girando a la ${toEdge.kind === 'room' ? 'Sala ' + toEdge.index : toEdge.title}`);
          startTurn();
          await camera.turn(fromEdge.wallId, toEdge.wallId, instant ? { duration: 0 } : {});
        }
        document.body.classList.remove('turning');
        if (currentIndex !== toEdge.index) break; // the turn did not land; never loop
      }
      if (currentIndex !== i) await camera.goTo(stops[i].wallId, 'focus-frame', opts);
    } finally {
      document.body.classList.remove('turning');
      traveling = false;
      busy = false;
      syncNav();
    }
  }

  const showStop = (i, opts) => {
    if (traveling) return Promise.resolve();
    popup.hide();
    tip.hide();
    if (hasCorner && sideOf(currentIndex) !== sideOf(i)) return travel(i, opts);
    return camera.goTo(stops[i].wallId, 'focus-frame', opts);
  };

  prev.addEventListener('click', () => currentIndex > 0 && showStop(currentIndex - 1));
  next.addEventListener('click', () => currentIndex < stops.length - 1 && showStop(currentIndex + 1));
  menu.addEventListener('change', () => showStop(+menu.value));
  soundBtn.addEventListener('click', toggleSpeaker);

  const noanim = $('btn-noanim');
  const motionOn = () => noanim.getAttribute('aria-pressed') === 'true';
  const syncMotion = () => {
    camera.userInstant = motionOn();
    document.body.classList.toggle('no-anim', camera.instant);
    const label = noanim.querySelector('.nav-pill-label');
    const short = motionOn() ? 'Sin movimiento' : 'Con movimiento';
    const hint = motionOn()
      ? 'Las salas cambian de un salto. Pulsa para volver a ver la animación.'
      : 'Las salas se recorren con animación. Pulsa para verlas quietas.';
    if (label) label.textContent = short;
    noanim.setAttribute('aria-label', short);
    noanim.title = hint;
  };
  noanim.addEventListener('click', () => {
    noanim.setAttribute('aria-pressed', motionOn() ? 'false' : 'true');
    syncMotion();
  });
  syncMotion();

  const fsBtn = $('btn-fullscreen');
  const fsTarget = document.documentElement;
  const requestFs = fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen;
  if (!requestFs) fsBtn.hidden = true;
  else {
    const fsNow = () => document.fullscreenElement || document.webkitFullscreenElement;
    const syncFs = () => {
      const on = !!fsNow();
      fsBtn.setAttribute('aria-pressed', String(on));
      const text = on ? 'Salir de pantalla completa' : 'Pantalla completa';
      fsBtn.setAttribute('aria-label', text);
      fsBtn.title = text;
    };
    fsBtn.addEventListener('click', () => {
      const done = fsNow()
        ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
        : requestFs.call(fsTarget);
      if (done && done.catch) done.catch(() => {});
    });
    document.addEventListener('fullscreenchange', syncFs);
    document.addEventListener('webkitfullscreenchange', syncFs);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (card.isOpen()) card.close();
      else if (popup.isOpen()) popup.hide();
      else tip.hide();
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (busy || card.isOpen()) return;
    const t = e.target;
    if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.getAttribute('role') === 'tab')) return;
    if (e.key === 'ArrowRight' && currentIndex < stops.length - 1) showStop(currentIndex + 1);
    if (e.key === 'ArrowLeft' && currentIndex > 0) showStop(currentIndex - 1);
  });

  // ---------- Intro door sequence ----------
  const fade = $('fade');
  const introStop = stops[0];
  const firstRoom = stops[1];

  async function enter() {
    if (busy) return;
    popup.hide();
    if (camera.instant || !firstRoom) { if (firstRoom) showStop(1, { duration: 0 }); return; }
    busy = true;
    syncNav();
    const w0 = introStop.wallId;
    const leaves = [
      [introStop.wall.el.querySelector('#door-leaf-left'), '0% 50%'],
      [introStop.wall.el.querySelector('#door-leaf-right'), '100% 50%'],
    ].filter(([n]) => n);

    await camera.goTo(w0, 'focus-door', { duration: 1.2 });
    leaves.forEach(([n, origin]) => window.gsap.to(n, { scaleX: 0.12, transformOrigin: origin, duration: 1.2, ease: 'power2.inOut' }));
    window.gsap.to(fade, { opacity: 1, duration: 0.5, delay: 0.7, ease: 'none' });
    await camera.goTo(w0, 'focus-door-pass', { duration: 1.2 });

    // Under the white overlay: cut to room 1, pulled back, then ease to rest.
    currentIndex = firstRoom.index;
    leaves.forEach(([n]) => window.gsap.set(n, { scaleX: 1 }));
    camera.place(firstRoom.wallId, 'focus-frame', { zOffset: -700 });
    busy = false;
    syncNav();
    busy = true;
    await Promise.all([
      camera.goTo(firstRoom.wallId, 'focus-frame', { duration: 0.7, ease: 'power2.out' }),
      new Promise((res) => window.gsap.to(fade, { opacity: 0, duration: 0.6, ease: 'power1.out', onComplete: res })),
    ]);
    busy = false;
    syncNav();
  }

  // ---------- Overlays ----------
  const goToTarget = (id) => {
    const s = stopById(id);
    if (s) showStop(s.index);
  };

  buildIntro(introStop.wall, gallery, {
    enter,
    goToTarget,
    skip: () => { popup.hide(); camera.goTo(introStop.wallId, 'focus-directory', { duration: 0 }); },
    speaker: toggleSpeaker,
  });

  stops.filter((s) => s.kind === 'room' && s.data && !s.wall.placeholder).forEach((s) => {
    buildRoom(s.wall, s.room, {
      speaker: toggleSpeaker,
      showTip: (d, text) => tip.show(d, text),
      hideTip: () => tip.hide(),
      openCard: () => camera.goTo(s.wallId, 'focus-content'),
      letter: async (hs) => {
        await camera.goTo(s.wallId, hs.focus || 'focus-letter');
        popup.show({
          label: hs.label,
          actionLabel: 'Abrir «Metodología activa»',
          onAction: () => { pendingTab = Math.max(0, tabs.indexOf('Metodología activa')); camera.goTo(s.wallId, 'focus-content'); },
        });
      },
    });
  });

  // ---------- Sala 1 map (replaces the old window and cerro boxes) ----------
  const mapStop = stops.find((s) => s.kind === 'room' && s.room.map && s.data && !s.wall.placeholder);
  if (mapStop) {
    const groups = (mapStop.data.evidence && mapStop.data.evidence.cerros_by_group) || [];
    mapStop.wall.map = await initMap({
      wall: mapStop.wall,
      cfg: mapStop.room.map,
      isInstant: () => camera.instant,
      tip,
      onActivate: () => {
        if (card.isOpen()) return;
        const n = groups.length;
        pendingTab = Math.max(0, tabs.indexOf('Metodología activa'));
        pendingOpts = { highlightPhase: 'Desarrollo', line: n ? `${n} equipos, ${n} cerros` : undefined };
        camera.goTo(mapStop.wallId, 'focus-content');
      },
    });
  }

  // ---------- Sala 2 lockers, plaques and flip board ----------
  const lockerStop = stops.find((s) => s.kind === 'room' && s.room.lockers && s.room.board && s.data && !s.wall.placeholder);
  if (lockerStop) initRoom2({ wall: lockerStop.wall, room: lockerStop.room, data: lockerStop.data, isInstant: () => camera.instant });

  // ---------- Sala 3 garland, lens and scene bar ----------
  const arStop = stops.find((s) => s.kind === 'room' && s.room.lens && s.room.garland && s.data && !s.wall.placeholder);
  if (arStop) {
    arStop.wall.room3 = initRoom3({
      wall: arStop.wall,
      room: arStop.room,
      data: arStop.data,
      isInstant: () => camera.instant,
      goTo: (frame, opts) => camera.goTo(arStop.wallId, frame, opts),
      openCard: (label) => {
        if (card.isOpen()) return;
        pendingTab = Math.max(0, tabs.indexOf(label));
        camera.goTo(arStop.wallId, 'focus-content');
      },
      playAudio: toggleSpeaker,
      tip,
    });
  }

  // ---------- Sala 4 cards, thermometers and pegboard ----------
  const iaStop = stops.find((s) => s.kind === 'room' && s.room.lab && s.room.pegboard && s.data && !s.wall.placeholder);
  if (iaStop) {
    iaStop.wall.room4 = initRoom4({
      wall: iaStop.wall,
      room: iaStop.room,
      data: iaStop.data,
      isInstant: () => camera.instant,
      goTo: (frame, opts) => camera.goTo(iaStop.wallId, frame, opts),
      openCard: (label) => {
        if (card.isOpen()) return;
        pendingTab = Math.max(0, tabs.indexOf(label));
        camera.goTo(iaStop.wallId, 'focus-content');
      },
    });
  }

  // ---------- Final room (works with or without wall-05) ----------
  const finalStop = stops.find((s) => s.kind === 'final');
  if (finalStop) {
    auditPublish({ gallery, rooms, roomData });
    const api = initFinal({
      wall: finalStop.wall,
      gallery,
      rooms,
      roomData,
      playAudio: toggleSpeaker,
      openCard: (view) => card.open(null, view),
    });
    finalStop.wall.finalRoom = api;
  }

  // ---------- Debug ----------
  if (debug) {
    walls.forEach(drawDebug);
    const dm = $('debug-menu');
    walls.forEach((w) => {
      const g = document.createElement('optgroup');
      g.label = w.id;
      w.frames.forEach((_, fid) => g.append(new Option(fid, `${w.id}|${fid}`)));
      dm.append(g);
    });
    $('debug-field').hidden = false;
    if (hasCorner) {
      const entries = [
        ['Marco…', ''],
        ['Probar giro interior', 'turn-inside', 'corner_90'],
        ['Probar giro exterior', 'turn-outside', 'corner_90_outside'],
        ['Probar giro', 'turn', 'corner_90'],
        ['Probar entrada al aula', 'aula-enter', 'door_enter'],
      ].filter(([, , type]) => !type || corners.some((c) => c.type === type));
      dm.prepend(...entries.map(([label, value]) => new Option(label, value)));
      dm.selectedIndex = 0;
    }
    dm.addEventListener('change', () => {
      if (!dm.value) return;
      if (dm.value === 'turn') {
        // Legacy test: cross the first inside corner.
        dm.selectedIndex = 0;
        const c = corners.find((x) => x.type === 'corner_90');
        if (c) showStop(sideOf(currentIndex) <= sideOf(c.a.index) ? c.b.index : c.a.index);
        return;
      }
      if (dm.value === 'aula-enter') {
        dm.selectedIndex = 0;
        const c = corners.find((x) => x.type === 'door_enter');
        if (c) showStop(sideOf(currentIndex) <= sideOf(c.a.index) ? c.b.index : c.a.index);
        return;
      }
      if (dm.value === 'turn-inside' || dm.value === 'turn-outside') {
        dm.selectedIndex = 0;
        const c = corners.find((x) => x.type === (dm.value === 'turn-inside' ? 'corner_90' : 'corner_90_outside'));
        if (c) showStop(sideOf(currentIndex) <= sideOf(c.a.index) ? c.b.index : c.a.index);
        return;
      }
      const [w, f] = dm.value.split('|');
      camera.goTo(w, f);
    });
    window.__camera = camera;
    window.__entrance = entrance;
    window.__props = props;
  }

  // ---------- Start ----------
  camera.place(introStop.wallId, 'focus-frame');
  syncNav();
}

main().catch((err) => {
  console.error(err);
  const msg = document.createElement('p');
  msg.id = 'load-error';
  msg.setAttribute('role', 'alert');
  msg.textContent = 'No se pudo cargar la galería. Revisa que estés usando Live Server y que existan los archivos de galeria-data.';
  document.body.prepend(msg);
});
