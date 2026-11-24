import { esc, uid, clamp, parseNames, safeFileName, findDuplicateNames } from './utils.js';
import {
  computeTableSize,
  makeSeats,
  positions,
  detectSeatOverlaps,
  tableFootprint
} from './geometry.js';
import {
  seatTable,
  buildTemplateData,
  templateMeta,
  getTemplateSnapshot,
  templateCatalog
} from './templates.js';
import {
  sanitizeProjectData,
  buildCsvContent,
  buildPreviewSvg,
  buildProjectSvg,
  svgToPngBlob
} from './exporter.js';

const $ = id => document.getElementById(id);
const room = $('room');
const roomWrap = $('roomWrap');
const stageEl = $('stage');

// 資料核心狀態
let tables = [];
let structures = [];
let stageConfig = { x: 420, y: 16, w: 360, h: 52, text: '講台區 / 主席台 (Stage)' };

let selectedTable = null;
const selectedTables = new Set();
let selectedSeat = null;
let selectedStruct = null;
let zoom = 1;
let snapToGrid = false;
let layoutLocked = false;
let drag = null;
let marquee = null;
let dragSeatInfo = null;
let toastTimer = null;
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 30;

function updateHistoryButtons() {
  const undoBtn = $('undoBtn');
  const redoBtn = $('redoBtn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function pushHistory() {
  undoStack.push(JSON.stringify(getProjectData()));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(getProjectData()));
  if (redoStack.length > MAX_HISTORY) redoStack.shift();
  const raw = undoStack.pop();
  updateHistoryButtons();
  try {
    loadProjectData(JSON.parse(raw));
    showToast('已復原上一步操作。');
  } catch (e) {}
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(getProjectData()));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  const raw = redoStack.pop();
  updateHistoryButtons();
  try {
    loadProjectData(JSON.parse(raw));
    showToast('已重做操作。');
  } catch (e) {}
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === tabId);
  });
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});

function refreshOverlapMarkers() {
  const overlaps = detectSeatOverlaps(tables);
  const dup = findDuplicateNames(tables);
  room.querySelectorAll('.seat').forEach(se => {
    se.classList.toggle('overlap', overlaps.has(se.dataset.seat));
    se.classList.toggle('duplicate', dup.seatIds.has(se.dataset.seat));
  });
  updateStatus(overlaps.size, dup.names.length);
}

// 僅更新選取樣式，不重建 DOM (確保拖曳穩定)
function syncSelectionUI() {
  stageEl.classList.toggle('selected', selectedStruct === 'stage');
  room.querySelectorAll('.structObj').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === selectedStruct);
  });
  room.querySelectorAll('.tableObj').forEach(el => {
    const id = el.dataset.id;
    el.classList.toggle('selected', id === selectedTable || selectedTables.has(id));
  });
  room.querySelectorAll('.seat').forEach(el => {
    el.classList.toggle('selected', el.dataset.seat === selectedSeat);
  });
}

function applySearchHighlight(scrollFirst = false) {
  const q = ($('seatSearch')?.value || '').trim().toLowerCase();
  let firstMatch = null;
  room.querySelectorAll('.seat').forEach(se => {
    const nameEl = se.querySelector('.name');
    const txt = (nameEl?.textContent || '').trim();
    const isMatch = Boolean(q && txt && txt !== '空席' && txt.toLowerCase().includes(q));
    se.classList.toggle('match', isMatch);
    if (isMatch && !firstMatch) firstMatch = se;
  });
  if (scrollFirst && firstMatch) {
    firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
}

function structSvgMarkup(st) {
  if (st.type.startsWith('wall')) {
    return `<div class="structWall" style="width:100%;height:100%;"></div>`;
  }
  if (st.type === 'door-single') {
    return `
      <svg width="${st.w}" height="${st.h}" viewBox="0 0 ${st.w} ${st.h}">
        <path d="M 0,${st.h} A ${st.w} ${st.h} 0 0 1 ${st.w},0" fill="none" stroke="#2563a6" stroke-width="2" stroke-dasharray="4,3"/>
        <line x1="0" y1="0" x2="0" y2="${st.h}" stroke="#334155" stroke-width="4"/>
        <line x1="0" y1="${st.h}" x2="${st.w}" y2="${st.h}" stroke="#94a3b8" stroke-width="1"/>
        <text x="${st.w / 2}" y="${st.h - 6}" font-size="10" fill="#475569" text-anchor="middle">${esc(st.label || '門')}</text>
      </svg>`;
  }
  if (st.type === 'door-double') {
    const hw = st.w / 2;
    return `
      <svg width="${st.w}" height="${st.h}" viewBox="0 0 ${st.w} ${st.h}">
        <path d="M 0,${st.h} A ${hw} ${st.h} 0 0 1 ${hw},0" fill="none" stroke="#2563a6" stroke-width="1.5" stroke-dasharray="3,3"/>
        <path d="M ${st.w},${st.h} A ${hw} ${st.h} 0 0 0 ${hw},0" fill="none" stroke="#2563a6" stroke-width="1.5" stroke-dasharray="3,3"/>
        <line x1="0" y1="0" x2="0" y2="${st.h}" stroke="#334155" stroke-width="3"/>
        <line x1="${st.w}" y1="0" x2="${st.w}" y2="${st.h}" stroke="#334155" stroke-width="3"/>
        <line x1="0" y1="${st.h}" x2="${st.w}" y2="${st.h}" stroke="#94a3b8" stroke-width="1"/>
        <text x="${hw}" y="${st.h - 6}" font-size="10" fill="#475569" text-anchor="middle">${esc(st.label || '雙開門')}</text>
      </svg>`;
  }
  if (st.type === 'pillar-round') {
    return `<div class="structPillar round" style="width:100%;height:100%;"></div>`;
  }
  return `<div class="structPillar" style="width:100%;height:100%;"></div>`;
}

function swapSeats(tid1, sid1, tid2, sid2) {
  if (sid1 === sid2) return;
  const t1 = tables.find(x => x.id === tid1);
  const t2 = tables.find(x => x.id === tid2);
  const s1 = t1?.seats.find(x => x.id === sid1);
  const s2 = t2?.seats.find(x => x.id === sid2);
  if (!s1 || !s2) return;
  pushHistory();
  const tmpName = s1.name;
  s1.name = s2.name;
  s2.name = tmpName;
  render();
  showToast('已對調席位姓名。');
}

function openInlineSeatEditor(se, tid, sid) {
  const t = tables.find(x => x.id === tid);
  const s = t?.seats.find(x => x.id === sid);
  if (!s) return;
  const inp = document.createElement('input');
  inp.className = 'seat-inline-input';
  inp.value = s.name || '';
  inp.placeholder = '姓名';
  se.innerHTML = '';
  se.appendChild(inp);
  inp.focus();
  inp.select();

  let done = false;
  const commit = save => {
    if (done) return;
    done = true;
    const nextVal = inp.value.trim();
    if (save && nextVal !== (s.name || '')) {
      pushHistory();
      s.name = nextVal;
      if (selectedSeat === sid) $('seatName').value = nextVal;
    }
    render();
  };
  inp.onclick = e => e.stopPropagation();
  inp.onpointerdown = e => e.stopPropagation();
  inp.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') commit(true);
    else if (e.key === 'Escape') commit(false);
  };
  inp.onblur = () => commit(true);
}

