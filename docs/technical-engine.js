/**
 * KW Technical Spider v0.4.6-hotfix-2 — 杯柄與通道優先級校準
 * 僅輸出技術狀態與風險提示，不提供買賣建議。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TechnicalEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NEAR_PCT = 2.5;
  const BOLL_NEAR = 0.97;

  /** 產品 UI 文案：結構量測／延伸參考（非投資建議） */
  function localizeMeasureLabel(mmOrText) {
    if (mmOrText == null) return null;
    if (typeof mmOrText === 'object') {
      if (mmOrText.label) return localizeMeasureLabel(mmOrText.label);
      if (mmOrText.measuredPct != null) {
        const sign = mmOrText.direction === 'down' ? '-' : '+';
        return '結構量測：' + sign + Math.round(mmOrText.measuredPct) + '%';
      }
      return null;
    }
    let s = String(mmOrText).trim();
    if (!s) return null;
    if (/^結構量測：/.test(s)) return s;
    s = s.replace(/^Measured move\s+/i, '');
    const cup = /cup\s*depth/i.test(s);
    const chan = /\bchannel\b/i.test(s);
    const pct = s.match(/([+-]?\d+)\s*%/);
    if (cup && pct) return '結構量測：' + pct[1] + '% 杯深';
    if (chan && pct) return '結構量測：' + pct[1] + '% 通道';
    if (pct) return '結構量測：' + pct[1] + '%';
    return (
      '結構量測：' +
      s.replace(/cup depth/gi, '杯深').replace(/\bchannel\b/gi, '通道')
    );
  }

  function localizeFibUiLine(f) {
    if (!f) return '';
    const lvl = f.level != null ? String(f.level) : '';
    if (f.drawOnChart === false) {
      return 'Fibonacci ' + lvl + '：超出可視範圍';
    }
    return lvl;
  }

  function localizeChartBadgeText(text) {
    if (!text) return text;
    const t = String(text);
    if (/Projection beyond/i.test(t)) return '延伸參考：超出可視範圍';
    if (/Fibonacci/i.test(t) && /beyond/i.test(t)) {
      return t
        .replace(/Fibonacci\s+([\d./\s]+)\s+beyond view/i, 'Fibonacci $1：超出可視範圍')
        .replace(/beyond view/gi, '超出可視範圍');
    }
    return t;
  }

  function num(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function arr(v) {
    return Array.isArray(v) ? v.slice() : [];
  }

  function pctDistance(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return Infinity;
    return (Math.abs(a - b) / Math.abs(b)) * 100;
  }

  function isNear(value, target, pct) {
    if (!Number.isFinite(value) || !Number.isFinite(target)) return false;
    return pctDistance(value, target) <= (pct || NEAR_PCT);
  }

  function ma20Slope(series) {
    if (!series || series.length < 25) return null;
    const tail = series.slice(-25);
    const maAt = (idx) => {
      const slice = tail.slice(0, idx + 1).map((r) => num(r.close, null)).filter((c) => c != null);
      if (slice.length < 20) return null;
      const window = slice.slice(-20);
      return window.reduce((s, c) => s + c, 0) / 20;
    };
    const last = maAt(tail.length - 1);
    const prev = maAt(Math.max(19, tail.length - 6));
    if (last == null || prev == null) return null;
    return last > prev;
  }

  /**
   * 統一 record.latest / record.daily 與扁平欄位兩種格式。
   */
  function normalizeRecord(record) {
    if (!record || record.code == null) return null;

    const daily = record.daily || {};
    const weekly = record.weekly || {};
    const latest = record.latest || {};
    const analysis = record.analysis || {};

    const close = num(
      latest.close,
      num(record.close, num(daily.close, null))
    );
    const changePct = num(
      latest.change_pct,
      num(record.change_pct, null)
    );
    const volume = num(
      latest.volume,
      num(record.volume, num(daily.volume, null))
    );

    const ma5 = num(daily.ma5, num(record.ma5, null));
    const ma10 = num(daily.ma10, num(record.ma10, null));
    const ma20 = num(daily.ma20, num(record.ma20, null));
    const ma60 = num(daily.ma60, num(record.ma60, null));
    const bollMid = num(daily.boll_mid, num(record.boll_mid, ma20));
    const bollUb = num(daily.boll_ub, num(record.boll_ub, null));
    const bollLb = num(daily.boll_lb, num(record.boll_lb, null));
    let prevHigh20 = num(daily.prev_high20, num(record.prev_high20, null));
    const recentLow10 = num(daily.recent_low10, num(record.recent_low10, null));
    const volumeRatio = num(
      daily.volume_ratio,
      num(record.volume_ratio, num(record.vol_ratio, null))
    );
    const distanceMa20Pct = num(
      daily.distance_ma20_pct,
      num(record.distance_ma20_pct, null)
    );
    const upperShadowRatio = num(
      daily.upper_shadow_ratio,
      num(record.upper_shadow_ratio, null)
    );
    const consecutiveUp = num(
      daily.consecutive_up,
      num(record.consecutive_up, 0)
    );
    const wBollUb = num(
      weekly.boll_ub,
      num(record.w_boll_ub, num(record.w_boll_ub, null))
    );

    let support = arr(daily.support);
    let resistance = arr(daily.resistance);
    if (!support.length && record.support) support = arr(record.support);
    if (!resistance.length && record.resistance) resistance = arr(record.resistance);

    const series = arr(record.series).map((row) => ({
      date: row.date,
      open: num(row.open, null),
      high: num(row.high, null),
      low: num(row.low, null),
      close: num(row.close, null),
      volume: num(row.volume, 0),
      ma5: num(row.ma5, null),
      ma10: num(row.ma10, null),
      ma20: num(row.ma20, null),
      boll_ub: num(row.boll_ub, null),
      boll_lb: num(row.boll_lb, null),
    }));

    if (prevHigh20 == null && series.length >= 21) {
      const highs = series.slice(-21, -1).map((r) => r.high).filter(Number.isFinite);
      if (highs.length) prevHigh20 = Math.max.apply(null, highs);
    }
    if (recentLow10 == null && series.length >= 10) {
      const lows = series.slice(-10).map((r) => r.low).filter(Number.isFinite);
      if (lows.length) recentLow10 = Math.min.apply(null, lows);
    }

    return {
      code: String(record.code).trim(),
      name: record.name || record.code,
      market: record.market || '',
      as_of: record.as_of || null,
      close,
      change_pct: changePct,
      volume,
      ma5,
      ma10,
      ma20,
      ma60,
      boll_ub: bollUb,
      boll_mid: bollMid,
      boll_lb: bollLb,
      prev_high20: prevHigh20,
      recent_low10: recentLow10,
      volume_ratio: volumeRatio,
      distance_ma20_pct: distanceMa20Pct,
      upper_shadow_ratio: upperShadowRatio,
      consecutive_up: consecutiveUp,
      w_boll_ub: wBollUb,
      support,
      resistance,
      series,
      analysis,
      raw: record,
    };
  }

  function buildSupportResistance(norm) {
    const support = norm.support.slice();
    const resistance = norm.resistance.slice();
    if (norm.ma20 != null && !support.some((s) => String(s).includes('MA20'))) {
      support.push('MA20 ' + Math.round(norm.ma20));
    }
    if (norm.ma10 != null && !support.some((s) => String(s).includes('MA10'))) {
      support.push('MA10 ' + Math.round(norm.ma10));
    }
    if (norm.recent_low10 != null && !support.some((s) => String(s).includes('10日'))) {
      support.push('10日低點 ' + Math.round(norm.recent_low10));
    }
    if (norm.prev_high20 != null && !resistance.some((s) => String(s).includes('前高'))) {
      resistance.push('20日前高 ' + Math.round(norm.prev_high20));
    }
    if (norm.boll_ub != null && !resistance.some((s) => String(s).includes('BOLL上'))) {
      resistance.push('BOLL上緣 ' + Math.round(norm.boll_ub));
    }
    if (norm.boll_lb != null && !support.some((s) => String(s).includes('BOLL下'))) {
      support.push('BOLL下緣 ' + Math.round(norm.boll_lb));
    }
    return { support: support.slice(0, 8), resistance: resistance.slice(0, 8) };
  }

  function analyzeTrend(norm) {
    const close = norm.close;
    const ma5 = norm.ma5;
    const ma10 = norm.ma10;
    const ma20 = norm.ma20;
    const ma60 = norm.ma60;
    const reasons = [];
    let state = '震盪';

    if (!Number.isFinite(close)) {
      return { state: '—', reason: ['收盤價資料不足'] };
    }
    if (Number.isFinite(ma60) && close < ma60) {
      state = '空頭';
      reasons.push('收盤低於 MA60');
    } else if (Number.isFinite(ma20) && close < ma20) {
      state = '轉弱';
      reasons.push('收盤低於 MA20');
    } else if (Number.isFinite(ma20) && close > ma20) {
      const slopeUp = ma20Slope(norm.series);
      if (slopeUp) {
        state = '多頭';
        reasons.push('收盤站上 MA20，且 MA20 上彎');
      } else if (Number.isFinite(ma5) && Number.isFinite(ma10) && ma5 > ma10) {
        state = '轉強';
        reasons.push('收盤站上 MA20，且 MA5 > MA10');
      } else {
        state = '震盪';
        reasons.push('收盤站上 MA20，短均線尚未明確多排');
      }
    }

    return { state, reason: reasons };
  }

  function analyzePosition(norm) {
    const close = norm.close;
    const ma20 = norm.ma20;
    const prevHigh = norm.prev_high20;
    const recentLow = norm.recent_low10;
    const bollUb = norm.boll_ub;
    const bollLb = norm.boll_lb;
    const reasons = [];
    let state = '中位';

    if (!Number.isFinite(close)) {
      return { state: '—', reason: ['價格資料不足'] };
    }

    if (Number.isFinite(bollUb) && (close >= bollUb || isNear(close, bollUb, 1.5))) {
      state = '高位';
      reasons.push('接近或觸及日線 BOLL 上緣');
    } else if (Number.isFinite(bollLb) && (close <= bollLb || isNear(close, bollLb, 1.5))) {
      state = '低位';
      reasons.push('接近或觸及日線 BOLL 下緣');
    } else if (Number.isFinite(prevHigh) && isNear(close, prevHigh, NEAR_PCT)) {
      state = '壓力附近';
      reasons.push('接近 20 日前高壓力');
    } else if (
      (Number.isFinite(ma20) && isNear(close, ma20, NEAR_PCT)) ||
      (Number.isFinite(recentLow) && isNear(close, recentLow, NEAR_PCT))
    ) {
      state = '支撐附近';
      if (Number.isFinite(ma20) && isNear(close, ma20, NEAR_PCT)) {
        reasons.push('接近 MA20 支撐');
      }
      if (Number.isFinite(recentLow) && isNear(close, recentLow, NEAR_PCT)) {
        reasons.push('接近 10 日低點');
      }
    } else if (Number.isFinite(ma20) && close > ma20 * 1.05) {
      state = '高位';
      reasons.push('收盤明顯高於 MA20');
    } else if (Number.isFinite(ma20) && close < ma20 * 0.98) {
      state = '低位';
      reasons.push('收盤低於 MA20 區間');
    } else {
      reasons.push('位於均線與通道中間區');
    }

    return { state, reason: reasons };
  }

  function analyzeExtension(norm) {
    const close = norm.close;
    const dist = num(norm.distance_ma20_pct, null);
    const bollUb = norm.boll_ub;
    const wBollUb = norm.w_boll_ub;
    const reasons = [];
    let state = '正常';

    if (!Number.isFinite(close)) {
      return { state: '—', reason: ['價格資料不足'] };
    }

    if (Number.isFinite(bollUb) && close >= bollUb) {
      state = '過熱';
      reasons.push('收盤觸及或突破日線 BOLL 上緣');
    } else if (Number.isFinite(dist) && dist > 10) {
      state = '過熱';
      reasons.push('距 MA20 超過 10%');
    } else if (Number.isFinite(wBollUb) && close >= wBollUb * BOLL_NEAR) {
      state = '過熱';
      reasons.push('接近或觸及週線 BOLL 上緣');
    } else if (Number.isFinite(dist) && dist >= 5 && dist <= 10) {
      state = '偏熱';
      reasons.push('距 MA20 約 ' + dist.toFixed(1) + '%');
    } else if (Number.isFinite(bollUb) && close >= bollUb * BOLL_NEAR) {
      state = '偏熱';
      reasons.push('接近日線 BOLL 上緣');
    } else {
      reasons.push('距 MA20 偏離在正常範圍');
    }

    return { state, reason: reasons };
  }

  function analyzeVolume(norm) {
    const vr = norm.volume_ratio;
    const reasons = [];
    let state = '中性';

    if (!Number.isFinite(vr)) {
      return { state, reason: ['量能比資料不足'] };
    }
    if (vr < 0.8) {
      state = '量縮';
      reasons.push('量比 ' + vr.toFixed(2) + '，低於 0.8');
    } else if (vr >= 1.3 && vr <= 3) {
      state = '健康放大';
      reasons.push('量比 ' + vr.toFixed(2) + '，介於 1.3～3');
    } else if (vr > 3) {
      state = '爆量';
      reasons.push('量比 ' + vr.toFixed(2) + '，高於 3');
    } else {
      reasons.push('量比 ' + vr.toFixed(2) + '，未達明顯放大或縮量');
    }

    return { state, reason: reasons };
  }

  function collectWarnings(norm) {
    const warnings = [];
    const close = norm.close;
    const dist = num(norm.distance_ma20_pct, null);
    const upper = num(norm.upper_shadow_ratio, null);
    const consec = num(norm.consecutive_up, 0);
    const bollUb = norm.boll_ub;
    const wBollUb = norm.w_boll_ub;

    if (!Number.isFinite(close)) return warnings;

    if (upper > 0.35) warnings.push('長上影，上影比例 ' + (upper * 100).toFixed(0) + '%');
    if (consec >= 3) warnings.push('連續上漲 ' + consec + ' 日');
    if (Number.isFinite(dist) && dist > 10) warnings.push('距離 MA20 超過 10%');
    if (Number.isFinite(bollUb) && close >= bollUb * BOLL_NEAR) {
      warnings.push('接近日線 BOLL 上緣');
    }
    if (Number.isFinite(wBollUb) && close >= wBollUb * BOLL_NEAR) {
      warnings.push('接近週線 BOLL 上緣');
    }

    const preset = arr(norm.analysis.warnings);
    preset.forEach((w) => {
      if (w && !warnings.includes(w)) warnings.push(w);
    });

    return warnings;
  }

  function collectLabels(trend, position, extension, volume, norm) {
    const labels = [];
    if (trend.state === '多頭' || trend.state === '轉強') labels.push('趨勢偏多');
    if (position.state === '支撐附近') labels.push('靠近支撐');
    if (position.state === '壓力附近') labels.push('靠近壓力');
    if (extension.state === '偏熱') labels.push('延伸偏熱');
    if (extension.state === '過熱') labels.push('延伸過熱');
    if (volume.state === '健康放大') labels.push('量能健康放大');
    if (volume.state === '爆量') labels.push('爆量警示');
    if (volume.state === '量縮') labels.push('量縮');

    arr(norm.analysis.labels).forEach((l) => {
      if (l && !labels.includes(l)) labels.push(l);
    });

    return labels.slice(0, 12);
  }

  function scoreTrend(trend) {
    const map = { 多頭: 88, 轉強: 72, 震盪: 50, 轉弱: 32, 空頭: 15 };
    return map[trend.state] ?? 50;
  }

  function scorePosition(position) {
    const map = { 低位: 35, 支撐附近: 55, 中位: 50, 高位: 72, 壓力附近: 78 };
    return map[position.state] ?? 50;
  }

  function scoreExtension(extension) {
    const map = { 正常: 35, 偏熱: 68, 過熱: 85 };
    return map[extension.state] ?? 50;
  }

  function scoreRisk(warnings, extension) {
    let base = 25 + warnings.length * 12;
    if (extension.state === '過熱') base += 20;
    else if (extension.state === '偏熱') base += 10;
    return Math.min(100, Math.max(0, base));
  }

  function buildSummary(norm, trend, position, extension, warnings) {
    if (norm.analysis && norm.analysis.summary) {
      return norm.analysis.summary;
    }
    const parts = [
      '趨勢「' + trend.state + '」',
      '位置「' + position.state + '」',
      '延伸「' + extension.state + '」',
    ];
    if (warnings.length) {
      parts.push('注意：' + warnings.slice(0, 2).join('、'));
    } else {
      parts.push('暫無顯著過熱警示');
    }
    return parts.join('；') + '。';
  }

  function analyze(record) {
    const norm = normalizeRecord(record);
    if (!norm) {
      throw new Error('TechnicalEngine.analyze 需要有效 record');
    }

    const trend = analyzeTrend(norm);
    const position = analyzePosition(norm);
    const extension = analyzeExtension(norm);
    const volume = analyzeVolume(norm);
    const supportResistance = buildSupportResistance(norm);
    const warnings = collectWarnings(norm);
    const labels = collectLabels(trend, position, extension, volume, norm);

    const scores = {
      trend: scoreTrend(trend),
      position: scorePosition(position),
      extension: scoreExtension(extension),
      risk: scoreRisk(warnings, extension),
    };

    return {
      trend,
      position,
      extension,
      volume,
      supportResistance,
      warnings,
      labels,
      scores,
      summary: buildSummary(norm, trend, position, extension, warnings),
      meta: {
        code: norm.code,
        name: norm.name,
        close: norm.close,
        as_of: norm.as_of,
      },
      normalized: norm,
    };
  }

  function findRecord(pool, query) {
    if (!pool || !query) return null;
    const q = String(query).trim();
    const qUpper = q.toUpperCase();
    const records = pool.records || pool;
    if (!Array.isArray(records)) return null;

    const hit =
      records.find((r) => String(r.code).toUpperCase() === qUpper) ||
      records.find((r) => String(r.name || '').includes(q)) ||
      null;

    return hit ? normalizeRecord(hit) : null;
  }

  /** 相對目標價的偏離百分比：(close - target) / target * 100 */
  function relPct(close, target) {
    if (!Number.isFinite(close) || !Number.isFinite(target) || target === 0) return null;
    return ((close - target) / target) * 100;
  }

  /** 接近目標（在 target 下方 0～pct% 或已達/超過） */
  function nearBelow(close, target, pct) {
    if (!Number.isFinite(close) || !Number.isFinite(target)) return false;
    const d = relPct(close, target);
    return d != null && d >= -pct && d <= 0;
  }

  function makeScanItem(norm, analysis, reason, extra) {
    const item = {
      code: norm.code,
      name: norm.name,
      close: norm.close,
      change_pct: norm.change_pct,
      reason,
      labels: (analysis.labels || []).slice(0, 4),
      scores: { ...analysis.scores },
    };
    if (extra && extra.morphologyType) {
      item.morphologyType = extra.morphologyType;
      item.morphologyState = extra.morphologyState;
      item.morphologyConfidence = extra.morphologyConfidence;
      item.measuredLabel = extra.measuredLabel;
      item.measuredExtension = extra.measuredExtension;
    }
    if (extra && extra.riskConditionCount != null) {
      item.riskConditionCount = extra.riskConditionCount;
    }
    return item;
  }

  /** 高風險延伸條件計數（與 scanner 一致） */
  function countHighRiskConditions(norm) {
    const close = norm.close;
    const parts = [];
    let count = 0;

    if (Number.isFinite(norm.distance_ma20_pct) && norm.distance_ma20_pct > 10) {
      count += 1;
      parts.push('距 MA20 過遠');
    }
    if (Number.isFinite(norm.boll_ub) && close >= norm.boll_ub) {
      count += 1;
      parts.push('接近 BOLL 上緣');
    }
    if (Number.isFinite(norm.w_boll_ub) && close >= norm.w_boll_ub) {
      count += 1;
      parts.push('接近週線 BOLL 上緣');
    }
    if (norm.upper_shadow_ratio > 0.35) {
      count += 1;
      parts.push('長上影');
    }
    if (norm.consecutive_up >= 3) {
      count += 1;
      parts.push('連續上漲');
    }
    if (Number.isFinite(norm.volume_ratio) && norm.volume_ratio > 3) {
      count += 1;
      parts.push('爆量');
    }

    return { count, parts };
  }

  function hasLabel(analysis, text) {
    return (analysis.labels || []).some((l) => String(l).includes(text));
  }

  /** 機會型 bucket 排除：過熱 / 高位延伸 */
  function isTooHotForOpportunity(norm, analysis, riskFlags) {
    const close = norm.close;
    return (
      analysis.extension.state === '過熱' ||
      hasLabel(analysis, '延伸過熱') ||
      (Number.isFinite(norm.boll_ub) && close >= norm.boll_ub) ||
      (Number.isFinite(norm.w_boll_ub) && close >= norm.w_boll_ub) ||
      (Number.isFinite(norm.distance_ma20_pct) && norm.distance_ma20_pct > 10) ||
      norm.upper_shadow_ratio > 0.35 ||
      riskFlags.count >= 2 ||
      analysis.scores.risk >= 85
    );
  }

  function lastDayChangePct(norm) {
    const s = norm.series;
    if (!s || s.length < 2) return null;
    const last = s[s.length - 1].close;
    const prev = s[s.length - 2].close;
    if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return null;
    return (last / prev - 1) * 100;
  }

  const SCANNER_OPPORTUNITY_KEYS = [
    'bullishTrend',
    'nearBreakout',
    'nearSupport',
    'healthyVolume',
  ];
  const SCANNER_RISK_KEYS = ['extendedHot', 'bollRisk', 'highRiskExtension'];

  const SCANNER_BUCKETS = [
    { key: 'bullishTrend', title: '趨勢偏多', desc: '站上 MA20、短均線偏多，且尚未觸及 BOLL 上緣。' },
    { key: 'nearBreakout', title: '接近突破', desc: '接近 20 日前高，觀察是否有效突破。' },
    { key: 'nearSupport', title: '支撐附近', desc: '回到 MA20、近期低點或 BOLL 下緣附近的技術支撐區。' },
    { key: 'healthyVolume', title: '健康放量', desc: '量能放大但未達爆量，價量結構仍屬健康。' },
    { key: 'extendedHot', title: '延伸偏熱', desc: '距 MA20 已拉開或連漲，短線追價風險升高。' },
    { key: 'bollRisk', title: 'BOLL 風險', desc: '接近日線或週線 BOLL 上緣，需留意延伸風險。' },
    { key: 'highRiskExtension', title: '高風險延伸', desc: '多項過熱條件同時出現，不宜以新進追價角度解讀。' },
  ];

  function classifyRecord(norm, analysis) {
    const close = norm.close;
    const ma5 = norm.ma5;
    const ma10 = norm.ma10;
    const ma20 = norm.ma20;
    const ma60 = norm.ma60;
    const bollUb = norm.boll_ub;
    const bollLb = norm.boll_lb;
    const wBollUb = norm.w_boll_ub;
    const prevHigh = norm.prev_high20;
    const recentLow = norm.recent_low10;
    const vr = norm.volume_ratio;
    const distMa20 = norm.distance_ma20_pct;
    const upper = norm.upper_shadow_ratio;
    const consec = norm.consecutive_up;
    const scores = analysis.scores;
    const trend = analysis.trend;
    const extension = analysis.extension;

    const hits = {
      bullishTrend: false,
      nearBreakout: false,
      nearSupport: false,
      healthyVolume: false,
      extendedHot: false,
      bollRisk: false,
      highRiskExtension: false,
    };
    const reasons = {};
    const sortKeys = {};

    if (!Number.isFinite(close)) return { hits, reasons, sortKeys, extras: {} };

    const riskFlags = countHighRiskConditions(norm);
    const tooHot = isTooHotForOpportunity(norm, analysis, riskFlags);
    const dayChg = lastDayChangePct(norm);

    const nearDailyBoll =
      Number.isFinite(bollUb) &&
      (close >= bollUb ||
        (relPct(close, bollUb) != null &&
          relPct(close, bollUb) >= -3 &&
          relPct(close, bollUb) <= 3));
    const nearWeeklyBoll =
      Number.isFinite(wBollUb) &&
      (close >= wBollUb ||
        (relPct(close, wBollUb) != null &&
          relPct(close, wBollUb) >= -3 &&
          relPct(close, wBollUb) <= 3));

    const extHot =
      (Number.isFinite(distMa20) && distMa20 >= 5 && distMa20 <= 10) ||
      extension.state === '偏熱' ||
      consec >= 3;

    const extras = {};

    // G. 高風險延伸（先算，供其他 bucket 排除）
    if (riskFlags.count >= 2) {
      hits.highRiskExtension = true;
      const main =
        riskFlags.parts.length > 0
          ? riskFlags.parts.join('、') + '。'
          : '多項過熱條件同時出現，不適合以新進追價角度解讀。';
      reasons.highRiskExtension = main;
      sortKeys.highRiskExtension = riskFlags.count;
      extras.highRiskExtension = { riskConditionCount: riskFlags.count };
    }

    // F. BOLL 風險
    if (nearDailyBoll || nearWeeklyBoll) {
      hits.bollRisk = true;
      reasons.bollRisk = '接近日線或週線 BOLL 上緣，需留意延伸風險。';
      const d1 = Number.isFinite(bollUb) ? Math.abs(relPct(close, bollUb)) : 999;
      const d2 = Number.isFinite(wBollUb) ? Math.abs(relPct(close, wBollUb)) : 999;
      sortKeys.bollRisk = Math.min(d1, d2);
    }

    // E. 延伸偏熱
    if (extHot) {
      hits.extendedHot = true;
      reasons.extendedHot = '距 MA20 已有一段距離，短線追價風險升高。';
      sortKeys.extendedHot = Number.isFinite(distMa20) ? distMa20 : 5;
    }

    // A. 趨勢偏多（排除過熱與高風險）
    if (
      Number.isFinite(ma20) &&
      close > ma20 &&
      Number.isFinite(ma5) &&
      Number.isFinite(ma10) &&
      ma5 >= ma10 &&
      scores.trend >= 70 &&
      !tooHot &&
      !hits.highRiskExtension
    ) {
      hits.bullishTrend = true;
      reasons.bullishTrend = '收盤站上 MA20，短均線維持多頭排列。';
      sortKeys.bullishTrend = scores.trend;
    }

    // B. 接近突破（可含高位，但 reason / 排序降權）
    if (Number.isFinite(prevHigh) && Number.isFinite(ma20) && close > ma20) {
      const dHigh = relPct(close, prevHigh);
      if (dHigh != null && dHigh >= -3 && dHigh <= 1) {
        hits.nearBreakout = true;
        const breakoutRisky =
          hits.bollRisk ||
          hits.extendedHot ||
          hits.highRiskExtension ||
          extension.state === '過熱' ||
          extension.state === '偏熱' ||
          riskFlags.count >= 2;
        reasons.nearBreakout = breakoutRisky
          ? '接近 20 日前高，但已進入延伸區，突破觀察需降權。'
          : '接近 20 日前高，仍需觀察是否有效突破。';
        sortKeys.nearBreakout = {
          tier: breakoutRisky ? 1 : 0,
          dist: Math.abs(dHigh),
        };
      }
    }

    // C. 支撐附近（排除破線轉弱）
    const nearMa20 =
      Number.isFinite(ma20) && Math.abs(relPct(close, ma20)) <= 3;
    const nearLow =
      Number.isFinite(recentLow) &&
      close >= recentLow &&
      relPct(close, recentLow) != null &&
      relPct(close, recentLow) >= 0 &&
      relPct(close, recentLow) <= 5;
    const nearBollLbZone =
      Number.isFinite(bollLb) &&
      close >= bollLb &&
      relPct(close, bollLb) != null &&
      relPct(close, bollLb) >= 0 &&
      relPct(close, bollLb) <= 5;

    const supportExclude =
      (Number.isFinite(ma60) && close < ma60) ||
      trend.state === '空頭' ||
      (Number.isFinite(bollLb) && close < bollLb) ||
      (dayChg != null && dayChg < -7 && Number.isFinite(ma20) && close <= ma20);

    if ((nearMa20 || nearLow || nearBollLbZone) && !supportExclude) {
      hits.nearSupport = true;
      reasons.nearSupport =
        '股價回到 MA20 / 近期低點附近，屬技術支撐觀察區。';
      const dists = [];
      if (nearMa20) dists.push(Math.abs(relPct(close, ma20)));
      if (nearLow) dists.push(Math.abs(relPct(close, recentLow)));
      if (nearBollLbZone) dists.push(Math.abs(relPct(close, bollLb)));
      sortKeys.nearSupport = Math.min.apply(null, dists);
    }

    // D. 健康放量（排除過熱）
    if (
      Number.isFinite(vr) &&
      vr >= 1.3 &&
      vr <= 3 &&
      Number.isFinite(ma20) &&
      close > ma20 &&
      !tooHot &&
      !hits.highRiskExtension
    ) {
      hits.healthyVolume = true;
      reasons.healthyVolume = '量能放大但未達爆量，價量結構仍屬健康。';
      sortKeys.healthyVolume = vr;
    }

    return { hits, reasons, sortKeys, extras };
  }

  function scan(poolOrRecords, asOf) {
    const records = Array.isArray(poolOrRecords)
      ? poolOrRecords
      : poolOrRecords && poolOrRecords.records
        ? poolOrRecords.records
        : [];
    const as_of =
      asOf ||
      (poolOrRecords && poolOrRecords.as_of) ||
      (records[0] && normalizeRecord(records[0])?.as_of) ||
      '';

    const buckets = {
      bullishTrend: [],
      nearBreakout: [],
      nearSupport: [],
      healthyVolume: [],
      extendedHot: [],
      bollRisk: [],
      highRiskExtension: [],
    };

    records.forEach((raw) => {
      const norm = normalizeRecord(raw);
      if (!norm || !Number.isFinite(norm.close)) return;

      let analysis;
      try {
        analysis = analyze(raw);
      } catch (e) {
        return;
      }

      const { hits, reasons, sortKeys, extras } = classifyRecord(norm, analysis);
      const morph = detectMorphology(raw);
      const mm = morph.measuredMove || {};
      const measuredLabel = localizeMeasureLabel(mm);
      const fibUi =
        morph.fibExtensions && morph.fibExtensions.length
          ? morph.fibExtensions
              .map((f) => localizeFibUiLine(f))
              .filter(Boolean)
              .join('、')
          : '';

      SCANNER_BUCKETS.forEach(({ key }) => {
        if (!hits[key]) return;
        buckets[key].push({
          item: makeScanItem(
            norm,
            analysis,
            reasons[key],
            Object.assign({}, extras[key], {
              morphologyType: morph.primary.type,
              morphologyState: morph.primary.state,
              morphologyConfidence: morph.primary.confidence,
              measuredLabel: measuredLabel,
              measuredExtension: mm.currentExtensionPct,
              fibUi: fibUi,
              trendState: analysis.trend && analysis.trend.state,
              volumeState: analysis.volume && analysis.volume.state,
              extensionState: analysis.extension && analysis.extension.state,
            })
          ),
          sortKey: sortKeys[key],
        });
      });
    });

    buckets.bullishTrend.sort((a, b) => b.sortKey - a.sortKey);
    buckets.nearBreakout.sort((a, b) => {
      const ta = a.sortKey.tier != null ? a.sortKey.tier : 0;
      const tb = b.sortKey.tier != null ? b.sortKey.tier : 0;
      if (ta !== tb) return ta - tb;
      return a.sortKey.dist - b.sortKey.dist;
    });
    buckets.nearSupport.sort((a, b) => a.sortKey - b.sortKey);
    buckets.healthyVolume.sort((a, b) => b.sortKey - a.sortKey);
    buckets.extendedHot.sort((a, b) => b.sortKey - a.sortKey);
    buckets.bollRisk.sort((a, b) => a.sortKey - b.sortKey);
    buckets.highRiskExtension.sort((a, b) => b.sortKey - a.sortKey);

    const trimmed = {};
    SCANNER_BUCKETS.forEach(({ key }) => {
      trimmed[key] = buckets[key].slice(0, 8).map((x) => x.item);
    });

    return {
      as_of,
      total: records.length,
      buckets: trimmed,
      opportunityKeys: SCANNER_OPPORTUNITY_KEYS,
      riskKeys: SCANNER_RISK_KEYS,
    };
  }


const MORPH_MIN_BARS = 120;
const MORPH_LOOKBACK = 180;

function getMorphSeries(record) {
  const norm = normalizeRecord(record);
  if (!norm || !norm.series) {
    return { norm, series: [], meta: { length: 0, sufficient: false, lookback: 0 } };
  }
  const all = norm.series.filter((r) => r.close != null);
  const lookback = Math.min(MORPH_LOOKBACK, all.length);
  const series = all.slice(-lookback);
  return {
    norm,
    series,
    meta: { length: all.length, lookback: series.length, sufficient: all.length >= MORPH_MIN_BARS },
  };
}

function getSeries(record) {
  return getMorphSeries(record);
}

function countConsecutiveCandles(series) {
  const out = {
    upCloses: 0,
    downCloses: 0,
    greenCandles: 0,
    redCandles: 0,
    consecutiveHigherHighs: 0,
    consecutiveLowerLows: 0,
  };
  if (!series || series.length < 2) return out;
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i].close > series[i - 1].close) out.upCloses++;
    else break;
  }
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i].close < series[i - 1].close) out.downCloses++;
    else break;
  }
  for (let i = series.length - 1; i >= 0; i--) {
    const o = series[i].open != null ? series[i].open : series[i].close;
    if (series[i].close >= o) out.greenCandles++;
    else break;
  }
  for (let i = series.length - 1; i >= 0; i--) {
    const o = series[i].open != null ? series[i].open : series[i].close;
    if (series[i].close < o) out.redCandles++;
    else break;
  }
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i].high > series[i - 1].high) out.consecutiveHigherHighs++;
    else break;
  }
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i].low < series[i - 1].low) out.consecutiveLowerLows++;
    else break;
  }
  return out;
}

