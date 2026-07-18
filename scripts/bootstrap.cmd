@echo off
setlocal

rem Use an explicit process-level policy so this works when npm.ps1 is blocked by Windows PowerShell.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap.ps1" %*
exit /b %ERRORLEVEL%
