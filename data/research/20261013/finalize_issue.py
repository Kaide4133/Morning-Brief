# -*- coding: utf-8 -*-
"""Date-guarded artifact mirrors and exact water wording; run after builder."""
import json,shutil
from pathlib import Path
R=Path(__file__).resolve().parents[3]
def load(p):return json.loads(p.read_text())
def save(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
d=load(R/'data/issues/20261013.json');assert d['date']=='2026-10-13' and d['ark']['water_level']==67.4
for name in ['20261013-stock-news-kelvin.html','index.html']:
 for dest in [R/name,R/'site'/name]:shutil.copy2(R/'docs'/name,dest)
for prefix in ['', 'docs/','site/']:
 shutil.copy2(R/'data/water-level-history.json',R/(prefix+'water-level-history.json'))
log=load(R/'water-level-log.json');assert isinstance(log,list)
row={'date':d['date'],'holding_level':'67.4%','market_state':d['scenario_label'],'cover':d['scenario_label'],'systemic_risk':d['market']['systemic_risk'],'vix':'15.21 / +2.49%','taifex_night':'10/13 09:15盤中 48715 / -630','foreign_futures_net':'10/12 -82,806 口','main_theme':'水位續升／科技承壓／價值優先','strategy':d['strategy']['thesis'],'risk_control':d['ark']['note']}
log=[row]+[x for x in log if x['date']!=d['date']]
for prefix in ['', 'docs/','site/']:save(R/(prefix+'water-level-log.json'),log)
ctx=load(R/'data/morning-brief-context/20261013.json');assert ctx['valid_for_trading_date']==d['date'] and ctx['water']['change']==.5
ctx['leader_policy']['water_policy']['interpretation']=d['ark']['note']+'價格承接尚未擴散，新增配置仍待確認。'
for prefix in ['data/','','docs/','site/']:
 save(R/(prefix+'morning-brief-context/20261013.json'),ctx)
 latest=R/(prefix+'morning-brief-context-latest.json')
 if latest.exists():assert load(latest)['valid_for_trading_date']<=d['date']
 save(latest,ctx)
print('Finalized dated/root/docs/site mirrors and exact water interpretation; action rules unchanged.')