// 繪製與渲染畫布
function render() {
  room.querySelectorAll('.tableObj, .structObj, .align-guide, .marquee-box').forEach(el => el.remove());

  const rw = clamp(+$('roomW').value || 1200, 600, 3600);
  const rh = clamp(+$('roomH').value || 800, 500, 3000);
  room.style.width = rw + 'px';
  room.style.height = rh + 'px';

  // 渲染講台
  stageEl.style.left = stageConfig.x + 'px';
  stageEl.style.top = stageConfig.y + 'px';
  stageEl.style.width = stageConfig.w + 'px';
  stageEl.style.height = stageConfig.h + 'px';
  stageEl.textContent = $('stageText').value || stageConfig.text;

  // 渲染結構物件
  structures.forEach(st => {
    const el = document.createElement('div');
    el.className = 'structObj';
    el.dataset.id = st.id;
    Object.assign(el.style, {
      left: st.x + 'px',
      top: st.y + 'px',
      width: st.w + 'px',
      height: st.h + 'px'
    });
    el.innerHTML = structSvgMarkup(st);
    el.onpointerdown = e => startDrag(e, st.id, 'struct');
    room.appendChild(el);
  });

  const overlaps = detectSeatOverlaps(tables);
  const dup = findDuplicateNames(tables);

  // 渲染桌位與席位
  tables.forEach(t => {
    const el = document.createElement('div');
    el.className = 'tableObj ' + t.type;
    el.dataset.id = t.id;
    Object.assign(el.style, {
      left: t.x + 'px',
      top: t.y + 'px',
      width: t.w + 'px',
      height: t.h + 'px',
      transform: t.rotation ? `rotate(${t.rotation}deg)` : ''
    });

    const sh = document.createElement('div');
    sh.className = 'tableShape';
    if (t.type === 'auditoriumRow') {
      const labelTop = Math.max(0, (t.radius || 250) - 52);
      sh.style.top = labelTop + 'px';
      sh.innerHTML = `<span class="tableLabel">${esc(t.name)} (${t.seats.length}席)</span>`;
    } else {
      sh.innerHTML = `<span class="tableLabel">${esc(t.name)}<br><small style="font-weight:normal;opacity:0.85">${t.seats.length}席</small></span>`;
    }
    el.appendChild(sh);

    const p = positions(t);
    t.seats.forEach(s => {
      const q = p[s.id];
      if (!q) return;
      const se = document.createElement('div');
      se.className = `seat ${s.role}`
        + (overlaps.has(s.id) ? ' overlap' : '')
        + (dup.seatIds.has(s.id) ? ' duplicate' : '');
      se.dataset.seat = s.id;
      se.draggable = true;
      se.style.left = q.x + 'px';
      se.style.top = q.y + 'px';
      se.style.transform = `rotate(${q.rotation || 0}deg)`;
      se.innerHTML = `<span class="no">${esc(s.no)}</span><span class="name">${esc(s.name || '空席')}</span>`;
      se.title = `${t.name}｜${s.no}號席${s.name ? '：' + s.name : ''}（雙擊快編／拖曳對調）`;

      se.onpointerdown = e => e.stopPropagation();
      se.onclick = e => {
        e.stopPropagation();
        selectSeat(t.id, s.id);
      };
      se.ondblclick = e => {
        e.stopPropagation();
        openInlineSeatEditor(se, t.id, s.id);
      };
      se.ondragstart = e => {
        e.stopPropagation();
        dragSeatInfo = { tid: t.id, sid: s.id };
        se.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', s.id);
        }
      };
      se.ondragover = e => {
        if (!dragSeatInfo || dragSeatInfo.sid === s.id) return;
        e.preventDefault();
        se.classList.add('drop-target');
      };
      se.ondragleave = () => se.classList.remove('drop-target');
      se.ondrop = e => {
        e.preventDefault();
        e.stopPropagation();
        se.classList.remove('drop-target');
        if (dragSeatInfo) swapSeats(dragSeatInfo.tid, dragSeatInfo.sid, t.id, s.id);
        dragSeatInfo = null;
      };
      se.ondragend = () => {
        se.classList.remove('dragging');
        room.querySelectorAll('.seat.drop-target').forEach(node => node.classList.remove('drop-target'));
        dragSeatInfo = null;
      };

      el.appendChild(se);
    });

    el.onpointerdown = e => startDrag(e, t.id, 'table');
    room.appendChild(el);
  });

  syncSelectionUI();
  applySearchHighlight(false);
  updateStatus(overlaps.size, dup.names.length);
  saveLocal();
}

function clearAlignGuides() {
  room.querySelectorAll('.align-guide').forEach(g => g.remove());
}

