const path = require('path');
const fs = require('fs');
const TE = require(path.join(__dirname, '..', 'docs', 'technical-engine.js'));
const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-data.json'), 'utf8')
);
const html = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'technical-spider.html'),
  'utf8'
);

const EN_NAME = /[A-Za-z]{5,}/;
const codes = [
  '6285', '3017', '3528', '6016', '3034', '9105', '6548', '5864', '6015',
  '6207', '3149', '2455', '2313', '7769', '00830', '00861', '0050', '2330',
  '3665', '0052',
];

function primary(code) {
  return TE.detectMorphology(data.records.find((x) => x.code === code)).primary;
}

function nameOf(code) {
  const r = data.records.find((x) => x.code === code);
  return r ? r.name : null;
}

const englishLeft = data.records.filter(function (r) {
  return EN_NAME.test(r.name || '') && !/[\u4e00-\u9fff]/.test(r.name || '');
});

const mm00830 = TE.detectMorphology(
  data.records.find((x) => x.code === '00830')
).measuredMove;

const checks = {
  versionHtml:
    html.includes('KW Technical Spider v0.4.8') &&
    html.includes('技術形態自動判讀') &&
    html.includes('產品文案與掃描卡片可讀性整理') &&
    html.includes('meta-chip') &&
    !html.includes('Annotation Minimal Mode'),
  as_of: data.as_of,
  recordCount: data.records.length,
  englishNamesLeft: englishLeft.length,
  names: Object.fromEntries(codes.map((c) => [c, nameOf(c)])),
  measureLabel: TE.localizeMeasureLabel(mm00830),
  scanSample: (function () {
    const scan = TE.scan(data);
    const all = []
      .concat(scan.buckets.bullishTrend || [])
      .concat(scan.buckets.nearBreakout || []);
    const cup = all.find((x) => x.code === '00830');
    return cup ? cup.measuredLabel : null;
  })(),
  n00830: primary('00830'),
  n2330: primary('2330'),
  n3665: primary('3665'),
  n0052: primary('0052'),
};

let ok =
  checks.versionHtml &&
  checks.as_of === '2026-06-04' &&
  checks.recordCount === 78 &&
  checks.englishNamesLeft === 0 &&
  checks.measureLabel &&
  checks.measureLabel.indexOf('結構量測') === 0 &&
  checks.measureLabel.indexOf('Measured move') < 0 &&
  (!checks.scanSample || checks.scanSample.indexOf('Measured move') < 0) &&
  checks.n00830.type === '杯柄型態' &&
  checks.n00830.state === '突破延伸' &&
  checks.n2330.type === '假突破風險' &&
  checks.n3665.type === '下降壓力線突破' &&
  checks.n0052.type === '上升通道';

console.log(JSON.stringify({ ok, checks }, null, 2));
process.exit(ok ? 0 : 1);
