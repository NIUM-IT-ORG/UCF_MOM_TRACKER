@echo off
REM ====================================================================
REM  MoM_Tracker - local setup for Windows. No Docker, no PowerShell.
REM
REM  Checks what is installed, prepares the database, installs
REM  dependencies, migrates, seeds and verifies. Safe to run again:
REM  every step is skipped if it has already been done.
REM ====================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   MoM_Tracker - UCF Meeting and Action Item Tracker
echo   Local setup. No Docker required.
echo.

REM ---- 1 - Node ------------------------------------------------------
echo == Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   STOPPED: Node.js is not installed.
  echo   Install the LTS build from https://nodejs.org then run this again.
  goto :fail
)
for /f "tokens=*" %%v in ('node --version') do set "NODEV=%%v"
echo    OK  Node !NODEV!

node -e "process.exit(Number(process.versions.node.split('.')[0])>=20?0:1)"
if errorlevel 1 (
  echo.
  echo   STOPPED: Node !NODEV! is too old. This needs Node 20 or newer.
  goto :fail
)

REM ---- 2 - pnpm ------------------------------------------------------
REM Three ways to get pnpm, tried in order of how pleasant they are to live
REM with. Corepack is first but often cannot write its shims: they go into
REM the Node installation folder, which needs administrator rights when Node
REM sits in Program Files. npx is last because it is slower, but it needs no
REM install and no elevation at all, so it always works.
echo.
echo == pnpm
set "PM="

where pnpm >nul 2>&1
if not errorlevel 1 (
  set "PM=pnpm"
  goto :gotpnpm
)

echo    pnpm not found - trying Corepack, which ships with Node.
call corepack enable >nul 2>&1
call corepack prepare pnpm@10 --activate >nul 2>&1
where pnpm >nul 2>&1
if not errorlevel 1 (
  set "PM=pnpm"
  echo    OK  enabled through Corepack
  goto :gotpnpm
)

echo    Corepack could not do it - that usually means it needed
echo    administrator rights. Installing pnpm with npm instead.
call npm install -g pnpm@10 >nul 2>&1
where pnpm >nul 2>&1
if not errorlevel 1 (
  set "PM=pnpm"
  echo    OK  installed with npm
  goto :gotpnpm
)

echo    npm could not install it globally either - falling back to npx,
echo    which needs no install and no elevation. Slightly slower, works fine.
call npx --yes pnpm@10 --version >nul 2>&1
if not errorlevel 1 (
  set "PM=npx --yes pnpm@10"
  echo    OK  using npx
  goto :gotpnpm
)

echo.
echo   STOPPED: could not get pnpm working by any route.
echo.
echo   Try this in a new window, then run SETUP.bat again:
echo       npm install -g pnpm
echo.
echo   If that fails too, it is usually a proxy blocking the npm registry.
goto :fail

:gotpnpm
for /f "tokens=*" %%v in ('%PM% --version 2^>nul') do set "PNPMV=%%v"
echo    OK  pnpm !PNPMV!

REM ---- 3 - PostgreSQL ------------------------------------------------
echo.
echo == PostgreSQL
set "PSQL="
where psql >nul 2>&1
if not errorlevel 1 set "PSQL=psql"

if not defined PSQL (
  REM The Windows installer does not add itself to PATH. Look where it lands.
  for /f "delims=" %%d in ('dir /b /ad /o-n "C:\Program Files\PostgreSQL" 2^>nul') do (
    if not defined PSQL if exist "C:\Program Files\PostgreSQL\%%d\bin\psql.exe" (
      set "PSQL=C:\Program Files\PostgreSQL\%%d\bin\psql.exe"
      set "PATH=C:\Program Files\PostgreSQL\%%d\bin;!PATH!"
    )
  )
)

