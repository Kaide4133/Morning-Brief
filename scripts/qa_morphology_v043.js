const path = require('path');
const fs = require('fs');
const TE = require(path.join(__dirname, '..', 'docs', 'technical-engine.js'));
const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-data.json'), 'utf8')
);
const records = data.records || [];

const dist = {};
let mmCount = 0;
let fibCount = 0;
let cupSec = 0;
let annChannel = null;

records.forEach((r) => {
  const m = TE.detectMorphology(r);
  const t = (m.primary && m.primary.type) || '無明確形態';
  dist[t] = (dist[t] || 0) + 1;
  if (m.measuredMove && m.measuredMove.direction) mmCount++;
  if (m.fibExtensions && m.fibExtensions.length) fibCount++;
  (m.secondary || []).forEach((s) => {
    if (s.type === '杯型底雛形') cupSec++;
  });
  if (!annChannel && t === '上升通道') {
    annChannel = {
      code: r.code,
      ann: (m.chartAnnotations || m.primary.annotations || []).length,
      hasZone: (m.primary.annotations || []).some((a) => a.kind === 'zone'),
      hasPos: (m.primary.annotations || []).some((a) => a.kind === 'position'),
    };
  }
});

const r2330 = records.find((x) => x.code === '2330');
const m2330 = r2330 ? TE.detectMorphology(r2330) : null;
const ann2330 = m2330 ? m2330.chartAnnotations || m2330.primary.annotations : [];

console.log(
  JSON.stringify(
    {
      records: records.length,
      distribution: dist,
      cupSecondary: cupSec,
      measuredMove: mmCount,
      fibExtensions: fibCount,
      channelSample: annChannel,
      n2330: m2330
        ? {
            type: m2330.primary.type,
            ann: ann2330.map((a) => a.kind + ':' + (a.label || '')),
          }
        : null,
      n3665: records.find((x) => x.code === '3665')?.name,
      n00887: records.find((x) => x.code === '00887')?.name,
    },
    null,
    2
  )
);
