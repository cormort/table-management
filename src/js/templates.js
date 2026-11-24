import { uid } from './utils.js';
import { computeTableSize, makeSeats } from './geometry.js';

export function seatTable(name, type, x, y, count, side = 0, chair = 'none', extra = {}) {
  const size = computeTableSize(type, count, side, extra.w, extra.h);
  return {
    id: uid(),
    name,
    type,
    x,
    y,
    ...extra,
    w: size.w,
    h: size.h,
    chair,
    seats: makeSeats(count, side, chair, type)
  };
}

export function buildTemplateData(key) {
  const roomCfg = (name, w, h, stageText = '講台區 / 主席台') => ({
    meetingName: name,
    roomW: w,
    roomH: h,
    stage: { x: Math.round((w - 360) / 2), y: 18, w: 360, h: 52, text: stageText },
    structures: [
      { id: uid(), type: 'door-single', label: '入口', x: 12, y: 110, w: 85, h: 85 },
      { id: uid(), type: 'door-double', label: '出口', x: w - 112, y: 110, w: 100, h: 80 }
    ],
    tables: []
  });

  let d;
  if (key === 'executive') {
    d = roomCfg('首長會議座位配置表', 1200, 800);
    const t = seatTable('首長會議桌', 'uShape', 0, 145, 20, 4, 'bottom');
    t.x = Math.round((d.roomW - t.w) / 2);
    d.tables.push(t);
  } else if (key === 'committee') {
    d = roomCfg('委員會議座位配置表', 1200, 800);
    const t = seatTable('委員會議桌', 'hollowSquare', 0, 180, 20, 0, 'top');
    t.x = Math.round((d.roomW - t.w) / 2);
    d.tables.push(t);
  } else if (key === 'boardroom') {
    d = roomCfg('董事會／主管會報座位配置表', 1100, 700);
    const t = seatTable('主管會議桌', 'rect', 0, 225, 13, 1, 'left', { w: 360, h: 170 });
    t.x = Math.round((d.roomW - t.w) / 2);
    d.tables.push(t);
  } else if (key === 'negotiation') {
    d = roomCfg('雙邊談判座位配置表', 1200, 760);
    const t1 = seatTable('甲方代表席', 'classroom', 0, 230, 8, 0, 'none', { w: 540, h: 55 });
    const t2 = seatTable('乙方代表席', 'classroom', 0, 405, 8, 0, 'none', { w: 540, h: 55 });
    t1.x = t2.x = Math.round((d.roomW - t1.w) / 2);
    d.tables.push(t1, t2);
  } else if (key === 'video') {
    d = roomCfg('視訊會議座位配置表', 1100, 720, '視訊螢幕 / Camera');
    const t = seatTable('視訊會議桌', 'rect', 0, 235, 11, 1, 'left', { w: 340, h: 160 });
    t.x = Math.round((d.roomW - t.w) / 2);
    d.tables.push(t);
  } else if (key === 'classroom') {
    d = roomCfg('教育訓練座位配置表', 1300, 950);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        d.tables.push(seatTable(`${r + 1}排-${c + 1}組`, 'classroom', 150 + c * 350 + (c > 1 ? 80 : 0), 170 + r * 145, 2));
      }
    }
  } else if (key === 'exam') {
    d = roomCfg('考試／甄試座位配置表', 1400, 1000);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 6; c++) {
        d.tables.push(seatTable(`${r + 1}排-${c + 1}號`, 'classroom', 95 + c * 205, 175 + r * 190, 1, 0, 'none', { w: 90, h: 50 }));
      }
    }
  } else if (key === 'workshop') {
    d = roomCfg('工作坊分組座位配置表', 1500, 1000);
    [[260, 230], [650, 230], [1040, 230], [260, 610], [650, 610], [1040, 610]].forEach((q, i) => {
      d.tables.push(seatTable(`第${i + 1}組`, 'round', q[0], q[1], 6));
    });
  } else if (key === 'briefing') {
    d = roomCfg('簡報／記者會座位配置表', 1300, 900);
    const vip = seatTable('貴賓席', 'classroom', 430, 130, 4, 0, 'none', { w: 440, h: 60 });
    vip.seats.forEach(x => { x.role = 'vip'; });
    d.tables.push(vip);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        d.tables.push(seatTable(`${r + 1}排-${c + 1}組`, 'classroom', 100 + c * 365 + (c > 1 ? 60 : 0), 300 + r * 135, r === 0 ? 2 : 3));
      }
    }
  } else if (key === 'panel') {
    d = roomCfg('論壇／座談會座位配置表', 1420, 950);
    const panel = seatTable('與談人席', 'classroom', 450, 120, 5, 0, 'none', { w: 520, h: 60 });
    panel.seats.forEach(x => { x.role = 'vip'; });
    d.tables.push(panel);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        d.tables.push(seatTable(`${r + 1}排-${c + 1}區`, 'classroom', 85 + c * 420 + (c > 1 ? 65 : 0), 305 + r * 145, r < 2 ? 3 : 4));
      }
    }
  } else if (key === 'banquet') {
    d = roomCfg('圓桌會議／餐敘座位配置表', 1500, 1000);
    [[250, 220], [640, 220], [1030, 220], [250, 590], [640, 590], [1030, 590]].forEach((q, i) => {
      d.tables.push(seatTable(`第${i + 1}桌`, 'round', q[0], q[1], 8, 0, i === 0 ? 'top' : 'none'));
    });
  } else if (key === 'auditorium') {
    d = roomCfg('大型講堂座位配置表', 1500, 1100);
    const cx = 750;
    for (let r = 0; r < 5; r++) {
      const radius = 285 + r * 95;
      const count = 8 + r * 2;
      const span = 110;
      const arc = Math.round(2 * radius * Math.sin(span * Math.PI / 360)) + 60;
      d.tables.push(seatTable(`第 ${r + 1} 排`, 'auditoriumRow', Math.round(cx - arc / 2), 105, count, 0, 'none', { w: arc, h: 24, radius, angleSpan: span }));
    }
  }
  return d;
}

