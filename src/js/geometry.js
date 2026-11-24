import { uid } from './utils.js';

// 桌型標準預設尺寸
export function dims(type) {
  if (type === 'round') return { w: 220, h: 220 };
  if (type === 'oval') return { w: 320, h: 200 };
  if (type === 'uShape') return { w: 380, h: 240 };
  if (type === 'hollowSquare') return { w: 360, h: 260 };
  if (type === 'classroom') return { w: 220, h: 60 };
  if (type === 'auditoriumRow') return { w: 420, h: 50 };
  return { w: 320, h: 160 }; // rect
}

export function uShapeSplit(n) {
  if (n <= 2) return { sideCnt: 0, bottomCnt: n };
  const sideCnt = Math.max(1, Math.floor(n / 3));
  const bottomCnt = Math.max(1, n - sideCnt * 2);
  return { sideCnt, bottomCnt };
}

export function hollowCounts(n) {
  const base = Math.floor(n / 4);
  const rem = n % 4;
  return [
    base + (rem >= 1 ? 1 : 0), // top
    base + (rem >= 3 ? 1 : 0), // right
    base + (rem >= 2 ? 1 : 0), // bottom
    base                       // left
  ];
}

// 統一防重疊尺寸計算 (所有建立/更新桌位路徑共用)
export function computeTableSize(type, normalCount, sideCount = 0, reqW = 0, reqH = 0) {
  const d = dims(type);
  const pitchX = 78;     // 依 (i+1)*w/(n+1) 均分規則，n>=2 時需 (n+1)*78 才能確保 >=8px 水平淨距
  const pitchSideY = 78; // 側邊席位旋轉90度，垂直佔高70px + 8px淨距
  let minW = d.w;
  let minH = d.h;
  const sideRows = Math.ceil(sideCount / 2);

  if (type === 'classroom') {
    minW = normalCount >= 2 ? Math.max(d.w, (normalCount + 1) * pitchX) : d.w;
    minH = Math.max(d.h, sideRows >= 1 ? (sideRows + 1) * pitchSideY : 0);
  } else if (type === 'rect') {
    const topCnt = Math.ceil(normalCount / 2);
    minW = topCnt >= 2 ? Math.max(d.w, (topCnt + 1) * pitchX) : d.w;
    minH = Math.max(d.h, sideRows >= 1 ? (sideRows + 1) * pitchSideY : 0);
  } else if (type === 'uShape') {
    const { sideCnt, bottomCnt } = uShapeSplit(normalCount);
    minW = bottomCnt >= 2 ? Math.max(d.w, (bottomCnt + 1) * pitchX) : d.w;
    const vCnt = Math.max(sideCnt, sideRows);
    minH = vCnt >= 2 ? Math.max(d.h, (vCnt + 1) * pitchSideY) : d.h;
  } else if (type === 'hollowSquare') {
    const [topC, rightC, bottomC, leftC] = hollowCounts(normalCount);
    const hCnt = Math.max(topC, bottomC);
    const vCnt = Math.max(leftC, rightC, sideRows);
    minW = hCnt >= 2 ? Math.max(d.w, (hCnt + 1) * pitchX) : d.w;
    minH = vCnt >= 2 ? Math.max(d.h, (vCnt + 1) * pitchSideY) : d.h;
  } else if (type === 'round' || type === 'oval') {
    const diameter = Math.ceil((normalCount * 82) / Math.PI);
    minW = Math.max(d.w, diameter);
    minH = Math.max(
      d.h,
      type === 'round'
        ? diameter
        : Math.max(Math.round(diameter * 0.65), Math.ceil((normalCount * 78) / Math.PI) - 56)
    );
    // 側面加位沿桌高均分，需足夠高度；圓桌同步加寬以維持正圓
    if (sideRows >= 1) minH = Math.max(minH, (sideRows + 1) * pitchSideY);
    if (type === 'round') minW = Math.max(minW, minH);
  }

  return {
    w: Math.max(minW, Number(reqW) || 0),
    h: Math.max(minH, Number(reqH) || 0)
  };
}