function showAlignGuides(vx, hy) {
  clearAlignGuides();
  if (vx !== null) {
    const g = document.createElement('div');
    g.className = 'align-guide v';
    g.style.left = vx + 'px';
    room.appendChild(g);
  }
  if (hy !== null) {
    const g = document.createElement('div');
    g.className = 'align-guide h';
    g.style.top = hy + 'px';
    room.appendChild(g);
  }
}

// 高效拖曳處理 (支援鎖定、多選群組拖曳、網格吸附與對齊輔助線)
function startDrag(e, id, kind) {
  if (e.button !== 0) return;
  if (e.target.closest('.seat')) return;
  e.stopPropagation();

  if (kind === 'table' && e.shiftKey) {
    if (selectedTables.has(id)) {
      selectedTables.delete(id);
      if (selectedTable === id) selectedTable = [...selectedTables][0] || null;
    } else {
      selectedTables.add(id);
      selectedTable = id;
    }
    selectedSeat = null;
    selectedStruct = null;
    syncSelectionUI();
    return;
  }

  const targetEl = e.currentTarget;
  let obj;
  let group = null;

  if (kind === 'table') {
    if (selectedTables.has(id) && selectedTables.size > 1) {
      selectedTable = id;
      selectedSeat = null;
      selectedStruct = null;
      syncSelectionUI();
      obj = tables.find(x => x.id === id);
      if (!layoutLocked) {
        group = [...selectedTables].map(tid => {
          const item = tables.find(x => x.id === tid);
          const itemEl = room.querySelector(`.tableObj[data-id="${tid}"]`);
          return item && itemEl ? { obj: item, el: itemEl, ox: item.x, oy: item.y } : null;
        }).filter(Boolean);
      }
    } else {
      selectTable(id, true);
      obj = tables.find(x => x.id === id);
    }
  } else if (kind === 'struct') {
    selectStruct(id, true);
    obj = structures.find(x => x.id === id);
  } else if (kind === 'stage') {
    selectedStruct = 'stage';
    selectedTable = selectedSeat = null;
    selectedTables.clear();
    syncSelectionUI();
    obj = stageConfig;
  }

  if (!obj || layoutLocked) return;

  drag = {
    kind,
    obj,
    el: targetEl,
    group,
    sx: e.clientX,
    sy: e.clientY,
    ox: obj.x,
    oy: obj.y,
    moved: false
  };
  try { targetEl.setPointerCapture(e.pointerId); } catch (_) {}
}

stageEl.onpointerdown = e => startDrag(e, 'stage', 'stage');

// 點擊空白畫布取消選取或開始框選多桌
room.addEventListener('pointerdown', e => {
  if (e.target !== room || e.button !== 0) return;
  selectedTable = selectedSeat = selectedStruct = null;
  selectedTables.clear();
  syncSelectionUI();

  const rect = room.getBoundingClientRect();
  const startX = (e.clientX - rect.left) / zoom;
  const startY = (e.clientY - rect.top) / zoom;
  const boxEl = document.createElement('div');
  boxEl.className = 'marquee-box';
  room.appendChild(boxEl);
  marquee = { startX, startY, curX: startX, curY: startY, boxEl, moved: false };
});

roomWrap.addEventListener('pointerdown', e => {
  if (e.target === roomWrap) {
    selectedTable = selectedSeat = selectedStruct = null;
    selectedTables.clear();
    syncSelectionUI();
  }
});

window.addEventListener('pointermove', e => {
  if (marquee) {
    const rect = room.getBoundingClientRect();
    marquee.curX = (e.clientX - rect.left) / zoom;
    marquee.curY = (e.clientY - rect.top) / zoom;
    const x = Math.min(marquee.startX, marquee.curX);
    const y = Math.min(marquee.startY, marquee.curY);
    const w = Math.abs(marquee.curX - marquee.startX);
    const h = Math.abs(marquee.curY - marquee.startY);
    if (w > 4 || h > 4) marquee.moved = true;
    Object.assign(marquee.boxEl.style, {
      left: x + 'px',
      top: y + 'px',
      width: w + 'px',
      height: h + 'px'
    });
    return;
  }

  if (!drag) return;
  const dx = (e.clientX - drag.sx) / zoom;
  const dy = (e.clientY - drag.sy) / zoom;
  if (!drag.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
    pushHistory();
    drag.moved = true;
  }

  const rw = +$('roomW').value || 1200;
  const rh = +$('roomH').value || 800;

  if (drag.group && drag.group.length > 1) {
    let gdx = Math.round(dx);
    let gdy = Math.round(dy);
    if (snapToGrid) {
      gdx = Math.round((drag.ox + dx) / 10) * 10 - drag.ox;
      gdy = Math.round((drag.oy + dy) / 10) * 10 - drag.oy;
    }
    drag.group.forEach(item => {
      const mx = Math.max(0, rw - (item.obj.w || 0));
      const my = Math.max(0, rh - (item.obj.h || 0));
      item.curX = clamp(item.ox + gdx, 0, mx);
      item.curY = clamp(item.oy + gdy, 0, my);
      item.el.style.left = item.curX + 'px';
      item.el.style.top = item.curY + 'px';
    });
    return;
  }

  const maxX = Math.max(0, rw - (drag.obj.w || 0));
  const maxY = Math.max(0, rh - (drag.obj.h || 0));
  let nx = Math.round(drag.ox + dx);
  let ny = Math.round(drag.oy + dy);
  if (snapToGrid) {
    nx = Math.round(nx / 10) * 10;
    ny = Math.round(ny / 10) * 10;
  }

  // 與其他桌位或講台邊緣／中心對齊輔助線
  let guideX = null;
  let guideY = null;
  const w = drag.obj.w || 0;
  const h = drag.obj.h || 0;
  const targets = [stageConfig, ...tables.filter(t => t !== drag.obj)];
  for (const other of targets) {
    const ow = other.w || 0;
    const oh = other.h || 0;
    if (guideX === null) {
      if (Math.abs(nx - other.x) <= 6) { nx = other.x; guideX = other.x; }
      else if (Math.abs((nx + w / 2) - (other.x + ow / 2)) <= 6) {
        nx = Math.round(other.x + ow / 2 - w / 2);
        guideX = Math.round(other.x + ow / 2);
      } else if (Math.abs((nx + w) - (other.x + ow)) <= 6) {
        nx = Math.round(other.x + ow - w);
        guideX = Math.round(other.x + ow);
      }
    }
    if (guideY === null) {
      if (Math.abs(ny - other.y) <= 6) { ny = other.y; guideY = other.y; }
      else if (Math.abs((ny + h / 2) - (other.y + oh / 2)) <= 6) {
        ny = Math.round(other.y + oh / 2 - h / 2);
        guideY = Math.round(other.y + oh / 2);
      } else if (Math.abs((ny + h) - (other.y + oh)) <= 6) {
        ny = Math.round(other.y + oh - h);
        guideY = Math.round(other.y + oh);
      }
    }
    if (guideX !== null && guideY !== null) break;
  }
  showAlignGuides(guideX, guideY);

  drag.curX = clamp(nx, 0, maxX);
  drag.curY = clamp(ny, 0, maxY);
  drag.el.style.left = drag.curX + 'px';
  drag.el.style.top = drag.curY + 'px';
});