function findSwingHighs(series, window) {
  const w = window || 3;
  const out = [];
  for (let i = w; i < series.length - w; i++) {
    const h = series[i].high;
    let ok = true;
    for (let j = 1; j <= w; j++) {
      if (series[i - j].high >= h || series[i + j].high >= h) ok = false;
    }
    if (ok) out.push({ index: i, price: h });
  }
  return out;
}

function findSwingLows(series, window) {
  const w = window || 3;
  const out = [];
  for (let i = w; i < series.length - w; i++) {
    const l = series[i].low;
    let ok = true;
    for (let j = 1; j <= w; j++) {
      if (series[i - j].low <= l || series[i + j].low <= l) ok = false;
    }
    if (ok) out.push({ index: i, price: l });
  }
  return out;
}

function linearRegression(points) {
  if (!points || points.length < 2) return null;
  const n = points.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  points.forEach((p) => {
    sx += p.index;
    sy += p.price;
    sxx += p.index * p.index;
    sxy += p.index * p.price;
  });
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function relPct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return ((a - b) / b) * 100;
}

function averageVolume(series, start, end) {
  const s = Math.max(0, start);
  const e = Math.min(series.length, end);
  let sum = 0;
  let n = 0;
  for (let i = s; i < e; i++) {
    sum += series[i].volume || 0;
    n++;
  }
  return n ? sum / n : 0;
}

