@echo off
REM ====================================================================
REM  Finds out what is wrong, in one go, and prints it.
REM
REM  Run this while RUN.bat is running in another window. It checks the
REM  database, the schema, the generated client, and then signs in and
REM  performs the writes that have given trouble - attendance, minutes
REM  and a document - reporting the real cause of each failure.
REM
REM  Whatever it prints is safe to send on. It writes nothing new: what
REM  is already recorded is re-saved unchanged, and anything it adds to
REM  try a write it removes again.
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

set "PM="
where pnpm >nul 2>&1
if not errorlevel 1 set "PM=pnpm"
if not defined PM set "PM=npx --yes pnpm@10"

call %PM% doctor

echo.
echo   Copy everything above this line if you need to send it on.
echo.
pause