function finishDrag() {
  if (marquee) {
    const x1 = Math.min(marquee.startX, marquee.curX);
    const y1 = Math.min(marquee.startY, marquee.curY);
    const x2 = Math.max(marquee.startX, marquee.curX);
    const y2 = Math.max(marquee.startY, marquee.curY);
    marquee.boxEl.remove();
    if (marquee.moved) {
      selectedTables.clear();
      tables.forEach(t => {
        if (t.x < x2 && t.x + t.w > x1 && t.y < y2 && t.y + t.h > y1) {
          selectedTables.add(t.id);
        }
      });
      selectedTable = [...selectedTables][0] || null;
      if (selectedTable) selectTable(selectedTable, true);
      else syncSelectionUI();
    }
    marquee = null;
  }

  if (!drag) return;
  clearAlignGuides();
  if (drag.moved) {
    if (drag.group && drag.group.length > 1) {
      drag.group.forEach(item => {
        if (item.curX !== undefined) {
          item.obj.x = item.curX;
          item.obj.y = item.curY;
        }
      });
    } else if (drag.curX !== undefined) {
      drag.obj.x = drag.curX;
      drag.obj.y = drag.curY;
    }
    refreshOverlapMarkers();
    saveLocal();
  }
  drag = null;
}

window.addEventListener('pointerup', finishDrag);
window.addEventListener('pointercancel', finishDrag);

// 選取切換
function selectTable(id, skipRender = false) {
  selectedTable = id;
  selectedTables.clear();
  if (id) selectedTables.add(id);
  selectedSeat = null;
  selectedStruct = null;
  const t = tables.find(x => x.id === id);
  if (t) {
    if (t.type !== 'auditoriumRow') $('tableType').value = t.type;
    $('tableName').value = t.name;
    $('seatCount').value = t.seats.filter(s => s.role !== 'side').length;
    $('sideCount').value = t.seats.filter(s => s.role === 'side').length;
    $('chairPos').value = t.chair || 'none';
    $('tableRotation').value = t.rotation || 0;
    switchTab('tab-table');
  }
  if (skipRender) syncSelectionUI();
  else render();
}

function selectSeat(tid, sid) {
  selectedTable = tid;
  selectedTables.clear();
  selectedTables.add(tid);
  selectedSeat = sid;
  selectedStruct = null;
  const t = tables.find(x => x.id === tid);
  const s = t?.seats.find(x => x.id === sid);
  if (s) {
    $('seatName').value = s.name;
    $('seatRole').value = s.role;
    $('seatNo').value = s.no;
  }
  switchTab('tab-seat');
  syncSelectionUI();
  $('seatName').focus();
  $('seatName').select();
}

function selectStruct(id, skipRender = false) {
  selectedStruct = id;
  selectedTable = selectedSeat = null;
  selectedTables.clear();
  const st = structures.find(x => x.id === id);
  if (st) {
    $('structType').value = st.type;
    $('structLabel').value = st.label || '';
    $('structW').value = st.w;
    $('structH').value = st.h;
    switchTab('tab-room');
  }
  if (skipRender) syncSelectionUI();
  else render();
}

// 桌位新增 / 更新 / 刪除 / 旋轉
function addTable(recordHistory = true) {
  if (recordHistory) pushHistory();
  const type = $('tableType').value;
  const n = Math.max(1, +$('seatCount').value || 1);
  const side = Math.max(0, +$('sideCount').value || 0);
  const chair = $('chairPos').value;
  const rotation = ((+$('tableRotation').value || 0) % 360 + 360) % 360;
  const size = computeTableSize(type, n, side);

  const newT = {
    id: uid(),
    name: $('tableName').value.trim() || `第${tables.length + 1}桌`,
    type,
    x: 100 + (tables.length % 3) * 380,
    y: 120 + Math.floor(tables.length / 3) * 280,
    w: size.w,
    h: size.h,
    rotation,
    chair,
    seats: makeSeats(n, side, chair, type)
  };
  tables.push(newT);
  render();
  selectTable(newT.id, true);
}

function updateTable() {
  const t = tables.find(x => x.id === selectedTable);
  if (!t) return alert('請先點選畫布上的桌位！');
  pushHistory();
  const isArc = t.type === 'auditoriumRow';
  const type = isArc ? t.type : $('tableType').value;
  const n = Math.max(1, +$('seatCount').value || 1);
  const side = Math.max(0, +$('sideCount').value || 0);
  const chair = $('chairPos').value;
  const rotation = ((+$('tableRotation').value || 0) % 360 + 360) % 360;
  const size = isArc ? { w: t.w, h: t.h } : computeTableSize(type, n, side);

  t.name = $('tableName').value.trim() || t.name;
  t.type = type;
  t.w = size.w;
  t.h = size.h;
  t.rotation = rotation;
  t.chair = chair;

  const oldNormal = (t.seats || []).filter(s => s.role !== 'side');
  const oldSide = (t.seats || []).filter(s => s.role === 'side');
  const neu = makeSeats(n, side, chair, type);
  let nIdx = 0;
  let sIdx = 0;
  neu.forEach(s => {
    if (s.role === 'side') {
      const prev = oldSide[sIdx++];
      if (prev) {
        s.name = prev.name;
        s.no = prev.no;
      }
    } else {
      const prev = oldNormal[nIdx++];
      if (prev) {
        s.name = prev.name;
        s.no = prev.no;
        if (prev.role === 'vip' && s.role !== 'chairman') s.role = 'vip';
      }
    }
  });
  t.seats = neu;
  render();
}

