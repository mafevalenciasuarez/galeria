// Decorative props. Sound waves sit on each #speaker and only while that room's
// file is actually playing. The paper plane crosses a room at random intervals.
const NS = 'http://www.w3.org/2000/svg';
const r3 = (n) => Math.round(n * 1000) / 1000;

const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
};

async function fetchSvg(path) {
  const res = await fetch(path);
  if (!res.ok) { console.warn(`[props] ${path} missing`); return null; }
  const host = document.createElement('div');
  host.innerHTML = (await res.text()).replace(/<\?xml[\s\S]*?\?>/, '').trim();
  return host.querySelector('svg');
}

// Keep the class, drop the id, so the same drawing can sit on every wall.
function adopt(svg) {
  const g = svgEl('g');
  [...svg.children].forEach((child) => g.append(child.cloneNode(true)));
  g.querySelectorAll('[id]').forEach((n) => {
    n.setAttribute('class', n.id);
    n.removeAttribute('id');
  });
  return g;
}

function mountWaves(wall, art) {
  const speaker = wall.svg && wall.svg.querySelector('#speaker');
  if (!speaker) return null;
  const wrap = adopt(art);
  wrap.setAttribute('class', 'speaker-waves');
  wrap.setAttribute('visibility', 'hidden');
  wrap.setAttribute('pointer-events', 'none');
  wrap.setAttribute('aria-hidden', 'true');
  wall.svg.append(wrap);
  const area = wrap.querySelector('.speaker-area');
  const ab = area.getBBox();
  const sb = speaker.getBBox();
  const s = Math.max(sb.width / ab.width, sb.height / ab.height);
  const cx = ab.x + ab.width / 2;
  const cy = ab.y + ab.height / 2;
  const px = sb.x + sb.width / 2;
  const py = sb.y + sb.height / 2;
  wrap.setAttribute('transform', `translate(${r3(px)} ${r3(py)}) scale(${r3(s)}) translate(${r3(-cx)} ${r3(-cy)})`);
  wrap.querySelectorAll('.sound-wave-1, .sound-wave-2, .sound-wave-3, .movement-lines').forEach((n) => {
    n.setAttribute('opacity', '0');
  });
  return wrap;
}

// A second copy of the camera, flat, above the rooms. The sheet used to live
// inside #world with a translateZ; the scene then discarded the whole plane
// the moment any part of it crossed the viewport edge.
function mountSky(host) {
  const world = host[0].el.parentElement;
  const n = Math.max(...host.map((w) => w.index)) + 1;
  const layer = document.createElement('div');
  layer.className = 'plane-host';
  world.parentElement.append(layer);
  const sky = svgEl('svg', {
    class: 'plane-sky', viewBox: `0 0 ${n * 1600} 900`,
    preserveAspectRatio: 'none', overflow: 'visible', 'aria-hidden': 'true',
  });
  layer.append(sky);
  const sync = () => {
    const first = host[0].el;
    const w = parseFloat(first.style.width);
    const h = parseFloat(first.style.height);
    if (!w || !h) return;
    sky.style.left = first.style.left || '0px';
    sky.style.top = first.style.top || '0px';
    sky.style.width = (w * n) + 'px';
    sky.style.height = h + 'px';
    layer.style.transform = world.style.transform;
  };
  sync();
  window.addEventListener('resize', sync);
  new MutationObserver(sync).observe(world, { attributes: true, attributeFilter: ['style'] });
  return sky;
}

