"""One-issue authorized comparison exception, not a permanent SOP change.
Run after the normal builder; do not use for another issue date.
"""
import json, re, shutil
from pathlib import Path
from decimal import Decimal
ROOT=Path(__file__).resolve().parents[1]
DATE='2026-09-23'
NOTE='9/22水位資料缺漏，暫以9/21的67.7%作比較基準；今日66.7%，較該基準下降1.0個百分點，非相較昨日的實測變化。'
def read(p): return json.loads(p.read_text())
def save(p,d): p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
issue=read(ROOT/'data/issues/20260923.json')
assert issue['date']==DATE and issue['ark']['water_level']==66.7
assert Decimal('66.7')-Decimal('67.7')==Decimal('-1.0')
meta={'comparison_date':'2026-09-21','comparison_level':67.7,'comparison_is_provisional':True,'previous_trading_date':'2026-09-22','previous_trading_day_level':None,'daily_change':None,'comparison_change':-1.0,'comparison_note':NOTE,'exception_scope':DATE}
for name in ['data/morning-brief-context-latest.json','data/morning-brief-context/20260923.json']:
 p=ROOT/name; c=read(p); assert c['date']==DATE
 c['water'].update(meta)
 c['leader_policy']['water_policy'].update(meta)
 c['leader_policy']['water_policy']['interpretation']=NOTE+' 市場採輪動確認，不因指數紅盤加速曝險。'
 c['action_guidance']['water_comparison']=meta
 save(p,c)
p=ROOT/'data/water-level-history.json';h=read(p)
assert not any(x['date']=='2026-09-22' for x in h['records'])
assert next(x for x in h['records'] if x['date']=='2026-09-21')['water_level']==67.7
for x in h['records']:
 if x['date']==DATE: x.update(meta)
save(p,h)
logs=read(ROOT/'water-level-log.json'); logs=[x for x in logs if x['date']!=DATE]
assert not any(x['date']=='2026-09-22' for x in logs)
logs.insert(0,dict(date=DATE,holding_level='66.7%',market_state='04 輪動換手',cover='04 輪動換手',systemic_risk=issue['market']['systemic_risk'],vix='14.21 / -4.44%',taifex_night=issue['market']['futures']['line'],foreign_futures_net=issue['market']['foreign_oi']['value'],main_theme=issue['hero']['headline'],strategy=issue['strategy']['reader']['playbook'],risk_control=NOTE,**meta))
html=(ROOT/'docs/water-level.html').read_text()
m=re.search(r'(<script id="water-comparison-data" type="application/json">)(.*?)(</script>)',html,re.S)
assert m is not None
chart=json.loads(m.group(2));chart['comparison_exception']=meta
for row in chart['rows']:
 if row['date']==DATE: row.update(meta)
 if row['date']=='2026-09-22': assert row['water_level'] is None
html=html[:m.start(2)]+json.dumps(chart,ensure_ascii=False)+html[m.end(2):]
if 'id="water-comparison-exception"' not in html:
 html=html.replace('<section class="chart-panel"', '<p class="chart-note" id="water-comparison-exception">'+NOTE+'</p>\n  <section class="chart-panel"')
for folder in [ROOT,ROOT/'docs',ROOT/'site']:
 save(folder/'water-level-history.json',h);save(folder/'water-level-log.json',logs)
 (folder/'water-level.html').write_text(html)
 for name in ['20260923-stock-news-kelvin.html','index.html']:
  if folder!=ROOT/'docs': shutil.copyfile(ROOT/'docs'/name,folder/name)
 if (folder/'technical-spider.html').exists():
  p=folder/'technical-spider.html';t=p.read_text()
  t=re.sub(r'資料日期[：:]?\s*2026-\d{2}-\d{2}', '資料日期 2026-09-23', t)
  t=re.sub(r'資料池[：:]?\s*\d+\s*檔', '資料池 75 檔',t)
  p.write_text(t)
print('Exception metadata preserved in issue, context, history, log and chart; no 9/22 water record.')
