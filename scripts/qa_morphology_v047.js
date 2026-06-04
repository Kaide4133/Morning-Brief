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

function morph(code) {
  return TE.detectMorphology(data.records.find((x) => x.code === code));
}

function primary(code) {
  return morph(code).primary;
}

const checks = {
  versionHtml:
    html.includes('KW Technical Spider v0.4.7') &&
    html.includes('Annotation Minimal Mode') &&
    html.includes("const annotationMode = 'minimal'") &&
    html.includes('buildMinimalLabelOpts') &&
    html.includes('filterAnnotationsMinimal') &&
    html.includes('formatStructureMeasureLines') &&
    html.includes('skipChartBadges'),
  as_of: data.as_of,
  n00830: primary('00830'),
  n00861: primary('00861'),
  n0050: primary('0050'),
  n2330: primary('2330'),
  n0052: primary('0052'),
  n3665: primary('3665'),
  mm0050: morph('0050').measuredMove,
  fib00830: (morph('00830').fibExtensions || []).length,
};

let ok =
  checks.versionHtml &&
  checks.as_of === '2026-06-04' &&
  checks.n00830.type === '杯柄型態' &&
  checks.n00830.state === '突破延伸' &&
  checks.n00861.type === '杯柄型態' &&
  checks.n0050.type === '杯柄型態' &&
  checks.n2330.type === '假突破風險' &&
  checks.n0052.type === '上升通道' &&
  checks.n3665.type === '下降壓力線突破' &&
  (checks.n3665.state === '回測支撐' || checks.n3665.state === '突破後回測');

console.log(JSON.stringify({ ok, checks }, null, 2));
process.exit(ok ? 0 : 1);
