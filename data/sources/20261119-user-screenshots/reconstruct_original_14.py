from pathlib import Path
import json,hashlib,shutil,datetime
R=Path('/Users/kaide/.hermes/cache/scratch/Morning-Brief-20261119-screenshots')
D=R/'data/sources/20261119-user-screenshots'; D.mkdir(parents=True,exist_ok=True)
ids='269f71de7293 b105bcced58e dd4211e21afb 02bfc1abe721 15c73f38a8ea 18d66e9fa56d 529e0403056d 6a145528f5fb b5a18ad317e1 68b6e2975bf7 bbb502503b05 2f67448aab1f 6c1243cfdda9 9fd2b18058e3'.split()
# Visual transcription: code|name|price|absolute change|percent|NAV or debt ratio|premium or industry
batches=[('water_level',''),('etf.value','''0055|元大MSCI金融|46.98|-1.3|-2.69|47.25|-0.57
00897|富邦基因免疫生技|13.36|-0.1|-0.74|13.33|0.23
00939|統一台灣高息動能|22.47|-0.62|-2.69|22.52|-0.22
00701|國泰股利精選30|40.15|-0.61|-1.50|40.23|-0.2
00875|國泰網路資安|60.2|3.75|6.64|59.41|1.33
00960|野村全球航運龍頭|20.62|-0.63|-2.96|20.86|-0.96
00918|大華優利高填息30|30.6|-0.91|-2.89|30.56|0.13
00731|復華富時高息低波|90.85|-2.5|-2.68|91.09|-0.26'''),('etf.value','''00939|統一台灣高息動能|22.47|-0.62|-2.69|22.52|-0.22
00701|國泰股利精選30|40.15|-0.61|-1.50|40.23|-0.2
00875|國泰網路資安|60.2|3.75|6.64|59.41|1.33
00960|野村全球航運龍頭|20.62|-0.63|-2.96|20.86|-0.96
00918|大華優利高填息30|30.6|-0.91|-2.89|30.56|0.13
00731|復華富時高息低波|90.85|-2.5|-2.68|91.09|-0.26
00919|群益台灣精選高息|29.15|-0.84|-2.80|29.16|-0.03
00878|國泰永續高股息|29.78|-0.87|-2.84|29.73|0.17'''),('etf.rising','''00683L|期元大美元指正2|23.56|0.12|0.51|23.64|-0.34
00682U|期元大美元指數|-|-|-|21.62|-0.74
00652|富邦印度|36.4|0.04|0.11|36.82|-1.14
00673R|期元大S&P原油反1|11.41|0.21|1.88|11.43|-0.17
00865B|國泰US短期公債|50.9|-0.05|-0.10|50.94|-0.08
00653L|富邦印度正2|50.65|0.35|0.70|50.83|-0.35
00689R|國泰20年美債反1|23.55|-0.14|-0.59|23.63|-0.36'''),('stocks.value','''2356|英業達|40.55|-1.75|-4.14|84.74|伺服器組裝代工
3706|神達|57.5|-2.3|-3.85|57.31|伺服器組裝代工
2347|聯強|74.3|0.8|1.09|70.60|3C通路商
2376|技嘉|260|-16.5|-5.97|79.08|板卡
3034|聯詠|436.5|-21.5|-4.69|33.43|驅動IC
3702|大聯大|80.2|-1.3|-1.60|85.41|IC零組件通路商
6669|緯穎|1410|-65|-4.41|72.73|伺服器組裝代工
2382|廣達|262.5|-2.5|-0.94|84.54|伺服器組裝代工'''),('stocks.value','''2382|廣達|262.5|-2.5|-0.94|84.54|伺服器組裝代工
5289|宜鼎|772|-64|-7.66|41.51|工業電腦
4958|臻鼎-KY|344|-38|-9.95|43.29|軟板
3042|晶技|117|-11.5|-8.95|23.97|石英元件
3711|日月光投控|504|-44|-8.03|63.53|IC封裝測試
3231|緯創|156|-6|-3.70|78.59|電腦及周邊產品
2301|光寶科|193.5|-14.5|-6.97|62.88|電源供應器
6414|樺漢|314.5|-12.5|-3.82|70.03|工業電腦'''),('stocks.value','''6414|樺漢|314.5|-12.5|-3.82|70.03|工業電腦
5347|世界|116.5|-7.5|-6.05|55.47|晶圓代工
2357|華碩|800|-41|-4.88|64.23|電腦及周邊產品
2404|漢唐|897|-30|-3.24|77.52|無塵室工程
5434|崇越|432.5|-41|-8.66|53.47|半導體設備
2027|大成鋼|45.8|-0.65|-1.40|40.70|不鏽鋼產品
2890|永豐金|39.1|-1.3|-3.22|93.30|金控
8069|元太|132.5|-8|-5.69|34.32|顯示器'''),('stocks.value','''8069|元太|132.5|-8|-5.69|34.32|顯示器
2330|台積電|2100|-75|-3.45|29.94|晶圓代工
1513|中興電|138.5|-5|-3.48|55.46|機電工程
6139|亞翔|549|-38|-6.47|73.57|無塵室工程
2379|瑞昱|726|-8|-1.09|67.30|IC設計
2454|聯發科|3720|-220|-5.58|50.94|IC設計
6670|復盛應用|260.5|-5.5|-2.07|35.53|高爾夫球
3293|鈊象|792|-7|-0.88|23.59|軟體遊戲'''),('stocks.value','''2330|台積電|2100|-75|-3.45|29.94|晶圓代工
1513|中興電|138.5|-5|-3.48|55.46|機電工程
6139|亞翔|549|-38|-6.47|73.57|無塵室工程
2379|瑞昱|726|-8|-1.09|67.30|IC設計
2454|聯發科|3720|-220|-5.58|50.94|IC設計
6670|復盛應用|260.5|-5.5|-2.07|35.53|高爾夫球
3293|鈊象|792|-7|-0.88|23.59|軟體遊戲
1476|儒鴻|384.5|0.5|0.13|16.78|成衣'''),('stocks.rising','''6199|天品|172.5|1|0.58|34.73|傳產其他
5324|士開|12.45|-0.05|-0.40|86.90|餐飲
8426|紅木-KY|23.65|-0.05|-0.21|50.05|建材
9933|中鼎|56.6|-0.9|-1.57|78.37|營造工程
8455|大拓-KY|35|-0.1|-0.28|57.23|機械
4807|日成-KY|37|2.5|7.25|44.71|文化創意
7584|樂意|44.45|4|9.89|39.06|軟體遊戲
2540|愛山林|48.75|1.25|2.63|81.27|地產代銷'''),('stocks.rising','''2540|愛山林|48.75|1.25|2.63|81.27|地產代銷
4174|浩鼎|69.8|-7.7|-9.94|26.21|製藥業
1476|儒鴻|384.5|0.5|0.13|16.78|成衣
6904|伯鑫|-|-|-|39.29|工具機
5511|德昌|71.3|0.4|0.56|53.25|營造工程
910322|康師傅-DR|28.35|-0.3|-1.05|72.93|飲料相關
8415|大國鋼|42.2|0.6|1.44|32.08|鋼鐵產品
3054|立萬利|60.9|-1.4|-2.25|9.16|生技其他'''),('stocks.rising','''3054|立萬利|60.9|-1.4|-2.25|9.16|生技其他
3293|鈊象|792|-7|-0.88|23.59|軟體遊戲
6743|安普新|34.35|-0.8|-2.28|74.68|消費性電子產品
2852|第一保|28.15|-0.8|-2.76|51.21|保險
6108|競國|38.25|-4.25|-10.00|59.58|硬板
5206|坤悅|24.4|-0.6|-2.40|70.58|營造工程
9935|慶豐富|19.7|-0.6|-2.96|68.86|家居用品
2636|台驊控股|70.3|-1.8|-2.50|56.45|航運其他'''),('stocks.rising','''2636|台驊控股|70.3|-1.8|-2.50|56.45|航運其他
1323|永裕|22.55|-0.65|-2.80|41.53|塑膠製品
2618|長榮航|46.4|-0.4|-0.85|59.55|航運其他
2610|華航|22.5|-0.4|-1.75|72.31|航運其他
4106|雃博|24.35|0.05|0.21|20.94|醫療器材
3004|豐達科|123.5|-6|-4.63|60.17|航天軍工
3489|森寶|22.6|-0.3|-1.31|78.19|營造工程
6470|宇智|44.2|-2|-4.33|31.98|網路設備'''),('stocks.rising','''1323|永裕|22.55|-0.65|-2.80|41.53|塑膠製品
2618|長榮航|46.4|-0.4|-0.85|59.55|航運其他
2610|華航|22.5|-0.4|-1.75|72.31|航運其他
4106|雃博|24.35|0.05|0.21|20.94|醫療器材
3004|豐達科|123.5|-6|-4.63|60.17|航天軍工
3489|森寶|22.6|-0.3|-1.31|78.19|營造工程
6470|宇智|44.2|-2|-4.33|31.98|網路設備
5348|正能量智能|15.8|-1.55|-8.93|44.32|無線通訊設備''')]
assert len(ids)==len(batches)==14
manifest=[]; zones={k:{} for k in ['etf.value','etf.rising','stocks.value','stocks.rising']}; observations=0
for i,(n,(zone,text)) in enumerate(zip(ids,batches),1):
 fn='img_'+n+'.jpg'; paths=list(Path('/Users/kaide/.hermes/cache/documents/native-inputs').rglob(fn)); assert len(paths)==1
 p=paths[0]; shutil.copy2(p,D/fn); sha=hashlib.sha256(p.read_bytes()).hexdigest(); rows=[]
 for line in text.splitlines():
  code,name,price,move,pct,metric,other=line.split('|'); assert code not in [x['code'] for x in rows]
  row={'code':code,'name':name,'price':None if price=='-' else price,'change':None if move=='-' else ('▲' if float(move)>0 else '▼')+str(abs(float(move))).rstrip('0').rstrip('.')+' ('+('+' if float(pct)>0 else '')+pct+'%)','source_file':fn,'source_sha256':sha,'raw_text':line,'confidence':'high','stamp':zone.split('.')[-1]}
  if zone.startswith('etf'):
   row.update(nav=metric,premium_discount=other+'%'); row['meta']='股價 '+(row['price'] or '—')+'｜'+(row['change'] or '漲跌 —')+'｜即時淨值 '+metric+'｜折溢價 '+other+'%'
  else:
   row.update(industry=other,debt_ratio=metric); row['meta']='股價 '+(row['price'] or '—')+'｜'+(row['change'] or '漲跌 —')+'｜負債比率 '+metric+'%'
  if code in zones[zone]:
   old=zones[zone][code]; assert old['raw_text']==line,(code,old,line); old['source_files'].append(fn)
  else:
   row['source_files']=[fn]; zones[zone][code]=row.copy()
  rows.append(row); observations+=1
 trans={'image_index':i,'filename':fn,'section':zone,'rows':rows,'raw_text':text,'visually_reviewed':True,'uncertain_items':[],'source_capture_timestamp':None,'phone_time_context':None if i==1 else ('13:32 display; AM/PM not explicit' if i<=10 else '13:33 display; AM/PM not explicit')}
 if i==1:
  trans.update(water_level=80.7,update_countdown='32:40 min sec',countdown_days=None,indicator_labels=['全球散戶','外資情緒','位階增溫','社交反指','量能暴衝'],indicator_numeric_values=None,raw_text='風控運算\n持股配置建議 80.7%\n更新倒數 32:40 min sec\n全球散戶｜外資情緒｜位階增溫｜社交反指｜量能暴衝\nNo numeric dial scores or countdown days printed')
 (D/(fn+'.transcription.json')).write_text(json.dumps(trans,ensure_ascii=False,indent=2)+'\n')
 manifest.append({'index':i,'filename':fn,'original_path':str(p),'sha256':sha,'bytes':p.stat().st_size,'section':zone,'visible_complete_rows':len(rows),'transcription':fn+'.transcription.json','capture_timestamp':None,'date_authority':'user explicitly designated 2026-11-19; images have no printed date','visually_reviewed':True})