// 生成席位 (依桌型精準指定主席位索引)
export function makeSeats(n, side, chair, type = 'rect') {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({ id: uid(), no: String(i + 1), name: '', role: 'normal' });
  }
  for (let i = 0; i < side; i++) {
    arr.push({ id: uid(), no: '加' + (i + 1), name: '', role: 'side' });
  }
  if (chair !== 'none' && arr.length) {
    let idx = 0;
    if (type === 'rect') {
      const topCnt = Math.ceil(n / 2);
      const bottomCnt = n - topCnt;
      if (chair === 'top') idx = Math.floor(topCnt / 2);
      else if (chair === 'bottom') idx = bottomCnt > 0 ? topCnt + Math.floor(bottomCnt / 2) : 0;
      else if (chair === 'left') idx = side >= 1 ? n : 0;
      else if (chair === 'right') idx = side >= 2 ? n + 1 : Math.max(0, topCnt - 1);
    } else if (type === 'hollowSquare') {
      const [topC, rightC, bottomC, leftC] = hollowCounts(n);
      if (chair === 'top') idx = Math.floor(topC / 2);
      else if (chair === 'right') idx = rightC > 0 ? topC + Math.floor(rightC / 2) : 0;
      else if (chair === 'bottom') idx = bottomC > 0 ? topC + rightC + Math.floor(bottomC / 2) : 0;
      else if (chair === 'left') idx = leftC > 0 ? topC + rightC + bottomC + Math.floor(leftC / 2) : 0;
    } else if (type === 'uShape') {
      const { sideCnt, bottomCnt } = uShapeSplit(n);
      if (chair === 'left') idx = sideCnt > 0 ? Math.floor(sideCnt / 2) : 0;
      else if (chair === 'bottom') idx = sideCnt + Math.floor(bottomCnt / 2);
      else if (chair === 'right') idx = sideCnt > 0 ? sideCnt + bottomCnt + Math.floor(sideCnt / 2) : Math.max(0, n - 1);
      else if (chair === 'top') idx = side >= 1 ? n : 0;
    } else if (type === 'round' || type === 'oval') {
      if (chair === 'top') idx = 0;
      else if (chair === 'right') idx = Math.round(n * 0.25) % n;
      else if (chair === 'bottom') idx = Math.round(n * 0.5) % n;
      else if (chair === 'left') idx = Math.round(n * 0.75) % n;
    } else {
      if (chair === 'left') idx = 0;
      else if (chair === 'right') idx = Math.max(0, n - 1);
      else idx = Math.floor(n / 2);
    }
    arr[Math.min(idx, arr.length - 1)].role = 'chairman';
  }
  return arr;
}

// 幾何位置與旋轉角度計算 (含圓桌/橢圓/講堂扇形旋轉)
export function positions(t) {
  const normal = t.seats.filter(s => s.role !== 'side');
  const side = t.seats.filter(s => s.role === 'side');
  const pos = {};

  if (t.type === 'round' || t.type === 'oval') {
    const rx = t.w / 2 + 36;
    const ry = t.h / 2 + 28;
    normal.forEach((s, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, normal.length);
      pos[s.id] = {
        x: t.w / 2 + rx * Math.cos(a) - 35,
        y: t.h / 2 + ry * Math.sin(a) - 18,
        rotation: (a * 180 / Math.PI) + 90
      };
    });
  } else if (t.type === 'classroom') {
    normal.forEach((s, i) => {
      pos[s.id] = {
        x: (i + 1) * t.w / (normal.length + 1) - 35,
        y: t.h + 8,
        rotation: 0
      };
    });
  } else if (t.type === 'uShape') {
    const { sideCnt, bottomCnt } = uShapeSplit(normal.length);
    normal.forEach((s, i) => {
      if (i < sideCnt) {
        pos[s.id] = { x: -75, y: (i + 1) * t.h / (sideCnt + 1) - 18, rotation: 90 };
      } else if (i < sideCnt + bottomCnt) {
        const k = i - sideCnt;
        pos[s.id] = { x: (k + 1) * t.w / (bottomCnt + 1) - 35, y: t.h + 8, rotation: 0 };
      } else {
        const k = i - sideCnt - bottomCnt;
        pos[s.id] = { x: t.w + 5, y: (k + 1) * t.h / (sideCnt + 1) - 18, rotation: -90 };
      }
    });
  } else if (t.type === 'hollowSquare') {
    const counts = hollowCounts(normal.length);
    let cursor = 0;
    counts.forEach((cnt, sideIdx) => {
      for (let k = 0; k < cnt; k++) {
        const s = normal[cursor++];
        if (!s) break;
        if (sideIdx === 0) pos[s.id] = { x: (k + 1) * t.w / (cnt + 1) - 35, y: -45, rotation: 180 };
        else if (sideIdx === 1) pos[s.id] = { x: t.w + 5, y: (k + 1) * t.h / (cnt + 1) - 18, rotation: -90 };
        else if (sideIdx === 2) pos[s.id] = { x: (k + 1) * t.w / (cnt + 1) - 35, y: t.h + 8, rotation: 0 };
        else pos[s.id] = { x: -75, y: (k + 1) * t.h / (cnt + 1) - 18, rotation: 90 };
      }
    });
  } else if (t.type === 'auditoriumRow') {
    const count = normal.length;
    const angleSpan = (t.angleSpan || 80) * (Math.PI / 180);
    const startAngle = (Math.PI / 2) - (angleSpan / 2);
    const r = t.radius || 250;
    normal.forEach((s, i) => {
      const theta = count <= 1 ? Math.PI / 2 : startAngle + (angleSpan * i / (count - 1));
      pos[s.id] = {
        x: t.w / 2 + r * Math.cos(theta) - 35,
        y: r * Math.sin(theta) - 18,
        rotation: (theta * 180 / Math.PI) - 90
      };
    });
  } else {
    const top = Math.ceil(normal.length / 2);
    const bottom = normal.length - top;
    normal.forEach((s, i) => {
      if (i < top) {
        pos[s.id] = { x: (i + 1) * t.w / (top + 1) - 35, y: -45, rotation: 180 };
      } else {
        const k = i - top;
        pos[s.id] = { x: (k + 1) * t.w / (bottom + 1) - 35, y: t.h + 8, rotation: 0 };
      }
    });
  }

  // 側面加位：若為 U 型、口字型或圓桌/橢圓桌，外側已有一般席位，則排於外二排避免重疊
  const hasSideNormal = ['uShape', 'hollowSquare', 'round', 'oval'].includes(t.type);
  const leftX = hasSideNormal ? -122 : -76;
  const rightX = hasSideNormal ? t.w + 52 : t.w + 6;
  const leftSide = [];
  const rightSide = [];
  side.forEach((s, i) => (i % 2 === 0 ? leftSide : rightSide).push(s));
  leftSide.forEach((s, k) => {
    pos[s.id] = { x: leftX, y: (k + 1) * t.h / (leftSide.length + 1) - 18, rotation: 90 };
  });
  rightSide.forEach((s, k) => {
    pos[s.id] = { x: rightX, y: (k + 1) * t.h / (rightSide.length + 1) - 18, rotation: -90 };
  });

  return pos;
}

