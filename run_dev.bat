@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

REM ---------------------------------------------------------------------------
REM WarpWeft local development launcher
REM   run_dev.bat        start API + Vite + Electron
REM   run_dev.bat web    start API + Vite only (open the URL in a browser)
REM   run_dev.bat web-noopen  same as web, but do not open a browser
REM ---------------------------------------------------------------------------

echo.
echo ============================================================
echo  WarpWeft Scheduler - development mode
echo  repo: %CD%
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on PATH. Install Node.js 22+ first.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found on PATH.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [ERROR] package.json was not found next to this script.
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

if not exist "resources\solver\warpweft-solver.jar" (
  echo [SETUP] Java solver jar is missing, building it...
  call npm run build:solver
  if errorlevel 1 (
    echo [ERROR] npm run build:solver failed. Check JDK 21 / JAVA_HOME.
    pause
    exit /b 1
  )
)

set "NO_ELECTRON="
if /i "%~1"=="web" set "NO_ELECTRON=1"
if /i "%~1"=="web-noopen" (set "NO_ELECTRON=1" & set "NO_OPEN=1")

REM ---------------------------------------------------------------------------
REM 1) local API on 4317 (skip when an instance is already healthy)
REM ---------------------------------------------------------------------------
call :probe "http://127.0.0.1:4317/api/health"
if errorlevel 1 (
  echo [START] API  http://127.0.0.1:4317
  start "WarpWeft API (4317)" cmd /k node scripts/dev-api.cjs
) else (
  echo [SKIP] API already responds on http://127.0.0.1:4317
)

REM ---------------------------------------------------------------------------
REM 2) Vite dev server on 5173 (strictPort so Electron always points here)
REM ---------------------------------------------------------------------------
call :probe "http://127.0.0.1:5173/"
if errorlevel 1 (
  echo [START] Vite http://127.0.0.1:5173
  start "WarpWeft Vite (5173)" cmd /k npm run dev -- --port 5173 --strictPort
) else (
  echo [SKIP] Vite already responds on http://127.0.0.1:5173
)

echo [WAIT ] waiting for API and Vite to become ready...
call :wait "http://127.0.0.1:4317/api/health" "API"
if errorlevel 1 goto :failed
call :wait "http://127.0.0.1:5173/" "Vite"
if errorlevel 1 goto :failed

if defined NO_ELECTRON (
  echo.
  echo [READY] Open http://127.0.0.1:5173 in a browser.
  echo         API: http://127.0.0.1:4317/api/health
  echo.
  if not defined NO_OPEN start "" "http://127.0.0.1:5173"
  exit /b 0
)

REM ---------------------------------------------------------------------------
REM 3) Electron pointing at the Vite dev server
REM ---------------------------------------------------------------------------
echo [START] Electron desktop
start "WarpWeft Desktop" cmd /c "set VITE_DEV_SERVER_URL=http://127.0.0.1:5173&& npm run desktop"

echo.
echo [READY] API + Vite + Electron are starting.
echo         Close the API / Vite / Electron windows to stop them.
echo.
ping -n 3 127.0.0.1 >nul
exit /b 0

:failed
echo.
echo [ERROR] The dev servers did not become ready in time.
echo         Check the "WarpWeft API" and "WarpWeft Vite" windows for details.
echo.
pause
exit /b 1

:probe
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-WebRequest -Uri '%~1' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }"
exit /b %errorlevel%

:wait
set "TARGET=%~1"
set "LABEL=%~2"
for /l %%i in (1,1,60) do (
  call :probe "%TARGET%"
  if not errorlevel 1 (
    echo [READY] %LABEL% is up.
    exit /b 0
  )
  ping -n 2 127.0.0.1 >nul
)
echo [ERROR] %LABEL% did not respond at %TARGET%
exit /b 1


