@echo off
cd /d "%~dp0docs"
echo.
echo KW Technical Spider - local preview
echo   http://127.0.0.1:8765/technical-spider.html
echo.
echo Press Ctrl+C to stop.
python -m http.server 8765
