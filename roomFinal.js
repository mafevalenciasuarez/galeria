// Final room (Aula de reflexión). The wall SVG may be missing: the placeholder still
// opens the card. Every string comes from gallery.json or an exp-*.json file.
// A null user_text stays null; the pending box is a separate marker, not a filled answer.
import { el } from './ui.js';
import { q, placeBox, hotspot } from './walls.js';

const VB = { w: 1600, h: 900 };

const FALLBACK_TABS = [
  { id: 'patrones', label: 'Patrones' },
  { id: 'reflexion', label: 'Reflexión metacognitiva' },
  { id: 'transferencia', label: 'Transferencia a mi práctica' },
  { id: 'ia', label: 'Uso de IA' },
  { id: 'referencias', label: 'Referencias' },
];

const make = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

function pendingBox(text) {
  const box = el('div', { class: 'pending-box' });
  if (!isBlank(text)) box.textContent = text;
  return box;
}

function columnList(decl) {
  const cols = decl && decl.columns;
  if (!Array.isArray(cols) || !cols.length) return null;
  return cols.map((c) => (typeof c === 'string'
    ? { id: c, label: c }
    : { id: c.id || c.key, label: c.label || c.id || c.key })).filter((c) => c.id);
}

// Publish mode only. Draft mode must not console.error.
export function auditPublish({ gallery, rooms, roomData }) {
  const mode = gallery.meta && gallery.meta.mode;
  if (mode !== 'publish') return;
  const fr = gallery.final_room || {};
  const pending = [];
  const mark = (path, value) => { if (value == null) pending.push(path); };

  if (fr.metacognitive_reflection) mark('final_room.metacognitive_reflection.user_text', fr.metacognitive_reflection.user_text);
  if (fr.iag_declaration) mark('final_room.iag_declaration.user_text', fr.iag_declaration.user_text);
  rooms.forEach((room, i) => {
    const d = roomData[i];
    if (d && d.transfer) mark(`${room.id}.transfer.user_text`, d.transfer.user_text);
  });
  const rows = fr.iag_declaration && fr.iag_declaration.draft_rows;
  const cols = columnList(fr.iag_declaration);
  if (Array.isArray(rows) && cols) {
    rows.forEach((row, r) => {
      cols.forEach((c) => {
        if (!row || row[c.id] == null) pending.push(`final_room.iag_declaration.draft_rows[${r}].${c.id}`);
      });
    });
  }
  (gallery.meta && gallery.meta.team || []).forEach((name, i) => {
    if (typeof name === 'string' && name.startsWith('TODO')) pending.push(`meta.team[${i}]`);
  });
  pending.forEach((path) => console.error(`[publish] pendiente: ${path}`));
}

