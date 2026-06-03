const path = require('path');
const fs = require('fs');
const TE = require(path.join(__dirname, '..', 'docs', 'technical-engine.js'));
const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-data.json'), 'utf8')
);
const records = data.records || [];
const html = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'technical-spider.html'),
  'utf8'
);
const engine = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'technical-engine.js'),
  'utf8'
);

const dist = {};
let mm = 0;
let fib = 0;
let cupSec = 0;
let cupPri = 0;
let badges = 0;

records.forEach((r) => {
  const m = TE.detectMorphology(r);
  const t = m.primary?.type || '無明確形態';
  dist[t] = (dist[t] || 0) + 1;
  if (m.measuredMove?.direction) mm++;
  if (m.fibExtensions?.length) fib++;
  if (t === '杯柄型態') cupPri++;
  if (m.chartBadges?.length) badges++;
  (m.secondary || []).forEach((s) => {
    if (s.type === '杯型底雛形') cupSec++;
  });
});

function inspect(code) {
  const r = records.find((x) => x.code === code);
  if (!r) return { missing: true };
  const n = TE.normalizeRecord(r);
  const m = TE.detectMorphology(r);
  const s = n.series.slice(-120).filter((x) => x.close != null);
  const lows = s.map((x) => x.low || x.close);
  const highs = s.map((x) => x.high || x.close);
  const ann = m.chartAnnotations || [];
  return {
    type: m.primary.type,
    state: m.primary.state,
    conf: m.primary.confidence,
    annKinds: ann.map((a) => a.kind + (a.style ? ':' + a.style : '')),
    labels: ann.map((a) => a.label).filter(Boolean),
    badges: (m.chartBadges || []).map((b) => b.text),
    mm: m.measuredMove?.label || null,
    fib: (m.fibExtensions || []).map((f) => ({
      level: f.level,
      draw: f.drawOnChart,
    })),
    yBand: { lo: Math.min(...lows), hi: Math.max(...highs) },
    seriesLen: n.series.length,
    weekly: (r.weekly_series || []).length,
  };
}

const banned = [
  '投資建議',
  '買進',
  '賣出',
  '必漲',
  '穩賺',
  '明牌',
  '保證',
  '目標價',
  '必達',
  '預測',
];
const bannedHits = banned.filter((w) => html.includes(w));

console.log(
  JSON.stringify(
    {
      versionHtml: html.includes('v0.4.5'),
      versionEngine: engine.includes('v0.4.5'),
      subtitle: html.includes('Pattern Drawing Polish'),
      records: records.length,
      as_of: data.as_of,
      distribution: dist,
      cupPrimary: cupPri,
      cupSecondary: cupSec,
      measuredMove: mm,
      fibExtensions: fib,
      chartBadgesCount: badges,
      n2330: inspect('2330'),
      n0052: inspect('0052'),
      n0050: inspect('0050'),
      n3665: inspect('3665'),
      n3665name: records.find((x) => x.code === '3665')?.name,
      n00887: records.find((x) => x.code === '00887')?.name,
      bannedInHtml: bannedHits,
      dailyLen: records[0]?.series?.length,
    },
    null,
    2
  )
);
