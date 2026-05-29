# 每日建置晨報（填好 JSON 後執行）
param(
  [Parameter(Mandatory = $true)]
  [string]$Date  # YYYYMMDD，例如 20260530
)

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Json = "data\issues\$Date.json"
if (-not (Test-Path $Json)) {
  Copy-Item "data\issues\_template.json" $Json
  Write-Host "已建立 $Json — 請先編輯內容後再跑一次。"
  exit 0
}

pip install -r requirements.txt -q
python tools\fetch_market.py
python tools\x_token.py 2>$null
python tools\x_fetch.py $Json
python tools\build_brief.py $Json
Write-Host "完成：site\$Date-stock-news-kelvin.html"
