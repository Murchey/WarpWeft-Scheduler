@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

set "ROOT=%CD%"
set "DIST=%ROOT%\dist"
set "STAGE=%ROOT%\build\release"
set "ICON=%ROOT%\assets\icon.ico"
set "NONINTERACTIVE="

if /i "%~1"=="--local" (
  set "NONINTERACTIVE=1"
  goto :LOCAL
)
if /i "%~1"=="--linux" (
  set "NONINTERACTIVE=1"
  goto :LINUX
)
if /i "%~1"=="--cloud" (
  set "NONINTERACTIVE=1"
  goto :LINUX
)

:MENU
cls
echo ============================================================
echo   WarpWeft Scheduler 构建工具
echo ============================================================
echo   项目目录: %ROOT%
echo.
echo   [1] 编译本地版本
echo       Electron 应用 + NSIS 安装包（安装包使用应用图标）
echo   [2] 编译 Linux 服务端（含登录）
echo       生成 systemd 部署包到 dist\linux-server\；说明见 guideline.md
echo   [0] 退出
echo.
choice /c 120 /n /m "请选择 [1/2/0]: "
if errorlevel 3 goto :EXIT
if errorlevel 2 goto :LINUX
if errorlevel 1 goto :LOCAL
goto :MENU

:EXIT
echo.
echo 已退出构建工具。
endlocal
exit /b 0

:LOCAL
cls
echo ============================================================
echo   [1/4] 检查构建环境
echo ============================================================
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 Node.js，请先安装 Node.js 并加入 PATH。
  goto :FAIL
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 npm，请先安装 Node.js 并加入 PATH。
  goto :FAIL
)
if not exist "node_modules\.bin\electron-builder.cmd" (
  echo [错误] 找不到 electron-builder，请先在项目根目录执行 npm install。
  goto :FAIL
)
if not exist "%ICON%" (
  echo [错误] 找不到应用图标: %ICON%
  goto :FAIL
)
if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/"
if not defined ELECTRON_BUILDER_BINARIES_MIRROR set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
if not defined CSC_IDENTITY_AUTO_DISCOVERY set "CSC_IDENTITY_AUTO_DISCOVERY=false"

echo [信息] Node 版本:
node --version
echo [信息] npm 版本:
call npm --version
echo [信息] 应用图标: %ICON%
echo.

echo ============================================================
echo   [2/4] 编译渲染进程和 Java Solver
echo ============================================================
if exist "%DIST%" rmdir /s /q "%DIST%"
call npm run build
if errorlevel 1 (
  echo.
  echo [错误] npm run build 失败。
  goto :FAIL
)
if not exist "%DIST%\index.html" (
  echo [错误] 编译产物缺少 dist\index.html。
  goto :FAIL
)
echo.
echo [完成] 渲染进程已编译到 dist\。
echo.

echo ============================================================
echo   [3/4] 打包 Electron 应用和安装包
echo ============================================================
if exist "%STAGE%" rmdir /s /q "%STAGE%"
call "node_modules\.bin\electron-builder.cmd" --win nsis --x64 ^
  --config.directories.output=build\release ^
  --config.win.icon=assets\icon.ico ^
  --config.nsis.installerIcon=assets\icon.ico ^
  --config.nsis.installerHeaderIcon=assets\icon.ico
if errorlevel 1 (
  echo.
  echo [错误] electron-builder 打包失败。
  goto :FAIL
)
if not exist "%STAGE%\win-unpacked" (
  echo [错误] 未找到免安装应用目录 build\release\win-unpacked。
  goto :FAIL
)
if not exist "%STAGE%\*.exe" (
  echo [错误] 未找到安装包 build\release\*.exe。
  goto :FAIL
)
echo.
echo [完成] Electron 应用和安装包已生成。
echo.

echo ============================================================
echo   [4/4] 移动产物到项目根目录 dist\
echo ============================================================
if not exist "%DIST%" mkdir "%DIST%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src=Join-Path (Get-Location) 'build\release'; $dst=Join-Path (Get-Location) 'dist'; if (-not (Test-Path -LiteralPath $src)) { throw '缺少打包暂存目录: ' + $src }; Get-ChildItem -LiteralPath $src -Force | ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination $dst -Force }"
if errorlevel 1 (
  echo.
  echo [错误] 移动打包产物到 dist 失败。
  goto :FAIL
)
if not exist "%DIST%\win-unpacked" (
  echo [错误] dist\win-unpacked 不存在。
  goto :FAIL
)
if not exist "%DIST%\*.exe" (
  echo [错误] dist\*.exe 不存在。
  goto :FAIL
)

echo.
echo ============================================================
echo   构建完成
echo ============================================================
echo   产物目录: %DIST%
echo.
echo   安装包:
for %%F in ("%DIST%\*.exe") do echo     %%~nxF
echo.
echo   免安装应用:
echo     dist\win-unpacked\
echo.
echo   应用图标:
echo     %ICON%
if defined NONINTERACTIVE goto :EXIT
echo.
pause
goto :MENU

:LINUX
cls
echo ============================================================
echo   编译 Linux 服务端部署包
echo ============================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 Node.js，请先安装 Node.js 并加入 PATH。
  goto :FAIL
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 npm，请先安装 Node.js 并加入 PATH。
  goto :FAIL
)
if not exist "scripts\build-linux-server.cjs" (
  echo [错误] 找不到 scripts\build-linux-server.cjs。
  goto :FAIL
)
if not exist "guideline.md" (
  echo [错误] 找不到 guideline.md，部署包不完整。
  goto :FAIL
)
if not exist "linux_server\user-cli.cjs" (
  echo [错误] 找不到 linux_server\user-cli.cjs，登录初始化脚本缺失。
  goto :FAIL
)
echo [信息] 正在编译渲染进程、Java Solver 和 Linux 部署包（含登录/用户管理）…
echo.
call npm run dist:linux
if errorlevel 1 (
  echo.
  echo [错误] Linux 服务端部署包构建失败。
  goto :FAIL
)
if not exist "%DIST%\linux-server\*.tar.gz" (
  echo [错误] 未找到 dist\linux-server\*.tar.gz。
  goto :FAIL
)
if not exist "%DIST%\linux-server\*.sha256" (
  echo [错误] 未找到 dist\linux-server\*.sha256。
  goto :FAIL
)
echo.
echo ============================================================
echo   Linux 服务端部署包构建完成
echo ============================================================
echo   产物目录: %DIST%\linux-server\
for %%F in ("%DIST%\linux-server\*.tar.gz") do echo   部署包: %%~nxF
for %%F in ("%DIST%\linux-server\*.sha256") do echo   校验文件: %%~nxF
if defined NONINTERACTIVE goto :EXIT
echo.
pause
goto :MENU

:FAIL
echo.
echo ============================================================
echo   构建失败
echo ============================================================
echo   请查看上方错误信息，修复后重新运行本脚本。
if defined NONINTERACTIVE (
  endlocal
  exit /b 1
)
echo.
pause
goto :MENU
