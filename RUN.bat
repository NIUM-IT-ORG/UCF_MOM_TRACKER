@echo off
REM ====================================================================
REM  Starts the API on :4000 and the web application on :3000, together.
REM  Both run in this window. Ctrl+C stops both.
REM ====================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

if not exist ".env" (
  echo.
  echo   No .env found. Run SETUP.bat first.
  echo.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo.
  echo   Dependencies are not installed. Run SETUP.bat first.
  echo.
  pause
  exit /b 1
)

REM PostgreSQL's bin folder is not on PATH by default. The app does not need
REM psql, but the pnpm db:* scripts do, so make it available anyway.
where psql >nul 2>&1
if errorlevel 1 (
  for /f "delims=" %%d in ('dir /b /ad /o-n "C:\Program Files\PostgreSQL" 2^>nul') do (
    if exist "C:\Program Files\PostgreSQL\%%d\bin\psql.exe" (
      set "PATH=C:\Program Files\PostgreSQL\%%d\bin;!PATH!"
      goto :gotpsql
    )
  )
)
:gotpsql

REM Same pnpm resolution as SETUP.bat: prefer a real install, fall back to
REM npx, which needs neither an install nor elevation.
set "PM="
where pnpm >nul 2>&1
if not errorlevel 1 set "PM=pnpm"
if not defined PM set "PM=npx --yes pnpm@10"

REM If setup fell back to the project-local PostgreSQL, it has to run
REM alongside the apps - it is a child process, so it goes when they go.
set "DEVCMD=dev"
if exist "var\pgdata" set "DEVCMD=dev:all"

echo.
echo   Starting MoM_Tracker
if "!DEVCMD!"=="dev:all" echo   Database  bundled PostgreSQL on port 5433
echo   Web       http://localhost:3000
echo   API       http://localhost:4000/api/v1/health
echo   Ctrl+C stops everything.
echo.

REM Open the browser shortly after the servers start. Fire and forget, so it
REM cannot hold up or interfere with them.
start "" /b cmd /c "timeout /t 14 /nobreak >nul & start """" http://localhost:3000"

call %PM% !DEVCMD!

echo.
pause
