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

# Prefer python3, fall back to python.
# Use Get-Command (not try/catch) so Windows Store alias stubs don't pass —
# they resolve as commands but fail to actually run Python.
$python = $null
foreach ($cmd in @("python3", "python")) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found) {
        # Reject the Microsoft Store app execution alias (zero-byte stub)
        if ($found.Source -and (Get-Item $found.Source -ErrorAction SilentlyContinue).Length -eq 0) {
            continue
        }
        $null = & $cmd --version 2>$null
        if ($LASTEXITCODE -eq 0) {
            $python = $cmd
            break
        }
    }
}

if (-not $python) {
    Write-Host "ERROR: Python 3 is required but was not found on PATH." -ForegroundColor Red
    Write-Host "Install Python 3.10+ and try again." -ForegroundColor Red
    exit 1
}

& $python $fittrack @Arguments
exit $LASTEXITCODE
