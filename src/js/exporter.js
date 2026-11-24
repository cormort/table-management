import { esc, uid, clamp } from './utils.js';
import { dims, positions } from './geometry.js';

export function sanitizeProjectData(d) {
  if (!d || typeof d !== 'object') throw new Error('Invalid project data');
  const validTypes = new Set(['rect', 'classroom', 'round', 'oval', 'uShape', 'hollowSquare', 'auditoriumRow']);
  const validRoles = new Set(['normal', 'chairman', 'vip', 'side']);
  const rw = clamp(Number(d.roomW) || 1200, 600, 3600);
  const rh = clamp(Number(d.roomH) || 800, 500, 3000);
  const stg = d.stage && typeof d.stage === 'object' ? d.stage : {};
  const safeStage = {
    x: Number.isFinite(Number(stg.x)) ? Number(stg.x) : Math.round((rw - 360) / 2),
    y: Number.isFinite(Number(stg.y)) ? Number(stg.y) : 16,
    w: Math.max(80, Number(stg.w) || 360),
    h: Math.max(30, Number(stg.h) || 52),
    text: String(stg.text || '講台區 / 主席台 (Stage)')
  };

  const safeStructs = Array.isArray(d.structures)
    ? d.structures.filter(s => s && typeof s === 'object').map(s => ({
        id: String(s.id || uid()),
        type: String(s.type || 'wall-h'),
        label: String(s.label ?? ''),
        x: Number(s.x) || 0,
        y: Number(s.y) || 0,
        w: Math.max(8, Number(s.w) || 80),
        h: Math.max(8, Number(s.h) || 14)
      }))
    : [];

  const safeTables = Array.isArray(d.tables)
    ? d.tables.filter(t => t && typeof t === 'object').map((t, idx) => {
        const type = validTypes.has(t.type) ? t.type : 'rect';
        const def = dims(type);
        const seats = Array.isArray(t.seats)
          ? t.seats.filter(s => s && typeof s === 'object').map((s, si) => ({
              id: String(s.id || uid()),
              no: String(s.no ?? (si + 1)),
              name: String(s.name ?? ''),
              role: validRoles.has(s.role) ? s.role : 'normal'
            }))
          : [];
        return {
          id: String(t.id || uid()),
          name: String(t.name || `第${idx + 1}桌`),
          type,
          x: Number(t.x) || 0,
          y: Number(t.y) || 0,
          w: Math.max(40, Number(t.w) || def.w),
          h: Math.max(20, Number(t.h) || def.h),
          chair: String(t.chair || 'none'),
          radius: Number.isFinite(Number(t.radius)) ? Number(t.radius) : undefined,
          angleSpan: Number.isFinite(Number(t.angleSpan)) ? Number(t.angleSpan) : undefined,
          seats
        };
      })
    : [];

  return {
    meetingName: String(d.meetingName || '會議座位配置表'),
    roomW: rw,
    roomH: rh,
    stage: safeStage,
    structures: safeStructs,
    tables: safeTables
  };
}

