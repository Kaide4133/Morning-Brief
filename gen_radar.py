import json
import re
import statistics
import sys
import time
import urllib.request
from pathlib import Path


def get_tickers_from_html(html_path):
    html = Path(html_path).read_text(encoding='utf-8')
    m = re.search(r'<section id="s5".*?</section>\s*<section id="s6"', html, re.S)
    section = m.group(0) if m else html
    codes = []
    patterns = [r'data-code="(\d{4})"', r'<div class="card-code">\s*(\d{4})\s*</div>']
    for pat in patterns:
        for code in re.findall(pat, section):
            if code not in codes:
                codes.append(code)
    return codes


def fetch_yf(code):
    for suffix in ['.TW', '.TWO']:
        url = f'https://query2.finance.yahoo.com/v8/finance/chart/{code}{suffix}?range=3mo&interval=1d'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            data = json.loads(urllib.request.urlopen(req, timeout=10).read().decode('utf-8'))['chart']['result'][0]
            timestamps = data.get('timestamp') or []
            quote = data['indicators']['quote'][0]
            rows = []
            for i, ts in enumerate(timestamps):
                row = {
                    'date': time.strftime('%Y/%m/%d', time.localtime(ts)),
                    'open': quote.get('open', [None] * len(timestamps))[i],
                    'high': quote.get('high', [None] * len(timestamps))[i],
                    'low': quote.get('low', [None] * len(timestamps))[i],
                    'close': quote.get('close', [None] * len(timestamps))[i],
                    'volume': quote.get('volume', [None] * len(timestamps))[i],
                }
                if row['open'] is None or row['close'] is None:
                    continue
                rows.append(row)
            if len(rows) > 10:
                return rows, 'TWSE' if suffix == '.TW' else 'TPEX'
        except Exception:
            pass
    return [], 'UNKNOWN'


def sma(values, n):
    if len(values) < n:
        return None
    return sum(values[-n:]) / n


def enriched_series(rows):
    out = []
    for i, row in enumerate(rows[-60:]):
        prefix = rows[: len(rows) - len(rows[-60:]) + i + 1]
        closes = [r['close'] for r in prefix]
        ma5 = sma(closes, 5)
        ma10 = sma(closes, 10)
        ma20 = sma(closes, 20)
        if ma20 is not None and len(closes) >= 20:
            sd20 = statistics.stdev(closes[-20:]) if len(closes[-20:]) >= 2 else 0
            ub = ma20 + 2 * sd20
            lb = ma20 - 2 * sd20
        else:
            ub = lb = None
        out.append({
            'date': row['date'],
            'open': round(row['open'], 2),
            'high': round(row['high'], 2),
            'low': round(row['low'], 2),
            'close': round(row['close'], 2),
            'volume': int(row['volume'] or 0),
            'ma5': round(ma5, 2) if ma5 is not None else None,
            'ma10': round(ma10, 2) if ma10 is not None else None,
            'ma20': round(ma20, 2) if ma20 is not None else None,
            'boll_ub': round(ub, 2) if ub is not None else None,
            'boll_lb': round(lb, 2) if lb is not None else None,
        })
    return out


