"""One-issue mirror/context finalizer; run after Oct8 build only."""
import json,shutil
from pathlib import Path
R=Path(__file__).resolve().parents[3]
def load(p):return json.loads(p.read_text())
def save(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
d=load(R/'data/issues/20261008.json');assert d['date']=='2026-10-08' and d['ark']['water_level']==66.5
for f in ['data/morning-brief-context/20261008.json','data/morning-brief-context-latest.json']:
 p=R/f;c=load(p);assert c['date']=='2026-10-08'
 c['leader_policy']['water_policy']['interpretation']='水位較前一交易日下降0.9個百分點，可配置空間收斂；先按風控決定可持有總額，再按固定價值判定選擇資金位置。'
 save(p,c)
p=R/'water-level-log.json'; log=load(p)
row={'date':d['date'],'holding_level':'66.5%','market_state':'06 風險收縮','cover':'06 風險收縮','systemic_risk':'中','vix':'15.08 / +0.47%','taifex_night':'近月臺指期49,464點、-1.01%（10/8 09:30盤中）','foreign_futures_net':'-79,101 口（10/7日終）','main_theme':d['title'],'strategy':d['strategy']['playbook'],'risk_control':d['ark']['note']}
log=[row]+[x for x in log if x['date']!=d['date']]
for base in [R,R/'docs',R/'site']:
 save(base/'water-level-log.json',log)
 shutil.copy2(R/'data/water-level-history.json',base/'water-level-history.json')
 if base!=R/'docs':
  for name in ['20261008-stock-news-kelvin.html','index.html']:shutil.copy2(R/'docs'/name,base/name)
print('Oct8 mirrors and numeric-direction context finalized')
