'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {selectRows, statistics, segments, number} = require('../assets/js/water-level.js');
// Synthetic unit fixtures only; production chart embeds official source records.
const rows = [
  {date:'2026-05-04',water_level:50,taiex_close:20000},
  {date:'2026-06-05',water_level:null,taiex_close:21000},
  {date:'2026-09-04',water_level:60,taiex_close:22000},
  {date:'2026-09-07',water_level:61,taiex_close:null},
];
test('calendar-period filtering is anchored at latest record', () => {
  assert.deepEqual(selectRows(rows,'30'), rows.slice(2));
  assert.deepEqual(selectRows(rows,'all'), rows);
  assert.deepEqual(selectRows([],'90'), []);
});
test('paired deltas use the same dates and exclude pending close', () => {
  const s = statistics(rows);
  assert.equal(s.start,'2026-05-04'); assert.equal(s.end,'2026-09-04');
  assert.equal(s.count,2); assert.equal(s.waterDelta,10);
  assert.ok(Math.abs(s.marketReturn-10)<1e-10);
  assert.equal(statistics(rows.slice(2)),null);
});
test('missing observations break paths instead of being bridged or zero-filled', () => {
  const result = segments(rows,'water_level', row => rows.indexOf(row), n=>n);
  assert.equal(result,'M0.00,50.00 M2.00,60.00 L3.00,61.00');
  assert.equal(segments(rows,'taiex_close', row=>rows.indexOf(row), n=>n), 'M0.00,20000.00 L1.00,21000.00 L2.00,22000.00');
});
test('nonfinite, numeric strings and null are not valid observations; zero water is valid', () => {
  for (const value of [null,undefined,NaN,Infinity,'52']) assert.equal(number(value),false);
  assert.equal(number(0),true);
  assert.equal(statistics([{date:'2026-01-01',water_level:0,taiex_close:100},{date:'2026-01-02',water_level:1,taiex_close:101}]).waterDelta,1);
});