function rotateSelectedTables(deg = 90) {
  const ids = selectedTables.size ? [...selectedTables] : (selectedTable ? [selectedTable] : []);
  if (!ids.length) return alert('請先點選欲旋轉的桌位！');
  pushHistory();
  ids.forEach(id => {
    const t = tables.find(x => x.id === id);
    if (t) t.rotation = (((t.rotation || 0) + deg) % 360 + 360) % 360;
  });
  const primary = tables.find(x => x.id === (selectedTable || ids[0]));
  if (primary) $('tableRotation').value = primary.rotation || 0;
  render();
}

function deleteTable() {
  const ids = new Set(selectedTables);
  if (selectedTable) ids.add(selectedTable);
  if (!ids.size) return;
  pushHistory();
  tables = tables.filter(x => !ids.has(x.id));
  selectedTable = selectedSeat = null;
  selectedTables.clear();
  render();
}

function duplicateTable() {
  const t = tables.find(x => x.id === selectedTable);
  if (!t) return;
  pushHistory();
  const c = JSON.parse(JSON.stringify(t));
  c.id = uid();
  c.name = t.name + ' (複本)';
  c.x += 40;
  c.y += 40;
  c.seats.forEach(s => s.id = uid());
  tables.push(c);
  selectTable(c.id);
}

function applySeat() {
  const t = tables.find(x => x.id === selectedTable);
  const s = t?.seats.find(x => x.id === selectedSeat);
  if (!s) return alert('請先在畫布上點選要編輯的具體席位！');
  pushHistory();
  s.name = $('seatName').value.trim();
  s.no = $('seatNo').value.trim() || s.no;
  s.role = $('seatRole').value;
  render();
}

// 結構物件預設尺寸聯動與操作
const structDefaults = {
  'wall-h': { w: 120, h: 14, label: '隔間牆' },
  'wall-v': { w: 14, h: 160, label: '垂直隔間牆' },
  'door-single': { w: 90, h: 90, label: '進出大門' },
  'door-double': { w: 100, h: 80, label: '雙開大門' },
  'pillar-round': { w: 40, h: 40, label: '圓形立柱' },
  'pillar-square': { w: 40, h: 40, label: '方形立柱' }
};

$('structType').addEventListener('change', () => {
  const def = structDefaults[$('structType').value];
  if (def && !selectedStruct) {
    $('structW').value = def.w;
    $('structH').value = def.h;
  }
});

function addStruct() {
  pushHistory();
  const type = $('structType').value;
  const def = structDefaults[type] || { w: 120, h: 14 };
  const w = Math.max(8, +$('structW').value || def.w);
  const h = Math.max(8, +$('structH').value || def.h);

  const st = {
    id: uid(),
    type,
    label: $('structLabel').value,
    x: 80 + (structures.length * 40) % 300,
    y: 100 + (structures.length * 30) % 200,
    w,
    h
  };
  structures.push(st);
  render();
  selectStruct(st.id, true);
}

function updateStruct() {
  if (selectedStruct === 'stage') {
    return alert('講台標題請於「場地設定」頁籤修改，位置可直接拖曳移動。');
  }
  const st = structures.find(x => x.id === selectedStruct);
  if (!st) return alert('請先點選欲更新的結構物件');
  pushHistory();
  st.type = $('structType').value;
  st.label = $('structLabel').value;
  st.w = Math.max(8, +$('structW').value || st.w);
  st.h = Math.max(8, +$('structH').value || st.h);
  render();
}

function deleteStruct() {
  if (!selectedStruct || selectedStruct === 'stage') {
    if (selectedStruct === 'stage') alert('講台為核心區無法刪除，可拖曳移動或於「場地設定」修改標題。');
    return;
  }
  pushHistory();
  structures = structures.filter(x => x.id !== selectedStruct);
  selectedStruct = null;
  render();
}

$('quickAddDoorLeft').onclick = () => {
  pushHistory();
  structures.push({ id: uid(), type: 'door-single', label: '入口大門', x: 10, y: 120, w: 80, h: 80 });
  render();
};
$('quickAddDoorRight').onclick = () => {
  pushHistory();
  structures.push({ id: uid(), type: 'door-double', label: '出口安全門', x: Math.max(10, +$('roomW').value - 110), y: 120, w: 100, h: 80 });
  render();
};

// 內建座位版型 UI 控制
let selectedTemplateKey = null;
let pendingTemplateKey = null;
let templateCategory = 'all';

function renderTemplateLibrary() {
  const q = $('templateSearch').value.trim().toLowerCase();
  const list = templateCatalog.filter(t =>
    (templateCategory === 'all' || t.category === templateCategory) &&
    (!q || `${t.name} ${t.desc} ${t.tags}`.toLowerCase().includes(q))
  );
  if ($('templateSort').value === 'seatsAsc') list.sort((a, b) => a.seats - b.seats);
  if ($('templateSort').value === 'seatsDesc') list.sort((a, b) => b.seats - a.seats);
  $('templateGrid').innerHTML = list.length
    ? list.map(t => `<button class="template-card${t.key === selectedTemplateKey ? ' selected' : ''}" data-template="${esc(t.key)}"><span class="template-thumb">${esc(t.icon)}</span><span><strong>${esc(t.name)}</strong><span>${esc(t.desc)}</span><span class="mini">${t.seats} 席｜${t.tables} 桌區｜${esc(t.size)}</span></span></button>`).join('')
    : '<div class="template-empty">找不到符合條件的座位版型</div>';
  document.querySelectorAll('#templateGrid [data-template]').forEach(b => {
    b.onclick = () => selectTemplate(b.dataset.template);
  });
}

