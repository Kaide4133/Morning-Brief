const path = require('path');
const fs = require('fs');
const TE = require(path.join(__dirname, '..', 'docs', 'technical-engine.js'));
const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-data.json'), 'utf8')
);

function inspect(code) {
  const r = data.records.find((x) => x.code === code);
  const m = TE.detectMorphology(r);
  return {
    code,
    primary: m.primary.type,
    state: m.primary.state,
    confidence: m.primary.confidence,
    secondary: m.secondary,
    rankingDebug: m.rankingDebug,
    cupProbe: m.cupProbe,
  };
}

// patch: call after we add cupProbe to engine - for now run morphology only
['00830', '00861', '0050'].forEach((code) => {
  const r = data.records.find((x) => x.code === code);
  const m = TE.detectMorphology(r);
  console.log(JSON.stringify({ code, rankingDebug: m.rankingDebug }, null, 2));
});
