/* Local SVG renderer: no CDN dependency and no browser market-data fetches. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const number = x => typeof x === 'number' && Number.isFinite(x);
  const stamp = date => Date.parse(date + 'T00:00:00Z');
  const fmt = (n, decimals = 2) => n.toLocaleString('zh-TW', {minimumFractionDigits: decimals, maximumFractionDigits: decimals});
  const signed = (n, decimals) => (n > 0 ? '+' : '') + fmt(n, decimals);
  function selectRows(rows, range) {
    if (!rows.length || range === 'all') return rows.slice();
    const start = stamp(rows[rows.length - 1].date) - Number(range) * DAY;
    return rows.filter(row => stamp(row.date) >= start);
  }
  function statistics(rows) {
    const pairs = rows.filter(row => number(row.water_level) && number(row.taiex_close) && row.taiex_close > 0);
    if (pairs.length < 2) return null;
    const first = pairs[0], last = pairs[pairs.length - 1];
    return {start: first.date, end: last.date, count: pairs.length,
      waterDelta: last.water_level - first.water_level,
      marketReturn: (last.taiex_close / first.taiex_close - 1) * 100};
  }
  function segments(rows, key, x, y) {
    let penDown = false;
    return rows.map(row => {
      if (!number(row[key])) { penDown = false; return ''; }
      const command = penDown ? 'L' : 'M'; penDown = true;
      return command + x(row).toFixed(2) + ',' + y(row[key]).toFixed(2);
    }).filter(Boolean).join(' ');
  }
  const statusLabel = status => ({pending: '尚無當日收盤', non_trading: '非交易日', missing: '收盤資料缺漏'}[status] || '尚無收盤資料');
  const api = {selectRows, statistics, segments, number, statusLabel};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document) return;
  const $ = id => document.getElementById(id);
  const data = JSON.parse($('water-comparison-data').textContent);
  const allRows = data.rows;
  const svg = $('water-chart');
  const NS = 'http://www.w3.org/2000/svg';
  let rows = [], range = '90', selected = 0, geometry;
  const add = (name, attrs, text, parent = svg) => {
    const el = document.createElementNS(NS, name);
    Object.entries(attrs || {}).forEach(([key, value]) => el.setAttribute(key, value));
    if (text != null) el.textContent = text;
    parent.appendChild(el); return el;
  };
  const latestMarket = allRows.filter(row => number(row.taiex_close)).at(-1);
  if (latestMarket) {
    $('latest-index').textContent = fmt(latestMarket.taiex_close);
    $('latest-index-date').textContent = latestMarket.date + ' · 收盤／點';
  }
  function updateSelected(index) {
    if (!rows.length) return;
    selected = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[selected];
    $('selected-date').textContent = row.date;
    $('selected-water').textContent = '水位 ' + (number(row.water_level) ? fmt(row.water_level, 1) + '%' : '無紀錄');
    $('selected-market').textContent = '加權 ' + (number(row.taiex_close) ? fmt(row.taiex_close) + ' 點' : statusLabel(row.market_status));
    $('chart-date').value = selected;
    $('chart-date').setAttribute('aria-valuetext', row.date + '，' + $('selected-water').textContent + '，' + $('selected-market').textContent);
    const group = svg.querySelector('.selection'); group.replaceChildren();
    const x = geometry.x(row);
    add('line', {x1:x, x2:x, y1:geometry.top, y2:geometry.bottom, class:'crosshair'}, null, group);
    if (number(row.water_level)) add('circle', {cx:x, cy:geometry.waterY(row.water_level), r:4.5, class:'selected-water'}, null, group);
    if (number(row.taiex_close)) add('circle', {cx:x, cy:geometry.marketY(row.taiex_close), r:4.5, class:'selected-market'}, null, group);
  }
  function draw() {
    const oldDate = rows[selected]?.date;
    rows = selectRows(allRows, range);
    svg.replaceChildren();
    $('chart-empty').hidden = rows.length > 0;
    svg.style.display = rows.length ? 'block' : 'none';
    $('chart-date').disabled = !rows.length;
    if (!rows.length) return;
    const width = svg.clientWidth || 800, height = svg.clientHeight || 350;
    const mobile = width < 550;
    const left = mobile ? 30 : 40, right = width - (mobile ? 55 : 72), top = 22, bottom = height - 30;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    add('title', {}, '方舟水位與台股加權指數');
    add('desc', {}, '左軸水位固定 0 至 100%，右軸為指數點數、依所選區間縮放；缺值斷線。左右方向鍵切換日期。');
    let first = stamp(rows[0].date), last = stamp(rows.at(-1).date);
    if (first === last) { first -= DAY; last += DAY; }
    const x = row => left + (stamp(row.date) - first) / (last - first) * (right - left);
    const prices = rows.filter(row => number(row.taiex_close)).map(row => row.taiex_close);
    let low = prices.length ? Math.min(...prices) : 0, high = prices.length ? Math.max(...prices) : 100;
    const pad = Math.max((high - low) * 0.12, high * 0.003, 1);
    low = Math.max(0, low - pad); high += pad;
    const waterY = value => bottom - value / 100 * (bottom - top);
    const marketY = value => bottom - (value - low) / (high - low) * (bottom - top);
    geometry = {x, waterY, marketY, left, right, top, bottom, width};
    for (let n = 0; n <= 4; n++) {
      const y = bottom - n / 4 * (bottom - top);
      add('line', {x1:left, x2:right, y1:y, y2:y, class:'grid'});
      add('text', {x:left - 7, y:y + 3, 'text-anchor':'end'}, n * 25);
      add('text', {x:right + 7, y:y + 3}, prices.length ? fmt(low + n / 4 * (high - low), 0) : '—');
    }
    const tickCount = Math.min(mobile ? 3 : 6, rows.length);
    const indexes = new Set(Array.from({length:tickCount}, (_, i) => Math.round(i / Math.max(1, tickCount - 1) * (rows.length - 1))));
    for (const i of indexes) {
      const row = rows[i];
      add('text', {x:x(row), y:height - 7, 'text-anchor':i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}, row.date.slice(5).replace('-', '/'));
    }
    add('path', {d:segments(rows, 'taiex_close', x, marketY), class:'market-line', 'data-series':'taiex'});
    add('path', {d:segments(rows, 'water_level', x, waterY), class:'water-line', 'data-series':'water'});
    // Dots keep isolated observations visible even when neighboring values are absent.
    for (const row of rows) {
      if (number(row.water_level)) add('circle', {cx:x(row), cy:waterY(row.water_level), r:2, class:'water-dot'});
      if (number(row.taiex_close)) add('circle', {cx:x(row), cy:marketY(row.taiex_close), r:1.4, class:'market-dot'});
    }
    add('g', {class:'selection', 'aria-hidden':'true'});
    $('chart-date').max = rows.length - 1;
    const oldIndex = rows.findIndex(row => row.date === oldDate);
    updateSelected(oldIndex >= 0 ? oldIndex : rows.length - 1);
    const stats = statistics(rows);
    $('period-water').textContent = stats ? '水位 ' + signed(stats.waterDelta, 1) + ' 個百分點' : '水位 —';
    $('period-market').textContent = stats ? '大盤 ' + signed(stats.marketReturn, 2) + '%' : '大盤 —';
    $('period-dates').textContent = stats ? `${stats.start} → ${stats.end} · ${stats.count} 個共同日期` : '至少需要兩個共同有值的日期';
    const waterCount = rows.filter(row => number(row.water_level)).length;
    const marketCount = prices.length;
    const latest = rows.at(-1);
    const latestNote = !number(latest.taiex_close) ? `；${latest.date} ${statusLabel(latest.market_status)}` : '';
    $('coverage-note').textContent = `${rows[0].date} — ${rows.at(-1).date}｜水位 ${waterCount} 筆・大盤 ${marketCount} 筆${latestNote}。缺漏日期不補值；區間變化僅採共同起訖日。`;
    svg.dataset.rowCount = rows.length;
    svg.dataset.range = range;
  }
  document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
    range = button.dataset.range; rows = []; selected = 0;
    document.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    draw();
  }));
  function selectPointer(event) {
    if (!rows.length || !geometry) return;
    const rect = svg.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * geometry.width;
    let nearest = 0, distance = Infinity;
    rows.forEach((row, index) => { const d = Math.abs(geometry.x(row) - px); if (d < distance) {distance = d; nearest = index;} });
    updateSelected(nearest);
  }
  svg.addEventListener('pointerdown', selectPointer);
  svg.addEventListener('pointermove', event => { if (event.pointerType === 'mouse' || event.buttons) selectPointer(event); });
  svg.addEventListener('keydown', event => {
    const delta = {ArrowLeft:-1, ArrowRight:1, Home:-rows.length, End:rows.length}[event.key];
    if (delta == null) return;
    event.preventDefault(); updateSelected(selected + delta);
  });
  $('chart-date').addEventListener('input', event => updateSelected(Number(event.target.value)));
  let resizeFrame;
  new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(draw); }).observe($('chart-shell'));
  draw();
})(typeof window === 'undefined' ? globalThis : window);
