@echo off
call "%~dp0npm.cmd" run dev
exit /b %ERRORLEVEL%
