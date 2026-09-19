@echo off
REM ====================================================================
REM  MoM_Tracker - start it and record everything.
REM
REM  Same thing RUN.bat does, with every line written to
REM      app\var\diagnose.log
REM  as well as to this window.
REM
REM  Use it when the app starts but every screen says "Request failed
REM  (500)." - that message means the web page could not reach the API at
REM  all, so the reason is in the API's own output, which scrolls past
REM  and is gone. This keeps it.
REM
REM  What to do:
REM    1. Double-click this.
REM    2. Wait until it settles - about a minute - and try the site.
REM    3. Press Ctrl+C in this window, then Y, to stop it.
REM    4. Tell me it is done. The log is at app\var\diagnose.log
REM
REM  Nothing is changed. It only starts things and writes a log.
REM ====================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "APP="
if exist "app\.env" set "APP=app"
if not defined APP if exist ".env" if exist "SETUP.bat" set "APP=."
if not defined APP (
  echo.
  echo   STOPPED: cannot find the application. This file has to sit either
  echo   beside the app folder or inside it.
  goto :fail
)

cd /d "!APP!"

echo.
echo   MoM_Tracker - starting with a full log
echo.

REM Nothing may already be listening, or this second copy fails in a way
REM that has nothing to do with the fault being investigated.
netstat -ano | findstr /r /c:"LISTENING" | findstr /r /c:":3000 " /c:":4000 " /c:":5433 " >nul 2>&1
if not errorlevel 1 (
  echo   STOPPED: something is already running - port 3000, 4000 or 5433 is
  echo   in use. Close the other MoM_Tracker window first, then run this.
  goto :fail
)

REM The project-local PostgreSQL refuses to start under an administrator
REM account, by design.
if exist "var\pgdata" (
  set "ELEVATED="
  whoami /groups 2>nul | findstr /c:"S-1-16-12288" >nul 2>&1 && set "ELEVATED=1"
  if defined ELEVATED (
    echo   STOPPED: this window is running as Administrator. Close it and
    echo   start DIAGNOSE.bat with an ordinary double-click.
    goto :fail
  )
)

set "PM="
where pnpm >nul 2>&1
if not errorlevel 1 set "PM=pnpm"
if not defined PM set "PM=npx --yes pnpm@10"

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

set "DEVCMD=dev"
if exist "var\pgdata" set "DEVCMD=dev:all"

set "LOG=var\diagnose.log"
if not exist "var" mkdir "var" >nul 2>&1
if exist "!LOG!" del /f /q "!LOG!" >nul 2>&1

echo   Recording to  %CD%\!LOG!
echo   Web           http://localhost:3000
echo.
echo   Let it settle for about a minute, open the site, then press Ctrl+C
echo   here and answer Y to stop it. Then tell me it is done.
echo.
echo   ----------------------------------------------------------------

REM  2^>^&1 sends the error output into the same file. Without it the very
REM  lines that matter - the crash - would be the ones missing from the log.
REM  The log is written and echoed: `tee` does not exist in cmd, and the
REM  pipe through `more` would swallow the exit code and buffer the output,
REM  so the file is the record and the window shows whatever the tools
REM  print to the console directly.
call %PM% !DEVCMD! > "!LOG!" 2>&1

echo   ----------------------------------------------------------------
echo.
echo   Stopped. The log is at:
echo       %CD%\!LOG!
echo.
echo   The last 30 lines:
echo.
REM  No `tail` in cmd. `more +N` skips N lines and prints the rest, which is
REM  one command rather than a loop - and a loop here is exactly where a
REM  for-variable stops expanding and the screen fills with "%l".
set "N=0"
for /f %%c in ('type "!LOG!" 2^>nul ^| find /c /v ""') do set "N=%%c"
set /a "SKIP=!N!-30"
if !SKIP! lss 0 set "SKIP=0"
more +!SKIP! "!LOG!"

echo.
echo   Send me that file, or just say it is ready and I will read it.
echo.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