export function initFinal({ wall, gallery, rooms, roomData, openCard, playAudio }) {
  const fr = gallery.final_room;
  if (!fr) return;
  const draft = !gallery.meta || gallery.meta.mode !== 'publish';
  const placeholders = fr.placeholders || {};
  const tabs = tabList(fr);
  const standIns = standInList(fr, rooms, roomData, tabs);
  const specs = tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    render(container) { renderTab(tab.id, container); },
  }));
  const kicker = [gallery.meta && gallery.meta.title, gallery.meta && gallery.meta.course, gallery.meta && gallery.meta.activity]
    .filter(Boolean).join(' · ');

  const show = (tab, roomId) => openCard({
    specs,
    tab: tab || (specs[0] && specs[0].id),
    title: fr.title || '',
    kicker,
    scrollTo: roomId || null,
    footer: teamFooter(),
    extra: draft ? verifyBlock() : null,
  });

  const activate = (entry) => {
    if (!entry) return;
    if (entry.id === 'speaker' || entry.type === 'audio') { playAudio(); return; }
    show(entry.tab, entry.room);
  };

  if (wall.placeholder) {
    standIns.forEach(drawStandIn);
  } else if (Array.isArray(fr.hotspots)) {
    fr.hotspots.forEach((hs) => {
      if (!hs || !hs.id) return;
      const node = q(wall, '#' + hs.id);
      const speaker = hs.id === 'speaker' || hs.type === 'audio';
      if (!node) {
        if (speaker) return;
        console.warn(`[final] #${hs.id} not found in ${wall.id}; using stand-in`);
        const stand = standIns.find((s) => s.id === hs.id);
        if (stand) drawStandIn(stand);
        return;
      }
      hotspot(wall, node, {
        label: hs.label || hs.id,
        onActivate: () => activate(speaker ? { id: 'speaker' } : hs),
      });
    });
  } else if (!wall.placeholder) {
    console.warn(`[final] ${wall.id} loaded but final_room.hotspots is missing`);
  }

  function drawStandIn(entry) {
    if (entry.x == null || entry.y == null || entry.w == null || entry.h == null) {
      console.warn(`[final] stand-in ${entry.id || entry.label} has no box; skipping`);
      return;
    }
    const btn = make('button', 'stand-in', entry.label || '');
    btn.type = 'button';
    btn.tabIndex = 0;
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', entry.label || entry.id || '');
    if (entry.font_cqw) btn.style.fontSize = entry.font_cqw + 'cqw';
    placeBox(btn, {
      left: entry.x / VB.w * 100,
      top: entry.y / VB.h * 100,
      width: entry.w / VB.w * 100,
      height: entry.h / VB.h * 100,
    });
    const go = () => activate(entry);
    btn.addEventListener('click', go);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
    wall.overlay.append(btn);
  }

  return { open: show };

  function renderTab(id, container) {
    const key = tabKey(id);
    if (key === 'patrones') renderPatterns(container);
    else if (key === 'reflexion') renderReflection(container);
    else if (key === 'transferencia') renderTransfer(container);
    else if (key === 'ia') renderIa(container);
    else if (key === 'referencias') renderRefs(container);
    else {
      console.warn(`[final] no renderer for tab "${id}"`);
      container.append(el('p', { class: 'muted' }, 'No hay información para esta pestaña en el archivo de datos.'));
    }
  }

  function renderPatterns(container) {
    (fr.cross_gallery_patterns || []).forEach((item) => {
      if (!item) return;
      if (item.pattern) container.append(el('h3', {}, item.pattern));
      if (item.evidence) container.append(el('p', {}, item.evidence));
    });
    if (!isBlank(fr.pattern_note)) {
      const note = el('p', { class: 'pattern-note' });
      if (draft) note.append(el('span', { class: 'draft-badge' }, 'Borrador'));
      note.append(document.createTextNode(draft ? ' ' + fr.pattern_note : fr.pattern_note));
      container.append(note);
    }
  }

  function renderReflection(container) {
    const block = fr.metacognitive_reflection || {};
    if (!isBlank(block.prompt)) container.append(el('blockquote', { class: 'reflect-quote' }, block.prompt));
    container.append(isBlank(block.user_text) ? pendingBox(placeholders.pending) : el('p', {}, block.user_text));
  }

  function renderTransfer(container) {
    rooms.forEach((room, i) => {
      const d = roomData[i];
      const title = d && d.room && d.room.title;
      const transfer = d && d.transfer;
      if (!title && !transfer) return;
      const section = el('section', { class: 'transfer-block', 'data-room': room.id });
      if (title) section.append(el('h3', {}, title));
      if (transfer && !isBlank(transfer.prompt)) section.append(el('p', {}, transfer.prompt));
      section.append(transfer && !isBlank(transfer.user_text) ? el('p', {}, transfer.user_text) : pendingBox(placeholders.pending));
      container.append(section);
    });
  }

  function renderIa(container) {
    const decl = fr.iag_declaration || {};
    if (!isBlank(decl.template_prompt)) container.append(el('p', {}, decl.template_prompt));
    container.append(isBlank(decl.user_text) ? pendingBox(placeholders.pending) : el('p', {}, decl.user_text));
    const cols = columnList(decl);
    const rows = Array.isArray(decl.draft_rows) ? decl.draft_rows : null;
    if (!cols || !rows) {
      if (decl.columns || decl.draft_rows) console.warn('[final] iag_declaration.columns or draft_rows is missing; skipping the table');
      return;
    }
    if (!isBlank(placeholders.pending_ai_rows)) container.append(el('p', { class: 'muted' }, placeholders.pending_ai_rows));
    const anyNull = rows.some((row) => cols.some((c) => !row || row[c.id] == null));
    const hideBadges = !draft && !anyNull;
    const table = el('table', { class: 'ia-table' });
    table.append(el('thead', {}, el('tr', {}, cols.map((c) => el('th', { scope: 'col' }, c.label)))));
    const body = el('tbody');
    rows.forEach((row) => {
      const cells = cols.map((c) => el('td', {}, !row || row[c.id] == null ? pendingBox(placeholders.pending) : String(row[c.id])));
      const status = row && row.status;
      if (status && cells.length && !(hideBadges && String(status).toLowerCase() === 'borrador')) {
        cells[cells.length - 1].append(el('span', { class: 'draft-badge' }, String(status)));
      }
      body.append(el('tr', {}, cells));
    });
    table.append(body);
    container.append(table);
  }

  function renderRefs(container) {
    const wanted = Array.isArray(fr.references_apa7) ? new Set(fr.references_apa7) : null;
    const items = [];
    rooms.forEach((room, i) => {
      if (wanted && !wanted.has(room.id)) return;
      const d = roomData[i];
      const apa = d && d.source && d.source.apa;
      if (isBlank(apa)) return;
      items.push({ text: apa, note: d.source.doi_note });
    });
    (fr.data_credits || []).forEach((credit) => {
      if (!isBlank(credit)) items.push({ text: credit });
    });
    items.sort((a, b) => a.text.localeCompare(b.text, 'es', { sensitivity: 'base' }));
    const ul = el('ul', { class: 'ref-list' });
    items.forEach((item) => {
      const li = el('li', { class: 'apa' }, item.text);
      if (draft && !isBlank(item.note)) li.append(el('span', { class: 'doi-warn' }, item.note));
      ul.append(li);
    });
    container.append(ul);
    if (draft && !isBlank(fr.references_note)) container.append(el('p', { class: 'pattern-note' }, fr.references_note));
  }

  function teamFooter() {
    const names = gallery.meta && gallery.meta.team;
    if (!Array.isArray(names) || !names.length) return null;
    const shown = names.map((name) => (
      typeof name === 'string' && name.startsWith('TODO') && !isBlank(placeholders.team_pending)
        ? placeholders.team_pending
        : name
    ));
    return el('p', { class: 'team-line' }, shown.join(' · '));
  }

  function verifyBlock() {
    const groups = rooms.map((room, i) => {
      const d = roomData[i];
      const items = d && Array.isArray(d.verify) ? d.verify.filter((v) => !isBlank(v)) : [];
      if (!items.length) return null;
      const title = (d && d.room && d.room.title) || room.id;
      return el('section', {}, el('h3', {}, title), el('ul', {}, items.map((v) => el('li', {}, v))));
    }).filter(Boolean);
    if (!groups.length) return null;
    return el('details', { class: 'verify' }, el('summary', {}, 'Avisos de verificación'), groups);
  }
}

