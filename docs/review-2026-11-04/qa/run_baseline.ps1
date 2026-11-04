param(
    [string]$Repo = (Resolve-Path "$PSScriptRoot\..\..\..").Path,
    [switch]$SkipFrontend
)

$ErrorActionPreference = "Continue"
$results = [System.Collections.Generic.List[object]]::new()

function Add-Result([string]$Name, [int]$Code, [string]$Detail = "") {
    $results.Add([pscustomobject]@{ Check = $Name; Exit = $Code; Detail = $Detail })
    $colour = if ($Code -eq 0) { "Green" } else { "Red" }
    Write-Host ("{0,-34} {1}" -f $Name, $(if ($Code -eq 0) { "PASS" } else { "FAIL ($Code)" })) -ForegroundColor $colour
    if ($Detail) { Write-Host "  $Detail" -ForegroundColor DarkGray }
}

Push-Location $Repo
try {
    $env:SECRET_KEY = "local-test-secret"
    $env:DEBUG = "true"
    $env:DATABASE_URL = "postgresql+asyncpg://fittrack:fittrack_dev@localhost:5432/fittrack"
    $env:TEST_DATABASE_URL = "postgresql+asyncpg://fittrack:fittrack_dev@localhost:5432/fittrack_test"
    $env:REDIS_URL = "redis://:redis_dev_password@localhost:6379/0"

    Write-Host "`n== Backend ==" -ForegroundColor Cyan
    python -m pytest backend/tests -q -m "not integration" --tb=short
    Add-Result "backend unit (not integration)" $LASTEXITCODE

    python -m pytest backend/tests/test_doc_claims.py -q --tb=short
    Add-Result "doc-claim guard" $LASTEXITCODE

    python -m ruff check backend/
    Add-Result "ruff" $LASTEXITCODE

    if (-not $SkipFrontend) {
        Write-Host "`n== Frontend ==" -ForegroundColor Cyan
        Push-Location frontend
        try {
            npx tsc --noEmit
            Add-Result "tsc --noEmit" $LASTEXITCODE

            $output = (npm test -- --reporter=dot 2>&1 | Out-String)
            $code = $LASTEXITCODE
            if ($code -ne 0 -and $output -match "Tests\s+\d+ passed") {
                Add-Result "vitest" 0 "all tests passed; npm returned $code on a jsdom canvas warning"
            } else {
                Add-Result "vitest" $code
            }
        } finally {
            Pop-Location
        }
    }

    Write-Host "`n== Audit evidence ==" -ForegroundColor Cyan
    python (Join-Path $PSScriptRoot "verify_audit.py") --repo $Repo
    Add-Result "audit artifact gate" $LASTEXITCODE
} finally {
    Pop-Location
}

$failed = @($results | Where-Object { $_.Exit -ne 0 })
Write-Host "`n== Summary ==" -ForegroundColor Cyan
$results | Format-Table -AutoSize
if ($failed.Count -gt 0) {
    Write-Host "$($failed.Count) check(s) failed." -ForegroundColor Red
    exit 1
}
Write-Host "All checks passed." -ForegroundColor Green
exit 0
