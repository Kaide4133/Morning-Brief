'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {candle, marketDomain, candleGeometry} = require('../assets/js/water-level.js');
// Synthetic unit fixtures only, never inserted into production market data.
const valid = {market_status:'closed',taiex_open:100,taiex_high:110,taiex_low:90,taiex_close:105};
test('candlestick requires genuine full positive OHLC and completed status', () => {
  assert.equal(candle(valid).direction,'up');
  for (const patch of [{taiex_open:null},{taiex_high:104},{taiex_low:106},{taiex_high:NaN},{taiex_low:0},{taiex_open:'100'},{market_status:'pending'}]) assert.equal(candle({...valid,...patch}),null);
  assert.equal(candle({taiex_close:105,market_status:'closed'}),null);
});
test('Taiwan red and green candle direction compares close with open', () => {
  assert.equal(candle({...valid,taiex_close:95}).direction,'down');
  assert.equal(candle({...valid,taiex_close:100}).direction,'flat');
});
test('price domain includes entire wicks rather than closes only', () => {
  const domain=marketDomain([valid]);
  assert.ok(domain.low<90);assert.ok(domain.high>110);
  const empty=marketDomain([]);assert.ok(empty.high>empty.low);
});
test('body and wick geometry preserves OHLC, including a doji', () => {
  const g=candleGeometry(candle(valid),30,n=>200-n,8);
  assert.deepEqual(g,{x:26,width:8,y:95,height:5,wickTop:90,wickBottom:110});
  assert.equal(candleGeometry(candle({...valid,taiex_close:100}),30,n=>200-n,8).height,0);
});