function bollBandwidthAt(row) {
  const ub = row.boll_ub;
  const lb = row.boll_lb;
  const mid = row.ma20 || (ub + lb) / 2;
  if (!Number.isFinite(ub) || !Number.isFinite(lb) || !mid) return null;
  return (ub - lb) / mid;
}

function recentRange(series, length) {
  const tail = series.slice(-length);
  if (!tail.length) return null;
  const highs = tail.map((r) => r.high);
  const lows = tail.map((r) => r.low);
  const high = Math.max.apply(null, highs);
  const low = Math.min.apply(null, lows);
  return { high, low, width: high - low, start: series.length - length };
}

function linePriceAt(reg, index) {
  if (!reg) return null;
  return reg.slope * index + reg.intercept;
}

function emptyMorphology(summary) {
  return {
    primary: {
      type: '無明確形態',
      state: '無明確狀態',
      confidence: 0,
      summary: summary || '目前沒有足夠明確的形態學結構。',
      reasons: [],
      annotations: [],
    },
    secondary: [],
    structure: {},
    measuredMove: {
      direction: null,
      baseStartIndex: null,
      baseEndIndex: null,
      breakoutIndex: null,
      baseLow: null,
      baseHigh: null,
      measuredPct: null,
      currentExtensionPct: null,
      targets: [],
    },
    fibExtensions: [],
    candleStats: countConsecutiveCandles([]),
    dataMeta: { sufficient: false },
    diagnostics: {
      swingHighs: [],
      swingLows: [],
      rangeCompression: null,
      volumeCompression: null,
      slopeHigh: null,
      slopeLow: null,
    },
  };
}

function buildDiagnostics(series, norm) {
  const swingHighs = findSwingHighs(series, 3);
  const swingLows = findSwingLows(series, 3);
  const recent = recentRange(series, 20);
  const prior = recentRange(series.slice(0, -20), 20);
  let rangeCompression = null;
  if (recent && prior && prior.width > 0) {
    rangeCompression = recent.width / prior.width;
  }
  const volRecent = averageVolume(series, series.length - 15, series.length);
  const volPrior = averageVolume(series, series.length - 35, series.length - 15);
  const volumeCompression = volPrior > 0 ? volRecent / volPrior : null;
  const hiPts = swingHighs.slice(-3);
  const loPts = swingLows.slice(-3);
  return {
    swingHighs,
    swingLows,
    rangeCompression,
    volumeCompression,
    slopeHigh: hiPts.length >= 2 ? linearRegression(hiPts) : null,
    slopeLow: loPts.length >= 2 ? linearRegression(loPts) : null,
  };
}

const MORPH_PRIORITY = [
  '假突破風險',
  '杯柄型態',
  '上升通道',
  '下降通道',
  '反彈旗形',
  '下降壓力線突破',
  '平台突破',
  '三角收斂',
  'BOLL壓縮',
  'U型底',
  '圓弧底',
  '箱型整理',
  '無明確形態',
];

const MORPH_CATEGORY = {
  假突破風險: 'risk',
  杯柄型態: 'structure',
  上升通道: 'structure',
  下降通道: 'structure',
  下降壓力線突破: 'structure',
  平台突破: 'structure',
  反彈旗形: 'structure',
  三角收斂: 'structure',
  BOLL壓縮: 'structure',
  U型底: 'structure',
  圓弧底: 'structure',
  箱型整理: 'structure',
};

function barUpperShadowRatio(bar) {
  const span = Math.max(0.01, bar.high - bar.low);
  return (bar.high - Math.max(bar.open, bar.close)) / span;
}

function maxHandlePullForCupQuality(depthPct) {
  if (depthPct > 0.48) return 0.5;
  if (depthPct < 0.12) return 0.58;
  return Math.min(0.7, 0.38 + depthPct * 0.8);
}

