const path = require('path');
const fs = require('fs');
const TE = require(path.join(__dirname, '..', 'docs', 'technical-engine.js'));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-data.json'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-spider.html'), 'utf8');

function morph(code) {
  const rec = data.records.find((x) => x.code === code);
  if (!rec) throw new Error('missing record ' + code);
  return TE.detectMorphology(rec);
}

const m3034 = morph('3034');
const m2383 = morph('2383');
const m6515 = morph('6515');
const all = data.records.map((r) => ({ code: r.code, name: r.name, morph: TE.detectMorphology(r) }));
const primaryTypes = new Set(all.map((x) => x.morph.primary.type));

const checks = {
  versionHtml: html.includes('KW Technical Spider v0.5.0') && html.includes('旗型與 BOLL 參考納入交易計畫') && html.includes('morphTradePlan'),
  dataAsOf: data.as_of,
  recordCount: data.records.length,
  m3034Primary: m3034.primary.type,
  m3034Plan: m3034.tradePlan && m3034.tradePlan.stage,
  m2383Primary: m2383.primary.type,
  m2383Plan: m2383.tradePlan && m2383.tradePlan.stage,
  m6515Primary: m6515.primary.type,
  m6515Plan: m6515.tradePlan && m6515.tradePlan.stage,
  hasBullFlagDetector: typeof TE.detectMorphology === 'function' && fs.readFileSync(path.join(__dirname, '..', 'docs', 'technical-engine.js'), 'utf8').includes("type: '多頭旗形'"),
  knownPrimaryTypes: Array.from(primaryTypes).sort(),
};

const ok =
  checks.versionHtml &&
  checks.dataAsOf === '2026-06-11' &&
  checks.recordCount === 76 &&
  checks.m3034Primary === '杯柄型態' &&
  /杯柄型態/.test(checks.m3034Plan || '') &&
  checks.m2383Primary === '無明確形態' &&
  /不強制套型/.test(checks.m2383Plan || '') &&
  checks.m6515Primary === 'BOLL壓縮' &&
  /BOLL/.test(checks.m6515Plan || '') &&
  checks.hasBullFlagDetector;

console.log(JSON.stringify({ ok, checks }, null, 2));
process.exit(ok ? 0 : 1);
