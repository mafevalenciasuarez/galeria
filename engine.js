// Engine: loads data, builds stops, wires camera, walls and UI.
import { createCamera } from './camera.js';
import { loadWall, basename, buildIntro, buildRoom, drawDebug, buildFills, setFillTemplate } from './walls.js';
import { createCard, createPopup, createTooltip, createAudio, createAmbience } from './ui.js';
import { initMap } from './map.js';
import { initRoom2 } from './room2.js';
import { createProps } from './props.js';

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
  if (gallery.final_room) {
    stops.push({ id: gallery.final_room.id, kind: 'final', title: gallery.final_room.title, svg: gallery.final_room.wall_svg });
  }
  stops.forEach((s, i) => { s.index = i; s.wallId = basename(s.svg); });

  const scene = $('scene');
  const world = $('world');
  const camera = createCamera({ scene, world, debug });

  const walls = await Promise.all(stops.map((s) => loadWall({ index: s.index, id: s.wallId, svgPath: s.svg, title: s.title, framesFallback })));
  const fillSvg = await fetch('walls/wall-fill.svg').then((r) => (r.ok ? r.text() : null)).catch(() => null);
  if (fillSvg) setFillTemplate(fillSvg);

  walls.forEach((w, i) => {
    stops[i].wall = w;
    // Fills go first so the wall paints over their 1px overlap.
    buildFills(w, { first: i === 0, last: i === walls.length - 1 }).forEach((f) => world.append(f.el));
    world.append(w.el);
    camera.register(w);
  });
  camera.measure();

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
    if (s.index !== currentIndex) { currentIndex = s.index; audio.stop(); }
    syncNav();
    if (s.wall.map) { s.wall.map.refresh(); s.wall.map.arrived(); }
    if (frameId === 'focus-content' && s.data && !card.isOpen() && !busy) {
      card.open(s.data, { tab: pendingTab, ...pendingOpts });
      pendingTab = 0;
      pendingOpts = {};
    }
  };

  const showStop = (i, opts) => {
    popup.hide();
    tip.hide();
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
    const text = motionOn() ? 'Sin animación: activado' : 'Sin animación: desactivado';
    noanim.setAttribute('aria-label', text);
    noanim.title = text;
  };
  noanim.addEventListener('click', () => {
    noanim.setAttribute('aria-pressed', motionOn() ? 'false' : 'true');
    syncMotion();
  });
  syncMotion();

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
    dm.addEventListener('change', () => { const [w, f] = dm.value.split('|'); camera.goTo(w, f); });
    window.__camera = camera;
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
