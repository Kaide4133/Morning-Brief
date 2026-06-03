const path = require('path');
const fs = require('fs');
const TE = require(path.join(__dirname, '..', 'docs', 'technical-engine.js'));
const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-data.json'), 'utf8')
);
const records = data.records || [];

const dist = {};
let mm = 0;
let fib = 0;
let cupSec = 0;
let cupPri = 0;

records.forEach((r) => {
  const m = TE.detectMorphology(r);
  const t = m.primary?.type || '無明確形態';
  dist[t] = (dist[t] || 0) + 1;
  if (m.measuredMove?.direction) mm++;
  if (m.fibExtensions?.length) fib++;
  if (t === '杯柄型態') cupPri++;
  (m.secondary || []).forEach((s) => {
    if (s.type === '杯型底雛形') cupSec++;
  });
});

function ySim(code) {
  const r = records.find((x) => x.code === code);
  if (!r) return null;
  const n = TE.normalizeRecord(r);
  const s = n.series.slice(-120).filter((x) => x.close != null);
  const lows = s.map((x) => x.low || x.close);
  const highs = s.map((x) => x.high || x.close);
  return { close: s[s.length - 1].close, lo: Math.min(...lows), hi: Math.max(...highs) };
}

console.log(
  JSON.stringify(
    {
      records: records.length,
      distribution: dist,
      cupPrimary: cupPri,
      cupSecondary: cupSec,
      measuredMove: mm,
      fibExtensions: fib,
      y0052: ySim('0052'),
      n2330: (() => {
        const r = records.find((x) => x.code === '2330');
        const m = TE.detectMorphology(r);
        return {
          type: m.primary.type,
          ann: (m.chartAnnotations || []).map((a) => a.kind + ':' + (a.label || '')),
        };
      })(),
      n3665: (() => {
        const r = records.find((x) => x.code === '3665');
        const m = TE.detectMorphology(r);
        return { type: m.primary.type, mm: m.measuredMove?.label || '' };
      })(),
      n3665name: records.find((x) => x.code === '3665')?.name,
      n00887: records.find((x) => x.code === '00887')?.name,
    },
    null,
    2
  )
);