export const templateMeta = [
  { key: 'executive', name: '首長會議', icon: '🏛️', category: 'meeting', desc: 'U 型主桌，主席置中，兩側可安排列席人員。', tags: '首長 U型 主席 決策' },
  { key: 'committee', name: '委員會議', icon: '🗳️', category: 'meeting', desc: '口字型會議桌，中央留白，適合逐案審議。', tags: '委員 審查 口字型' },
  { key: 'boardroom', name: '董事會／主管會報', icon: '📊', category: 'meeting', desc: '單一長桌雙側對坐，主席位於短邊前端。', tags: '董事會 主管 長桌' },
  { key: 'negotiation', name: '雙邊談判／協商', icon: '🤝', category: 'meeting', desc: '雙方代表平行對坐，結構清晰對稱。', tags: '談判 協商 雙邊 對坐' },
  { key: 'video', name: '視訊會議室', icon: '🖥️', category: 'meeting', desc: '長桌面向前方視訊螢幕，保留攝影機視角。', tags: '視訊 混合 線上' },
  { key: 'classroom', name: '教育訓練', icon: '🏫', category: 'training', desc: '5 排 × 3 欄雙人桌，配置中央走道。', tags: '教室 訓練 課程' },
  { key: 'exam', name: '考試／甄試', icon: '📝', category: 'training', desc: '單人單桌、加大間距，保留前後監考動線。', tags: '考試 甄試 單人桌' },
  { key: 'workshop', name: '工作坊分組', icon: '🧠', category: 'training', desc: '6 個島型小組，每組 6 人，適合共同創作。', tags: '工作坊 分組 島型' },
  { key: 'briefing', name: '簡報／記者會', icon: '🎤', category: 'event', desc: '前排貴賓席搭配課堂座位及中央走道。', tags: '簡報 記者會 貴賓' },
  { key: 'panel', name: '論壇／座談會', icon: '💬', category: 'event', desc: '舞台上 5 位與談人，台下 4 排觀眾席。', tags: '論壇 座談 與談人' },
  { key: 'auditorium', name: '大型講堂', icon: '🏟️', category: 'event', desc: '5 排扇形座位，逐排增加席次並朝向舞台。', tags: '講堂 弧形 大型' },
  { key: 'banquet', name: '圓桌會議／餐敘', icon: '🍽️', category: 'special', desc: '6 張圓桌，每桌 8 人，適合交流或餐敘。', tags: '圓桌 餐敘 宴會' }
];

const templateCache = new Map();

export function getTemplateSnapshot(key) {
  if (!templateCache.has(key)) {
    const data = buildTemplateData(key);
    const seats = data.tables.reduce((sum, t) => sum + t.seats.length, 0);
    templateCache.set(key, {
      data,
      seats,
      tables: data.tables.length,
      size: `${data.roomW}×${data.roomH}`
    });
  }
  return templateCache.get(key);
}

export const templateCatalog = templateMeta.map(m => {
  const snap = getTemplateSnapshot(m.key);
  return { ...m, seats: snap.seats, tables: snap.tables, size: snap.size };
});
