const path = require('path');
const fs = require('fs');
const TE = require(path.join(__dirname, '..', 'docs', 'technical-engine.js'));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-data.json'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-spider.html'), 'utf8');
const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-engine.js'), 'utf8');

function morph(code) {
  const rec = data.records.find((x) => x.code === code);
  if (!rec) throw new Error('missing record ' + code);
  return TE.detectMorphology(rec);
}
const all = data.records.map((r) => ({ code: r.code, name: r.name, morph: TE.detectMorphology(r) }));
const primaryTypes = new Set(all.map((x) => x.morph.primary.type));
const noClear = all.filter((x) => x.morph.primary.type === '無明確形態');
const wSamples = all.filter((x) => x.morph.primary.type === 'W底');
const checks = {
  versionHtml: html.includes('KW Technical Spider v0.5.1') && html.includes('杯柄/W/旗型/楔形/箱型/頭肩底') && html.includes('morphTradePlan'),
  dataAsOf: data.as_of,
  recordCount: data.records.length,
  hasDetectors: ['W底', '頭肩底', '楔形收斂', '多頭旗形', '反彈旗形', '箱型整理'].every((x) => engineSrc.includes(x)),
  primaryTypes: Array.from(primaryTypes).sort(),
  noClearCount: noClear.length,
  wCount: wSamples.length,
  m3034: morph('3034').primary.type + '｜' + morph('3034').primary.state,
  m6515: morph('6515').primary.type + '｜' + morph('6515').primary.state,
  noClearPlan: noClear[0] && noClear[0].morph.tradePlan && noClear[0].morph.tradePlan.stage,
};
const ok =
  checks.versionHtml &&
  checks.dataAsOf === '2026-06-11' &&
  checks.recordCount === 76 &&
  checks.hasDetectors &&
  /杯柄型態/.test(checks.m3034) &&
  /BOLL壓縮/.test(checks.m6515) &&
  checks.noClearCount >= 1 &&
  checks.wCount >= 1 &&
  /不強制套型/.test(checks.noClearPlan || '');
console.log(JSON.stringify({ ok, checks, noClearSample: noClear.slice(0, 5).map((x) => [x.code, x.name]), wSample: wSamples.slice(0, 5).map((x) => [x.code, x.name, x.morph.primary.state]) }, null, 2));
process.exit(ok ? 0 : 1);