function selectTemplate(key) {
  selectedTemplateKey = key;
  const t = templateCatalog.find(x => x.key === key);
  if (!t) return;
  $('previewTitle').textContent = `${t.icon} ${t.name}`;
  $('previewCanvas').innerHTML = buildPreviewSvg(getTemplateSnapshot(key).data);
  $('previewDesc').textContent = t.desc;
  $('previewSeats').textContent = t.seats;
  $('previewTables').textContent = t.tables;
  $('previewSize').textContent = t.size;
  $('applySelectedTemplate').disabled = false;
  renderTemplateLibrary();
}

function applyTemplate(kind) {
  pushHistory();
  const d = buildTemplateData(kind);
  $('templateModal').classList.remove('show');
  loadProjectData(d);
  showToast('已套用版型。若需復原，可按 Ctrl+Z 或「復原」。');
}

function showToast(msg) {
  clearTimeout(toastTimer);
  $('status').textContent = msg;
  toastTimer = setTimeout(() => updateStatus(), 2400);
}

$('openTemplateModal').onclick = () => {
  $('templateModal').classList.add('show');
  renderTemplateLibrary();
  if (!selectedTemplateKey) selectTemplate('executive');
};
$('closeTemplateModal').onclick = () => $('templateModal').classList.remove('show');
$('applySelectedTemplate').onclick = () => {
  if (!selectedTemplateKey) return;
  if (tables.length > 0 || structures.length > 0) {
    pendingTemplateKey = selectedTemplateKey;
    const t = templateCatalog.find(x => x.key === selectedTemplateKey);
    const label = t ? `「${t.name}」` : '此版型';
    $('confirmTemplateMsg').textContent = `套用${label}將會清除目前的會議室配置（包含所有桌位、已排定名單與門牆結構）。套用後仍可按 Ctrl+Z 或點擊「復原」還原。`;
    $('confirmTemplateModal').classList.add('show');
  } else {
    applyTemplate(selectedTemplateKey);
  }
};
$('cancelApplyTemplate').onclick = () => {
  pendingTemplateKey = null;
  $('confirmTemplateModal').classList.remove('show');
};
$('confirmApplyTemplate').onclick = () => {
  const key = pendingTemplateKey;
  pendingTemplateKey = null;
  $('confirmTemplateModal').classList.remove('show');
  if (key) applyTemplate(key);
};
$('templateSearch').oninput = renderTemplateLibrary;
$('templateSort').onchange = renderTemplateLibrary;
document.querySelectorAll('.template-filter').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.template-filter').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    templateCategory = b.dataset.category;
    renderTemplateLibrary();
  };
});

window.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  if (e.key === 'Escape') {
    if ($('confirmTemplateModal').classList.contains('show')) {
      pendingTemplateKey = null;
      $('confirmTemplateModal').classList.remove('show');
      return;
    }
    document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
    return;
  }
  if (isEditing) return;

  const mod = e.ctrlKey || e.metaKey;
  const keyLower = e.key.toLowerCase();
  if (mod && keyLower === 'z' && !e.shiftKey && undoStack.length) {
    e.preventDefault();
    undo();
  } else if ((mod && keyLower === 'y') || (mod && keyLower === 'z' && e.shiftKey)) {
    if (redoStack.length) {
      e.preventDefault();
      redo();
    }
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedTable || selectedTables.size) {
      e.preventDefault();
      deleteTable();
    } else if (selectedStruct && selectedStruct !== 'stage') {
      e.preventDefault();
      deleteStruct();
    }
  }
});

// 教室矩陣快速生成器
$('openClassroomModal').onclick = () => $('classroomModal').classList.add('show');
$('closeClassroomModal').onclick = () => $('classroomModal').classList.remove('show');

$('generateClassroom').onclick = () => {
  pushHistory();
  const rows = clamp(+$('crRows').value || 4, 1, 15);
  const cols = clamp(+$('crCols').value || 3, 1, 10);
  const seatsPerTable = clamp(+$('crSeatsPerTable').value || 2, 1, 4);
  const aisle = $('crAisle').value;
  const names = parseNames($('crNames').value);

  const tableW = seatsPerTable === 1 ? 100 : computeTableSize('classroom', seatsPerTable, 0).w;
  const tableH = 50;
  const xGap = 40;
  const yGap = 58;
  const startY = stageConfig.y + stageConfig.h + 60;

  let nameIdx = 0;
  const newTables = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let aisleOffset = 0;
      if (aisle === 'center' && cols > 1 && c >= Math.ceil(cols / 2)) {
        aisleOffset = 80;
      }
      const x = 120 + c * (tableW + xGap) + aisleOffset;
      const y = startY + r * (tableH + yGap);

      const tableSeats = [];
      for (let s = 0; s < seatsPerTable; s++) {
        tableSeats.push({
          id: uid(),
          no: `R${r + 1}-${c + 1}-${s + 1}`,
          name: names[nameIdx++] || '',
          role: 'normal'
        });
      }

      newTables.push({
        id: uid(),
        name: `${r + 1}排-${c + 1}組`,
        type: 'classroom',
        x,
        y,
        w: tableW,
        h: tableH,
        rotation: 0,
        chair: 'none',
        seats: tableSeats
      });
    }
  }

  tables.push(...newTables);
  $('classroomModal').classList.remove('show');
  render();
};

// 大講堂弧形座位生成器
$('openAuditoriumModal').onclick = () => $('auditoriumModal').classList.add('show');
$('closeAuditoriumModal').onclick = () => $('auditoriumModal').classList.remove('show');

