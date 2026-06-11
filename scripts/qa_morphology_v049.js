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
const m2330 = morph('2330');

const checks = {
  versionHtml: html.includes('KW Technical Spider v0.4.9') && html.includes('型態階段與交易計畫優化') && html.includes('morphTradePlan'),
  dataAsOf: data.as_of,
  recordCount: data.records.length,
  m3034Primary: m3034.primary.type,
  m3034State: m3034.primary.state,
  m3034Secondary: (m3034.secondary || []).map((x) => x.type),
  m3034Plan: m3034.tradePlan && m3034.tradePlan.stage,
  m2383Primary: m2383.primary.type,
  m2383Plan: m2383.tradePlan && m2383.tradePlan.stage,
  m2330Primary: m2330.primary.type,
  noForcedPlan: m2383.tradePlan && /不強制套型/.test(m2383.tradePlan.stage),
};

const ok =
  checks.versionHtml &&
  checks.dataAsOf === '2026-06-11' &&
  checks.recordCount === 76 &&
  checks.m3034Primary === '杯柄型態' &&
  /頸線/.test(checks.m3034State) &&
  checks.m3034Secondary.includes('假突破風險') &&
  /杯柄型態/.test(checks.m3034Plan || '') &&
  checks.m2383Primary === '無明確形態' &&
  checks.noForcedPlan &&
  checks.m2330Primary === '假突破風險';

console.log(JSON.stringify({ ok, checks }, null, 2));
process.exit(ok ? 0 : 1);
