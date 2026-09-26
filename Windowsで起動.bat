@echo off
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 goto use_py
where python >nul 2>&1
if %errorlevel%==0 goto use_python
echo Python was not found. Install Python or run a local HTTP server in this folder.
pause
exit /b 1

:use_py
start "Lowland viewer local server" /min cmd /k "py -m http.server 8765"
goto open_page

:use_python
start "Lowland viewer local server" /min cmd /k "python -m http.server 8765"

:open_page
timeout /t 2 /nobreak >nul
start "" "http://localhost:8765/"
echo Opened http://localhost:8765/ . Keep the local server window running while using the viewer.
pause
