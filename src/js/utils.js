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
