@echo off
setlocal

set "PROJECT_ROOT=%~dp0.."
set /p NODE_VERSION=<"%PROJECT_ROOT%\.node-version"
set "HOST_ARCH=%PROCESSOR_ARCHITECTURE%"
if defined PROCESSOR_ARCHITEW6432 set "HOST_ARCH=%PROCESSOR_ARCHITEW6432%"

if /I "%HOST_ARCH%"=="AMD64" set "NODE_ARCH=x64"
if /I "%HOST_ARCH%"=="ARM64" set "NODE_ARCH=arm64"

if not defined NODE_ARCH (
  echo Unsupported Windows architecture: %HOST_ARCH% 1>&2
  exit /b 1
)

set "NODE_DIR=%PROJECT_ROOT%\.tools\node-v%NODE_VERSION%-win-%NODE_ARCH%"
if not exist "%NODE_DIR%\npm.cmd" (
  echo Project-local Node.js is not installed. Run .\scripts\bootstrap.cmd first. 1>&2
  exit /b 1
)

rem Prepending PATH ensures npm lifecycle scripts also execute with the pinned local node.exe.
set "PATH=%NODE_DIR%;%PATH%"
call "%NODE_DIR%\npm.cmd" %*
exit /b %ERRORLEVEL%
