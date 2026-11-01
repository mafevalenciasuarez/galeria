// wood-ceiling.js — textura procedural de techo de listones de madera (sin imágenes externas).
// Uso: import { makeWoodTexture } from './wood-ceiling.js'; const url = makeWoodTexture({ plankPx: 32 });
// Devuelve un data URL PNG de un mosaico sin costuras (los listones y sus juntas se repiten sin corte).
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shade(hex, f) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map(i => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
export function makeWoodTexture(opts = {}) {
  const o = Object.assign({
    tilePx: 1024, plankPx: 32, seed: 7, knotProb: 0.12, grain: 0.14,
    palette: ['#dcc29a', '#d2b184', '#caa377', '#c29a6a', '#d8b98c', '#b98d60', '#cfa97a'],
    jointColor: 'rgba(52,32,14,0.60)'
  }, opts);
  const rnd = mulberry32(o.seed);
  const N = o.tilePx, cols = Math.max(1, Math.round(N / o.plankPx)), pw = N / cols;
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.fillStyle = '#c9a56f'; g.fillRect(0, 0, N, N);
  for (let c = 0; c < cols; c++) {
    const segs = []; let y = 0;
    while (y < N) { const len = 170 + rnd() * 380; segs.push(Math.min(len, N - y)); y += len; }
    if (segs.length > 1 && segs[segs.length - 1] < 90) { const l = segs.pop(); segs[segs.length - 1] += l; }
    let y0 = 0; const x0 = c * pw;
    for (const len of segs) {
      const hex = o.palette[(rnd() * o.palette.length) | 0];
      const body = shade(hex, 0.93 + rnd() * 0.14);
      g.fillStyle = body; g.fillRect(x0, y0, pw, len);                 // color plano por tramo: sin degradados
      g.save(); g.beginPath(); g.rect(x0, y0, pw, len); g.clip();
      const n = 3 + ((rnd() * 4) | 0);
      for (let k = 0; k < n; k++) {
        const gx = x0 + 3 + rnd() * (pw - 6), amp = 0.8 + rnd() * 1.6, ph = rnd() * 6.28, fr = 0.006 + rnd() * 0.01;
        g.beginPath();
        for (let yy = y0; yy <= y0 + len; yy += 8) { const xx = gx + Math.sin(yy * fr + ph) * amp; yy === y0 ? g.moveTo(xx, yy) : g.lineTo(xx, yy); }
        g.strokeStyle = `rgba(70,44,20,${o.grain * (0.5 + rnd())})`; g.lineWidth = 0.7 + rnd() * 1.2; g.stroke();
      }
      if (rnd() < o.knotProb && len > 140) {
        const kx = x0 + pw * (0.3 + rnd() * 0.4), ky = y0 + len * (0.25 + rnd() * 0.5), rx = 2.4 + rnd() * 2.2, ry = rx * (1.5 + rnd());
        g.beginPath(); g.ellipse(kx, ky, rx * 1.9, ry * 1.9, 0, 0, 6.283); g.strokeStyle = 'rgba(80,50,22,.35)'; g.lineWidth = 1; g.stroke();
        g.beginPath(); g.ellipse(kx, ky, rx, ry, 0, 0, 6.283); g.fillStyle = 'rgba(66,38,16,.85)'; g.fill();
      }
      g.restore();
      g.fillStyle = o.jointColor; g.fillRect(x0, y0, pw, 1.6);       // junta a tope al inicio del tramo
      y0 += len;
    }
    g.fillStyle = o.jointColor; g.fillRect((c + 1) * pw - 1.6, 0, 1.6, N);   // ranura entre listones
    g.fillStyle = 'rgba(255,240,210,.18)'; g.fillRect(x0, 0, 1, N);          // arista iluminada
  }
  return cv.toDataURL('image/png');
}
// Estilo CSS del plano del techo. Sin sombras ni degradados suaves (estética 2D de la galería).
// Opcional: una línea de tinta plana junto a las paredes (edgeLinePx > 0, con cortes duros).
// Con el plano girado con rotateX(90deg): arriba = pared del fondo (z = 0); derecha = pared perpendicular (x = xr).
export function woodCeilingStyle(url, { tilePx = 1024, base = '#cfa873', edgeLinePx = 0, edgeLineColor = '#4b342c' } = {}) {
  const layers = [], sizes = [], repeats = [];
  if (edgeLinePx > 0) {
    layers.push(`linear-gradient(to bottom, ${edgeLineColor} 0 ${edgeLinePx}px, transparent ${edgeLinePx}px)`,
                `linear-gradient(to left, ${edgeLineColor} 0 ${edgeLinePx}px, transparent ${edgeLinePx}px)`);
    sizes.push('auto', 'auto'); repeats.push('no-repeat', 'no-repeat');
  }
  layers.push(`url(${url})`); sizes.push(`${tilePx}px ${tilePx}px`); repeats.push('repeat');
  return { backgroundColor: base, backgroundImage: layers.join(', '), backgroundSize: sizes.join(', '), backgroundRepeat: repeats.join(', ') };
}
