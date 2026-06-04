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
  return {
    primary: m.primary.type,
    state: m.primary.state,
    confidence: m.primary.confidence,
    bowlQuality: m.primary.quality && m.primary.quality.bowlQuality,
    secondary: (m.secondary || []).map((s) => s.type + ':' + s.state),
    rankScore: m.primary.rankScore,
    debug: m.rankingDebug,
  };
}

console.log(
  JSON.stringify(
    {
      versionHtml: html.includes('v0.4.6-hotfix'),
      as_of: data.as_of,
      records: data.records.length,
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
