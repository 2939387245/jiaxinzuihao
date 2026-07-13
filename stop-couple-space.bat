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

echo Stopping the Couple Space backend and Cloudflare Tunnel...
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-couple-space.ps1"
set "exitCode=%ERRORLEVEL%"

echo.
if not "%exitCode%"=="0" (
  echo [FAILED] Shutdown did not complete. Check the message above.
) else (
  echo [DONE] Shutdown completed. You can close this window.
)
pause
exit /b %exitCode%
