import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeSeats,
  positions,
  detectSeatOverlaps
} from '../src/js/geometry.js';
import {
  seatTable,
  buildTemplateData,
  templateMeta,
  templateCatalog
} from '../src/js/templates.js';
import {
  sanitizeProjectData,
  buildCsvContent,
  buildProjectSvg
} from '../src/js/exporter.js';

test('all 12 built-in templates have 0 seat overlaps and match catalog counts', () => {
  assert.equal(templateCatalog.length, 12);
  for (const item of templateCatalog) {
    const data = buildTemplateData(item.key);
    const actualSeats = data.tables.reduce((sum, t) => sum + t.seats.length, 0);
    assert.equal(actualSeats, item.seats, `${item.key} seat count mismatch`);
    assert.equal(data.tables.length, item.tables, `${item.key} table count mismatch`);
    assert.equal(`${data.roomW}x${data.roomH}`, item.size.replace('×', 'x'));
    const overlaps = detectSeatOverlaps(data.tables);
    assert.equal(overlaps.size, 0, `${item.key} has ${overlaps.size} overlapping seats`);
  }
});

test('exhaustive sweep across all 6 table types (n=1..40, side=0..4) produces 0 seat overlaps', () => {
  const types = ['rect', 'classroom', 'round', 'oval', 'uShape', 'hollowSquare'];
  for (const type of types) {
    for (let n = 1; n <= 40; n++) {
      for (let side = 0; side <= 4; side++) {
        const t = seatTable('test', type, 0, 0, n, side);
        const overlaps = detectSeatOverlaps([t]);
        assert.equal(overlaps.size, 0, `${type} n=${n} side=${side} had ${overlaps.size} overlaps`);
      }
    }
  }
});

test('makeSeats assigns exactly 1 chairman at expected edge per table type', () => {
  // rect with left side seat
  const rectLeft = makeSeats(13, 1, 'left', 'rect');
  assert.equal(rectLeft.filter(s => s.role === 'chairman').length, 1);
  assert.equal(rectLeft[13].role, 'chairman');

  // rect bottom center
  const rectBottom = makeSeats(8, 0, 'bottom', 'rect');
  assert.equal(rectBottom.filter(s => s.role === 'chairman').length, 1);
  assert.equal(rectBottom[6].role, 'chairman');

  // hollowSquare top / right / bottom / left
  for (const pos of ['top', 'right', 'bottom', 'left']) {
    const hs = makeSeats(17, 0, pos, 'hollowSquare');
    assert.equal(hs.filter(s => s.role === 'chairman').length, 1, `hollowSquare ${pos}`);
  }

  // round positions
  const roundBottom = makeSeats(8, 0, 'bottom', 'round');
  assert.equal(roundBottom[4].role, 'chairman');
});

test('sanitizeProjectData gracefully normalizes malformed inputs', () => {
  const sanitized = sanitizeProjectData({
    roomW: 100, // clamped up to 600
    roomH: 99999, // clamped down to 3000
    stage: null,
    structures: [null, { type: 'wall-h', x: 'abc', y: 10 }],
    tables: [{ type: 'unknownType', seats: [null, { role: 'hacker', name: 'Alice' }] }]
  });
  assert.equal(sanitized.roomW, 600);
  assert.equal(sanitized.roomH, 3000);
  assert.equal(sanitized.structures.length, 1);
  assert.equal(sanitized.tables.length, 1);
  assert.equal(sanitized.tables[0].type, 'rect');
  assert.equal(sanitized.tables[0].seats[0].role, 'normal');
  assert.equal(sanitized.tables[0].seats[0].name, 'Alice');
});

test('buildCsvContent emits UTF-8 BOM and neutralizes formula injection', () => {
  const csv = buildCsvContent({
    meetingName: '=CMD()',
    tables: [{
      name: '+Table1',
      type: 'rect',
      x: 10,
      y: 20,
      seats: [{ no: '1', name: '@attacker', role: 'normal' }]
    }]
  });
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=CMD()"'));
  assert.ok(csv.includes('"\'+Table1"'));
  assert.ok(csv.includes('"\'@attacker"'));
});

test('buildProjectSvg renders header title, uShape path, hollowSquare frame, and rotated seats', () => {
  const execData = buildTemplateData('executive');
  const commData = buildTemplateData('committee');
  const combined = {
    ...execData,
    tables: [...execData.tables, ...commData.tables]
  };
  const svg = buildProjectSvg(combined);
  assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes('首長會議座位配置表'));
  assert.ok(svg.includes('<path d="M ')); // uShape path
  assert.ok(svg.includes('fill="none" stroke="#8b5e34"')); // hollowSquare/uShape stroke
  assert.ok(svg.includes('rotate('));
});
