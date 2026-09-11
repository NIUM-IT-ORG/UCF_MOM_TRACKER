# MoM_Tracker - local setup for Windows, without Docker.
#
# Checks what is installed, prepares the database, installs dependencies,
# applies migrations, loads the demo data and proves the two database
# guarantees hold. Safe to run more than once: every step is skipped if it
# has already been done.
#
# Run it from SETUP.bat, or directly:
#     powershell -ExecutionPolicy Bypass -File .\scripts\windows\install.ps1
#
# IMPORTANT, if you edit this file: keep it ASCII-only and save it as UTF-8
# with a BOM. Windows PowerShell 5.1 decodes a BOM-less file as the system
# ANSI codepage, which turns any multi-byte character into mojibake - and
# some of that mojibake contains curly quotes, which PowerShell treats as
# real string delimiters. The parse then fails a hundred lines further down
# with a message about a missing brace. 'pnpm check:scripts' guards this.

$ErrorActionPreference = 'Stop'

# ---- small helpers -------------------------------------------------------

function Say  ($m) { Write-Host $m }
function Step ($m) { Write-Host ''; Write-Host "== $m" -ForegroundColor Cyan }
function Ok   ($m) { Write-Host "   OK  $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "   !   $m" -ForegroundColor Yellow }

function Die ($m) {
    Write-Host ''
    Write-Host "STOPPED: $m" -ForegroundColor Red
    Write-Host ''
    Write-Host 'Nothing was left half-done. Fix the above and run this again.'
    exit 1
}

function Have ($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# Runs a command in the given folder and stops on a non-zero exit code, so a
# failure is never mistaken for success three steps later.
#
# Invoked directly rather than through Start-Process: pnpm and corepack are
# .cmd/.ps1 shims, not .exe files, and Start-Process does not always resolve
# them. Arguments are passed as an array so nothing depends on quoting.
function Run ($exe, $argList, $workDir) {
    Say "   > $exe $($argList -join ' ')"
    Push-Location $workDir
    try {
        & $exe @argList
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($code -ne 0) {
        Die "'$exe $($argList -join ' ')' failed with exit code $code."
    }
}

# Repository root: two levels up from scripts\windows.
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $root 'package.json'))) {
    $root = $PSScriptRoot
}

Write-Host ''
Write-Host '  MoM_Tracker - UCF Meeting and Action Item Tracker' -ForegroundColor White
Write-Host '  Local setup. No Docker required.'
Write-Host "  Repository: $root"
Write-Host ''

# ---- 1 - Node ------------------------------------------------------------

Step 'Node.js'
if (-not (Have 'node')) {
    Die 'Node.js is not installed. Get the LTS installer from https://nodejs.org and run this again.'
}
$nodeVersion = (& node --version).Trim()
$nodeMajor = [int](($nodeVersion -replace '^v', '') -split '\.')[0]
if ($nodeMajor -lt 20) {
    Die "Node $nodeVersion is too old. This needs Node 20 or newer. See https://nodejs.org"
}
Ok "Node $nodeVersion"

# ---- 2 - pnpm ------------------------------------------------------------

Step 'pnpm'
if (-not (Have 'pnpm')) {
    Warn 'pnpm not found. Enabling it through Corepack, which ships with Node.'
    try {
        & corepack enable 2>&1 | Out-Null
        & corepack prepare pnpm@10 --activate 2>&1 | Out-Null
    } catch {
        Die 'Could not enable pnpm. Run "npm install -g pnpm" in a new terminal, then try again.'
    }
}
if (-not (Have 'pnpm')) {
    Die 'pnpm still is not on PATH. Close this window, open a new one, and run again.'
}
Ok "pnpm $((& pnpm --version).Trim())"

# ---- 3 - PostgreSQL ------------------------------------------------------

Step 'PostgreSQL'
$psql = $null
if (Have 'psql') {
    $psql = (Get-Command psql).Source
} else {
    # The Windows installer does not add itself to PATH. Look where it lands.
    $roots = @('C:\Program Files\PostgreSQL', 'C:\Program Files (x86)\PostgreSQL')
    foreach ($r in $roots) {
        if (-not (Test-Path $r)) { continue }
        $dirs = Get-ChildItem $r -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
        foreach ($d in $dirs) {
            $try = Join-Path $d.FullName 'bin\psql.exe'
            if (Test-Path $try) { $psql = $try; break }
        }
        if ($psql) { break }
    }
}

