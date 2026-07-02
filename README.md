# Kelvin Wiggly Morning Brief — 固定模板工作流

每日只需：**11 張方舟截圖 → 填一份 JSON → 一鍵建置 → 推送 GitHub**。

## 目錄結構

```
Kelvin-Morning-Brief/
├── data/issues/           ← 每日資料（JSON）
│   ├── _template.json     ← 複製這份開始新的一天
│   └── 20260529.json
├── templates/             ← 固定 HTML 模板（勿改除非改版）
│   ├── morning-brief.html.j2
│   ├── index.html.j2
│   ├── macros.html.j2
│   └── icons.json
├── docs/                  ← 建置輸出（GitHub Pages 選 /docs 發布）
│   ├── assets/
│   ├── index.html
│   └── YYYYMMDD-stock-news-kelvin.html
└── tools/
    ├── build_brief.py     ← JSON → HTML
    ├── fetch_market.py    ← SOX / VIX / Mag7（Yahoo）
    ├── x_fetch.py         ← X API（§VII–IX，可選）
    └── push_github.py     ← 推送 GitHub
```

## 第一次設定

```powershell
cd C:\Users\DELL\Documents\Kelvin-Morning-Brief
pip install -r requirements.txt
copy .env.example .env
# 編輯 .env，填入 GITHUB_PAT
```

GitHub Pages：**Settings → Pages → Branch `main` → Folder `/docs`**

（GitHub 介面只有 **root** 和 **docs** 兩種，沒有 site。）

## 手機操作（推薦）

電腦不在身邊時，用 **GitHub App + 自動建置** 即可發布晨報。

### 事前準備（做一次）

1. 手機安裝 **GitHub** App（iOS / Android）
2. Repo → **Settings → Secrets → Actions** → 新增：
   - `X_BEARER_TOKEN`（選填，自動抓 X 訊號用）
3. 確認 Pages 設為 **`main` + `/docs`**
4. 把晨報網址加到手機主畫面：
   - https://kaide4133.github.io/Morning-Brief/

### 每日手機流程

**① 填資料**

- 方式 A：手機把 **11 張方舟截圖** 丟給 Cursor / AI，請它產出 JSON，再貼到 GitHub
- 方式 B：在 GitHub App 編輯  
  `data/issues/YYYYMMDD.json`（可複製前一日 JSON 再改）

路徑：Repo → 檔案 → `data/issues/20260530.json` → 鉛筆圖示編輯 → Commit

**② 一鍵發布**

Repo → **Actions** → **Publish Morning Brief** → **Run workflow**

- `date` 可填 `20260530`（只建置該日）或留空（重建全部）
- 約 1–2 分鐘後，網站自動更新

**③ 預覽**

打開 https://kaide4133.github.io/Morning-Brief/

> 推送 JSON 到 `data/issues/` 也會自動觸發建置；手動 Run workflow 可強制重建。

### 手機 vs 電腦

| 項目 | 手機 | 電腦 |
|------|------|------|
| 看晨報 | ✅ 瀏覽器 | ✅ |
| 編輯 JSON | ✅ GitHub App | ✅ Cursor |
| 上傳截圖給 AI | ✅ | ✅ 較方便 |
| 一鍵發布 | ✅ Actions | ✅ `daily.ps1` |


### 1. 上傳 11 張方舟截圖給 AI / 自行填 JSON

| 截圖 | 填入 JSON 區塊 |
|---|---|
| 1 水位儀表 | `ark`, `scenario_id`, 五維描述 |
| 2 ETF 價值區 | `etf.value`（10 檔） |
| 3 ETF 升溫區 | `etf.rising` + `etf.overlap` |
| 4–6 產業價值區 | `stocks.value`（取 10 檔代表） |
| 7–10 產業升溫區 | `stocks.rising` + `stocks.overlap` |
| — | `market` / `mag7` 等查 Yahoo、TAIFEX |

```powershell
copy data\issues\_template.json data\issues\20260530.json
# 編輯 20260530.json
python tools\fetch_market.py          # 參考 SOX/VIX 數字
python tools\build_brief.py data\issues\20260530.json
```

### 2. 預覽

用瀏覽器開啟 `docs\20260530-stock-news-kelvin.html`

### 3. 推送 GitHub

```powershell
$env:GITHUB_PAT = "ghp_xxxx"   # 或寫入 .env 後手動 export
python tools\build_brief.py --all
python tools\push_github.py --init -m "2026/05/30 morning brief"
```

## 封面 8 情境

合圖：`docs/assets/covers/ChatGPT Image 2026年7月2日 下午07_51_15.png`
對照：`docs/assets/covers/scenario-map.json`

在 JSON 設 `scenario_id`: `"01"`–`"08"`，模板自動裁切封面。

## X Console（§VII–IX）

### 第一次設定（約 5 分鐘）

**1. X Developer Console 取得金鑰**

1. 登入 [developer.x.com](https://developer.x.com/)
2. 進入你的 **Project → App**
3. 在 **Keys and tokens** 複製：
   - **Client ID**（OAuth 2.0 Client ID）
   - **Client Secret**（OAuth 2.0 Client Secret）

> Client ID / Secret 本身**不能直接抓貼文**，但可換成 **Bearer Token** 供腳本使用。你已儲值 $10 的帳號通常已具 Read 權限。

**2. 寫入 `.env`**

```powershell
cd C:\Users\DELL\Documents\Kelvin-Morning-Brief
copy .env.example .env
notepad .env
```

填入（**不要貼到聊天或 GitHub**）：

```
X_CLIENT_ID=你的_Client_ID
X_CLIENT_SECRET=你的_Client_Secret
```

**3. 換 Token 並測試**

```powershell
python tools\x_token.py          # 自動換 Bearer Token 寫入 .env
python tools\x_fetch.py --dry-run   # 預覽會抓哪些 X 重點
```

### 每日怎麼用（與晨報連動）

填好當日 JSON 後：

```powershell
python tools\x_fetch.py data\issues\20260530.json
python tools\build_brief.py data\issues\20260530.json
```

或用一鍵腳本（已含 x_fetch）：

```powershell
.\tools\daily.ps1 -Date 20260530
```

`x_fetch` 會依 `data/x-watchlist.json` 監控 Trump、Musk、Fed、白宮、NVIDIA 等，**自動挑市場相關重點**寫入 JSON 的 §VII–IX，再建置進 HTML。

| 你的金鑰 | 晨報裡變成什麼 |
|---------|---------------|
| Client ID + Secret | → Bearer Token → 抓 X 貼文 |
| x_fetch 評分篩選 | → `intelligence.trump` / `.musk` / `.policy` |
| build_brief | → 晨報 §VII–IX 段落 |

保留手動內容：`python tools\x_fetch.py ... --keep-existing`

## 資料來源規範

- **11 張截圖** → 方舟 ETF / 個股 / 水位（唯一來源）
- **Yahoo Finance** → SOX、VIX、七巨頭
- **TAIFEX** → 外資台指期淨額
- **X / Bloomberg** → §VII–IX 政策與人物訊號

---

Design System Spec v1.0 · Kelvin Wiggly · MMXXVI
