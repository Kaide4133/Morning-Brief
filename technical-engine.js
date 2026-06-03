/**
 * KW Technical Spider v0.4.1 — 形態學校準 + 延伸量測
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
    const prevHigh20 = num(daily.prev_high20, num(record.prev_high20, null));
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
      const extLabel =
        mm.currentExtensionPct != null && mm.direction === 'up'
          ? '+' + Math.round(mm.currentExtensionPct) + '%'
          : mm.currentExtensionPct != null && mm.direction === 'down'
            ? Math.round(mm.currentExtensionPct) + '%'
            : null;

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
              measuredExtension: extLabel,
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

function detectFalseBreakout(series, norm, diag) {
  const close = norm.close;
  const last = series[series.length - 1];
  const pressure = num(norm.prev_high20, null);
  if (!Number.isFinite(pressure)) return null;
  const broke = last.high > pressure * 1.002;
  const failedClose = close < pressure;
  const longUpper = norm.upper_shadow_ratio > 0.35;
  if (!broke || (!failedClose && !longUpper)) return null;
  const n = series.length - 1;
  return {
    type: '假突破風險',
    state: '假突破風險',
    confidence: longUpper && failedClose ? 78 : 65,
    summary: '盤中突破前高但收盤未能有效站穩，且伴隨長上影，需降權解讀。',
    reasons: ['觸及前高壓力', failedClose ? '收盤回到壓力線下' : '長上影偏高', longUpper ? '上影比例偏高' : ''].filter(Boolean),
    annotations: [
      { kind: 'horizontal', label: '前高壓力線', price: pressure },
      { kind: 'marker', label: '假突破', index: n, price: last.high },
    ],
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
  if (!Number.isFinite(lineP) || close <= lineP) return null;
  if (!Number.isFinite(norm.ma20) || close <= norm.ma20) return null;
  return {
    type: '下降壓力線突破',
    state: close > lineP * 1.02 ? '已突破' : '回測中',
    confidence: norm.volume_ratio >= 1.2 ? 74 : 60,
    summary: '收盤站上下降壓力線，結構由壓制轉向修復。',
    reasons: ['高點連線下壓', '收盤站上下降壓力線', norm.volume_ratio >= 1.2 ? '量能配合' : ''].filter(Boolean),
    annotations: [
      {
        kind: 'trendline',
        label: '下降壓力線',
        points: [
          { index: pts[0].index, price: linePriceAt(reg, pts[0].index) },
          { index: n, price: lineP },
        ],
      },
      { kind: 'marker', label: '突破點', index: n, price: close },
    ],
  };
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
      { kind: 'zone', label: 'BOLL壓縮區', startIndex: n - 20, endIndex: n },
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

function buildMeasuredMove(candidate, series, norm) {
  const empty = {
    direction: null,
    baseStartIndex: null,
    baseEndIndex: null,
    breakoutIndex: null,
    baseLow: null,
    baseHigh: null,
    measuredPct: null,
    currentExtensionPct: null,
    targets: [],
  };
  if (!candidate || !series.length) return empty;
  const n = series.length - 1;
  const close = norm.close;
  const type = candidate.type;
  if (type === '平台突破' || type === '杯柄型態') {
    let baseHigh = null;
    let baseLow = null;
    if (type === '平台突破') {
      const look = series.slice(Math.max(0, n - 40), n - 5);
      baseHigh = Math.max.apply(null, look.map((r) => r.high));
      baseLow = Math.min.apply(null, look.map((r) => r.low));
    } else {
      const left = series.slice(0, Math.floor(series.length * 0.45));
      baseHigh = Math.max.apply(null, left.map((r) => r.high));
      baseLow = Math.min.apply(null, series.map((r) => r.low));
    }
    if (!Number.isFinite(baseHigh) || !Number.isFinite(baseLow) || baseHigh <= baseLow) return empty;
    const height = baseHigh - baseLow;
    const measuredPct = (height / baseLow) * 100;
    const target = baseHigh + height;
    const ext = relPct(close, baseHigh);
    return {
      direction: 'up',
      baseStartIndex: 0,
      baseEndIndex: n - 5,
      breakoutIndex: n,
      baseLow,
      baseHigh,
      measuredPct: Math.round(measuredPct * 10) / 10,
      currentExtensionPct: ext != null ? Math.round(ext * 10) / 10 : null,
      targets: [{ price: target, label: '+' + Math.round(measuredPct) + '%' }],
    };
  }
  if (type === '反彈旗形' || type === '下降通道') {
    const box = recentRange(series, 30);
    if (!box) return empty;
    const height = box.width;
    const measuredPct = (height / box.high) * 100;
    return {
      direction: 'down',
      baseStartIndex: box.start,
      baseEndIndex: n,
      breakoutIndex: n,
      baseLow: box.low,
      baseHigh: box.high,
      measuredPct: Math.round(measuredPct * 10) / 10,
      currentExtensionPct: relPct(close, box.low),
      targets: [{ price: box.low - height, label: '-' + Math.round(measuredPct) + '%' }],
    };
  }
  return empty;
}

function buildFibExtensions(candidate, series) {
  const out = [];
  if (!candidate) return out;
  const ok = ['杯柄型態', '圓弧底', '平台突破', 'U型底'];
  if (ok.indexOf(candidate.type) < 0 || series.length < MORPH_MIN_BARS) return out;
  const left = series.slice(0, Math.floor(series.length * 0.5));
  const baseLow = Math.min.apply(null, series.map((r) => r.low));
  let neckline = null;
  if (candidate.type === '平台突破') {
    const look = series.slice(Math.max(0, series.length - 45), series.length - 5);
    neckline = Math.max.apply(null, look.map((r) => r.high));
  } else {
    neckline = Math.max.apply(null, left.map((r) => r.high));
  }
  if (!Number.isFinite(baseLow) || !Number.isFinite(neckline) || neckline <= baseLow) return out;
  const span = neckline - baseLow;
  [1.618, 2.618].forEach((lv) => {
    out.push({
      level: lv,
      price: Math.round((neckline + span * (lv - 1)) * 100) / 100,
      label: String(lv) + ' extension',
    });
  });
  return out;
}

function mergeMorphAnnotations(primary, measuredMove, fibExtensions) {
  const ann = (primary.annotations || []).slice();
  if (measuredMove && measuredMove.direction && measuredMove.targets) {
    measuredMove.targets.forEach((t) => {
      ann.push({ kind: 'horizontal', label: t.label, price: t.price, style: 'measure' });
      ann.push({
        kind: 'measure',
        label: t.label,
        fromIndex: measuredMove.breakoutIndex,
        fromPrice: measuredMove.baseHigh,
        toPrice: t.price,
      });
    });
  }
  fibExtensions.forEach((f) => {
    ann.push({ kind: 'horizontal', label: f.label, price: f.price, style: 'fib' });
  });
  return ann;
}

function detectCupHandle(series, norm, meta) {
  if (!meta.sufficient || series.length < 120) return null;
  const n = series.length;
  const leftEnd = Math.floor(n * 0.35);
  const cupEnd = Math.floor(n * 0.72);
  const left = series.slice(0, leftEnd);
  const cup = series.slice(leftEnd, cupEnd);
  const handle = series.slice(cupEnd);
  if (left.length < 20 || cup.length < 30 || handle.length < 10) return null;
  const leftHigh = Math.max.apply(null, left.map((r) => r.high));
  const cupLow = Math.min.apply(null, cup.map((r) => r.low));
  if (left[0].close <= cupLow * 1.08) return null;
  const cupDepth = leftHigh - cupLow;
  if (cupDepth / leftHigh < 0.12 || cupDepth / leftHigh > 0.45) return null;
  const cupLows = cup.map((r) => r.low);
  const mid = Math.floor(cupLows.length / 2);
  const avgFirst = cupLows.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
  const avgLast = cupLows.slice(mid).reduce((s, v) => s + v, 0) / (cupLows.length - mid);
  if (avgLast < avgFirst * 0.98) return null;
  const neckline = leftHigh;
  const handleLow = Math.min.apply(null, handle.map((r) => r.low));
  const handlePullback =
    (Math.max.apply(null, handle.map((r) => r.high)) - handleLow) / cupDepth;
  if (handlePullback > 0.38) return null;
  const close = norm.close;
  let state = '杯底成形';
  if (relPct(close, neckline) >= -5 && close < neckline) state = '柄部整理';
  if (relPct(close, neckline) >= -3 && close < neckline) state = '頸線附近';
  if (close >= neckline * 1.01) state = '頸線突破';
  if (close >= neckline * 1.05) state = '突破延伸';
  return {
    type: '杯柄型態',
    state,
    confidence: close >= neckline ? 76 : 68,
    summary: '中期形成杯狀底部，右側回升後進入柄部整理，頸線為主要結構壓力。',
    reasons: ['左側回落', '杯底低點鈍化', '右側回升', '柄部整理'],
    annotations: [
      { kind: 'horizontal', label: '頸線', price: neckline, style: 'neckline' },
      {
        kind: 'polyline',
        label: '杯體',
        points: [
          { index: 0, price: left[0].close },
          { index: leftEnd + Math.floor(cup.length / 2), price: cupLow },
          { index: cupEnd, price: series[cupEnd].close },
        ],
        style: 'cup',
      },
      { kind: 'zone', label: '柄部', startIndex: cupEnd, endIndex: n, style: 'handle' },
      ...(close >= neckline
        ? [{ kind: 'marker', label: '突破', index: n, price: close, style: 'breakout' }]
        : []),
    ],
    structure: { neckline, support: cupLow, resistance: neckline },
  };
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
  if (Math.abs(regH.slope - regL.slope) > 0.35) return null;
  if (ascending && (regH.slope < 0.04 || regL.slope < 0.04)) return null;
  if (!ascending && (regH.slope > -0.04 || regL.slope > -0.04)) return null;
  const n = series.length - 1;
  const top = linePriceAt(regH, n);
  const bot = linePriceAt(regL, n);
  const close = norm.close;
  let state = '通道中段';
  if (Number.isFinite(top) && relPct(close, top) >= -3) state = '通道上緣';
  if (Number.isFinite(bot) && relPct(close, bot) <= 3) state = '通道下緣';
  if (close > top) state = '通道突破';
  if (close < bot) state = '通道跌破';
  const label = ascending ? '上升通道' : '下降通道';
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
        label: ascending ? '上升壓力線' : '下降壓力線',
        points: [
          { index: hiPts[0].index, price: linePriceAt(regH, hiPts[0].index) },
          { index: n, price: top },
        ],
        style: 'resistance',
      },
      {
        kind: 'trendline',
        label: ascending ? '上升支撐線' : '下降支撐線',
        points: [
          { index: loPts[0].index, price: linePriceAt(regL, loPts[0].index) },
          { index: n, price: bot },
        ],
        style: 'support',
      },
      { kind: 'zone', label: '通道', startIndex: Math.max(0, n - 50), endIndex: n, style: 'channel' },
    ],
    structure: { resistance: top, support: bot },
  };
}

function detectBearFlag(series, norm) {
  if (series.length < 50) return null;
  const n = series.length - 1;
  const pole = series.slice(Math.max(0, n - 45), Math.max(0, n - 25));
  const flag = series.slice(Math.max(0, n - 25));
  if (pole.length < 10 || flag.length < 12) return null;
  if (pole[0].close <= pole[pole.length - 1].close * 1.08) return null;
  const hi = findSwingHighs(flag, 2);
  const lo = findSwingLows(flag, 2);
  if (hi.length < 2 || lo.length < 2) return null;
  const regH = linearRegression(hi);
  const regL = linearRegression(lo);
  if (!regH || !regL || regH.slope < 0.02 || regL.slope < 0.01) return null;
  const flagLow = Math.min.apply(null, flag.map((r) => r.low));
  const close = norm.close;
  let state = '旗形反彈中';
  if (close < flagLow) state = '跌破下緣';
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
      ...(close < flagLow
        ? [{ kind: 'marker', label: '跌破', index: n, price: close, style: 'breakdown' }]
        : []),
    ],
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

  candidates.sort(
    (a, b) => MORPH_PRIORITY.indexOf(a.type) - MORPH_PRIORITY.indexOf(b.type)
  );

  if (!candidates.length) {
    const empty = emptyMorphology('目前沒有足夠明確的形態學結構。');
    empty.candleStats = countConsecutiveCandles(series);
    empty.dataMeta = meta;
    empty.morphSeriesLength = series.length;
    return empty;
  }

  const pick = candidates[0];
  const measuredMove = buildMeasuredMove(pick, series, norm);
  const fibExtensions = buildFibExtensions(pick, series);
  const primary = {
    type: pick.type,
    state: pick.state,
    confidence: pick.confidence,
    summary: pick.summary,
    reasons: pick.reasons || [],
    annotations: mergeMorphAnnotations(pick, measuredMove, fibExtensions),
    structure: pick.structure || {},
  };
  const secondary = candidates.slice(1, 4).map((c) => ({
    type: c.type,
    state: c.state,
    confidence: c.confidence,
  }));

  return {
    primary,
    secondary,
    structure: pick.structure || {},
    measuredMove,
    fibExtensions,
    candleStats: countConsecutiveCandles(series),
    dataMeta: meta,
    diagnostics,
    morphSeriesLength: series.length,
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
  };
});