def analyze(rows):
    rows = [r for r in rows if all(r.get(k) is not None for k in ['open', 'high', 'low', 'close', 'volume'])]
    if len(rows) < 8:
        return None
    full_rows = rows[:]
    rows = rows[-60:]
    last = rows[-1]
    prev = rows[-2]
    closes = [r['close'] for r in rows]
    vols = [r['volume'] for r in rows]
    ma5 = sum(closes[-5:]) / min(5, len(closes))
    ma10 = sum(closes[-10:]) / min(10, len(closes))
    ma20 = sum(closes[-20:]) / min(20, len(closes))
    closes20 = closes[-20:]
    sd20 = statistics.stdev(closes20) if len(closes20) >= 2 else 0
    boll_ub = ma20 + 2 * sd20
    boll_lb = ma20 - 2 * sd20
    boll_bw = (boll_ub - boll_lb) / ma20 if ma20 else 0

    prev_vols = vols[-6:-1]
    avgv5 = sum(prev_vols) / max(1, len(prev_vols))
    vol_ratio = last['volume'] / avgv5 if avgv5 else None
    prev_high20 = max(r['high'] for r in rows[-21:-1]) if len(rows) >= 21 else max(r['high'] for r in rows[:-1])
    recent_low10 = min(r['low'] for r in rows[-10:])
    change_pct = (last['close'] / prev['close'] - 1) * 100 if prev['close'] else 0
    upper = (last['high'] - max(last['open'], last['close'])) / max(0.01, last['high'] - last['low']) if last['high'] > last['low'] else 0

    consec = 0
    for i in range(len(rows) - 1, 0, -1):
        if rows[i]['close'] > rows[i - 1]['close']:
            consec += 1
        else:
            break

    breakout = last['close'] > prev_high20
    trend = ma5 > ma10 > ma20
    dist_ma20 = (last['close'] / ma20 - 1) * 100 if ma20 else 0

    score = 0
    flags = []
    brakes = []
    if trend:
        score += 20
        flags.append('均線多頭排列')
    elif ma5 > ma10:
        score += 12
        flags.append('短均線轉強')
    if breakout:
        score += 25
        flags.append('突破近20日壓力')
    elif last['close'] >= prev_high20 * 0.97:
        score += 15
        flags.append('接近壓力區')
    if vol_ratio is not None:
        if 1.3 <= vol_ratio <= 3.0:
            score += 20
            flags.append('量能健康放大')
        elif vol_ratio > 3.0:
            score += 8
            brakes.append('爆量，需防長上影或隔日失速')
        elif vol_ratio < 0.8:
            brakes.append('量能不足')
    if upper < 0.3:
        score += 10
    else:
        brakes.append('上影線偏長')
    if abs(dist_ma20) <= 12:
        score += 10
    elif dist_ma20 > 18:
        brakes.append('離月線過遠')
    else:
        score += 4
    if consec >= 4:
        brakes.append(f'連漲{consec}日，追價風險升高')
        score -= 15
    if change_pct > 7:
        brakes.append('單日漲幅過大，開高不追')
        score -= 15
    if last['high'] >= boll_ub * 0.99:
        if boll_bw < 0.15 and vol_ratio and vol_ratio > 1.3 and prev['close'] < boll_ub:
            flags.insert(0, '布林通道收斂後帶量突破上軌')
            score += 15
        else:
            brakes.append('觸及或衝出布林上軌，極短線過熱防拉回')
            score -= 20

    score = max(0, min(100, round(score)))
    if score >= 75 and not any(('過遠' in b or '連漲' in b or '單日漲幅' in b or '布林上軌' in b) for b in brakes):
        stage = '可觀察'
    elif score >= 55:
        stage = '等回測'
    else:
        stage = '禁止追價'

    support = f'{round(ma10, 2)} (10日) / {round(ma20, 2)} (月線)'
    if prev_high20 > last['close']:
        resistance = f'{round(prev_high20, 2)} (前高) / {round(boll_ub, 2)} (布林上軌)'
    else:
        resistance = f'{round(boll_ub, 2)} (布林上軌)'

    return {
        **last,
        'change_pct': round(change_pct, 2),
        'ma5': round(ma5, 2),
        'ma10': round(ma10, 2),
        'ma20': round(ma20, 2),
        'boll_ub': round(boll_ub, 2),
        'boll_lb': round(boll_lb, 2),
        'boll_bw': round(boll_bw, 3),
        'vol_ratio': round(vol_ratio, 2) if vol_ratio else None,
        'prev_high20': round(prev_high20, 2),
        'recent_low10': round(recent_low10, 2),
        'upper_shadow_ratio': round(upper, 2),
        'consecutive_up': consec,
        'distance_ma20_pct': round(dist_ma20, 2),
        'breakout': breakout,
        'trend': trend,
        'score': score,
        'stage': stage,
        'flags': flags[:4],
        'brakes': brakes[:4] or ['開高超過5%或跌回突破平台，不追'],
        'support': support,
        'resistance': resistance,
        'series': enriched_series(full_rows),
    }


def main():
    html_path = sys.argv[1] if len(sys.argv) > 1 else '20260519-stock-news-kelvin.html'
    report_date = re.search(r'(20\d{6})', Path(html_path).name)
    as_of = f'{report_date.group(1)[:4]}-{report_date.group(1)[4:6]}-{report_date.group(1)[6:8]}' if report_date else time.strftime('%Y-%m-%d')
    codes = get_tickers_from_html(html_path)
    records = []
    missing = []
    for code in codes:
        rows, market = fetch_yf(code)
        analysis = analyze(rows) if rows else None
        if analysis:
            records.append({'code': code, 'market': market, 'analysis': analysis})
        else:
            missing.append(code)
        time.sleep(0.03)
    out = {
        'as_of': as_of,
        'source': 'Yahoo Finance daily data generated by Hermes',
        'universe': f'{as_of} Kelvin industry value/heating tickers',
        'records': records,
        'missing': missing,
    }
    Path('radar-technical.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'codes': len(codes), 'records': len(records), 'missing': missing}, ensure_ascii=False))


if __name__ == '__main__':
    main()