function computeCupQuality(ctx) {
  const {
    leftRimIdx,
    cupLowIdx,
    rightRimIdx,
    leftRim,
    cupLow,
    rightRim,
    neckline,
    depthPct,
    handlePull,
    cupEnd,
  } = ctx;
  const cupSpan = Math.max(1, rightRimIdx - leftRimIdx);
  const leftDist = cupLowIdx - leftRimIdx;
  const rightDist = rightRimIdx - cupLowIdx;
  const rimDistanceScore = Math.min(
    1,
    Math.min(leftDist, rightDist) / Math.max(4, cupSpan * 0.14)
  );
  let depthScore = 0.35;
  if (depthPct >= 0.18 && depthPct <= 0.42) depthScore = 1;
  else if (depthPct >= 0.12 && depthPct <= 0.48) depthScore = 0.85;
  else if (depthPct >= 0.10 && depthPct <= 0.52) depthScore = 0.72;
  else if (depthPct >= 0.08 && depthPct <= 0.55) depthScore = 0.55;
  else if (depthPct > 0.55) depthScore = 0.35;
  const symmetryScore =
    leftRim > cupLow * 1.03 && rightRim > cupLow * 1.03 && rightRim >= leftRim * 0.82
      ? 1
      : 0.45;
  const necklineScore = rightRim >= neckline * 0.88 && leftRim >= neckline * 0.82 ? 1 : 0.55;
  let handleScore = 0.35;
  const handlePullCap = depthPct < 0.2 ? 0.62 : depthPct < 0.35 ? 0.58 : 0.5;
  if (handlePull <= 0.28) handleScore = 1;
  else if (handlePull <= 0.42) handleScore = 0.75;
  else if (handlePull <= handlePullCap) handleScore = 0.5;
  else if (handlePull <= maxHandlePullForCupQuality(depthPct)) handleScore = 0.38;
  const bowlQuality =
    rimDistanceScore * 0.28 +
    depthScore * 0.24 +
    symmetryScore * 0.22 +
    necklineScore * 0.14 +
    handleScore * 0.12;
  return {
    bowlQuality: Math.round(bowlQuality * 1000) / 1000,
    rimDistanceScore: Math.round(rimDistanceScore * 100) / 100,
    depthScore: Math.round(depthScore * 100) / 100,
    handleScore: Math.round(handleScore * 100) / 100,
    necklineScore: Math.round(necklineScore * 100) / 100,
    symmetryScore: Math.round(symmetryScore * 100) / 100,
  };
}

function computeMorphRankScore(c, allCandidates) {
  let score = c.confidence || 0;
  const all = allCandidates || [];
  if (c.type === '假突破風險') {
    score += 14;
    if ((c.riskSignals || 0) >= 2) score += 10;
    if ((c.riskSignals || 0) >= 3) score += 6;
  }
  if (c.type === '杯柄型態') {
    const bq = c.quality && c.quality.bowlQuality != null ? c.quality.bowlQuality : 0;
    score += bq * 34;
    if (bq >= 0.58 && (c.confidence || 0) >= 78) score += 12;
    if (bq < 0.58) score -= 28;
    if (bq < 0.55) score -= 35;
    if ((c.confidence || 0) < 78) score -= 18;
  }
  if (c.type === '上升通道' || c.type === '下降通道') {
    const cup = all.find((x) => x.type === '杯柄型態');
    if (cup && (cup.confidence || 0) >= 78) {
      const bq = cup.quality && cup.quality.bowlQuality != null ? cup.quality.bowlQuality : 0;
      const q = cup.quality || {};
      if (
        bq >= 0.58 &&
        q.depthScore >= 0.45 &&
        q.rimDistanceScore >= 0.45 &&
        (c.confidence || 0) <= 70
      ) {
        score -= 38;
      } else if (bq >= 0.65 && (cup.confidence || 0) >= 85) {
        score -= 30;
      }
    }
  }
  if (c.type === '下降壓力線突破' && (c.state === '突破後回測' || c.state === '回測支撐')) {
    score += 8;
  }
  return Math.round(score * 10) / 10;
}

function enrichMorphCandidate(c, allCandidates) {
  if (!c) return c;
  c.category = MORPH_CATEGORY[c.type] || 'structure';
  c.rankScore = computeMorphRankScore(c, allCandidates);
  return c;
}

function cupMeetsChannelPriorityThreshold(cup) {
  if (!cup || cup.type !== '杯柄型態') return false;
  const q = cup.quality || {};
  const conf = cup.confidence || 0;
  const bq = q.bowlQuality != null ? q.bowlQuality : 0;
  if (conf < 78 || bq < 0.55) return false;
  if (bq < 0.58) return false;
  if ((q.depthScore || 0) < 0.45 && bq < 0.62) return false;
  if ((q.rimDistanceScore || 0) < 0.45 && bq < 0.62) return false;
  if ((q.necklineScore || 0) < 0.45 && bq < 0.62) return false;
  if ((q.handleScore || 0) < 0.35 && bq < 0.62) return false;
  return true;
}

function cupBeatsOrdinaryChannel(bestCup, bestChannel) {
  if (!bestCup || !bestChannel) return false;
  if (!cupMeetsChannelPriorityThreshold(bestCup)) return false;
  const chConf = bestChannel.confidence || 0;
  const cupConf = bestCup.confidence || 0;
  const bq = bestCup.quality.bowlQuality;
  if (
    bestChannel.state === '通道突破' &&
    chConf >= 78 &&
    bq < 0.65
  ) {
    return false;
  }
  if (chConf <= 70 && cupConf >= 78 && bq >= 0.58) return true;
  return cupConf >= chConf + 6 && bq >= 0.58;
}

function pickMorphologyPrimary(candidates, norm, series) {
  if (!candidates.length) return null;
  const all = candidates.map((c) => enrichMorphCandidate(Object.assign({}, c), candidates));
  all.sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0));

  const bestRisk = all.find((c) => c.type === '假突破風險');
  const cups = all
    .filter((c) => c.type === '杯柄型態')
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const bestCup = cups[0];
  const channels = all
    .filter((c) => c.type === '上升通道' || c.type === '下降通道')
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const bestChannel = channels[0];
  const bestDesc = all.find((c) => c.type === '下降壓力線突破');

  const cupBq =
    bestCup && bestCup.quality && bestCup.quality.bowlQuality != null
      ? bestCup.quality.bowlQuality
      : 0;
  const cupConf = bestCup ? bestCup.confidence || 0 : 0;
  const highCup = bestCup && cupConf >= 85 && cupBq >= 0.65;
  const qualityCup =
    bestCup && cupConf >= 78 && cupBq >= 0.58 && cupMeetsChannelPriorityThreshold(bestCup);

  const pressure = norm && num(norm.prev_high20, null);
  const close = norm && norm.close;
  let priorHighRejection = false;
  if (Number.isFinite(pressure) && Number.isFinite(close) && close <= pressure * 1.02 && series) {
    for (let i = Math.max(0, series.length - 8); i < series.length; i++) {
      const bar = series[i];
      if (bar.high >= pressure * 0.992 && bar.close < pressure * 1.003) {
        priorHighRejection = true;
        break;
      }
    }
  }

  const cupNeck = bestCup && bestCup.structure ? bestCup.structure.neckline : null;
  const cupAboveNeck =
    Number.isFinite(cupNeck) && Number.isFinite(close) && close > cupNeck * 1.01;
  const belowPriorHigh =
    Number.isFinite(pressure) && Number.isFinite(close) && close < pressure * 0.99;
  const cupBreakoutState =
    bestCup &&
    (bestCup.state === '突破延伸' ||
      (bestCup.state === '頸線突破' && !belowPriorHigh) ||
      (bestCup.state === '頸線附近' && !belowPriorHigh));
  const highQualityBreakout =
    bestCup &&
    cupAboveNeck &&
    cupConf >= 85 &&
    cupBq >= 0.65 &&
    (bestCup.state === '突破延伸' || (!belowPriorHigh && cupBreakoutState));

  if (!bestCup && bestChannel && bestRisk) {
    if ((bestRisk.riskSignals || 0) < 2 || (bestRisk.confidence || 0) < 76) {
      return bestChannel;
    }
  }

  if (bestRisk && (bestRisk.confidence || 0) >= 65) {
    const weakCup = !bestCup || cupConf < 88 || cupBq < 0.65;
    const riskWins =
      (weakCup && !highQualityBreakout) ||
      (priorHighRejection && belowPriorHigh && !highQualityBreakout) ||
      ((bestRisk.rankScore || 0) >= (bestCup ? bestCup.rankScore || 0 : 0) + 8 &&
        !highQualityBreakout);
    if (riskWins) return bestRisk;
  }

  if (highQualityBreakout) return bestCup;
  if (bestCup && bestChannel && cupBeatsOrdinaryChannel(bestCup, bestChannel)) {
    return bestCup;
  }
  if (highCup) {
    if (!bestChannel || cupConf >= (bestChannel.confidence || 0) + 2) return bestCup;
  }
  if (qualityCup && bestChannel && (bestChannel.confidence || 0) <= 70) return bestCup;
  if (qualityCup && bestChannel && (bestChannel.confidence || 0) < 88) return bestCup;

  if (
    bestDesc &&
    (bestDesc.state === '突破後回測' || bestDesc.state === '回測支撐') &&
    (bestDesc.confidence || 0) >= 62
  ) {
    if (!bestCup || cupBq < 0.72 || cupConf < 88) return bestDesc;
  }

  return all[0];
}

function pickMorphologySecondary(primary, candidates, cupLike) {
  const sec = [];
  const seen = new Set();
  candidates.forEach((c) => {
    if (!c || c.type === primary.type || seen.has(c.type)) return;
    if (primary.type === '假突破風險' && (c.type === '杯柄型態' || c.type === '杯型底雛形')) return;
    if (primary.type === '杯柄型態' && (c.type === '上升通道' || c.type === '下降通道')) {
      seen.add(c.type);
      sec.push({ type: c.type, state: c.state, confidence: c.confidence });
      return;
    }
    if (
      (primary.type === '上升通道' || primary.type === '下降通道') &&
      c.type === '杯柄型態'
    ) {
      const bq = c.quality && c.quality.bowlQuality != null ? c.quality.bowlQuality : 0;
      if (bq >= 0.55 && (c.confidence || 0) >= 75) {
        seen.add(c.type);
        sec.push({ type: c.type, state: c.state, confidence: c.confidence });
      }
      return;
    }
    if (sec.length < 3) {
      seen.add(c.type);
      sec.push({ type: c.type, state: c.state, confidence: c.confidence });
    }
  });
  if (
    cupLike &&
    primary.type === '無明確形態' &&
    !seen.has(cupLike.type)
  ) {
    sec.push({
      type: cupLike.type,
      state: cupLike.state,
      confidence: cupLike.confidence,
    });
  }
  return sec.slice(0, 4);
}

function detectFalseBreakout(series, norm, diag) {
  const close = norm.close;
  const pressure = num(norm.prev_high20, null);
  if (!Number.isFinite(pressure)) return null;
  const n = series.length - 1;
  const last = series[n];
  const lookback = Math.min(8, n);
  let failedIdx = -1;
  let failedHigh = pressure;
  let riskSignals = 0;
  let longUpper = norm.upper_shadow_ratio > 0.35;

  for (let i = n - lookback; i <= n; i++) {
    const bar = series[i];
    const broke = bar.high > pressure * 1.002;
    const touched = bar.high >= pressure * 0.992;
    const failedClose = bar.close < pressure;
    const upper = barUpperShadowRatio(bar);
    if ((broke || touched) && (failedClose || upper > 0.28)) {
      failedIdx = i;
      failedHigh = Math.max(failedHigh, bar.high);
      if (failedClose) riskSignals += 1;
      if (upper > 0.28) {
        riskSignals += 1;
        longUpper = true;
      }
      if (touched && failedClose) riskSignals += 1;
    }
  }

  const lastBroke = last.high > pressure * 1.002;
  const lastFailedClose = close < pressure;
  if (lastBroke && (lastFailedClose || longUpper)) {
    failedIdx = n;
    failedHigh = Math.max(failedHigh, last.high);
    if (lastFailedClose) riskSignals += 1;
    if (longUpper) riskSignals += 1;
  }

  const nearRejected =
    close <= pressure * 1.025 &&
    (failedIdx >= 0 || relPct(close, pressure) != null);
  if (failedIdx < 0 || !nearRejected) return null;
  if (riskSignals < 2 && !longUpper) return null;
  if (close > pressure * 1.015 && !longUpper) return null;

  const ann = [
    {
      kind: 'horizontal',
      label: 'prior high',
      price: pressure,
      style: 'prior-high',
      layer: 'primary',
    },
    {
      kind: 'marker',
      label: 'failed breakout',
      index: failedIdx,
      price: failedHigh,
      style: 'failed',
      layer: 'primary',
    },
  ];
  const failBar = series[failedIdx];
  if (longUpper || barUpperShadowRatio(failBar) > 0.3) {
    ann.push({
      kind: 'wick',
      label: 'upper wick',
      index: failedIdx,
      price: failBar.high,
      closePrice: failBar.close,
      layer: 'primary',
    });
    riskSignals += 1;
  }

  let confidence = 65;
  if (longUpper && lastFailedClose) confidence = 78;
  else if (longUpper || lastFailedClose) confidence = 72;
  if (failedIdx < n - 1 && close < pressure) confidence += 4;

  return {
    type: '假突破風險',
    state: '假突破風險',
    category: 'risk',
    confidence: Math.min(88, confidence),
    riskSignals,
    summary: '近期觸及前高壓力後未能有效站穩，伴隨長上影或收盤拒絕，需降權解讀。',
    reasons: [
      '觸及前高壓力',
      close < pressure ? '收盤仍在壓力線下或附近' : '價格未能有效站穩前高',
      longUpper ? '上影比例偏高' : '近期失敗突破',
      failedIdx < n ? '近幾日內曾出現失敗突破' : '',
    ].filter(Boolean),
    annotations: ann,
    structure: { resistance: pressure, neckline: pressure },
  };
}