if not defined PSQL (
  echo.
  echo   STOPPED: PostgreSQL was not found.
  echo.
  echo   Install it from  https://www.postgresql.org/download/windows/
  echo   Keep port 5432, and note the postgres password you set.
  echo.
  echo   If you have winget, this also works:
  echo       winget install --id PostgreSQL.PostgreSQL.16 -e
  echo.
  echo   Then close this window, open a new one, and run SETUP.bat again
  echo   so it picks up the new PATH.
  goto :fail
)
echo    OK  psql found

REM ---- 4 - database and role -----------------------------------------
echo.
echo == Database
echo    The postgres superuser password is the one set when PostgreSQL
echo    was installed. It will be visible as you type.
set /p "PGPASSWORD=   postgres password: "

"%PSQL%" -U postgres -h localhost -p 5432 -d postgres -tAc "SELECT 1" >nul 2>&1
if errorlevel 1 (
  echo.
  echo   STOPPED: could not connect to PostgreSQL as user postgres.
  echo   Check the password, and that the PostgreSQL service is running.
  goto :fail
)
echo    OK  connected as postgres

set "ROLEFOUND="
for /f "tokens=*" %%r in ('"%PSQL%" -U postgres -h localhost -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='ucf'" 2^>nul') do set "ROLEFOUND=%%r"
if "!ROLEFOUND!"=="1" (
  echo    OK  role ucf already exists
) else (
  "%PSQL%" -U postgres -h localhost -d postgres -c "CREATE ROLE ucf LOGIN PASSWORD 'ucf_dev_only'" >nul
  if errorlevel 1 goto :dbfail
  echo    OK  created role ucf
)

set "DBFOUND="
for /f "tokens=*" %%r in ('"%PSQL%" -U postgres -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='mom_tracker'" 2^>nul') do set "DBFOUND=%%r"
if "!DBFOUND!"=="1" (
  echo    OK  database mom_tracker already exists
) else (
  "%PSQL%" -U postgres -h localhost -d postgres -c "CREATE DATABASE mom_tracker OWNER ucf" >nul
  if errorlevel 1 goto :dbfail
  echo    OK  created database mom_tracker
)
set "PGPASSWORD="

REM ---- 5 - configuration ---------------------------------------------
echo.
echo == Configuration
call node scripts\windows\write-env.mjs
if errorlevel 1 goto :fail

REM ---- 6 - dependencies ----------------------------------------------
echo.
echo == Dependencies
echo    First run downloads a few hundred packages. Give it a minute or two.
call %PM% install
if errorlevel 1 goto :fail
call %PM% --filter @mom/shared build
if errorlevel 1 goto :fail
echo    OK  installed

REM ---- 7 - schema and demo data --------------------------------------
echo.
echo == Database schema and demo data
call %PM% db:deploy
if errorlevel 1 (
  echo.
  echo    Prisma could not apply the migrations. That is usually its engine
  echo    download being blocked by a proxy. The migrations are plain SQL,
  echo    so applying them directly instead.
  echo.
  call %PM% db:apply
  if errorlevel 1 goto :fail
)
call %PM% db:seed
if errorlevel 1 goto :fail
echo    OK  migrated and seeded

REM ---- 8 - prove it --------------------------------------------------
echo.
echo == Verification
call %PM% assert:invariants
if errorlevel 1 goto :fail
call %PM% assert:seed
if errorlevel 1 goto :fail

echo.
echo   ================================================================
echo    Setup complete.
echo.
echo    Start it with:  RUN.bat
echo    Web             http://localhost:3000
echo    API             http://localhost:4000/api/v1/health
echo   ================================================================
echo.
set /p "STARTNOW=  Start it now? (Y/n): "
if /i "!STARTNOW!"=="n" goto :done
call "%~dp0RUN.bat"
goto :done

:dbfail
set "PGPASSWORD="
echo.
echo   STOPPED: could not create the role or database.
echo   The postgres user may not have permission, or something is already
echo   there under a different owner.
goto :fail

:fail
echo.
echo   Nothing was left half-done. Fix the above and run SETUP.bat again.
echo.
pause
exit /b 1

:done
echo.
pause
exit /b 0
