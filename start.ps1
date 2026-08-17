<#
.SYNOPSIS
    FitTrack development startup script (PowerShell).
.DESCRIPTION
    Thin wrapper around fittrack.py — the FitTrack Service Manager.
    Delegates all work to the Python utility for cross-platform consistency.
.EXAMPLE
    .\start.ps1                       # Interactive menu
    .\start.ps1 up                    # Start all services
    .\start.ps1 up backend frontend   # Start specific services
    .\start.ps1 status                # Show service status
    .\start.ps1 monitor               # Live monitoring dashboard
    .\start.ps1 logs backend          # Tail backend logs
    .\start.ps1 down                  # Stop all services
    .\start.ps1 restart frontend      # Restart frontend
    .\start.ps1 build                 # Rebuild images
    .\start.ps1 migrate               # Run database migrations
    .\start.ps1 reset                 # Full teardown, rebuild, and restart with migrations
    .\start.ps1 backup                # Backup database to backups/
    .\start.ps1 backup -o my.sql.gz   # Backup to custom path
    .\start.ps1 restore backups\fittrack_20260101_120000.sql.gz  # Restore from backup
#>

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$fittrack = Join-Path $scriptDir "fittrack.py"

# Prefer python3, fall back to python
$python = $null
foreach ($cmd in @("python3", "python")) {
    try {
        $null = & $cmd --version 2>&1
        $python = $cmd
        break
    } catch {
        # not found
    }
}

if (-not $python) {
    Write-Host "ERROR: Python 3 is required but was not found on PATH." -ForegroundColor Red
    Write-Host "Install Python 3.10+ and try again." -ForegroundColor Red
    exit 1
}

& $python $fittrack @Arguments
exit $LASTEXITCODE
