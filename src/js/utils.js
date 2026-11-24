export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

export function uid() {
  return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function parseNames(raw) {
  return String(raw ?? '').split(/[\n,、\t ;]+/).map(s => s.trim()).filter(Boolean);
}

export function safeFileName(meetingName) {
  return (String(meetingName || '').trim() || '會議座位表').replace(/[\/:*?"<>|]/g, '_');
}

export function findDuplicateNames(tableList) {
  const nameToIds = new Map();
  (tableList || []).forEach(t => {
    (t.seats || []).forEach(s => {
      const n = String(s.name || '').trim();
      if (!n) return;
      if (!nameToIds.has(n)) nameToIds.set(n, []);
      nameToIds.get(n).push(s.id);
    });
  });
  const seatIds = new Set();
  const names = [];
  for (const [name, ids] of nameToIds.entries()) {
    if (ids.length > 1) {
      names.push(name);
      ids.forEach(id => seatIds.add(id));
    }
  }
  return { seatIds, names };
}