if (-not $psql) {
    Write-Host ''
    Warn 'PostgreSQL is not installed, or is not where this script looked.'
    Write-Host ''
    Write-Host '   Install it from   https://www.postgresql.org/download/windows/'
    Write-Host '   During setup: keep port 5432, and note the postgres password.'
    if (Have 'winget') {
        Write-Host ''
        $answer = Read-Host '   Install PostgreSQL 16 now with winget? (y/N)'
        if ($answer -eq 'y' -or $answer -eq 'Y') {
            Run 'winget' @('install', '--id', 'PostgreSQL.PostgreSQL.16', '-e', '--accept-package-agreements', '--accept-source-agreements') $root
            Write-Host ''
            Die 'PostgreSQL installed. Close this window, open a new one, and run this script again so it picks up the new PATH.'
        }
    }
    Die 'Install PostgreSQL, then run this again.'
}
Ok "psql at $psql"

$env:Path = (Split-Path -Parent $psql) + ';' + $env:Path

# ---- 4 - database and role ----------------------------------------------

Step 'Database'
$dbName  = 'mom_tracker'
$appUser = 'ucf'
$appPass = 'ucf_dev_only'

Say '   The postgres superuser password is the one set when PostgreSQL was installed.'
$secure = Read-Host '   postgres password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$probe = & psql -U postgres -h localhost -p 5432 -d postgres -tAc 'SELECT 1' 2>&1
if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    Die "Could not connect to PostgreSQL as 'postgres'. It said: $probe"
}
Ok 'connected as postgres'

$roleExists = (& psql -U postgres -h localhost -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$appUser'" | Out-String).Trim()
if ($roleExists -ne '1') {
    & psql -U postgres -h localhost -d postgres -c "CREATE ROLE $appUser LOGIN PASSWORD '$appPass'" | Out-Null
    Ok "created role $appUser"
} else {
    Ok "role $appUser already exists"
}

$dbExists = (& psql -U postgres -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'" | Out-String).Trim()
if ($dbExists -ne '1') {
    & psql -U postgres -h localhost -d postgres -c "CREATE DATABASE $dbName OWNER $appUser" | Out-Null
    Ok "created database $dbName"
} else {
    Ok "database $dbName already exists"
}

Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

# ---- 5 - .env ------------------------------------------------------------

Step 'Configuration'
$envPath = Join-Path $root '.env'
if (Test-Path $envPath) {
    Ok '.env already exists - leaving it exactly as it is'
} else {
    $text = Get-Content (Join-Path $root '.env.example') -Raw
    # Real random secrets, not the placeholders. Generated with Node so there
    # is no dependency on which crypto APIs this machine happens to have.
    $s1 = (& node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))").Trim()
    $s2 = (& node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))").Trim()
    $text = $text -replace 'replace_me_with_a_long_random_string', $s1
    $text = $text -replace 'replace_me_with_a_different_long_random_string', $s2
    # No BOM: dotenv would otherwise read the first key as "<BOM>NODE_ENV".
    [System.IO.File]::WriteAllText($envPath, $text, (New-Object System.Text.UTF8Encoding $false))
    Ok '.env written, with freshly generated secrets'
}

# ---- 6 - dependencies ----------------------------------------------------

Step 'Dependencies'
Say '   First run downloads a few hundred packages. Give it a minute or two.'
Run 'pnpm' @('install') $root
Run 'pnpm' @('--filter', '@mom/shared', 'build') $root
Ok 'installed'

# ---- 7 - schema and data -------------------------------------------------

Step 'Database schema and demo data'
Run 'pnpm' @('db:deploy') $root
Run 'pnpm' @('db:seed') $root
Ok 'migrated and seeded'

# ---- 8 - prove it --------------------------------------------------------

Step 'Verification'
Run 'pnpm' @('assert:invariants') $root
Run 'pnpm' @('assert:seed') $root
Ok 'the database guarantees hold, and the data matches the prototype'

# ---- done ----------------------------------------------------------------

Write-Host ''
Write-Host '  Setup complete.' -ForegroundColor Green
Write-Host ''
Write-Host '  Start it with:   RUN.bat      (or: pnpm dev)'
Write-Host '  Web              http://localhost:3000'
Write-Host '  API              http://localhost:4000/api/v1/health'
Write-Host ''

$start = Read-Host '  Start it now? (Y/n)'
if ($start -ne 'n' -and $start -ne 'N') {
    & (Join-Path $PSScriptRoot 'run.ps1')
}
