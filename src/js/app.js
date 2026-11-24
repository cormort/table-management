import { esc, uid, clamp, parseNames, safeFileName } from './utils.js';
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
  buildProjectSvg
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
let selectedSeat = null;
let selectedStruct = null;
let zoom = 1;
let drag = null;
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
  room.querySelectorAll('.seat').forEach(se => {
    se.classList.toggle('overlap', overlaps.has(se.dataset.seat));
  });
  updateStatus(overlaps.size);
}

// 僅更新選取樣式，不重建 DOM (確保拖曳穩定)
function syncSelectionUI() {
  stageEl.classList.toggle('selected', selectedStruct === 'stage');
  room.querySelectorAll('.structObj').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === selectedStruct);
  });
  room.querySelectorAll('.tableObj').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === selectedTable);
  });
  room.querySelectorAll('.seat').forEach(el => {
    el.classList.toggle('selected', el.dataset.seat === selectedSeat);
  });
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

// 繪製與渲染畫布
function render() {
  room.querySelectorAll('.tableObj, .structObj').forEach(el => el.remove());

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

  // 渲染桌位與席位
  tables.forEach(t => {
    const el = document.createElement('div');
    el.className = 'tableObj ' + t.type;
    el.dataset.id = t.id;
    Object.assign(el.style, {
      left: t.x + 'px',
      top: t.y + 'px',
      width: t.w + 'px',
      height: t.h + 'px'
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
      se.className = `seat ${s.role}` + (overlaps.has(s.id) ? ' overlap' : '');
      se.dataset.seat = s.id;
      se.style.left = q.x + 'px';
      se.style.top = q.y + 'px';
      se.style.transform = `rotate(${q.rotation || 0}deg)`;
      se.innerHTML = `<span class="no">${esc(s.no)}</span><span class="name">${esc(s.name || '空席')}</span>`;
      se.title = `${t.name}｜${s.no}號席${s.name ? '：' + s.name : ''}`;
      se.onpointerdown = e => e.stopPropagation();
      se.onclick = e => {
        e.stopPropagation();
        selectSeat(t.id, s.id);
      };
      el.appendChild(se);
    });

    el.onpointerdown = e => startDrag(e, t.id, 'table');
    room.appendChild(el);
  });

  syncSelectionUI();
  updateStatus(overlaps.size);
  saveLocal();
}

// 高效拖曳處理 (不重建 DOM，避免 pointerCapture 失效)
function startDrag(e, id, kind) {
  if (e.button !== 0) return;
  if (e.target.closest('.seat')) return;
  e.stopPropagation();
  const targetEl = e.currentTarget;
  let obj;
  if (kind === 'table') {
    selectTable(id, true);
    obj = tables.find(x => x.id === id);
  } else if (kind === 'struct') {
    selectStruct(id, true);
    obj = structures.find(x => x.id === id);
  } else if (kind === 'stage') {
    selectedStruct = 'stage';
    selectedTable = selectedSeat = null;
    syncSelectionUI();
    obj = stageConfig;
  }
  if (!obj) return;

  drag = {
    kind,
    obj,
    el: targetEl,
    sx: e.clientX,
    sy: e.clientY,
    ox: obj.x,
    oy: obj.y,
    moved: false
  };
  try { targetEl.setPointerCapture(e.pointerId); } catch (_) {}
}

stageEl.onpointerdown = e => startDrag(e, 'stage', 'stage');

// 點擊空白畫布取消選取
room.addEventListener('pointerdown', e => {
  if (e.target === room) {
    selectedTable = selectedSeat = selectedStruct = null;
    syncSelectionUI();
  }
});
roomWrap.addEventListener('pointerdown', e => {
  if (e.target === roomWrap) {
    selectedTable = selectedSeat = selectedStruct = null;
    syncSelectionUI();
  }
});

window.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = (e.clientX - drag.sx) / zoom;
  const dy = (e.clientY - drag.sy) / zoom;
  if (!drag.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
    pushHistory();
    drag.moved = true;
  }
  const rw = +$('roomW').value || 1200;
  const rh = +$('roomH').value || 800;
  const maxX = Math.max(0, rw - (drag.obj.w || 0));
  const maxY = Math.max(0, rh - (drag.obj.h || 0));
  drag.curX = clamp(Math.round(drag.ox + dx), 0, maxX);
  drag.curY = clamp(Math.round(drag.oy + dy), 0, maxY);
  drag.el.style.left = drag.curX + 'px';
  drag.el.style.top = drag.curY + 'px';
});

