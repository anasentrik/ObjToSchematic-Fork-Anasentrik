@echo off
setlocal
cd /d "%~dp0"

set "NODE_DIR=%USERPROFILE%\tools\node-v20.20.2-win-x64"
if not exist "%NODE_DIR%\node.exe" (
    echo Node not found at %NODE_DIR%
    pause
    exit /b 1
)
set "PATH=%NODE_DIR%;%PATH%"

if not exist node_modules (
    echo Installing dependencies...
    call npm ci --no-audit --no-fund
    if errorlevel 1 (
        pause
        exit /b 1
    )
)

echo Starting dev server, the browser opens once it is ready. Press Ctrl+C to stop.
start "" /min cmd /c "timeout /t 20 /nobreak >nul & start http://localhost:8080"
call npm start
pause
