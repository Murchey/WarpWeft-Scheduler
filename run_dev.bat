@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title WarpWeft Scheduler - Dev Launcher

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 22+ first.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found.
  pause
  exit /b 1
)
if not exist "package.json" (
  echo [ERROR] package.json was not found. Run this script from the repo root.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo [SETUP] node_modules is missing, running npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

set "ARG=%~1"
if defined ARG (
  set "MODE=%ARG%"
  goto dispatch
)

:menu
cls
echo ============================================================
echo   WarpWeft Scheduler - Dev Launcher
echo   repo: %CD%
echo ============================================================
echo.
echo   [1] Electron desktop dev - recommended
echo       Vite + Electron; Electron starts the local API
echo.
echo   [2] Browser dev - local API
echo       Vite + local API; opens the browser
echo.
echo   [3] LAN server dev
echo       API / Vite listen on 0.0.0.0 for other devices
echo.
echo   [4] Browser dev - no auto-open
echo       Vite + local API; open the URL yourself
echo.
echo   [0] Exit
echo.
echo   First run: npm install
echo ============================================================
set "MODE="
set /p "MODE=Enter a number and press Enter: "
if not defined MODE goto menu
if "%MODE%"=="0" goto end

:dispatch
if /i "%MODE%"=="1" goto mode_electron
if /i "%MODE%"=="2" goto mode_web
if /i "%MODE%"=="3" goto mode_lan
if /i "%MODE%"=="4" goto mode_web_noopen
if /i "%MODE%"=="web" goto mode_web
if /i "%MODE%"=="web-noopen" goto mode_web_noopen
if /i "%MODE%"=="lan" goto mode_lan
if "%MODE%"=="0" goto end
echo.
echo Invalid choice: %MODE%
ping -n 3 127.0.0.1 >nul
if defined ARG exit /b 1
goto menu

:mode_electron
echo.
echo [1/4] Starting Electron desktop dev...
if not exist "node_modules\electron\dist\electron.exe" goto repair_electron
if not exist "node_modules\electron\path.txt" goto repair_electron
goto electron_ready

:repair_electron
echo [SETUP] Electron binary is missing, repairing...
call npm run fix:electron
if errorlevel 1 (
  echo [ERROR] Electron repair failed. Run npm run fix:electron manually.
  pause
  exit /b 1
)

:electron_ready
echo.
call npm run dev:electron
set "EXITCODE=%ERRORLEVEL%"
echo.
echo Electron dev finished. Exit code: %EXITCODE%
if defined ARG exit /b %EXITCODE%
pause
goto menu

:mode_web
echo.
echo [2/4] Starting browser dev with local API...
echo.
call npm run dev:web
set "EXITCODE=%ERRORLEVEL%"
echo.
echo Browser dev finished. Exit code: %EXITCODE%
if defined ARG exit /b %EXITCODE%
pause
goto menu

:mode_lan
echo.
echo [3/4] Starting LAN server dev...
echo Firewall must allow inbound TCP 4317 and 5173.
echo.
call npm run dev:web -- --lan
set "EXITCODE=%ERRORLEVEL%"
echo.
echo LAN dev finished. Exit code: %EXITCODE%
if defined ARG exit /b %EXITCODE%
pause
goto menu

:mode_web_noopen
echo.
echo [4/4] Starting browser dev without auto-open...
echo.
call npm run dev:web -- --no-open
set "EXITCODE=%ERRORLEVEL%"
echo.
echo Browser dev finished. Exit code: %EXITCODE%
if defined ARG exit /b %EXITCODE%
pause
goto menu

:end
echo Bye.
endlocal
exit /b 0