function finishDrag() {
  if (!drag) return;
  if (drag.curX !== undefined && drag.moved) {
    drag.obj.x = drag.curX;
    drag.obj.y = drag.curY;
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
  selectedSeat = null;
  selectedStruct = null;
  const t = tables.find(x => x.id === id);
  if (t) {
    if (t.type !== 'auditoriumRow') $('tableType').value = t.type; // 弧形排不在下拉選項中
    $('tableName').value = t.name;
    $('seatCount').value = t.seats.filter(s => s.role !== 'side').length;
    $('sideCount').value = t.seats.filter(s => s.role === 'side').length;
    $('chairPos').value = t.chair || 'none';
  }
  if (skipRender) syncSelectionUI();
  else render();
}

function selectSeat(tid, sid) {
  selectedTable = tid;
  selectedSeat = sid;
  selectedStruct = null;
  const t = tables.find(x => x.id === tid);
  const s = t?.seats.find(x => x.id === sid);
  if (s) {
    $('seatName').value = s.name;
    $('seatRole').value = s.role;
    $('seatNo').value = s.no;
  }
  switchTab('tab-table');
  syncSelectionUI();
  $('seatName').focus();
  $('seatName').select();
}

function selectStruct(id, skipRender = false) {
  selectedStruct = id;
  selectedTable = selectedSeat = null;
  const st = structures.find(x => x.id === id);
  if (st) {
    $('structType').value = st.type;
    $('structLabel').value = st.label || '';
    $('structW').value = st.w;
    $('structH').value = st.h;
    switchTab('tab-struct');
  }
  if (skipRender) syncSelectionUI();
  else render();
}

// 桌位新增 / 更新 / 刪除
function addTable(recordHistory = true) {
  if (recordHistory) pushHistory();
  const type = $('tableType').value;
  const n = Math.max(1, +$('seatCount').value || 1);
  const side = Math.max(0, +$('sideCount').value || 0);
  const chair = $('chairPos').value;
  const size = computeTableSize(type, n, side);

  const newT = {
    id: uid(),
    name: $('tableName').value.trim() || `第${tables.length + 1}桌`,
    type,
    x: 100 + (tables.length % 3) * 380,
    y: 120 + Math.floor(tables.length / 3) * 280,
    w: size.w,
    h: size.h,
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
  const isArc = t.type === 'auditoriumRow'; // 弧形排保留型別與弧寬，避免被改成長方桌
  const type = isArc ? t.type : $('tableType').value;
  const n = Math.max(1, +$('seatCount').value || 1);
  const side = Math.max(0, +$('sideCount').value || 0);
  const chair = $('chairPos').value;
  const size = isArc ? { w: t.w, h: t.h } : computeTableSize(type, n, side);

  t.name = $('tableName').value.trim() || t.name;
  t.type = type;
  t.w = size.w;
  t.h = size.h;
  t.chair = chair;

  // 分離一般席與加位席保留姓名與 VIP 身分，同時避免殘留舊主席位
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

function deleteTable() {
  if (!selectedTable) return;
  pushHistory();
  tables = tables.filter(x => x.id !== selectedTable);
  selectedTable = selectedSeat = null;
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
$('applySelectedTemplate').onclick = () => selectedTemplateKey && applyTemplate(selectedTemplateKey);
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
    if (selectedTable) {
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

function updateStatus(overlapCount = detectSeatOverlaps(tables).size) {
  const totalSeats = tables.reduce((a, t) => a + t.seats.length, 0);
  const namedSeats = tables.reduce((a, t) => a + t.seats.filter(s => s.name).length, 0);
  const baseText = `桌區: ${tables.length}｜總席位: ${totalSeats}｜已排定: ${namedSeats} 人｜結構物: ${structures.length}`;
  if (overlapCount > 0) {
    $('status').innerHTML = `${esc(baseText)}｜<span class="overlap-warn">⚠️ 重疊席位: ${overlapCount}</span>`;
  } else {
    $('status').textContent = baseText + '｜✅ 零重疊';
  }
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

let saveTimer = null;
function saveLocal() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('meetingLayoutV2', JSON.stringify(getProjectData())); } catch (e) {}
  }, 180);
}

// 縮放控制
function applyZoom(val) {
  zoom = clamp(Math.round(val * 10) / 10, 0.4, 1.8);
  room.style.transform = `scale(${zoom})`;
  $('zoomReset').textContent = Math.round(zoom * 100) + '%';
}
$('zoomIn').onclick = () => applyZoom(zoom + 0.1);
$('zoomOut').onclick = () => applyZoom(zoom - 0.1);
$('zoomReset').onclick = () => applyZoom(1);

// 清空與重設
$('clearAll').onclick = () => $('confirmModal').classList.add('show');
$('cancelClear').onclick = () => $('confirmModal').classList.remove('show');
$('confirmClear').onclick = () => {
  pushHistory();
  tables = [];
  structures = [];
  selectedTable = selectedSeat = selectedStruct = null;
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
