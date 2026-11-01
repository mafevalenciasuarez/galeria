// Uso: node tools/inject-frames.mjs <carpeta-svg-origen> <frames.json> <carpeta-salida>
// Inserta (o reemplaza) un grupo <g id="focus-frames"> con los marcos de cámara
// justo antes de </svg>. Si la entrada trae "annotations" (archivo junto a frames.json),
// también inserta <g id="map-annotations"> (flecha de norte, etiquetas) para que no se
// pierdan al volver a exportar desde Illustrator.
import fs from 'node:fs';
import path from 'node:path';

const [srcDir, framesPath, outDir] = process.argv.slice(2);
if (!srcDir || !framesPath || !outDir) {
  console.error('Uso: node tools/inject-frames.mjs <origen> <frames.json> <salida>');
  process.exit(1);
}
const { walls } = JSON.parse(fs.readFileSync(framesPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

for (const file of fs.readdirSync(srcDir).filter(f => f.endsWith('.svg'))) {
  const name = path.basename(file, '.svg');
  const entry = walls[name];
  if (!entry) { console.warn(`Sin marcos definidos para ${name}; se omite.`); continue; }
  // Forma antigua: array de marcos (grupo focus-frames). Forma nueva: { group, rects }.
  const frames = Array.isArray(entry) ? entry : entry.rects;
  const groupId = Array.isArray(entry) ? 'focus-frames' : (entry.group || 'focus-frames');
  const annotationsFile = Array.isArray(entry) ? null : entry.annotations;
  const annId = (!Array.isArray(entry) && entry.annotations_group) || 'map-annotations';
  const annotations = annotationsFile
    ? fs.readFileSync(path.join(path.dirname(framesPath), annotationsFile), 'utf8').trim()
    : '';

  let svg = fs.readFileSync(path.join(srcDir, file), 'utf8');
  // Illustrator pone ids de raíz como Layer_1 o bg-1; los unificamos con el nombre de la pared.
  svg = svg.replace(/<svg\b([^>]*)>/, (m, attrs) => {
    const clean = attrs.replace(/\sid="[^"]*"/, '');
    return `<svg id="${name}"${clean}>`;
  });
  svg = svg.replace(new RegExp(`\\s*<g id="${groupId}"[\\s\\S]*?<\\/g>\\s*(?=<\\/svg>)`), '\n'); // reemplazo idempotente
  svg = svg.replace(new RegExp(`\\s*<g id="${annId}"[\\s\\S]*?<\\/g>\\s*(?=<\\/svg>)`), '\n');
  svg = svg.replace(/id="svg2"/, `id="${name}-content"`); // Illustrator reutiliza svg2 en cada archivo

  const rects = frames.map(f =>
    `    <rect id="${f.id}" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}"/>`
  ).join('\n');
  const group = `  <g id="${groupId}" fill="none" stroke="none" pointer-events="none">\n${rects}\n  </g>\n`;

  const annGroup = annotations
    ? `  <g id="${annId}" pointer-events="none">\n${annotations}\n  </g>\n`
    : '';
  // ids a ocultar (arte original que el fragmento ya reemplaza): se les añade display="none"
  for (const hid of (Array.isArray(entry) ? [] : (entry.hide || []))) {
    svg = svg.replace(new RegExp(`(<\\w+\\b[^>]*?\\bid="${hid}")([^>]*>)`), (m, a, b) => b.includes('display=') ? m : `${a} display="none"${b}`);
  }
  svg = svg.replace(/<\/svg>\s*$/, annGroup + group + '</svg>\n');
  fs.writeFileSync(path.join(outDir, file), svg);
  console.log(`OK ${name}: ${frames.length} marcos`);
}
