const path = require('path');
const fs = require('fs');
const TE = require(path.join(__dirname, '..', 'docs', 'technical-engine.js'));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-data.json'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-spider.html'), 'utf8');
const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-engine.js'), 'utf8');
function morph(code) { return TE.detectMorphology(data.records.find((x) => x.code === code)); }
const all = data.records.map((r) => ({ code: r.code, name: r.name, morph: TE.detectMorphology(r) }));
const types = new Set(all.map((x) => x.morph.primary.type));
const directions = new Set(all.map((x) => x.morph.primary.direction || (x.morph.tradePlan && x.morph.tradePlan.direction)));
const noClear = all.filter((x) => x.morph.primary.type === '無明確形態');
const checks = {
  versionHtml: html.includes('KW Technical Spider v0.6.0') && html.includes('Pattern Matrix 多空型態矩陣') && html.includes('方向：'),
  dataAsOf: data.as_of,
  recordCount: data.records.length,
  hasBullBearDetectors: ['detectWBottom','detectInverseHeadShoulders','detectMTop','detectHeadShouldersTop','detectBullFlag','detectBearFlag','detectWedge'].every((x)=>engineSrc.includes(x)),
  hasDirectionMap: ['多方反轉','多方延續','空方反轉','空方延續','中性待確認','無明確方向'].every((x)=>engineSrc.includes(x)),
  primaryTypes: Array.from(types).sort(),
  directions: Array.from(directions).sort(),
  m3034: morph('3034').primary,
  m2383: morph('2383').primary,
  m2330: morph('2330').primary,
  m6515: morph('6515').primary,
  noClearCount: noClear.length,
  noClearPlan: noClear[0] && noClear[0].morph.tradePlan && noClear[0].morph.tradePlan.direction,
};
const ok = checks.versionHtml && checks.dataAsOf === '2026-06-11' && checks.recordCount === 76 && checks.hasBullBearDetectors && checks.hasDirectionMap && checks.m3034.type === '杯柄型態' && checks.m3034.direction === '多方延續' && checks.m2383.type === 'W底' && checks.m2383.direction === '多方反轉' && checks.m2330.direction === '空方風險' && checks.m6515.direction === '中性待確認' && checks.noClearCount >= 1 && checks.noClearPlan === '無明確方向';
console.log(JSON.stringify({ ok, checks }, null, 2));
process.exit(ok ? 0 : 1);