function touchesLevel(series, level, pct, start, end) {
  let n = 0;
  for (let i = start; i < end; i++) {
    const h = series[i].high;
    if (Number.isFinite(h) && relPct(h, level) != null && Math.abs(relPct(h, level)) <= pct) n++;
  }
  return n;
}

function detectPlatformBreakout(series, norm) {
  const n = series.length;
  const baseStart = Math.max(0, n - 45);
  const look = series.slice(baseStart, n - 1);
  if (look.length < 15) return null;
  const platform = Math.max.apply(null, look.map((r) => r.high));
  const touches = touchesLevel(series, platform, 2.5, baseStart, n - 1);
  if (touches < 3) return null;
  const close = norm.close;
  const dist = relPct(close, platform);
  if (!Number.isFinite(close) || !Number.isFinite(platform) || dist == null || dist < 1) return null;
  if (!Number.isFinite(norm.ma20) || close <= norm.ma20) return null;
  const last = series[n - 1];
  if (last.close < platform && last.high > platform && norm.upper_shadow_ratio > 0.35) return null;
  const state = dist <= 5 ? '已突破' : dist <= 10 ? '突破延伸' : '已突破';
  let summary = '價格收盤站上近期平台壓力，屬平台突破結構。';
  const extended =
    (Number.isFinite(norm.distance_ma20_pct) && norm.distance_ma20_pct > 10) ||
    (norm.boll_ub && close >= norm.boll_ub * 0.97);
  if (extended) summary += '但已進入延伸區，突破品質需降權。';
  let confidence = norm.volume_ratio >= 1.2 ? 72 : 58;
  if (extended) confidence = Math.min(confidence, 62);
  return {
    type: '平台突破',
    state,
    confidence,
    summary,
    reasons: ['至少三次測試平台壓力', '整理區間至少15根', '收盤站上平台壓力', close > norm.ma20 ? '站上 MA20' : ''].filter(Boolean),
    annotations: [
      { kind: 'horizontal', label: '平台壓力線', price: platform, style: 'neckline' },
      { kind: 'marker', label: '突破點', index: n - 1, price: close, style: 'breakout' },
    ],
    structure: { neckline: platform, resistance: platform },
  };
}

function detectDescendingBreakout(series, norm, diag) {
  const hi = diag.swingHighs;
  if (hi.length < 3) return null;
  const pts = hi.slice(-3);
  const reg = linearRegression(pts);
  if (!reg || reg.slope >= -0.02) return null;
  const n = series.length - 1;
  const lineP = linePriceAt(reg, n);
  const close = norm.close;
  if (!Number.isFinite(lineP)) return null;

  const trendAnn = {
    kind: 'trendline',
    label: 'descending resistance',
    points: [
      { index: pts[0].index, price: linePriceAt(reg, pts[0].index) },
      { index: n, price: lineP },
    ],
    style: 'resistance',
    layer: 'primary',
  };

  const lookback = 8;
  let breakoutIdx = -1;
  for (let i = Math.max(0, n - lookback); i <= n; i++) {
    const lp = linePriceAt(reg, i);
    if (series[i].close > lp * 1.008) breakoutIdx = i;
  }

  const structStart = Math.max(0, breakoutIdx >= 0 ? breakoutIdx - 5 : n - 12);
  const structSlice = series.slice(structStart, n + 1);
  const structLow = Math.min.apply(
    null,
    structSlice.map((r) => r.low).filter(Number.isFinite)
  );

  if (close > lineP && Number.isFinite(norm.ma20) && close > norm.ma20) {
    return {
      type: '下降壓力線突破',
      state: close > lineP * 1.02 ? '已突破' : '回測中',
      category: 'structure',
      confidence: norm.volume_ratio >= 1.2 ? 74 : 60,
      summary: '收盤站上下降壓力線，結構由壓制轉向修復。',
      reasons: ['高點連線下壓', '收盤站上下降壓力線', norm.volume_ratio >= 1.2 ? '量能配合' : ''].filter(
        Boolean
      ),
      structure: { resistance: lineP, neckline: lineP },
      annotations: [
        trendAnn,
        {
          kind: 'marker',
          label: 'breakout',
          index: n,
          price: close,
          style: 'breakout',
          layer: 'primary',
        },
      ],
    };
  }

  if (
    breakoutIdx >= 0 &&
    close >= lineP * 0.97 &&
    Number.isFinite(structLow) &&
    close >= structLow * 1.01
  ) {
    const dist = relPct(close, lineP);
    let state = '突破後回測';
    if (dist != null && dist >= -2.5 && dist <= 4) state = '回測支撐';
    let confidence = 64;
    if (norm.volume_ratio >= 1.05) confidence += 4;
    if (close >= lineP) confidence += 4;
    if (state === '回測支撐') confidence += 2;
    const ann = [trendAnn];
    ann.push({
      kind: 'marker',
      label: 'breakout',
      index: breakoutIdx,
      price: series[breakoutIdx].close,
      style: 'breakout',
      layer: 'primary',
    });
    ann.push({
      kind: 'marker',
      label: 'retest',
      index: n,
      price: close,
      style: 'near-neck',
      layer: 'primary',
    });
    return {
      type: '下降壓力線突破',
      state,
      category: 'structure',
      confidence: Math.min(72, confidence),
      summary: '近期曾突破下降壓力線，目前回測壓力附近且未破壞突破前結構低點。',
      reasons: [
        '高點連線下壓',
        '近' + (n - breakoutIdx) + '日內曾站上下降壓力線',
        '目前回測壓力線附近',
        '未跌破突破前結構低點',
      ],
      structure: { resistance: lineP, neckline: lineP, breakoutIndex: breakoutIdx },
      annotations: ann,
    };
  }

  return null;
}

function detectTriangle(series, norm, diag) {
  const hi = diag.swingHighs.slice(-3);
  const lo = diag.swingLows.slice(-3);
  if (hi.length < 3 || lo.length < 3) return null;
  const regH = linearRegression(hi);
  const regL = linearRegression(lo);
  if (!regH || !regL || regH.slope > -0.05 || regL.slope < 0.05) return null;
  const recent = recentRange(series, 15);
  const prior = recentRange(series.slice(0, -15), 15);
  if (!recent || !prior || prior.width <= 0 || recent.width >= prior.width * 0.92) return null;
  const n = series.length - 1;
  const close = norm.close;
  const top = linePriceAt(regH, n);
  const bot = linePriceAt(regL, n);
  let state = '壓縮中';
  if (Number.isFinite(top) && relPct(close, top) != null && relPct(close, top) >= -3 && close < top) {
    state = '接近突破';
  }
  if (Number.isFinite(top) && close >= top) state = '已突破';
  if (Number.isFinite(bot) && close < bot) state = '失敗跌破';
  return {
    type: '三角收斂',
    state,
    confidence: 68,
    summary: '高點下壓、低點墊高，價格進入三角收斂末端。',
    reasons: ['高點斜率下降', '低點斜率上升', '區間寬度收斂', diag.volumeCompression < 0.9 ? '成交量收斂' : ''].filter(Boolean),
    annotations: [
      {
        kind: 'trendline',
        label: '下降壓力線',
        points: [
          { index: hi[0].index, price: linePriceAt(regH, hi[0].index) },
          { index: n, price: top },
        ],
      },
      {
        kind: 'trendline',
        label: '上升支撐線',
        points: [
          { index: lo[0].index, price: linePriceAt(regL, lo[0].index) },
          { index: n, price: bot },
        ],
      },
      { kind: 'zone', label: '收斂區', startIndex: Math.max(0, n - 25), endIndex: n },
    ],
  };
}

function detectBollCompression(series, norm) {
  const widths = series.map((r, i) => ({ i, w: bollBandwidthAt(r) })).filter((x) => x.w != null);
  if (widths.length < 40) return null;
  const vals = widths.map((x) => x.w).sort((a, b) => a - b);
  const p25 = vals[Math.floor(vals.length * 0.25)];
  const recent = widths.slice(-20);
  const avgRecent = recent.reduce((s, x) => s + x.w, 0) / recent.length;
  if (avgRecent > p25 * 1.05) return null;
  if (norm.volume_ratio > 3) return null;
  const n = series.length - 1;
  const last = series[n];
  let state = '壓縮中';
  if (last.boll_ub && last.close >= last.boll_ub * 0.99) state = '向上擴張';
  if (last.boll_lb && last.close <= last.boll_lb * 1.01) state = '向下擴張';
  return {
    type: 'BOLL壓縮',
    state,
    confidence: 64,
    summary: 'BOLL 頻寬降至近期低位，價格進入波動壓縮區。',
    reasons: ['BOLL 頻寬偏低', '波動區間收斂', '未見爆量'],
    annotations: [
      {
        kind: 'zone',
        label: 'BOLL壓縮區',
        startIndex: Math.max(0, n - 28),
        endIndex: n,
        style: 'squeeze',
      },
    ],
  };
}

function detectUBottom(series, norm) {
  const n = series.length;
  if (n < 50) return null;
  const left = series.slice(0, 18);
  const mid = series.slice(18, 35);
  const right = series.slice(35);
  const leftDrop = left[0].close > left[left.length - 1].close * 1.05;
  const midFlat = Math.abs(relPct(mid[mid.length - 1].close, mid[0].close)) < 8;
  const rightUp = right[right.length - 1].close > right[0].close * 1.05;
  const neckline = Math.max.apply(null, left.map((r) => r.high));
  if (!leftDrop || !midFlat || !rightUp) return null;
  const close = norm.close;
  let state = '右側成形';
  if (relPct(close, neckline) != null && relPct(close, neckline) >= -3 && close < neckline) {
    state = '頸線附近';
  }
  if (close >= neckline) state = '已突破';
  return {
    type: 'U型底',
    state,
    confidence: 62,
    summary: '左側急跌後橫盤築底，右側回升形成 U 型修復。',
    reasons: ['左側急跌', '中段橫盤', '右側回升', '接近左側高點區'],
    annotations: [
      { kind: 'horizontal', label: '頸線', price: neckline },
      {
        kind: 'polyline',
        label: 'U型輪廓',
        points: [
          { index: 0, price: left[0].close },
          { index: 22, price: mid[Math.floor(mid.length / 2)].low },
          { index: n - 1, price: close },
        ],
      },
    ],
  };
}

function detectArcBottom(series, norm, meta) {
  if (!meta || !meta.sufficient || series.length < 120) return null;
  const n = series.length;
  const t1 = Math.floor(n / 3);
  const t2 = t1 * 2;
  const seg1 = series.slice(0, t1);
  const seg2 = series.slice(t1, t2);
  const seg3 = series.slice(t2);
  const drop1 = seg1[0].close > seg1[seg1.length - 1].close * 1.06;
  const avgLow = (arr) => arr.reduce((s, r) => s + r.low, 0) / arr.length;
  const flatMid = Math.abs(relPct(avgLow(seg2), avgLow(seg1))) < 6;
  const rise3 = avgLow(seg3) > avgLow(seg2) * 1.03;
  if (!drop1 || !flatMid || !rise3) return null;
  const ma20End = series[n - 1].ma20;
  const ma20Mid = series[t1].ma20;
  const ma60End = series[n - 1].ma60 || ma20End;
  if (ma20End && ma20Mid && ma20End < ma20Mid * 0.998) return null;
  if (ma60End && ma20End && ma20End < ma60End * 0.995) return null;
  const neckline = Math.max.apply(null, series.slice(0, t2).map((r) => r.high));
  const close = norm.close;
  const midClose = (Math.max.apply(null, seg1.map((r) => r.high)) + Math.min.apply(null, seg2.map((r) => r.low))) / 2;
  if (close < midClose) return null;
  let state = '右側成形';
  if (relPct(close, neckline) >= -3 && close < neckline) state = '頸線附近';
  if (close >= neckline) state = '已突破';
  const confidence = close >= neckline ? 62 : 56;
  return {
    type: '圓弧底',
    state,
    confidence,
    summary: '下跌後低點逐步鈍化，右側回升，具圓弧底雛形。',
    reasons: ['前段下跌', '中段低點鈍化', '後段低點墊高', 'MA20 轉平或上彎'],
    annotations: [
      { kind: 'horizontal', label: '頸線', price: neckline, style: 'neckline' },
      { kind: 'zone', label: '弧形底部區', startIndex: 0, endIndex: t2, style: 'cup' },
    ],
    structure: { neckline, support: Math.min.apply(null, seg2.map((r) => r.low)) },
  };
}

