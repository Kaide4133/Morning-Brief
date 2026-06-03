/**
 * KW Technical Spider — 可重用技術分析核心
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
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function pctDistance(a, b) {
    if (!b) return Infinity;
    return Math.abs((a - b) / b) * 100;
  }

  function isNear(value, target, pct) {
    return pctDistance(value, target) <= (pct || NEAR_PCT);
  }

  function ma20Slope(series) {
    if (!series || series.length < 25) return null;
    const tail = series.slice(-25);
    const maAt = (idx) => {
      const slice = tail.slice(0, idx + 1).map((r) => r.close);
      if (slice.length < 20) return null;
      const window = slice.slice(-20);
      return window.reduce((s, c) => s + c, 0) / 20;
    };
    const last = maAt(tail.length - 1);
    const prev = maAt(Math.max(19, tail.length - 6));
    if (last == null || prev == null) return null;
    return last > prev;
  }

  function pickDaily(record) {
    return record.daily || record.analysis || {};
  }

  function pickWeekly(record) {
    return record.weekly || {};
  }

  function buildSupportResistance(record, daily) {
    const support = Array.isArray(daily.support)
      ? daily.support.slice()
      : [];
    const resistance = Array.isArray(daily.resistance)
      ? daily.resistance.slice()
      : [];
    const close = num(record.latest?.close ?? daily.close, null);
    const ma20 = num(daily.ma20, null);
    const ma10 = num(daily.ma10, null);
    const recentLow = num(daily.recent_low10, null);
    const prevHigh = num(daily.prev_high20, null);
    const bollUb = num(daily.boll_ub, null);
    const bollLb = num(daily.boll_lb, null);

    if (ma20 != null && !support.some((s) => String(s).includes('MA20'))) {
      support.push('MA20 ' + Math.round(ma20));
    }
    if (ma10 != null && !support.some((s) => String(s).includes('MA10'))) {
      support.push('MA10 ' + Math.round(ma10));
    }
    if (recentLow != null && !support.some((s) => String(s).includes('10日'))) {
      support.push('10日低點 ' + Math.round(recentLow));
    }
    if (prevHigh != null && !resistance.some((s) => String(s).includes('前高'))) {
      resistance.push('20日前高 ' + Math.round(prevHigh));
    }
    if (bollUb != null && !resistance.some((s) => String(s).includes('BOLL'))) {
      resistance.push('BOLL上緣 ' + Math.round(bollUb));
    }
    if (bollLb != null && !support.some((s) => String(s).includes('BOLL下'))) {
      support.push('BOLL下緣 ' + Math.round(bollLb));
    }
    if (close != null) {
      void close;
    }
    return { support: support.slice(0, 6), resistance: resistance.slice(0, 6) };
  }

  function analyzeTrend(close, daily, series) {
    const ma5 = num(daily.ma5, null);
    const ma10 = num(daily.ma10, null);
    const ma20 = num(daily.ma20, null);
    const ma60 = num(daily.ma60, null);
    const reasons = [];
    let state = '震盪';

    if (close < ma60) {
      state = '空頭';
      reasons.push('收盤低於 MA60');
    } else if (close < ma20) {
      state = '轉弱';
      reasons.push('收盤低於 MA20');
    } else if (close > ma20) {
      const slopeUp = ma20Slope(series);
      if (slopeUp) {
        state = '多頭';
        reasons.push('收盤站上 MA20，且 MA20 上彎');
      } else if (ma5 > ma10) {
        state = '轉強';
        reasons.push('收盤站上 MA20，且 MA5 > MA10');
      } else {
        state = '震盪';
        reasons.push('收盤站上 MA20，短均線尚未明確多排');
      }
    }

    if (daily.trend_state && reasons.length === 0) {
      reasons.push('資料池標記：' + daily.trend_state);
    }

    return { state, reason: reasons };
  }

  function analyzePosition(close, daily) {
    const ma20 = num(daily.ma20, null);
    const prevHigh = num(daily.prev_high20, null);
    const recentLow = num(daily.recent_low10, null);
    const bollUb = num(daily.boll_ub, null);
    const bollLb = num(daily.boll_lb, null);
    const reasons = [];
    let state = '中位';

    if (bollUb != null && (close >= bollUb || isNear(close, bollUb, 1.5))) {
      state = '高位';
      reasons.push('接近或觸及日線 BOLL 上緣');
    } else if (bollLb != null && (close <= bollLb || isNear(close, bollLb, 1.5))) {
      state = '低位';
      reasons.push('接近或觸及日線 BOLL 下緣');
    } else if (prevHigh != null && isNear(close, prevHigh, NEAR_PCT)) {
      state = '壓力附近';
      reasons.push('接近 20 日前高壓力');
    } else if (
      (ma20 != null && isNear(close, ma20, NEAR_PCT)) ||
      (recentLow != null && isNear(close, recentLow, NEAR_PCT))
    ) {
      state = '支撐附近';
      if (ma20 != null && isNear(close, ma20, NEAR_PCT)) {
        reasons.push('接近 MA20 支撐');
      }
      if (recentLow != null && isNear(close, recentLow, NEAR_PCT)) {
        reasons.push('接近 10 日低點');
      }
    } else if (ma20 != null && close > ma20 * 1.05) {
      state = '高位';
      reasons.push('收盤明顯高於 MA20');
    } else if (ma20 != null && close < ma20 * 0.98) {
      state = '低位';
      reasons.push('收盤低於 MA20 區間');
    } else {
      reasons.push('位於均線與通道中間區');
    }

    return { state, reason: reasons };
  }

  function analyzeExtension(close, daily, weekly) {
    const dist = num(daily.distance_ma20_pct, 0);
    const bollUb = num(daily.boll_ub, null);
    const wBollUb = num(weekly.boll_ub, null);
    const reasons = [];
    let state = '正常';

    if (close >= bollUb || dist > 10) {
      state = '過熱';
      if (close >= bollUb) reasons.push('收盤觸及或突破日線 BOLL 上緣');
      if (dist > 10) reasons.push('距 MA20 超過 10%');
    } else if (wBollUb != null && close >= wBollUb * BOLL_NEAR) {
      state = '過熱';
      reasons.push('接近或觸及週線 BOLL 上緣');
    } else if (dist >= 5 && dist <= 10) {
      state = '偏熱';
      reasons.push('距 MA20 約 ' + dist.toFixed(1) + '%');
    } else if (daily.extension_state) {
      if (/過熱|偏熱/.test(daily.extension_state)) {
        state = daily.extension_state.includes('過') ? '過熱' : '偏熱';
      }
      reasons.push('延伸狀態：' + daily.extension_state);
    } else {
      reasons.push('距 MA20 偏離在正常範圍');
    }

    return { state, reason: reasons };
  }

  function analyzeVolume(daily) {
    const vr = num(daily.volume_ratio, null);
    const reasons = [];
    let state = '中性';

    if (vr == null) {
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

  function collectWarnings(close, daily, weekly) {
    const warnings = [];
    const dist = num(daily.distance_ma20_pct, 0);
    const upper = num(daily.upper_shadow_ratio, 0);
    const consec = num(daily.consecutive_up, 0);
    const bollUb = num(daily.boll_ub, null);
    const wBollUb = num(weekly.boll_ub, null);

    if (upper > 0.35) warnings.push('長上影，上影比例 ' + (upper * 100).toFixed(0) + '%');
    if (consec >= 3) warnings.push('連續上漲 ' + consec + ' 日');
    if (dist > 10) warnings.push('距離 MA20 超過 10%');
    if (bollUb != null && close >= bollUb * BOLL_NEAR) {
      warnings.push('接近日線 BOLL 上緣');
    }
    if (wBollUb != null && close >= wBollUb * BOLL_NEAR) {
      warnings.push('接近週線 BOLL 上緣');
    }

    return warnings;
  }

  function collectLabels(trend, position, extension, volume) {
    const labels = [];
    if (trend.state === '多頭' || trend.state === '轉強') labels.push('趨勢偏多');
    if (position.state === '支撐附近') labels.push('靠近支撐');
    if (position.state === '壓力附近') labels.push('靠近壓力');
    if (extension.state === '偏熱') labels.push('延伸偏熱');
    if (extension.state === '過熱') labels.push('延伸過熱');
    if (volume.state === '健康放大') labels.push('量能健康放大');
    if (volume.state === '爆量') labels.push('爆量警示');
    if (volume.state === '量縮') labels.push('量縮');
    return labels;
  }

  function scoreTrend(trend) {
    const map = { 多頭: 88, 轉強: 72, 震盪: 50, 轉弱: 32, 空頭: 15 };
    return map[trend.state] ?? 50;
  }

  function scorePosition(position) {
    const map = {
      低位: 35,
      支撐附近: 55,
      中位: 50,
      高位: 72,
      壓力附近: 78,
    };
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

  function buildSummary(record, trend, position, extension, warnings) {
    if (record.analysis?.summary) return record.analysis.summary;
    const parts = [];
    parts.push('趨勢「' + trend.state + '」');
    parts.push('位置「' + position.state + '」');
    parts.push('延伸「' + extension.state + '」');
    if (warnings.length) {
      parts.push('注意：' + warnings.slice(0, 2).join('、'));
    } else {
      parts.push('暫無顯著過熱警示');
    }
    return parts.join('；') + '。';
  }

  function analyze(record) {
    if (!record || !record.code) {
      throw new Error('TechnicalEngine.analyze 需要含 code 的 record');
    }

    const daily = pickDaily(record);
    const weekly = pickWeekly(record);
    const close = num(
      record.latest?.close ?? daily.close ?? (record.series?.length
        ? record.series[record.series.length - 1].close
        : null),
      null
    );

    const trend = analyzeTrend(close, daily, record.series);
    const position = analyzePosition(close, daily);
    const extension = analyzeExtension(close, daily, weekly);
    const volume = analyzeVolume(daily);
    const supportResistance = buildSupportResistance(record, daily);
    const warnings = collectWarnings(close, daily, weekly);
    const labels = collectLabels(trend, position, extension, volume);

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
      summary: buildSummary(record, trend, position, extension, warnings),
      meta: {
        code: record.code,
        name: record.name || record.code,
        close,
        as_of: record.as_of || null,
      },
    };
  }

  function findRecord(pool, query) {
    if (!pool || !query) return null;
    const q = String(query).trim().toUpperCase();
    const records = pool.records || pool;
    if (!Array.isArray(records)) return null;
    return (
      records.find((r) => String(r.code).toUpperCase() === q) ||
      records.find((r) => String(r.name || '').includes(query.trim())) ||
      null
    );
  }

  return {
    analyze,
    findRecord,
    NEAR_PCT,
    BOLL_NEAR,
  };
});
