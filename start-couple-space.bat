@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where pwsh.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] PowerShell 7 ^(pwsh.exe^) was not found.
  echo Install PowerShell 7 and run this file again.
  pause
  exit /b 1
)

if /i "%~1"=="tunnel" goto start_tunnel
if /i "%~1"=="local" goto start_local
if exist "E:\Cloudflared\config\config.yml" goto start_tunnel

:start_local
echo Starting the local Couple Space backend...
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-couple-space.ps1" -ApiOnly
set "exitCode=%ERRORLEVEL%"
goto finish

:start_tunnel
echo Starting the Couple Space backend and Cloudflare Tunnel...
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-couple-space.ps1"
set "exitCode=%ERRORLEVEL%"

:finish
echo.
if not "%exitCode%"=="0" (
  echo [FAILED] Startup did not complete. Check the message above.
) else (
  echo [DONE] Startup completed. You can close this window.
)
pause
exit /b %exitCode%