function detectBox(series, norm) {
  const box = recentRange(series, 50);
  if (!box || box.width <= 0) return null;
  const mid = (box.high + box.low) / 2;
  if (box.width / mid < 0.04 || box.width / mid > 0.22) return null;
  const close = norm.close;
  let state = '箱內';
  if (relPct(close, box.high) >= -3 && close <= box.high) state = '接近上緣';
  if (relPct(close, box.low) <= 3 && close >= box.low) state = '接近下緣';
  if (close > box.high) state = '已突破';
  if (close < box.low) state = '失敗跌破';
  const bw = bollBandwidthAt(series[series.length - 1]);
  if (bw != null && bw < 0.08) return null;
  return {
    type: '箱型整理',
    state,
    confidence: 60,
    summary: '價格多次在固定上下緣之間震盪，呈現箱型整理。',
    reasons: ['上緣相對穩定', '下緣相對穩定', '收盤於箱內來回'],
    annotations: [
      { kind: 'horizontal', label: '箱型上緣', price: box.high },
      { kind: 'horizontal', label: '箱型下緣', price: box.low },
      { kind: 'horizontal', label: '中線', price: mid },
    ],
  };
}

function emptyMeasuredMove() {
  return {
    direction: null,
    baseStartIndex: null,
    baseEndIndex: null,
    breakoutIndex: null,
    baseLow: null,
    baseHigh: null,
    breakoutPrice: null,
    measuredPct: null,
    currentExtensionPct: null,
    projectionPrice: null,
    label: '',
    targets: [],
  };
}

function resolveMorphBaseRange(candidate, series) {
  const st = candidate.structure || {};
  const n = series.length - 1;
  const look = series.slice(Math.max(0, n - 45), n);
  let baseHigh = st.neckline || st.resistance || st.channelUpper;
  let baseLow = st.support || st.cupLow || st.channelLower;
  if (!Number.isFinite(baseLow) && look.length) {
    baseLow = Math.min.apply(null, look.map((r) => r.low));
  }
  if (!Number.isFinite(baseHigh) && look.length) {
    baseHigh = Math.max.apply(null, look.map((r) => r.high));
  }
  return { baseHigh, baseLow };
}

function buildMeasuredMove(candidate, series, norm) {
  const empty = emptyMeasuredMove();
  if (!candidate || !series.length) return empty;
  const n = series.length - 1;
  const close = norm.close;
  const type = candidate.type;
  const st = candidate.structure || {};
  const upTypes = ['平台突破', '杯柄型態', '下降壓力線突破', 'U型底', '圓弧底', '上升通道'];
  const brokeUp =
    upTypes.indexOf(type) >= 0 &&
    (candidate.state === '已突破' ||
      candidate.state === '突破延伸' ||
      candidate.state === '頸線突破' ||
      candidate.state === '通道突破' ||
      (type === '下降壓力線突破' && close > (st.neckline || st.resistance || 0)) ||
      (type === '杯柄型態' &&
        (close >= (st.neckline || 0) * 1.01 ||
          candidate.state === '頸線突破' ||
          candidate.state === '突破延伸' ||
          (candidate.state === '頸線附近' && close >= (st.neckline || 0) * 0.96))) ||
      (type === '平台突破' && close >= (st.neckline || st.resistance || 0) * 1.01));

  if (brokeUp) {
    let { baseHigh, baseLow } = resolveMorphBaseRange(candidate, series);
    if (type === '平台突破') {
      const look = series.slice(Math.max(0, n - 40), n - 5);
      baseHigh = st.neckline || st.resistance || Math.max.apply(null, look.map((r) => r.high));
      baseLow = st.support || Math.min.apply(null, look.map((r) => r.low));
    }
    if (type === '杯柄型態') {
      baseHigh = st.neckline || baseHigh;
      baseLow = st.cupLow || st.support || baseLow;
      if (close < baseHigh * 0.95) return empty;
    }
    if (type === '上升通道' && candidate.state !== '通道突破') return empty;
    if ((type === 'U型底' || type === '圓弧底') && close < (st.neckline || 0) * 0.99) {
      return empty;
    }
    if (!Number.isFinite(baseHigh) || !Number.isFinite(baseLow) || baseHigh <= baseLow) {
      return empty;
    }
    const height = baseHigh - baseLow;
    const measuredPct = (height / baseHigh) * 100;
    const projectionPrice = close + height;
    const ext = relPct(close, baseHigh);
    const tag =
      type === '杯柄型態'
        ? 'cup depth'
        : type === '上升通道'
          ? 'channel'
          : 'range';
    const label =
      '結構量測：+' +
      Math.round(measuredPct) +
      '%' +
      (tag === 'cup depth' ? ' 杯深' : tag === 'channel' ? ' 通道' : '');
    return {
      direction: 'up',
      baseStartIndex: Math.max(0, n - 45),
      baseEndIndex: n - 1,
      breakoutIndex: n,
      baseLow,
      baseHigh,
      breakoutPrice: close,
      measuredPct: Math.round(measuredPct * 10) / 10,
      currentExtensionPct: ext != null ? Math.round(ext * 10) / 10 : null,
      projectionPrice: Math.round(projectionPrice * 100) / 100,
      label,
      targets: [{ price: projectionPrice, label }],
    };
  }

  const downBroke =
    type === '反彈旗形' ||
    (type === '下降通道' && candidate.state && candidate.state.indexOf('跌破') >= 0);
  if (downBroke) {
    const baseHigh = st.resistance || st.channelUpper || (recentRange(series, 30) || {}).high;
    const baseLow = st.support || st.channelLower || (recentRange(series, 30) || {}).low;
    if (!Number.isFinite(baseHigh) || !Number.isFinite(baseLow) || baseHigh <= baseLow) {
      return empty;
    }
    const height = baseHigh - baseLow;
    const measuredPct = (height / baseHigh) * 100;
    const projectionPrice = close - height;
    const label = '結構量測：-' + Math.round(measuredPct) + '%';
    return {
      direction: 'down',
      baseStartIndex: Math.max(0, n - 30),
      baseEndIndex: n,
      breakoutIndex: n,
      baseLow,
      baseHigh,
      breakoutPrice: close,
      measuredPct: Math.round(measuredPct * 10) / 10,
      currentExtensionPct: relPct(close, baseLow),
      projectionPrice: Math.round(projectionPrice * 100) / 100,
      label,
      targets: [{ price: projectionPrice, label }],
    };
  }
  return empty;
}

function fibDrawOnChart(price, baseLow, baseHigh) {
  if (!Number.isFinite(price) || !Number.isFinite(baseLow) || !Number.isFinite(baseHigh)) {
    return false;
  }
  const span = baseHigh - baseLow || 1;
  return price >= baseLow - span * 0.2 && price <= baseHigh + span * 0.2;
}

function buildFibExtensions(candidate, series, norm, measuredMove) {
  const out = [];
  if (!candidate || !series.length) return out;
  const close = norm.close;
  let baseHigh;
  let baseLow;
  let direction = 'up';

  if (
    measuredMove &&
    measuredMove.direction &&
    Number.isFinite(measuredMove.baseHigh) &&
    Number.isFinite(measuredMove.baseLow) &&
    measuredMove.baseHigh > measuredMove.baseLow
  ) {
    baseHigh = measuredMove.baseHigh;
    baseLow = measuredMove.baseLow;
    direction = measuredMove.direction;
  } else {
    const noisy = ['假突破風險', 'BOLL壓縮', '箱型整理', '三角收斂'];
    if (noisy.indexOf(candidate.type) >= 0) return out;
    const st = candidate.structure || {};
    baseLow = st.support || st.cupLow || st.channelLower;
    baseHigh = st.neckline || st.resistance || st.channelUpper;
    if (!Number.isFinite(baseLow) || !Number.isFinite(baseHigh)) {
      const rr = resolveMorphBaseRange(candidate, series);
      baseHigh = rr.baseHigh;
      baseLow = rr.baseLow;
    }
    if (!Number.isFinite(baseLow) || !Number.isFinite(baseHigh) || baseHigh <= baseLow) {
      return out;
    }
    const nearNeck =
      candidate.type === '杯柄型態' &&
      Number.isFinite(baseHigh) &&
      relPct(close, baseHigh) != null &&
      relPct(close, baseHigh) >= -5 &&
      close < baseHigh * 1.02;
    const broke =
      candidate.state === '已突破' ||
      candidate.state === '突破延伸' ||
      candidate.state === '頸線突破' ||
      candidate.state === '通道突破' ||
      candidate.state === '頸線附近' ||
      nearNeck;
    if (!broke) return out;
    direction = close >= baseHigh * 0.98 ? 'up' : close <= baseLow * 1.02 ? 'down' : 'up';
  }

  const range = baseHigh - baseLow;
  if (range / baseHigh < 0.03 || range / baseHigh > 0.85) return out;

  const levels = [1.618, 2.618];
  levels.forEach((lv) => {
    const price =
      direction === 'down'
        ? baseHigh - range * lv
        : baseLow + range * lv;
    out.push({
      level: lv,
      price: Math.round(price * 100) / 100,
      label: lv + ' extension reference',
      drawOnChart: fibDrawOnChart(price, baseLow, baseHigh),
    });
  });
  return out;
}

function detectCupLikeShape(series, norm, meta) {
  if (!meta || series.length < 120) return null;
  const n = series.length;
  const leftEnd = Math.floor(n * 0.32);
  const midEnd = Math.floor(n * 0.72);
  const left = series.slice(0, leftEnd);
  const mid = series.slice(leftEnd, midEnd);
  const right = series.slice(midEnd);
  if (left.length < 12 || mid.length < 20 || right.length < 8) return null;

  const leftHigh = Math.max.apply(null, left.map((r) => r.high));
  const cupLow = Math.min.apply(null, mid.map((r) => r.low));
  const cupLowRel = mid.findIndex((r) => r.low === cupLow);
  const rangeHigh = Math.max.apply(null, series.map((r) => r.high));
  const rangeLow = Math.min.apply(null, series.map((r) => r.low));
  const span = rangeHigh - rangeLow;
  if (span <= 0) return null;

  const recovery = (norm.close - cupLow) / span;
  if (recovery < 0.6) return null;
  if (leftHigh < cupLow * 1.08) return null;

  const nearLow = mid.slice(Math.max(0, cupLowRel - 5), Math.min(mid.length, cupLowRel + 6));
  if (nearLow.length < 5) return null;
  const avgNear = nearLow.reduce((s, r) => s + r.low, 0) / nearLow.length;
  if (Math.abs(avgNear - cupLow) / cupLow > 0.06) return null;

  const vTurn = cupLowRel > 2 && cupLowRel < mid.length - 2 && mid.length < 14;
  if (vTurn) return null;

  const neckline = Math.max(leftHigh, rangeHigh * 0.92);
  const close = norm.close;
  let state = '右側回升';
  const handleZone = right.length >= 5 && close < neckline;
  if (handleZone) state = '柄部整理';
  else if (relPct(close, neckline) != null && relPct(close, neckline) >= -8 && close < neckline) {
    state = '頸線附近';
  } else if (close < neckline * 0.95) {
    state = '尚未突破';
  }

  const cupPoints = buildBowlCupCurvePoints(
    0,
    leftEnd + cupLowRel,
    midEnd - 1,
    leftHigh,
    cupLow,
    Math.max.apply(null, right.map((r) => r.high))
  );

  return {
    type: '杯型底雛形',
    state,
    confidence: 52,
    summary: '中期低點鈍化後右側回升，具杯型底雛形，尚未達正式杯柄標準。',
    reasons: ['左側相對偏高', '中段低點整理', '右側回升至區間上段'],
    annotations: [
      { kind: 'horizontal', label: '頸線', price: neckline, style: 'neckline' },
      { kind: 'cupcurve', label: '杯型輪廓', points: cupPoints, style: 'cup-faint' },
    ],
    structure: { neckline, support: cupLow, cupLow },
  };
}

const NO_CUP_SECONDARY = [
  '假突破風險',
  '上升通道',
  '下降通道',
  '反彈旗形',
  '下降壓力線突破',
  'BOLL壓縮',
];

function countLowPlateau(segment, cupLow, tolPct) {
  if (!segment.length || !Number.isFinite(cupLow)) return 0;
  let n = 0;
  segment.forEach((r) => {
    if (r.low != null && Math.abs(r.low - cupLow) / cupLow <= tolPct) n++;
  });
  return n;
}

function buildBowlCupCurvePoints(leftIdx, cupLowIdx, rightIdx, leftRim, cupLow, rightRim) {
  const pts = [];
  const leftSteps = 10;
  const rightSteps = 10;
  for (let i = 0; i <= leftSteps; i++) {
    const u = i / leftSteps;
    const index = Math.round(leftIdx + (cupLowIdx - leftIdx) * u);
    const ease = 1 - Math.cos(u * Math.PI * 0.5);
    pts.push({ index, price: leftRim + (cupLow - leftRim) * ease });
  }
  for (let i = 1; i <= rightSteps; i++) {
    const u = i / rightSteps;
    const index = Math.round(cupLowIdx + (rightIdx - cupLowIdx) * u);
    const ease = Math.sin(u * Math.PI * 0.5);
    pts.push({ index, price: cupLow + (rightRim - cupLow) * ease });
  }
  return pts;
}

