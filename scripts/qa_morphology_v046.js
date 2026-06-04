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
const records = data.records || [];

const dist = {};
let cupPri = 0;
records.forEach((r) => {
  const m = TE.detectMorphology(r);
  const t = m.primary?.type || '無明確形態';
  dist[t] = (dist[t] || 0) + 1;
  if (t === '杯柄型態') cupPri++;
});

function inspect(code) {
  const r = records.find((x) => x.code === code);
  if (!r) return { missing: true };
  const m = TE.detectMorphology(r);
  const st = m.structure || {};
  const ann = m.chartAnnotations || [];
  return {
    type: m.primary.type,
    leftRim: st.leftRim,
    cupLow: st.cupLow,
    rightRim: st.rightRim,
    leftIdx: st.leftRimIdx,
    cupLowIdx: st.cupLow != null ? 'ok' : null,
    rimGap:
      st.leftRimIdx != null && st.rightRimIdx != null
        ? st.rightRimIdx - st.leftRimIdx
        : null,
    badges: (m.chartBadges || []).map((b) => b.text),
    mm: m.measuredMove?.label,
    annCount: ann.length,
    hasCupCurve: ann.some((a) => a.kind === 'cupcurve'),
    n2330Cup: ann.some((a) => a.kind === 'cupfill' || a.style === 'cup'),
  };
}

const badDates = records.filter((r) => r.series[r.series.length - 1].date !== '2026-06-04');

console.log(
  JSON.stringify(
    {
      versionHtml: html.includes('v0.4.6'),
      as_of: data.as_of,
      records: records.length,
      badDates: badDates.length,
      distribution: dist,
      cupPrimary: cupPri,
      n2330: inspect('2330'),
      n0050: inspect('0050'),
      n0052: inspect('0052'),
      n3665: inspect('3665'),
      n00830: inspect('00830'),
      n00861: inspect('00861'),
    },
    null,
    2
  )
);