export function createProps({ stops, isInstant }) {
  const waves = new Map();
  let waveArt = null;
  let planeArt = null;
  let active = null;
  let levelStop = null;
  let audioCtx = null;
  let sourceNode = null;
  let analyser = null;
  let boundEl = null;
  let planeTimer = null;
  let flying = false;
  let sky = null;

  function hideWaves(wrap) {
    if (!wrap) return;
    if (wrap.timeline) { wrap.timeline.kill(); wrap.timeline = null; }
    wrap.setAttribute('visibility', 'hidden');
    wrap.querySelectorAll('.sound-wave-1, .sound-wave-2, .sound-wave-3, .movement-lines').forEach((n) => {
      n.style.opacity = '';
      n.setAttribute('opacity', '0');
    });
  }

  function showWaves(wrap) {
    wrap.setAttribute('visibility', 'visible');
    const rings = [1, 2, 3].map((i) => wrap.querySelector('.sound-wave-' + i)).filter(Boolean);
    const gsap = window.gsap;
    if (!gsap || isInstant()) {
      rings.forEach((n) => n.setAttribute('opacity', '1'));
      return;
    }
    // Outward ripple: 1, then 2, then 3, each fading in and back out, then repeat.
    const tl = gsap.timeline({ repeat: -1 });
    rings.forEach((n, i) => {
      tl.fromTo(n, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'sine.out' }, i * 0.28);
      tl.to(n, { opacity: 0, duration: 0.5, ease: 'sine.in' }, i * 0.28 + 0.4);
    });
    wrap.timeline = tl;
  }

  function stopLevel() {
    if (levelStop) { levelStop(); levelStop = null; }
    if (sourceNode) { sourceNode.disconnect(); sourceNode = null; }
    if (analyser) { analyser.disconnect(); analyser = null; }
    boundEl = null;
  }

  // Called synchronously from the click, before audio.play().
  function bind(el) {
    if (!el || el === boundEl) return;
    stopLevel();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    sourceNode = audioCtx.createMediaElementSource(el);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
    boundEl = el;
    audioCtx.resume();
  }

  // Movement ticks follow the signal. Silence in the file keeps them invisible.
  function followLevel(wrap) {
    if (levelStop) { levelStop(); levelStop = null; }
    const lines = wrap && wrap.querySelector('.movement-lines');
    if (!lines || !analyser) return;
    const bins = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let shown = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(bins);
      let sum = 0;
      for (let i = 0; i < bins.length; i++) {
        const v = (bins[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / bins.length);
      const target = rms < 0.02 ? 0 : Math.min(1, (rms - 0.02) * 9);
      shown += (target - shown) * 0.35;
      lines.setAttribute('opacity', shown < 0.04 ? '0' : String(r3(shown)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    levelStop = () => { cancelAnimationFrame(raf); lines.setAttribute('opacity', '0'); };
  }

  function glide() {
    if (flying || isInstant() || !planeArt) return;
    const candidates = stops.filter((s) => s.wall && s.wall.el).map((s) => s.wall);
    if (!candidates.length) return;
    if (!sky) sky = mountSky(candidates);
    const wall = candidates[Math.floor(Math.random() * candidates.length)];
    const g = adopt(planeArt);
    g.setAttribute('class', 'paper-plane');
    g.setAttribute('pointer-events', 'none');
    g.setAttribute('aria-hidden', 'true');
    sky.append(g);
    const vb = planeArt.viewBox.baseVal;
    const scale = 155 / (vb.width || 1777);
    // The drawing's nose points the wrong way, so the facing is opposite the travel.
    const dir = Math.random() < 0.5 ? 1 : -1;
    const face = -dir;
    // Nose sits low. A clockwise turn in the drawing's own frame lifts it;
    // the horizontal flip then makes a rightward flight read as counterclockwise.
    const tilt = 15;
    const cx = vb.x + vb.width / 2;
    const cy = vb.y + vb.height / 2;
    const reach = (vb.width * scale) / 2 * Math.cos(tilt * Math.PI / 180)
      + (vb.height * scale) / 2 * Math.sin(tilt * Math.PI / 180);
    const y0 = 80 + Math.random() * 180;
    const y1 = y0 + (Math.random() * 70 - 20);
    const start = dir > 0 ? -reach : 1600 + reach;
    const end = dir > 0 ? 1600 + reach : -reach;
    const origin = wall.index * 1600;
    const state = { x: start, y: y0 };
    const place = () => g.setAttribute('transform',
      `translate(${r3(origin + state.x)} ${r3(state.y)}) scale(${r3(face * scale)} ${r3(scale)}) rotate(${tilt}) translate(${r3(-cx)} ${r3(-cy)})`);
    place();
    flying = true;
    const done = () => { flying = false; g.remove(); };
    const gsap = window.gsap;
    if (!gsap) { done(); return; }
    gsap.to(state, {
      x: end, y: y1, duration: 6 + Math.random() * 2, ease: 'none',
      onUpdate: place,
      onComplete: done,
    });
  }

  function schedule(first) {
    const wait = first ? 2500 + Math.random() * 3000 : 8000 + Math.random() * 12000;
    planeTimer = setTimeout(() => { glide(); schedule(false); }, wait);
  }

  const ready = (async () => {
    [waveArt, planeArt] = await Promise.all([
      fetchSvg('props/speaker-soundwaves.svg'),
      fetchSvg('props/paper-plane.svg'),
    ]);
    if (waveArt) {
      stops.forEach((s) => {
        if (!s.wall || s.wall.placeholder) return;
        const wrap = mountWaves(s.wall, waveArt);
        if (wrap) waves.set(s.wall.el, wrap);
      });
    }
    if (planeArt) schedule(true);
  })();

  return {
    ready,
    // `el` is the HTMLAudioElement that just started. Null hides every speaker.
    bind,
    setSpeaking(wall, el) {
      hideWaves(active);
      if (levelStop) { levelStop(); levelStop = null; }
      active = null;
      if (!wall || !el) { stopLevel(); return; }
      ready.then(() => {
        if (!el || el.paused || el.ended) return;
        const wrap = waves.get(wall.el || wall);
        if (!wrap) return;
        active = wrap;
        showWaves(wrap);
        if (boundEl !== el) bind(el);
        followLevel(wrap);
      });
    },
  };
}