function pickCupRimPoints(series, leftEnd, cupEnd, cupLowIdx, cupLow) {
  const cupSpan = Math.max(8, cupEnd - leftEnd);
  const minGap = Math.max(4, Math.floor(cupSpan * 0.18));
  const leftSearchEnd = Math.max(0, cupLowIdx - minGap);
  let leftRimIdx = 0;
  let leftRim = -Infinity;
  for (let i = 0; i <= leftSearchEnd; i++) {
    const bar = series[i];
    const score = Math.max(bar.high, bar.close) * 0.65 + bar.close * 0.35;
    if (score > leftRim) {
      leftRim = bar.high;
      leftRimIdx = i;
    }
  }
  const rightSearchStart = Math.min(series.length - 1, cupLowIdx + minGap);
  const cupHighs = [];
  for (let i = rightSearchStart; i < cupEnd; i++) {
    if (series[i].high != null) cupHighs.push(series[i].high);
  }
  cupHighs.sort((a, b) => a - b);
  const cupHighCap =
    cupHighs.length > 4
      ? cupHighs[Math.floor(cupHighs.length * 0.88)]
      : Math.max.apply(null, cupHighs.concat([cupLow]));
  let rightRimIdx = rightSearchStart;
  let rightRim = -Infinity;
  for (let i = rightSearchStart; i < cupEnd; i++) {
    const bar = series[i];
    if (bar.high > cupHighCap * 1.04) continue;
    const score = Math.max(bar.high, bar.close) * 0.6 + bar.close * 0.4;
    if (score >= rightRim) {
      rightRim = bar.high;
      rightRimIdx = i;
    }
  }
  if (!Number.isFinite(leftRim) || leftRimIdx >= cupLowIdx - 2) {
    leftRimIdx = Math.max(0, leftEnd - 2);
    leftRim = series[leftRimIdx].high;
  }
  if (!Number.isFinite(rightRim) || rightRimIdx <= cupLowIdx + 2) {
    rightRimIdx = Math.max(cupLowIdx + minGap, cupEnd - 3);
    rightRim = series[rightRimIdx].high;
  }
  return { leftRimIdx, leftRim, rightRimIdx, rightRim };
}

function resolveCupNeckline(series, leftRimIdx, rightRimIdx, leftRim, rightRim) {
  const lBar = series[leftRimIdx] || {};
  const rBar = series[rightRimIdx] || {};
  const nlLeft = Math.max(leftRim, lBar.close || leftRim);
  const nlRight = Math.max(rightRim, rBar.close || rightRim);
  return Math.max(nlLeft, nlRight);
}

function morphPriceInBand(v, baseMin, baseMax, marginPct) {
  if (!Number.isFinite(v)) return false;
  const span = baseMax - baseMin || 1;
  return v >= baseMin - span * marginPct && v <= baseMax + span * marginPct;
}

function buildChartBadges(measuredMove, fibExtensions, series, norm) {
  const badges = [];
  const closes = series.map((r) => r.close).filter(Number.isFinite);
  const lows = series.map((r) => r.low || r.close);
  const highs = series.map((r) => r.high || r.close);
  let baseMin = Math.min.apply(null, lows.concat(closes));
  let baseMax = Math.max.apply(null, highs.concat(closes));
  const fibOff = [];
  (fibExtensions || []).forEach((f) => {
    if (!f.drawOnChart) fibOff.push(String(f.level));
  });
  if (fibOff.length) {
    badges.push({
      text: 'Fibonacci ' + fibOff.join(' / ') + '：超出可視範圍',
      kind: 'fib',
    });
  }
  const mm = measuredMove || {};
  if (
    mm.projectionPrice != null &&
    mm.direction &&
    !morphPriceInBand(mm.projectionPrice, baseMin, baseMax, 0.25)
  ) {
    badges.push({ text: '延伸參考：超出可視範圍', kind: 'projection' });
  }
  return badges;
}

function buildChartAnnotations(pick, measuredMove, fibExtensions, allCandidates, norm, series, cupLike) {
  const ann = [];
  (pick.annotations || []).forEach((a) => {
    ann.push(Object.assign({ layer: 'primary' }, a));
  });

  if (measuredMove && measuredMove.direction && measuredMove.baseHigh != null && measuredMove.baseLow != null) {
    ann.push({
      kind: 'bracket',
      label: 'base range',
      fromIndex: measuredMove.baseStartIndex,
      toIndex: measuredMove.baseEndIndex != null ? measuredMove.baseEndIndex : measuredMove.breakoutIndex,
      baseLow: measuredMove.baseLow,
      baseHigh: measuredMove.baseHigh,
      direction: measuredMove.direction,
      layer: 'primary',
    });
    ann.push({
      kind: 'measure',
      label: measuredMove.label || '',
      fromIndex: measuredMove.breakoutIndex,
      fromPrice: measuredMove.breakoutPrice || measuredMove.baseHigh,
      toPrice: measuredMove.projectionPrice,
      direction: measuredMove.direction,
      layer: 'primary',
    });
  }

  fibExtensions.forEach((f) => {
    if (!f.drawOnChart) return;
    ann.push({
      kind: 'horizontal',
      label: String(f.level),
      price: f.price,
      style: f.level >= 2.5 ? 'fib262' : 'fib161',
      layer: 'secondary',
      faint: true,
    });
  });

  if (
    measuredMove &&
    measuredMove.projectionPrice != null &&
    measuredMove.direction &&
    fibExtensions.length
  ) {
    ann.push({
      kind: 'horizontal',
      label: 'projection',
      price: measuredMove.projectionPrice,
      style: 'projection',
      layer: 'secondary',
    });
  }

  if (pick.type === '無明確形態' && cupLike) {
    (cupLike.annotations || []).slice(0, 2).forEach((a) => {
      ann.push(
        Object.assign({ layer: 'secondary', faint: true }, a, {
          style: 'cup-faint',
        })
      );
    });
  }

  if (pick.type === '杯柄型態' && allCandidates && allCandidates.length) {
    const ch = allCandidates.find(
      (c) => c.type === '上升通道' || c.type === '下降通道'
    );
    if (ch && ch.annotations) {
      ch.annotations.slice(0, 1).forEach((a) => {
        ann.push(Object.assign({ layer: 'secondary', faint: true }, a));
      });
    }
  }

  return ann.slice(0, 18);
}

function mergeMorphAnnotations(pick, measuredMove, fibExtensions, allCandidates, norm, series, cupLike) {
  return buildChartAnnotations(
    pick,
    measuredMove,
    fibExtensions,
    allCandidates,
    norm,
    series,
    cupLike
  );
}

function buildCupHandleCandidate(series, norm, meta) {
  const probe = { accepted: false, rejectReason: null, quality: null, confidence: null, state: null };
  if (series.length < 150) {
    probe.rejectReason = 'series<150';
    return { candidate: null, probe };
  }
  const n = series.length;
  const handleLen = Math.min(28, Math.max(5, Math.floor(n * 0.1)));
  const cupEnd = n - handleLen;
  const leftEnd = Math.floor(cupEnd * 0.42);
  const left = series.slice(0, leftEnd);
  const cup = series.slice(leftEnd, cupEnd);
  const handle = series.slice(cupEnd);
  if (left.length < 16 || cup.length < 24 || handle.length < 5 || handle.length > 30) {
    probe.rejectReason = 'segment_length';
    return { candidate: null, probe };
  }

  const cupBody = series.slice(leftEnd, cupEnd);
  let cupLow = Math.min.apply(null, cupBody.map((r) => r.low));
  let cupLowIdx = leftEnd + cupBody.findIndex((r) => r.low === cupLow);
  const cupMidStart = leftEnd + Math.floor(cupBody.length * 0.25);
  const cupMidEnd = leftEnd + Math.floor(cupBody.length * 0.75);
  for (let i = cupMidStart; i < cupMidEnd; i++) {
    const lo = series[i].low;
    if (lo != null && lo <= cupLow * 1.02) {
      cupLow = lo;
      cupLowIdx = i;
    }
  }
  const rims = pickCupRimPoints(series, leftEnd, cupEnd, cupLowIdx, cupLow);
  const leftRimIdx = rims.leftRimIdx;
  const leftRim = rims.leftRim;
  const rightRimIdx = rims.rightRimIdx;
  const rightRim = rims.rightRim;
  const neckline = resolveCupNeckline(series, leftRimIdx, rightRimIdx, leftRim, rightRim);
  const depthPct = (neckline - cupLow) / neckline;
  probe.depthPct = Math.round(depthPct * 1000) / 1000;
  if (depthPct < 0.1 || depthPct > 0.58) {
    probe.rejectReason = 'depthPct:' + probe.depthPct;
    return { candidate: null, probe };
  }
  if (cupLowIdx <= leftEnd + 2 || cupLowIdx >= cupEnd - 2) {
    probe.rejectReason = 'cupLowIdx_edge';
    return { candidate: null, probe };
  }
  const cupSpanIdx = rightRimIdx - leftRimIdx;
  if (cupLowIdx - leftRimIdx < Math.max(3, Math.floor(cupSpanIdx * 0.12))) {
    probe.rejectReason = 'left_rim_too_close_to_low';
    return { candidate: null, probe };
  }
  if (rightRimIdx - cupLowIdx < Math.max(3, Math.floor(cupSpanIdx * 0.12))) {
    probe.rejectReason = 'right_rim_too_close_to_low';
    return { candidate: null, probe };
  }
  if (rightRim < leftRim * 0.76) {
    probe.rejectReason = 'right_rim_low';
    return { candidate: null, probe };
  }

  const plateau = countLowPlateau(cup, cupLow, 0.07);
  probe.plateau = plateau;
  const minPlateau = depthPct < 0.14 ? 4 : 5;
  if (plateau < minPlateau) {
    probe.rejectReason = 'plateau<' + minPlateau;
    return { candidate: null, probe };
  }

  const cupSpan = cup.length;
  const vShape = cupSpan < 14 && cupLowIdx > leftEnd + 3 && cupLowIdx < cupEnd - 3;
  if (vShape) {
    probe.rejectReason = 'v_shape';
    return { candidate: null, probe };
  }

  const handleHigh = Math.max.apply(null, handle.map((r) => r.high));
  const handleLow = Math.min.apply(null, handle.map((r) => r.low));
  const cupDepth = Math.max(neckline - cupLow, neckline * 0.02);
  const handlePull = (handleHigh - handleLow) / cupDepth;
  const handleDepthPct = (handleHigh - handleLow) / neckline;
  probe.handlePull = Math.round(handlePull * 1000) / 1000;
  probe.handleDepthPct = Math.round(handleDepthPct * 1000) / 1000;
  const maxHandlePull = maxHandlePullForCupQuality(depthPct);
  if (handleDepthPct > 0.28) {
    probe.rejectReason = 'handle_range_too_wide';
    return { candidate: null, probe };
  }
  if (handlePull > maxHandlePull) {
    probe.rejectReason = 'handle_too_deep';
    return { candidate: null, probe };
  }
  if (handleLow < cupLow * 0.98) {
    probe.rejectReason = 'handle_below_cup_low';
    return { candidate: null, probe };
  }

  const ma20 = series[n - 1].ma20;
  if (Number.isFinite(ma20) && handleLow < ma20 * 0.82) {
    probe.rejectReason = 'handle_below_ma20';
    return { candidate: null, probe };
  }

  const close = norm.close;
  let state = '杯底成形';
  if (rightRim >= leftRim * 0.8 && close < neckline * 0.98) state = '右側回升';
  if (handle.length >= 5 && close < neckline) state = '柄部整理';
  if (relPct(close, neckline) != null && relPct(close, neckline) >= -5 && close < neckline * 1.01) {
    state = '頸線附近';
  }
  if (close >= neckline * 1.01) state = '頸線突破';
  if (close >= neckline * 1.05) state = '突破延伸';

  let confidence = 56;
  if (plateau >= 8) confidence += 6;
  else if (plateau >= minPlateau) confidence += 4;
  if (handle.length >= 5 && handle.length <= 25) confidence += 8;
  if (rightRim >= leftRim * 0.86) confidence += 6;
  if (rightRim >= neckline * 0.9) confidence += 4;
  if (norm.volume_ratio >= 1.05) confidence += 4;
  if (relPct(close, neckline) != null && relPct(close, neckline) >= -5) confidence += 6;
  if (close >= neckline) confidence += 8;
  if (!meta.sufficient) confidence = Math.min(confidence, 48);

  const quality = computeCupQuality({
    leftRimIdx,
    cupLowIdx,
    rightRimIdx,
    leftRim,
    cupLow,
    rightRim,
    neckline,
    depthPct,
    handlePull,
    cupEnd,
  });
  probe.quality = quality;
  if (quality.bowlQuality < 0.48) {
    probe.rejectReason = 'bowlQuality<' + quality.bowlQuality;
    return { candidate: null, probe };
  }
  if (quality.symmetryScore < 0.5 && quality.bowlQuality < 0.55) {
    probe.rejectReason = 'not_bowl_shaped';
    return { candidate: null, probe };
  }
  if (quality.bowlQuality < 0.58) confidence = Math.min(confidence, 80);
  else if (quality.bowlQuality < 0.65) confidence = Math.min(confidence, 84);
  else if (quality.bowlQuality >= 0.72) confidence += 6;
  if (quality.rimDistanceScore < 0.4 && quality.bowlQuality < 0.6) {
    probe.rejectReason = 'rim_distance_low';
    return { candidate: null, probe };
  }
  if (quality.rimDistanceScore < 0.45) confidence = Math.min(confidence, 76);
  probe.confidence = confidence;
  probe.state = state;
  probe.accepted = true;

  const cupPoints = buildBowlCupCurvePoints(
    leftRimIdx,
    cupLowIdx,
    rightRimIdx,
    leftRim,
    cupLow,
    rightRim
  );
  const handleTop = handleHigh;
  const handleBot = handleLow;
  const cupAnn = [
    {
      kind: 'cupfill',
      startIndex: leftRimIdx,
      endIndex: rightRimIdx,
      cupLowIdx,
      leftRim,
      cupLow,
      rightRim,
      layer: 'primary',
    },
    { kind: 'cupcurve', label: '', points: cupPoints, style: 'cup', layer: 'primary' },
    { kind: 'horizontal', label: 'neckline', price: neckline, style: 'neckline', layer: 'primary' },
    { kind: 'marker', label: 'left rim', index: leftRimIdx, price: leftRim, style: 'rim-left', layer: 'primary' },
    { kind: 'marker', label: 'cup low', index: cupLowIdx, price: cupLow, style: 'cup-low', layer: 'primary' },
    { kind: 'marker', label: 'right rim', index: rightRimIdx, price: rightRim, style: 'rim-right', layer: 'primary' },
    {
      kind: 'zone',
      label: 'handle',
      startIndex: cupEnd,
      endIndex: n - 1,
      style: 'handle',
      topPrice: handleTop,
      bottomPrice: handleBot,
      layer: 'primary',
    },
  ];
  if (state === '頸線附近') {
    cupAnn.push({
      kind: 'marker',
      label: 'near neckline',
      index: n - 1,
      price: close,
      style: 'near-neck',
      layer: 'primary',
    });
  } else if (close >= neckline * 1.005) {
    cupAnn.push({
      kind: 'marker',
      label: 'breakout',
      index: n - 1,
      price: close,
      style: 'breakout',
      layer: 'primary',
    });
  }

  const candidate = {
    type: '杯柄型態',
    state,
    category: 'structure',
    confidence: Math.min(90, Math.max(0, confidence)),
    quality,
    summary:
      '中期杯狀底部成形，右側回升並在頸線區整理，具杯柄型態結構。',
    reasons: [
      '左側杯口與右側杯口形成頸線區',
      '杯底低位鈍化',
      '右側回升接近頸線',
      handle.length >= 5 ? '柄部整理未破壞杯型深度' : '杯底成形中',
      '碗形品質 ' + Math.round(quality.bowlQuality * 100) + '%',
    ],
    annotations: cupAnn,
    structure: {
      neckline,
      support: cupLow,
      resistance: neckline,
      cupLow,
      leftRim,
      rightRim,
      leftRimIdx,
      rightRimIdx,
      cupDepthPct: Math.round(depthPct * 1000) / 10,
      handleStart: cupEnd,
      handleEnd: n - 1,
      bowlQuality: quality.bowlQuality,
    },
  };
  return { candidate, probe };
}

