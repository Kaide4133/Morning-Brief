/**
 * KW Technical Spider v0.2 — 可重用技術分析核心
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

      SCANNER_BUCKETS.forEach(({ key }) => {
        if (!hits[key]) return;
        buckets[key].push({
          item: makeScanItem(norm, analysis, reasons[key], extras[key]),
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

  return {
    analyze,
    normalizeRecord,
    findRecord,
    scan,
    SCANNER_BUCKETS,
    SCANNER_OPPORTUNITY_KEYS,
    SCANNER_RISK_KEYS,
    NEAR_PCT,
    BOLL_NEAR,
  };
});
