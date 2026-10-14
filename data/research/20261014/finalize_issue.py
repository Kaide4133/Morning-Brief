"""Date-guarded artifact finalizer; preserves historical provenance."""
import json, shutil
from pathlib import Path
R=Path(__file__).resolve().parents[3]
DATE='2026-10-14'; SLUG='20261014'
def load(p): return json.loads(p.read_text())
def save(p,d):
 p.parent.mkdir(parents=True,exist_ok=True)
 p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
d=load(R/f'data/issues/{SLUG}.json')
assert d['date']==DATE and d['ark']['water_level']==65.6
for name in [f'{SLUG}-stock-news-kelvin.html','index.html']:
 for dest in [R/name,R/'site'/name]: shutil.copy2(R/'docs'/name,dest)
for prefix in ['', 'docs/','site/']:
 shutil.copy2(R/'data/water-level-history.json',R/(prefix+'water-level-history.json'))
log=load(R/'water-level-log.json'); assert isinstance(log,list)
row={'date':DATE,'holding_level':d['ark']['holding_allocation_suggestion'],'market_state':d['scenario_label'],'cover':d['scenario_label'],'systemic_risk':d['market']['systemic_risk'],'vix':str(d['market']['vix']['value']),'taifex_night':d['market']['futures']['line'],'foreign_futures_net':d['market']['foreign_oi']['value'],'main_theme':d['title'],'strategy':d['strategy']['thesis'],'risk_control':d['ark']['note']}
log=[row]+[x for x in log if x['date']!=DATE]
for prefix in ['', 'docs/','site/']: save(R/(prefix+'water-level-log.json'),log)
ctx=load(R/f'data/morning-brief-context/{SLUG}.json')
assert ctx['valid_for_trading_date']==DATE and abs(ctx['water']['change']+1.8)<1e-8
ctx['leader_policy']['water_policy']['interpretation']=d['ark']['note']
for prefix in ['data/','','docs/','site/']:
 save(R/(prefix+f'morning-brief-context/{SLUG}.json'),ctx)
 latest=R/(prefix+'morning-brief-context-latest.json')
 if latest.exists(): assert load(latest)['valid_for_trading_date']<=DATE
 save(latest,ctx)
print('Finalized mirrors and exact numerical water interpretation; action rules unchanged.')