function detectCupHandle(series, norm, meta) {
  return buildCupHandleCandidate(series, norm, meta).candidate;
}

function detectChannel(series, norm, diag, ascending) {
  if (series.length < 60) return null;
  const hi = diag.swingHighs;
  const lo = diag.swingLows;
  if (hi.length < 3 || lo.length < 3) return null;
  const hiPts = hi.slice(-4);
  const loPts = lo.slice(-4);
  const regH = linearRegression(hiPts);
  const regL = linearRegression(loPts);
  if (!regH || !regL) return null;
  if (Math.abs(regH.slope - regL.slope) > 0.25) return null;
  if (ascending && (regH.slope < 0.06 || regL.slope < 0.06)) return null;
  if (!ascending && (regH.slope > -0.06 || regL.slope > -0.06)) return null;
  const n = series.length - 1;
  const top = linePriceAt(regH, n);
  const bot = linePriceAt(regL, n);
  if (!Number.isFinite(top) || !Number.isFinite(bot) || top <= bot) return null;
  const close = norm.close;
  const span = top - bot;
  let state = '通道中段';
  if (span > 0) {
    const pos = ((close - bot) / span) * 100;
    if (pos < 0) state = '通道跌破';
    else if (pos > 100) state = '通道突破';
    else if (pos <= 25) state = '通道下緣';
    else if (pos >= 75) state = '通道上緣';
    else state = '通道中段';
  }
  const label = ascending ? '上升通道' : '下降通道';
  const zoneLabel = ascending ? '上升通道' : '下降通道';
  let posLabel = state;
  if (state === '通道突破') posLabel = '通道突破';
  else if (state === '通道跌破') posLabel = '通道跌破';
  else if (state === '通道上緣') posLabel = 'near upper channel';
  else if (state === '通道下緣') posLabel = 'near lower channel';
  return {
    type: label,
    state,
    confidence: 66,
    summary: ascending
      ? '高點與低點同步墊高，價格沿上升通道運行。'
      : '高點與低點同步下移，價格沿下降通道運行。',
    reasons: [
      ascending ? '低點墊高' : '高點下壓',
      ascending ? '高點墊高' : '低點下移',
      '通道平行度尚可',
    ],
    annotations: [
      {
        kind: 'trendline',
        label: '通道上緣',
        points: [
          { index: hiPts[0].index, price: linePriceAt(regH, hiPts[0].index) },
          { index: n, price: top },
        ],
        style: 'resistance',
        layer: 'primary',
      },
      {
        kind: 'trendline',
        label: '通道下緣',
        points: [
          { index: loPts[0].index, price: linePriceAt(regL, loPts[0].index) },
          { index: n, price: bot },
        ],
        style: 'support',
        layer: 'primary',
      },
      {
        kind: 'zone',
        label: zoneLabel,
        startIndex: Math.max(0, n - 55),
        endIndex: n,
        style: 'channel',
        topPrice: top,
        bottomPrice: bot,
        layer: 'primary',
      },
      {
        kind: 'position',
        label: posLabel,
        index: n,
        price: close,
        style:
          state === '通道突破'
            ? 'breakout'
            : state === '通道跌破'
              ? 'breakdown'
              : 'neutral',
        layer: 'primary',
      },
    ],
    structure: { resistance: top, support: bot, channelUpper: top, channelLower: bot },
  };
}

function detectBearFlag(series, norm) {
  if (series.length < 50) return null;
  const n = series.length - 1;
  const poleLen = 25;
  const pole = series.slice(Math.max(0, n - poleLen - 15), Math.max(0, n - 15));
  const flag = series.slice(Math.max(0, n - 15));
  if (pole.length < 12 || flag.length < 8) return null;
  const dropPct = ((pole[0].close - pole[pole.length - 1].close) / pole[0].close) * 100;
  if (dropPct < 12) return null;
  const hi = findSwingHighs(flag, 2);
  const lo = findSwingLows(flag, 2);
  if (hi.length < 2 || lo.length < 2) return null;
  const regH = linearRegression(hi);
  const regL = linearRegression(lo);
  if (!regH || !regL || regH.slope < 0.02 || regL.slope < 0.01) return null;
  const flagLow = Math.min.apply(null, flag.map((r) => r.low));
  const close = norm.close;
  let state = '旗形反彈中';
  if (close < flagLow) state = dropPct > 15 ? '跌破延伸' : '跌破下緣';
  const avgVol = averageVolume(series, n - 12, n);
  const poleVol = averageVolume(series, n - 40, n - 20);
  if (poleVol > 0 && avgVol / poleVol > 1.4) return null;
  return {
    type: '反彈旗形',
    state,
    confidence: close < flagLow ? 72 : 58,
    summary: '急跌後形成小型反彈通道，若跌破下緣，屬反彈旗形失敗結構。',
    reasons: ['前段急跌', '小型反彈通道', '反彈量能偏弱'],
    annotations: [
      {
        kind: 'trendline',
        label: '旗形上緣',
        points: [
          { index: hi[0].index, price: linePriceAt(regH, hi[0].index) },
          { index: n, price: linePriceAt(regH, n) },
        ],
      },
      {
        kind: 'trendline',
        label: '旗形下緣',
        points: [
          { index: lo[0].index, price: linePriceAt(regL, lo[0].index) },
          { index: n, price: linePriceAt(regL, n) },
        ],
      },
      {
        kind: 'zone',
        label: '反彈旗形',
        startIndex: Math.max(0, n - 15),
        endIndex: n,
        style: 'channel',
        topPrice: linePriceAt(regH, n),
        bottomPrice: flagLow,
      },
      ...(close < flagLow
        ? [{ kind: 'marker', label: '跌破', index: n, price: close, style: 'breakdown' }]
        : []),
    ],
    structure: { resistance: linePriceAt(regH, n), support: flagLow },
  };
}

function detectMorphology(record) {
  const { norm, series, meta } = getMorphSeries(record);
  if (series.length < 40) {
    return emptyMorphology('此股票尚無足夠形態學資料。');
  }
  if (!meta.sufficient) {
    const empty = emptyMorphology(
      'series 僅 ' + meta.length + ' 根，不足以辨識杯柄／通道等中期形態。'
    );
    empty.candleStats = countConsecutiveCandles(series);
    empty.dataMeta = meta;
    empty.morphSeriesLength = series.length;
    return empty;
  }
  const diagnostics = buildDiagnostics(series, norm);
  const candidates = [];
  const add = (c) => {
    if (!c || !c.type) return;
    if (c.type === '圓弧底' && c.confidence < 55) return;
    candidates.push(c);
  };
  add(detectFalseBreakout(series, norm, diagnostics));
  add(detectCupHandle(series, norm, meta));
  add(detectChannel(series, norm, diagnostics, true));
  add(detectChannel(series, norm, diagnostics, false));
  add(detectBearFlag(series, norm));
  add(detectDescendingBreakout(series, norm, diagnostics));
  add(detectPlatformBreakout(series, norm));
  add(detectTriangle(series, norm, diagnostics));
  add(detectBollCompression(series, norm));
  add(detectUBottom(series, norm));
  add(detectArcBottom(series, norm, meta));
  add(detectBox(series, norm));

  if (!candidates.length) {
    const empty = emptyMorphology('目前沒有足夠明確的形態學結構。');
    empty.candleStats = countConsecutiveCandles(series);
    empty.dataMeta = meta;
    empty.morphSeriesLength = series.length;
    return empty;
  }

  const cupProbe = buildCupHandleCandidate(series, norm, meta).probe;
  const pick = pickMorphologyPrimary(candidates, norm, series);
  const cupLike = detectCupLikeShape(series, norm, meta);
  const measuredMove = buildMeasuredMove(pick, series, norm);
  const fibExtensions = buildFibExtensions(pick, series, norm, measuredMove);
  const chartAnnotations = mergeMorphAnnotations(
    pick,
    measuredMove,
    fibExtensions,
    candidates,
    norm,
    series,
    cupLike
  );
  const chartBadges = buildChartBadges(measuredMove, fibExtensions, series, norm);
  const secondary = pickMorphologySecondary(pick, candidates, cupLike);
  const primary = {
    type: pick.type,
    state: pick.state,
    confidence: pick.confidence,
    summary: pick.summary,
    reasons: pick.reasons || [],
    annotations: chartAnnotations,
    structure: pick.structure || {},
    quality: pick.quality || null,
    rankScore: pick.rankScore,
  };

  return {
    primary,
    secondary,
    structure: pick.structure || {},
    measuredMove,
    fibExtensions,
    chartAnnotations,
    chartBadges,
    candleStats: countConsecutiveCandles(series),
    dataMeta: meta,
    diagnostics,
    morphSeriesLength: series.length,
    cupProbe,
    rankingDebug: {
      pick: pick.type,
      rankScore: pick.rankScore,
      cupProbe,
      candidates: candidates.map((c) => ({
        type: c.type,
        state: c.state,
        confidence: c.confidence,
        rankScore: computeMorphRankScore(c, candidates),
        bowlQuality: c.quality && c.quality.bowlQuality,
        quality: c.quality || null,
      })),
    },
  };
}


  return {
    analyze,
    normalizeRecord,
    findRecord,
    scan,
    detectMorphology,
    countConsecutiveCandles,
    getMorphSeries,
    SCANNER_BUCKETS,
    SCANNER_OPPORTUNITY_KEYS,
    SCANNER_RISK_KEYS,
    NEAR_PCT,
    BOLL_NEAR,
    localizeMeasureLabel,
    localizeFibUiLine,
    localizeChartBadgeText,
  };
});