// SAT 分離軸定理檢查旋轉席位是否重疊
export function seatAxesCorners(cx, cy, hw, hh, deg) {
  const rad = (deg || 0) * Math.PI / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const ux = c, uy = s;
  const vx = -s, vy = c;
  return {
    cx, cy, ux, uy, vx, vy,
    corners: [
      [cx + ux * hw + vx * hh, cy + uy * hw + vy * hh],
      [cx - ux * hw + vx * hh, cy - uy * hw + vy * hh],
      [cx - ux * hw - vx * hh, cy - uy * hw - vy * hh],
      [cx + ux * hw - vx * hh, cy + uy * hw - vy * hh]
    ]
  };
}

export function boxesOverlapSAT(a, b) {
  const axes = [
    [a.ux, a.uy], [a.vx, a.vy],
    [b.ux, b.uy], [b.vx, b.vy]
  ];
  for (const [ax, ay] of axes) {
    let minA = Infinity, maxA = -Infinity;
    for (const [px, py] of a.corners) {
      const p = px * ax + py * ay;
      if (p < minA) minA = p;
      if (p > maxA) maxA = p;
    }
    let minB = Infinity, maxB = -Infinity;
    for (const [px, py] of b.corners) {
      const p = px * ax + py * ay;
      if (p < minB) minB = p;
      if (p > maxB) maxB = p;
    }
    if (maxA <= minB || maxB <= minA) return false;
  }
  return true;
}

export function detectSeatOverlaps(tableList) {
  const boxes = [];
  (tableList || []).forEach(t => {
    const p = positions(t);
    t.seats.forEach(s => {
      const q = p[s.id];
      if (!q) return;
      boxes.push({
        id: s.id,
        box: seatAxesCorners(t.x + q.x + 35, t.y + q.y + 18, 33.5, 16.5, q.rotation || 0)
      });
    });
  });

  const overlapping = new Set();
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const dx = boxes[i].box.cx - boxes[j].box.cx;
      const dy = boxes[i].box.cy - boxes[j].box.cy;
      if (dx * dx + dy * dy > 6400) continue; // > 80px 快速略過
      if (boxesOverlapSAT(boxes[i].box, boxes[j].box)) {
        overlapping.add(boxes[i].id);
        overlapping.add(boxes[j].id);
      }
    }
  }
  return overlapping;
}

// 計算桌位含四周席位的外接邊界
export function tableFootprint(t) {
  const p = positions(t);
  let minX = 0, minY = 0, maxX = t.w, maxY = t.h;
  t.seats.forEach(s => {
    const q = p[s.id];
    if (!q) return;
    const cx = q.x + 35;
    const cy = q.y + 18;
    const rad = (q.rotation || 0) * Math.PI / 180;
    const hw = 35 * Math.abs(Math.cos(rad)) + 18 * Math.abs(Math.sin(rad));
    const hh = 35 * Math.abs(Math.sin(rad)) + 18 * Math.abs(Math.cos(rad));
    minX = Math.min(minX, cx - hw);
    maxX = Math.max(maxX, cx + hw);
    minY = Math.min(minY, cy - hh);
    maxY = Math.max(maxY, cy + hh);
  });
  return {
    padL: Math.max(0, -minX),
    padT: Math.max(0, -minY),
    totalW: Math.ceil(maxX - minX),
    totalH: Math.ceil(maxY - minY)
  };
}
