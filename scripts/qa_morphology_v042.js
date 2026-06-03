const fs = require('fs');
const path = require('path');
const enginePath = path.join(__dirname, '..', 'docs', 'technical-engine.js');
const dataPath = path.join(__dirname, '..', 'docs', 'technical-data.json');
const code = fs.readFileSync(enginePath, 'utf8');
const TechnicalEngine = require(path.join(__dirname, '..', 'docs', 'technical-engine.js'));
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const records = data.records || [];

const lens = records.map((r) => (r.series || []).length);
const wlen = records.map((r) => (r.weekly_series || []).length);
const nameBad = records.filter((r) => !r.name || r.name === r.code);

const dist = {};
let mmCount = 0;
let fibCount = 0;
const samples = { channel: null, descBreak: null, cup: null };

records.forEach((r) => {
  const m = TechnicalEngine.detectMorphology(r);
  const t = (m.primary && m.primary.type) || '無明確形態';
  dist[t] = (dist[t] || 0) + 1;
  if (m.measuredMove && m.measuredMove.direction) mmCount++;
  if (m.fibExtensions && m.fibExtensions.length) fibCount++;
  if (!samples.channel && t === '上升通道') samples.channel = r.code;
  if (!samples.descBreak && t === '下降壓力線突破') samples.descBreak = r.code;
  if (!samples.cup && (t === '杯柄型態' || t === 'U型底' || t === '圓弧底')) samples.cup = r.code + ':' + t;
});

console.log(
  JSON.stringify(
    {
      records: records.length,
      series: {
        min: Math.min(...lens),
        max: Math.max(...lens),
        avg: Math.round(lens.reduce((a, b) => a + b, 0) / lens.length),
      },
      weekly_series: {
        min: Math.min(...wlen),
        max: Math.max(...wlen),
        avg: Math.round(wlen.reduce((a, b) => a + b, 0) / wlen.length),
      },
      name_equals_code: nameBad.map((r) => r.code),
      n3665: records.find((r) => r.code === '3665')?.name,
      n00887: records.find((r) => r.code === '00887')?.name,
      distribution: dist,
      measuredMove: mmCount,
      fibExtensions: fibCount,
      samples,
      n2330: (() => {
        const r = records.find((x) => x.code === '2330');
        if (!r) return null;
        const m = TechnicalEngine.detectMorphology(r);
        return { type: m.primary?.type, state: m.primary?.state, conf: m.primary?.confidence, mm: m.measuredMove?.label };
      })(),
    },
    null,
    2
  )
);
