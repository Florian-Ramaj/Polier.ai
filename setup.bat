@echo off
cd /d "%~dp0"
echo Installiere Pakete ins Projekt-venv ...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
echo.
echo Fertig. Du kannst dieses Fenster schliessen.
pause
