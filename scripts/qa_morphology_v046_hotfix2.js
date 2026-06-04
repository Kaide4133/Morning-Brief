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

function inspect(code) {
  const r = data.records.find((x) => x.code === code);
  if (!r) return { missing: true };
  const m = TE.detectMorphology(r);
  const cup = (m.rankingDebug && m.rankingDebug.candidates || []).find(
    (c) => c.type === '杯柄型態'
  );
  return {
    primary: m.primary.type,
    state: m.primary.state,
    confidence: m.primary.confidence,
    secondary: (m.secondary || []).map((s) => s.type + '·' + s.state),
    cupProbe: m.cupProbe,
    cupCandidate: cup
      ? {
          confidence: cup.confidence,
          bowlQuality: cup.quality && cup.quality.bowlQuality,
        }
      : null,
    channel: (m.rankingDebug && m.rankingDebug.candidates || [])
      .filter((c) => c.type === '上升通道')
      .map((c) => ({ state: c.state, confidence: c.confidence }))[0],
  };
}

function scanMorphFor(code) {
  const scan = TE.scan(data);
  const all = []
    .concat(
      ...TE.SCANNER_OPPORTUNITY_KEYS.map((k) => scan.buckets[k] || []),
      ...TE.SCANNER_RISK_KEYS.map((k) => scan.buckets[k] || [])
    )
    .map((x) => x.item || x);
  const hit = all.find((i) => String(i.code) === code);
  return hit
    ? { morphologyType: hit.morphologyType, morphologyState: hit.morphologyState }
    : null;
}

const checks = {
  versionHtml:
    html.includes('v0.4.6-hotfix-2') &&
    html.includes('Cup vs Channel Priority Calibration'),
  as_of: data.as_of,
  records: data.records.length,
  n00830: inspect('00830'),
  n00861: inspect('00861'),
  n0050: inspect('0050'),
  n2330: inspect('2330'),
  n0052: inspect('0052'),
  n3665: inspect('3665'),
  scan00830: scanMorphFor('00830'),
  scan00861: scanMorphFor('00861'),
};

let ok = true;
if (!checks.versionHtml) ok = false;
if (checks.as_of !== '2026-06-04') ok = false;
if (checks.n2330.primary !== '假突破風險') ok = false;
if (checks.n0050.primary !== '杯柄型態') ok = false;
if (checks.n0052.primary !== '上升通道') ok = false;
if (checks.n3665.primary !== '下降壓力線突破') ok = false;
if (
  checks.n3665.state !== '回測支撐' &&
  checks.n3665.state !== '突破後回測'
)
  ok = false;
if (checks.n00830.primary !== '杯柄型態') ok = false;
if (checks.n00861.primary !== '杯柄型態') ok = false;
if (checks.scan00830 && checks.scan00830.morphologyType !== '杯柄型態') ok = false;
if (checks.scan00861 && checks.scan00861.morphologyType !== '杯柄型態') ok = false;

console.log(JSON.stringify({ ok, checks }, null, 2));
process.exit(ok ? 0 : 1);