counts={k:len(v) for k,v in zones.items()}; overlaps={a:sorted(set(zones[a+'.value'])&set(zones[a+'.rising'])) for a in ['etf','stocks']}; universe=sorted(set().union(*(set(x) for x in zones.values())))
source={'schema_version':'ark.user_screenshot_reconstruction.v1','date':'2026-11-19','image_count':14,'captured_at':None,'reconstructed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'water_level':80.7,'countdown_days':None,'update_countdown':'32:40 min sec','five_indicators':{'status':'visible_analog_only','numeric_scores':None,'capture_timestamp':None},'zones':{k:list(v.values()) for k,v in zones.items()},'counts':counts,'overlaps':overlaps,'unique_codes':universe,'observed_rows':observations,'duplicate_observations_removed':observations-sum(counts.values()),'supersedes':'data/public-market/20261119.json same_day_unavailable; prior 2026-11-18 Ark remains historical only','uncertain_items':['Exact capture timestamps unavailable; phone times not capture timestamps','No printed dial numbers: exact official indicator scores unavailable','No day countdown visible; 32:40 is minute/second update timer','US zones not supplied; do not infer US zone membership']}
(D/'manifest.json').write_text(json.dumps({'expected_images':14,'actual_images':len(manifest),'images':manifest},ensure_ascii=False,indent=2)+'\n')
(D/'reconstructed-ark.json').write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n')
(D/'watchlist.json').write_text(json.dumps({'codes':universe})+'\n')
print(json.dumps({k:source[k] for k in ['image_count','counts','overlaps','observed_rows','duplicate_observations_removed','unique_codes']},ensure_ascii=False,indent=2))
