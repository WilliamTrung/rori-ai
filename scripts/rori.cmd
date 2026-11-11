@echo off
set "RORI=%APPDATA%\npm\rori.cmd"
if exist "%RORI%" (
  call "%RORI%" %*
  exit /b %ERRORLEVEL%
)
where cmdc >nul 2>&1
if errorlevel 1 (
  echo Rori not installed. Run: powershell -File scripts\install-rori-cli.ps1
  exit /b 1
)
cmdc %*