$('generateAuditorium').onclick = () => {
  pushHistory();
  const numRows = clamp(+$('audRows').value || 4, 1, 12);
  const startSeats = clamp(+$('audStartSeats').value || 8, 2, 30);
  const seatStep = clamp(+$('audSeatStep').value ?? 2, 0, 6);
  const angleSpan = clamp(+$('audAngleSpan').value || 90, 30, 160);
  const startRadius = clamp(+$('audStartRadius').value || 230, 150, 700);
  const rowSpacing = clamp(+$('audRowSpacing').value || 70, 50, 140);
  const names = parseNames($('audNames').value);

  const centerX = stageConfig.x + (stageConfig.w / 2);
  const centerY = stageConfig.y + (stageConfig.h / 2);
  const spanRad = angleSpan * (Math.PI / 180);

  let nameIdx = 0;
  const newTables = [];

  for (let r = 0; r < numRows; r++) {
    const curSeatsCount = startSeats + r * seatStep;
    const minSafeR = curSeatsCount > 1
      ? Math.ceil(76 / (2 * Math.sin(spanRad / (2 * (curSeatsCount - 1)))))
      : startRadius;
    const prevR = r > 0 ? newTables[r - 1].radius + rowSpacing : startRadius;
    const curRadius = Math.max(startRadius + r * rowSpacing, prevR, minSafeR);
    const arcWidth = Math.round(2 * curRadius * Math.sin(spanRad / 2)) + 60;

    const tObj = {
      id: uid(),
      name: `第 ${r + 1} 排`,
      type: 'auditoriumRow',
      x: Math.round(centerX - arcWidth / 2),
      y: Math.round(centerY + 30),
      w: arcWidth,
      h: 24,
      rotation: 0,
      radius: curRadius,
      angleSpan,
      chair: 'none',
      seats: []
    };

    for (let s = 0; s < curSeatsCount; s++) {
      tObj.seats.push({
        id: uid(),
        no: `${r + 1}排${s + 1}號`,
        name: names[nameIdx++] || '',
        role: r === 0 && s === Math.floor(curSeatsCount / 2) ? 'vip' : 'normal'
      });
    }
    newTables.push(tObj);
  }

  tables.push(...newTables);
  $('auditoriumModal').classList.remove('show');
  render();
};

// 批次名單排位 Modal
$('openBatchModal').onclick = () => $('batchModal').classList.add('show');
if ($('openBatchModalSidebar')) $('openBatchModalSidebar').onclick = () => $('batchModal').classList.add('show');
$('closeBatchModal').onclick = () => $('batchModal').classList.remove('show');

$('batchToSelectedTable').onclick = () => {
  const t = tables.find(x => x.id === selectedTable);
  if (!t) return alert('請先在畫布上選取一個桌位！');
  const names = parseNames($('batchNameList').value);
  if (!names.length) return alert('請先輸入或貼上姓名清單！');

  pushHistory();
  t.seats.forEach((s, idx) => {
    if (names[idx] !== undefined) s.name = names[idx];
  });
  $('batchModal').classList.remove('show');
  render();
};

$('batchToAllTables').onclick = () => {
  const names = parseNames($('batchNameList').value);
  if (!names.length) return alert('請先輸入或貼上姓名清單！');

  pushHistory();
  let idx = 0;
  tables.forEach(t => {
    t.seats.forEach(s => {
      if (names[idx] !== undefined) {
        s.name = names[idx++];
      }
    });
  });
  $('batchModal').classList.remove('show');
  render();
};

// 自動防重疊流式排列既有常規桌
function autoArrange() {
  pushHistory();
  const roomW = +$('roomW').value || 1200;
  const marginX = 50;
  const gapX = 40;
  const gapY = 40;
  let curX = marginX;
  let curY = Math.max(120, stageConfig.y + stageConfig.h + 50);
  let rowMaxH = 0;

  tables.forEach(t => {
    if (t.type === 'auditoriumRow') return;
    const fp = tableFootprint(t);
    if (curX > marginX && curX + fp.totalW > roomW - marginX) {
      curX = marginX;
      curY += rowMaxH + gapY;
      rowMaxH = 0;
    }
    t.x = Math.round(curX + fp.padL);
    t.y = Math.round(curY + fp.padT);
    curX += fp.totalW + gapX;
    rowMaxH = Math.max(rowMaxH, fp.totalH);
  });
  render();
}

function updateStatus(
  overlapCount = detectSeatOverlaps(tables).size,
  dupNameCount = findDuplicateNames(tables).names.length
) {
  const totalSeats = tables.reduce((a, t) => a + t.seats.length, 0);
  const namedSeats = tables.reduce((a, t) => a + t.seats.filter(s => s.name).length, 0);
  const baseText = `桌區: ${tables.length}｜總席位: ${totalSeats}｜已排定: ${namedSeats} 人｜結構物: ${structures.length}`;
  const notes = [];
  if (overlapCount > 0) notes.push(`<span class="overlap-warn">⚠️ 重疊席位: ${overlapCount}</span>`);
  else notes.push('✅ 零重疊');
  if (dupNameCount > 0) notes.push(`<span class="dup-warn">⚠️ 重複名單: ${dupNameCount} 組</span>`);
  $('status').innerHTML = `${esc(baseText)}｜${notes.join('｜')}`;
}

function getProjectData() {
  return {
    version: 2,
    meetingName: $('meetingName').value,
    roomW: +$('roomW').value || 1200,
    roomH: +$('roomH').value || 800,
    stage: stageConfig,
    structures,
    tables
  };
}

function loadProjectData(raw) {
  const d = sanitizeProjectData(raw);
  $('meetingName').value = d.meetingName;
  $('roomW').value = d.roomW;
  $('roomH').value = d.roomH;
  stageConfig = d.stage;
  $('stageText').value = stageConfig.text;
  structures = d.structures;
  tables = d.tables;
  selectedTable = selectedSeat = selectedStruct = null;
  selectedTables.clear();
  render();
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1200);
}

$('exportJson').onclick = () => {
  download(new Blob([JSON.stringify(getProjectData(), null, 2)], { type: 'application/json' }), safeFileName($('meetingName').value) + '.json');
};

$('importJson').onclick = () => $('jsonFile').click();
$('jsonFile').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      pushHistory();
      loadProjectData(parsed);
      showToast('已匯入 JSON 配置檔。');
    } catch (err) {
      alert('JSON 格式不正確或已毀損');
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsText(file);
};

