@echo off
cd /d "%~dp0backend"
echo Backend startet auf http://127.0.0.1:8000/docs
"..\.venv\Scripts\python.exe" -m uvicorn main:app --reload
pause
