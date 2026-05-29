8 格封面合圖（canonical）：
  market-scenarios-8.png
  （相容舊路徑 market-scenarios-8.jpg 亦可）

版面（2 列 × 4 欄，background-size: 400% 200%）：
  01 強多頭/突破      02 高檔分化      03 震盪整理      04 回檔修正
  05 空頭/風險升高    06 盤後觀望      07 財報週/等待    08 AI主線爆發

CSS background-position 對照見 scenario-map.json

每日選封面流程：
  1. 讀方舟 11 張截圖 + 晨報各區文字
  2. 依 scenario-map.json 的 when 欄位比對
  3. 若 02 與 04 同時符合 → 優先 risk posture（spec §7.4）
  4. 更新 HTML cover-sprite 的 background-position 與 label

2026/05/29 判定：02 高檔分化
  理由：加權創高後回檔 -1.4%，但被動元件升溫區多檔逼近漲停，
        價值區權值同步修正——典型內部分化，非全面 risk-off。