$('exportCsv').onclick = () => {
  const csvContent = buildCsvContent(getProjectData());
  download(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }), safeFileName($('meetingName').value) + '_席次名單.csv');
};

$('exportSvg').onclick = () => {
  const svgContent = buildProjectSvg(getProjectData());
  download(new Blob([svgContent], { type: 'image/svg+xml' }), safeFileName($('meetingName').value) + '_向量圖.svg');
};

$('exportPng').onclick = async () => {
  try {
    const d = getProjectData();
    const svg = buildProjectSvg(d);
    const blob = await svgToPngBlob(svg, d.roomW, d.roomH + 48, 2);
    download(blob, safeFileName(d.meetingName) + '_座位圖.png');
    showToast('已匯出高解析 PNG 圖片。');
  } catch (err) {
    alert('匯出 PNG 失敗：' + (err?.message || err));
  }
};

let saveTimer = null;
function saveLocal() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('meetingLayoutV2', JSON.stringify(getProjectData())); } catch (e) {}
  }, 180);
}

// 縮放與輔助開關控制
function applyZoom(val) {
  zoom = clamp(Math.round(val * 10) / 10, 0.4, 1.8);
  room.style.transform = `scale(${zoom})`;
  $('zoomReset').textContent = Math.round(zoom * 100) + '%';
}
$('zoomIn').onclick = () => applyZoom(zoom + 0.1);
$('zoomOut').onclick = () => applyZoom(zoom - 0.1);
$('zoomReset').onclick = () => applyZoom(1);

$('snapToggle').onclick = () => {
  snapToGrid = !snapToGrid;
  $('snapToggle').textContent = snapToGrid ? '🧲 網格吸附: 開' : '🧲 網格吸附: 關';
  $('snapToggle').classList.toggle('active-toggle', snapToGrid);
};

$('lockLayoutBtn').onclick = () => {
  layoutLocked = !layoutLocked;
  $('lockLayoutBtn').textContent = layoutLocked ? '🔒 已鎖定' : '🔓 鎖定配置';
  $('lockLayoutBtn').classList.toggle('active-toggle', layoutLocked);
};

$('seatSearch').addEventListener('input', () => applySearchHighlight(true));

// 清空與重設
$('clearAll').onclick = () => $('confirmModal').classList.add('show');
$('cancelClear').onclick = () => $('confirmModal').classList.remove('show');
$('confirmClear').onclick = () => {
  pushHistory();
  tables = [];
  structures = [];
  selectedTable = selectedSeat = selectedStruct = null;
  selectedTables.clear();
  $('confirmModal').classList.remove('show');
  render();
};

$('centerStage').onclick = () => {
  pushHistory();
  const rw = +$('roomW').value || 1200;
  stageConfig.x = Math.round((rw - stageConfig.w) / 2);
  stageConfig.y = 16;
  render();
};

// 綁定基礎事件
$('addTable').onclick = () => addTable(true);
$('updateTable').onclick = updateTable;
$('deleteTable').onclick = deleteTable;
$('duplicateTable').onclick = duplicateTable;
$('rotateTable90').onclick = () => rotateSelectedTables(90);
$('applySeat').onclick = applySeat;
$('clearSeat').onclick = () => { $('seatName').value = ''; applySeat(); };
$('autoArrange').onclick = autoArrange;
$('undoBtn').onclick = undo;
$('redoBtn').onclick = redo;
$('addStruct').onclick = addStruct;
$('updateStruct').onclick = updateStruct;
$('deleteStruct').onclick = deleteStruct;
$('printBtn').onclick = () => window.print();

['seatName', 'seatNo'].forEach(id => {
  $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter' && selectedSeat) {
      e.preventDefault();
      applySeat();
    }
  });
});

// 輕量屬性輸入免整頁重繪
['roomW', 'roomH'].forEach(id => {
  $(id).addEventListener('input', () => {
    const rw = clamp(+$('roomW').value || 1200, 600, 3600);
    const rh = clamp(+$('roomH').value || 800, 500, 3000);
    room.style.width = rw + 'px';
    room.style.height = rh + 'px';
    saveLocal();
  });
});
$('stageText').addEventListener('input', () => {
  stageConfig.text = $('stageText').value;
  stageEl.textContent = stageConfig.text || '講台區 / 主席台 (Stage)';
  saveLocal();
});
$('meetingName').addEventListener('input', saveLocal);

// 自我檢查：網址加 ?selftest 執行，驗證「零重疊」承諾 (所有版型 + 各桌型席數掃描)
function selfTest() {
  const fails = [];
  templateMeta.forEach(m => {
    const n = detectSeatOverlaps(buildTemplateData(m.key).tables).size;
    if (n) fails.push(`版型 ${m.key}: ${n} 席重疊`);
  });
  ['rect', 'classroom', 'round', 'oval', 'uShape', 'hollowSquare'].forEach(type => {
    for (let n = 1; n <= 40; n++) {
      for (let side = 0; side <= 4; side++) {
        const c = detectSeatOverlaps([seatTable('t', type, 0, 0, n, side)]).size;
        if (c) fails.push(`${type} n=${n} side=${side}: ${c} 席重疊`);
      }
    }
  });
  fails.forEach(f => console.error('[selftest]', f));
  document.title = fails.length ? `SELFTEST FAIL (${fails.length})` : 'SELFTEST PASS';
  showToast(fails.length ? `自我檢查失敗 ${fails.length} 項：${fails[0]}…（詳見 console）` : '自我檢查通過：零重疊');
  return fails;
}
if (location.search.includes('selftest')) window.selfTestResult = selfTest();

// 頁面初始化
try {
  const saved = localStorage.getItem('meetingLayoutV2');
  if (saved) {
    loadProjectData(JSON.parse(saved));
  } else {
    structures.push({ id: uid(), type: 'door-single', label: '正門入口', x: 20, y: 120, w: 90, h: 90 });
    structures.push({ id: uid(), type: 'wall-h', label: '後方隔音牆', x: 200, y: 740, w: 800, h: 14 });
    addTable(false);
  }
} catch (e) {
  tables = [];
  structures = [];
  addTable(false);
}
updateHistoryButtons();
