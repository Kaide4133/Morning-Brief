import re, json, urllib.request, time, statistics
html=open('/tmp/Morning-Brief-20260518-update/20260518-stock-news-kelvin.html',encoding='utf-8').read()
m=re.search(r'<section id="s5".*?</section>\s*<section id="s6"', html, re.S)
section=m.group(0) if m else html
codes=[]
for code in re.findall(r'data-code="(\d{4})"', section):
    if code not in codes: codes.append(code)

def num(x):
    if x is None: return None
    s=str(x).replace(',','').replace('--','').strip()
    if not s or s in ['X','除權息']: return None
    try: return float(s)
    except: return None

def fetch_twse(code, y, m):
    url=f'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date={y}{m:02d}01&stockNo={code}&response=json'
    req=urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
    try: data=json.loads(urllib.request.urlopen(req, timeout=12).read().decode('utf-8','ignore'))
    except Exception: return []
    if data.get('stat')!='OK': return []
    rows=[]
    for r in data.get('data',[]):
        if len(r)<7: continue
        rows.append({'date':r[0], 'volume':num(r[1]), 'open':num(r[3]), 'high':num(r[4]), 'low':num(r[5]), 'close':num(r[6])})
    return rows

def fetch_tpex(code, y, m):
    url=f'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code={code}&date={y}/{m:02d}/01&response=json'
    req=urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
    try: data=json.loads(urllib.request.urlopen(req, timeout=12).read().decode('utf-8','ignore'))
    except Exception: return []
    rows=[]
    for t in data.get('tables') or []:
        for r in t.get('data',[]):
            if len(r)<7: continue
            rows.append({'date':r[0], 'volume':num(r[1]), 'open':num(r[3]), 'high':num(r[4]), 'low':num(r[5]), 'close':num(r[6])})
    return rows

def analyze(rows):
    rows=[r for r in rows if all(r.get(k) is not None for k in ['open','high','low','close','volume'])]
    if len(rows)<8: return None
    rows=rows[-30:]
    last=rows[-1]; prev=rows[-2]
    closes=[r['close'] for r in rows]; vols=[r['volume'] for r in rows]
    ma5=sum(closes[-5:])/min(5,len(closes)); ma10=sum(closes[-10:])/min(10,len(closes)); ma20=sum(closes[-20:])/min(20,len(closes))
    
    # BOLL Calculations
    closes20 = closes[-20:]
    sd20 = statistics.stdev(closes20) if len(closes20) >= 2 else 0
    boll_ub = ma20 + 2 * sd20
    boll_lb = ma20 - 2 * sd20
    boll_bw = (boll_ub - boll_lb) / ma20 if ma20 else 0

    prev_vols=vols[-6:-1]; avgv5=sum(prev_vols)/max(1,len(prev_vols)); vol_ratio=last['volume']/avgv5 if avgv5 else None
    prev_high20=max(r['high'] for r in rows[-21:-1]) if len(rows)>=21 else max(r['high'] for r in rows[:-1])
    recent_low10=min(r['low'] for r in rows[-10:])
    change_pct=(last['close']/prev['close']-1)*100 if prev['close'] else 0
    upper=(last['high']-max(last['open'],last['close']))/max(0.01,last['high']-last['low']) if last['high']>last['low'] else 0
    consec=0
    for i in range(len(rows)-1,0,-1):
        if rows[i]['close']>rows[i-1]['close']: consec+=1
        else: break
    breakout=last['close']>prev_high20; trend=ma5>ma10>ma20; dist_ma20=(last['close']/ma20-1)*100 if ma20 else 0
    score=0; flags=[]; brakes=[]
    
    if trend: score+=20; flags.append('均線多頭排列')
    elif ma5>ma10: score+=12; flags.append('短均線轉強')
    if breakout: score+=25; flags.append('突破近20日壓力')
    elif last['close']>=prev_high20*0.97: score+=15; flags.append('接近壓力區')
    
    if vol_ratio is not None:
        if 1.3<=vol_ratio<=3.0: score+=20; flags.append('量能健康放大')
        elif vol_ratio>3.0: score+=8; brakes.append('爆量，需防長上影或隔日失速')
        elif vol_ratio<0.8: brakes.append('量能不足')
    
    if upper<0.3: score+=10
    else: brakes.append('上影線偏長')
    
    if abs(dist_ma20)<=12: score+=10
    elif dist_ma20>18: brakes.append('離月線過遠')
    else: score+=4
    
    if consec>=4: brakes.append(f'連漲{consec}日，追價風險升高'); score-=15
    if change_pct>7: brakes.append('單日漲幅過大，開高不追'); score-=15

    # BOLL Checks
    if last['high'] >= boll_ub * 0.99:
        if boll_bw < 0.15 and vol_ratio and vol_ratio > 1.3 and prev['close'] < boll_ub:
            flags.insert(0, '布林通道收斂後帶量突破上軌')
            score += 15
        else:
            brakes.append('觸及或衝出布林上軌，極短線過熱防拉回')
            score -= 20

    score=max(0,min(100,round(score)))
    if score>=75 and not any(('過遠' in b or '連漲' in b or '單日漲幅' in b or '布林上軌' in b) for b in brakes): stage='可觀察'
    elif score>=55: stage='等回測'
    else: stage='禁止追價'
    
    return {
        **last,'change_pct':round(change_pct,2),'ma5':round(ma5,2),'ma10':round(ma10,2),'ma20':round(ma20,2),
        'boll_ub':round(boll_ub,2), 'boll_lb':round(boll_lb,2), 'boll_bw':round(boll_bw,3),
        'vol_ratio':round(vol_ratio,2) if vol_ratio else None,'prev_high20':round(prev_high20,2),
        'recent_low10':round(recent_low10,2),'upper_shadow_ratio':round(upper,2),'consecutive_up':consec,
        'distance_ma20_pct':round(dist_ma20,2),'breakout':breakout,'trend':trend,'score':score,
        'stage':stage,'flags':flags[:4],'brakes':brakes[:4] or ['開高超過5%或跌回突破平台，不追']
    }

records=[]; missing=[]
for code in codes:
    rows=fetch_twse(code,2026,4)+fetch_twse(code,2026,5); market='TWSE'
    if len(rows)<8:
        rows=fetch_tpex(code,2026,4)+fetch_tpex(code,2026,5); market='TPEX'
    a=analyze(rows)
    if a: records.append({'code':code,'market':market,'analysis':a})
    else: missing.append(code)
    time.sleep(0.05)
out={'as_of':'2026-05-18','source':'TWSE/TPEX official daily data generated by Hermes','universe':'2026-05-18 Kelvin industry value/heating tickers','records':records,'missing':missing}
open('/tmp/Morning-Brief-20260518-update/radar-technical.json','w',encoding='utf-8').write(json.dumps(out,ensure_ascii=False,indent=2))
print(json.dumps({'codes':len(codes),'records':len(records),'missing':missing[:20]},ensure_ascii=False))