function tabList(fr) {
  if (Array.isArray(fr.tabs) && fr.tabs.length) {
    return fr.tabs.map((t, i) => (typeof t === 'string'
      ? { id: slug(t), label: t }
      : { id: t.id || slug(t.label) || String(i), label: t.label || t.id || '' })).filter((t) => t.label);
  }
  console.warn('[final] final_room.tabs is missing; using the five sections named for this room');
  return FALLBACK_TABS;
}

// Without placeholder_layout, the wall still needs a way to open the card.
// Labels are the tab names plus each room title already in the exp files. Boxes are layout, not copy.
function standInList(fr, rooms, roomData, tabs) {
  const given = fr.placeholder_layout && fr.placeholder_layout.stand_ins;
  if (Array.isArray(given) && given.length) {
    return given.map(normalizeBox);
  }
  console.warn('[final] final_room.placeholder_layout.stand_ins is missing; placing the section tabs and the four room titles');
  const transfer = tabs.find((t) => t.id === 'transferencia') || { id: 'transferencia', label: 'Transferencia a mi práctica' };
  const others = tabs.filter((t) => t.id !== 'transferencia');
  const backpacks = rooms.map((room, i) => {
    const d = roomData[i];
    return {
      id: `backpack-${i + 1}`,
      label: (d && d.room && d.room.title) || room.id,
      tab: transfer.id,
      room: room.id,
      font_cqw: 1.15,
    };
  });
  const entries = [
    ...others.map((t) => ({ id: t.id, label: t.label, tab: t.id, font_cqw: 1.7 })),
    ...backpacks,
  ];
  const colW = 560;
  const rowH = 72;
  const gap = 12;
  const origin = { x: 160, y: 200 };
  return entries.map((entry, i) => {
    const col = i < 4 ? 0 : 1;
    const row = i < 4 ? i : i - 4;
    return { ...entry, x: origin.x + col * (colW + 80), y: origin.y + row * (rowH + gap), w: colW, h: rowH };
  });
}

function normalizeBox(entry) {
  const x = num(entry.x, entry.left);
  const y = num(entry.y, entry.top);
  const w = num(entry.w, entry.width);
  const h = num(entry.h, entry.height);
  return { ...entry, x, y, w, h };
}

function num(...values) {
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function slug(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function tabKey(id) {
  const s = String(id || '');
  if (s === 'patrones' || s.includes('patron')) return 'patrones';
  if (s === 'reflexion' || s.includes('reflex') || s.includes('metacogn')) return 'reflexion';
  if (s === 'transferencia' || s.includes('transfer')) return 'transferencia';
  if (s === 'referencias' || s.includes('referenc')) return 'referencias';
  if (s === 'ia' || s === 'uso-de-ia' || s.includes('iag')) return 'ia';
  return s;
}
