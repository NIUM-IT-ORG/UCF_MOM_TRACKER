@echo off
REM ====================================================================
REM  MoM_Tracker - copy an extracted update into the app, then apply it.
REM
REM  This one sits BESIDE the app folder, not inside it. Windows extracts a
REM  zip into a subfolder named after the zip, so an update arrives as
REM
REM      Desktop\MoM_Tracker\MoM_Tracker-Update\    <- the patch
REM      Desktop\MoM_Tracker\app\                   <- the application
REM
REM  and the files have to be copied from the first into the second before
REM  anything can run. That is all this does, and then it hands over to
REM  UPDATE.bat inside the app.
REM
REM  Double-click it. Do not run it as Administrator.
REM ====================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   MoM_Tracker - applying an update
echo.

REM ---- the app --------------------------------------------------------
set "APP="
if exist "app\SETUP.bat" set "APP=app"
if not defined APP if exist "SETUP.bat" set "APP=."

if not defined APP (
  echo   STOPPED: cannot find the application.
  echo.
  echo   This file has to sit beside the app folder - the one containing
  echo   SETUP.bat, RUN.bat and .env. Usually that is:
  echo       Desktop\MoM_Tracker\app
  echo.
  echo   Put APPLY-UPDATE.bat in Desktop\MoM_Tracker and run it again.
  goto :fail
)
echo   Application  %CD%\!APP!

REM ---- the patch ------------------------------------------------------
REM Whatever folder here holds an UPDATE.bat is the extracted patch. Looking
REM for the file rather than for a folder name means it does not matter what
REM the zip was called or whether Windows appended "(1)".
set "PATCH="
set "MANY="
for /d %%d in (*) do (
  if exist "%%d\UPDATE.bat" (
    if defined PATCH (set "MANY=1") else (set "PATCH=%%d")
  )
)

if not defined PATCH (
  echo.
  echo   STOPPED: cannot find an extracted update beside this file.
  echo.
  echo   Right-click MoM_Tracker-Update.zip, choose "Extract All...", accept
  echo   the folder it offers, and run this again. There should then be a
  echo   folder here with UPDATE.bat inside it.
  goto :fail
)

if defined MANY (
  echo.
  echo   STOPPED: there is more than one extracted update here, and I will
  echo   not guess which one you meant.
  echo.
  echo   Delete the older folders - the ones with UPDATE.bat inside - keep
  echo   the newest, and run this again.
  goto :fail
)
echo   Update       %CD%\!PATCH!

REM ---- nothing may be running ------------------------------------------
REM A running MoM_Tracker holds Prisma's query engine DLL open, and Windows
REM will not let it be replaced. Catch it here, before anything is copied,
REM rather than halfway through.
echo.
netstat -ano | findstr /r /c:"LISTENING" | findstr /r /c:":3000 " /c:":4000 " >nul 2>&1
if not errorlevel 1 (
  echo   STOPPED: MoM_Tracker is still running - something is listening on
  echo   port 3000 or 4000.
  echo.
  echo   Go to the RUN.bat window, press Ctrl+C, close it, and run this again.
  goto :fail
)

echo   Copying the update into the application...
robocopy "!PATCH!" "!APP!" /E /NFL /NDL /NJH /NJS /NC /NS >nul
REM robocopy is not like other commands: 0-7 are degrees of success, 8 and
REM above are failures. `if errorlevel 1` would fail every successful copy.
if errorlevel 8 (
  echo.
  echo   STOPPED: the copy failed. Nothing was changed.
  echo   The usual cause is a file open in an editor, or the application
  echo   still running.
  goto :fail
)
echo   OK  copied

REM UPDATE.bat takes it from here: it backs up the database, installs,
REM migrates, rebuilds and offers to start. It does its own checks again,
REM which is fine - they are cheap and it is also run on its own.
echo.
call "!APP!\UPDATE.bat"
exit /b %errorlevel%

:fail
echo.
pause
exit /b 1
