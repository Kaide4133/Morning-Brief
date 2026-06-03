/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'docs');
const engineSrc = fs.readFileSync(path.join(root, 'technical-engine.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'technical-data.json'), 'utf8'));

const sandbox = { globalThis: {} };
vm.runInNewContext(engineSrc, sandbox);
const TE = sandbox.globalThis.TechnicalEngine;

const pool = { records: data.records, as_of: data.as_of };
let errors = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    errors += 1;
  }
}

const n2330 = TE.findRecord(pool, '2330');
assert(n2330 && n2330.code === '2330', '2330 findRecord');
const a2330 = TE.analyze(n2330.raw);
assert(a2330.summary, '2330 summary');
assert(a2330.trend.state, '2330 trend');
assert((n2330.series || []).length >= 60, '2330 series>=60');

const flat = {
  code: '9998',
  name: '測試',
  close: 100,
  change_pct: 1.2,
  ma5: 99,
  ma10: 98,
  ma20: 95,
  ma60: 90,
  boll_ub: 110,
  boll_lb: 80,
  prev_high20: 105,
  recent_low10: 92,
  volume_ratio: 1.5,
  distance_ma20_pct: 5.2,
  upper_shadow_ratio: 0.1,
  consecutive_up: 1,
  w_boll_ub: 115,
  series: [],
};
const nf = TE.normalizeRecord(flat);
assert(nf.close === 100 && nf.w_boll_ub === 115, 'flat normalize');

const miss = TE.findRecord(pool, '999999');
assert(miss === null, '999999 not found');

const scan = TE.scan(data.records, data.as_of);
const bucketCounts = {};
TE.SCANNER_BUCKETS.forEach((m) => {
  bucketCounts[m.key] = (scan.buckets[m.key] || []).length;
});

console.log(JSON.stringify({
  records: data.records.length,
  as_of: data.as_of,
  test2330: { name: n2330.name, close: n2330.close, trend: a2330.trend.state, series: n2330.series.length },
  bucketCounts,
  errors,
}, null, 2));

process.exit(errors ? 1 : 0);