export function buildCsvContent(projectData) {
  const rows = [['場次主題', '桌號/區域名稱', '桌型', '席次編號', '姓名/單位', '席位身分', 'X座標', 'Y座標']];
  const meeting = projectData.meetingName || '';
  const typeMap = {
    rect: '長方桌', classroom: '課堂桌', round: '圓桌', oval: '橢圓桌',
    uShape: 'U型桌', hollowSquare: '口字型', auditoriumRow: '大講堂弧形排'
  };
  const roleMap = { normal: '一般席', chairman: '主席席', vip: '貴賓席', side: '側面加位' };

  (projectData.tables || []).forEach(t => {
    (t.seats || []).forEach(s => {
      rows.push([
        meeting,
        t.name,
        typeMap[t.type] || t.type,
        s.no,
        s.name,
        roleMap[s.role] || s.role,
        t.x,
        t.y
      ]);
    });
  });

  return '\uFEFF' + rows
    .map(r => r.map(v => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}

export function renderTableSvgShape(t) {
  if (t.type === 'round') {
    return `<circle cx="${t.x + t.w / 2}" cy="${t.y + t.h / 2}" r="${t.w / 2}" fill="#fbf3d5" stroke="#8b5e34" stroke-width="3"/>`;
  }
  if (t.type === 'oval') {
    return `<ellipse cx="${t.x + t.w / 2}" cy="${t.y + t.h / 2}" rx="${t.w / 2}" ry="${t.h / 2}" fill="#fbf3d5" stroke="#8b5e34" stroke-width="3"/>`;
  }
  if (t.type === 'uShape') {
    const bw = 22;
    return `<path d="M ${t.x + bw / 2},${t.y} V ${t.y + t.h - bw / 2} H ${t.x + t.w - bw / 2} V ${t.y}" fill="none" stroke="#8b5e34" stroke-width="${bw}" stroke-linejoin="round"/>
            <path d="M ${t.x + bw / 2},${t.y} V ${t.y + t.h - bw / 2} H ${t.x + t.w - bw / 2} V ${t.y}" fill="none" stroke="#fbf3d5" stroke-width="${bw - 5}" stroke-linejoin="round"/>`;
  }
  if (t.type === 'hollowSquare') {
    const bw = 22;
    return `<rect x="${t.x + bw / 2}" y="${t.y + bw / 2}" width="${t.w - bw}" height="${t.h - bw}" rx="6" fill="none" stroke="#8b5e34" stroke-width="${bw}"/>
            <rect x="${t.x + bw / 2}" y="${t.y + bw / 2}" width="${t.w - bw}" height="${t.h - bw}" rx="6" fill="none" stroke="#fbf3d5" stroke-width="${bw - 5}"/>`;
  }
  if (t.type === 'classroom') {
    return `<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="4" fill="#e2e8f0" stroke="#475569" stroke-width="2"/>`;
  }
  if (t.type === 'auditoriumRow') {
    const r = t.radius || 250;
    const span = (t.angleSpan || 80) * Math.PI / 180;
    const a1 = Math.PI / 2 - span / 2;
    const a2 = Math.PI / 2 + span / 2;
    const cx = t.x + t.w / 2;
    const cy = t.y;
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    return `<path d="M ${x1.toFixed(1)},${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="#cbd5e1" stroke-width="10" stroke-linecap="round"/>`;
  }
  return `<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="6" fill="#fbf3d5" stroke="#8b5e34" stroke-width="2.5"/>`;
}

export function buildPreviewSvg(d) {
  const parts = [
    `<svg viewBox="0 0 ${d.roomW} ${d.roomH}" aria-label="座位配置預覽">`,
    `<rect width="${d.roomW}" height="${d.roomH}" fill="#ffffff"/>`,
    `<rect x="${d.stage.x}" y="${d.stage.y}" width="${d.stage.w}" height="${d.stage.h}" rx="8" fill="#334155"/>`,
    `<text x="${d.stage.x + d.stage.w / 2}" y="${d.stage.y + d.stage.h / 2 + 8}" text-anchor="middle" font-size="22" font-weight="bold" fill="#ffffff">${esc(d.stage.text)}</text>`
  ];
  d.tables.forEach(t => {
    parts.push(renderTableSvgShape(t));
    const p = positions(t);
    t.seats.forEach(s => {
      const q = p[s.id];
      if (!q) return;
      const fill = s.role === 'chairman' ? '#fca5a5' : s.role === 'vip' ? '#d8b4fe' : s.role === 'side' ? '#fde68a' : '#93c5fd';
      const stroke = s.role === 'chairman' ? '#dc2626' : s.role === 'vip' ? '#7e22ce' : s.role === 'side' ? '#d97706' : '#2563a6';
      parts.push(`<g transform="translate(${t.x + q.x + 35}, ${t.y + q.y + 18}) rotate(${q.rotation || 0})"><rect x="-35" y="-18" width="70" height="36" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="3"/></g>`);
    });
  });
  parts.push('</svg>');
  return parts.join('');
}

export function buildProjectSvg(d) {
  const headerH = 48;
  const totalH = d.roomH + headerH;
  const stg = d.stage;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${d.roomW}" height="${totalH}" viewBox="0 0 ${d.roomW} ${totalH}">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="${d.roomW / 2}" y="31" text-anchor="middle" font-family="Microsoft JhengHei, sans-serif" font-size="20" font-weight="bold" fill="#0f172a">${esc(d.meetingName)}</text>`,
    `<g transform="translate(0, ${headerH})">`,
    `<rect width="${d.roomW}" height="${d.roomH}" fill="#ffffff" stroke="#334155" stroke-width="4"/>`,
    `<rect x="${stg.x}" y="${stg.y}" width="${stg.w}" height="${stg.h}" rx="6" fill="#334155"/>`,
    `<text x="${stg.x + stg.w / 2}" y="${stg.y + stg.h / 2 + 5}" text-anchor="middle" fill="#ffffff" font-family="Microsoft JhengHei, sans-serif" font-size="15" font-weight="bold">${esc(stg.text)}</text>`
  ];

  (d.structures || []).forEach(st => {
    if (st.type.startsWith('wall')) {
      parts.push(`<rect x="${st.x}" y="${st.y}" width="${st.w}" height="${st.h}" fill="#334155" rx="2"/>`);
    } else if (st.type === 'door-single') {
      parts.push(`<g transform="translate(${st.x}, ${st.y})"><path d="M 0,${st.h} A ${st.w} ${st.h} 0 0 1 ${st.w},0" fill="none" stroke="#2563a6" stroke-width="2" stroke-dasharray="4,3"/><line x1="0" y1="0" x2="0" y2="${st.h}" stroke="#334155" stroke-width="4"/><line x1="0" y1="${st.h}" x2="${st.w}" y2="${st.h}" stroke="#94a3b8" stroke-width="1"/><text x="${st.w / 2}" y="${st.h - 6}" font-size="10" fill="#475569" text-anchor="middle" font-family="sans-serif">${esc(st.label || '門')}</text></g>`);
    } else if (st.type === 'door-double') {
      const hw = st.w / 2;
      parts.push(`<g transform="translate(${st.x}, ${st.y})"><path d="M 0,${st.h} A ${hw} ${st.h} 0 0 1 ${hw},0" fill="none" stroke="#2563a6" stroke-width="1.5" stroke-dasharray="3,3"/><path d="M ${st.w},${st.h} A ${hw} ${st.h} 0 0 0 ${hw},0" fill="none" stroke="#2563a6" stroke-width="1.5" stroke-dasharray="3,3"/><line x1="0" y1="0" x2="0" y2="${st.h}" stroke="#334155" stroke-width="3"/><line x1="${st.w}" y1="0" x2="${st.w}" y2="${st.h}" stroke="#334155" stroke-width="3"/><line x1="0" y1="${st.h}" x2="${st.w}" y2="${st.h}" stroke="#94a3b8" stroke-width="1"/><text x="${hw}" y="${st.h - 6}" font-size="10" fill="#475569" text-anchor="middle" font-family="sans-serif">${esc(st.label || '雙開門')}</text></g>`);
    } else if (st.type === 'pillar-round') {
      parts.push(`<circle cx="${st.x + st.w / 2}" cy="${st.y + st.h / 2}" r="${st.w / 2}" fill="#cbd5e1" stroke="#475569" stroke-width="2"/>`);
    } else {
      parts.push(`<rect x="${st.x}" y="${st.y}" width="${st.w}" height="${st.h}" fill="#cbd5e1" stroke="#475569" stroke-width="2"/>`);
    }
  });

  (d.tables || []).forEach(t => {
    parts.push(renderTableSvgShape(t));
    if (t.type === 'auditoriumRow') {
      const ly = t.y + (t.radius || 250) - 36;
      parts.push(`<text x="${t.x + t.w / 2}" y="${ly}" text-anchor="middle" font-family="Microsoft JhengHei, sans-serif" font-size="12" font-weight="bold" fill="#475569">${esc(t.name)}</text>`);
    } else {
      parts.push(`<text x="${t.x + t.w / 2}" y="${t.y + t.h / 2 + 5}" text-anchor="middle" font-family="Microsoft JhengHei, sans-serif" font-size="14" font-weight="bold" fill="${t.type === 'classroom' ? '#1e293b' : '#6b4423'}">${esc(t.name)}</text>`);
    }

    const p = positions(t);
    (t.seats || []).forEach(s => {
      const q = p[s.id];
      if (!q) return;
      const fill = s.role === 'chairman' ? '#fee2e2' : s.role === 'vip' ? '#f3e8ff' : s.role === 'side' ? '#fef3c7' : '#dbeafe';
      const stroke = s.role === 'chairman' ? '#dc2626' : s.role === 'vip' ? '#7e22ce' : s.role === 'side' ? '#d97706' : '#2563a6';
      parts.push(`<g transform="translate(${t.x + q.x + 35}, ${t.y + q.y + 18}) rotate(${q.rotation || 0})"><rect x="-35" y="-18" width="70" height="36" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/><text x="0" y="-3" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#475569">${esc(s.no)}</text><text x="0" y="11" text-anchor="middle" font-family="Microsoft JhengHei, sans-serif" font-size="11" font-weight="bold" fill="#0f172a">${esc(s.name || '空席')}</text></g>`);
    });
  });

  parts.push('</g></svg>');
  return parts.join('');
}
