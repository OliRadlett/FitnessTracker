# Renders every frame in the lab to PNG on the JVM, then checks contrast.
# No emulator and no device: Robolectric draws the real Compose tree.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File qa\shoot.ps1
#
# Output: qa/out/<frame>.png plus a printed contrast table.

param(
    [string]$Filter = "uk.oli.fittrack.lab.*ShotTest"
)

# The default Windows policy blocks unsigned scripts; scope this to the process.
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

$ErrorActionPreference = 'Stop'
$lab = Split-Path $PSScriptRoot -Parent
$androidRoot = Join-Path $env:LOCALAPPDATA 'Android'

if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem (Join-Path $androidRoot 'jdk-17') -Directory -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $jdk) { throw "No JDK 17 found. Run the toolchain setup or set JAVA_HOME." }
    $env:JAVA_HOME = $jdk.FullName
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $androidRoot 'Sdk' }

$gradle = Join-Path $androidRoot 'gradle-8.11.1\bin\gradle.bat'
if (-not (Test-Path $gradle)) { throw "Gradle 8.11.1 not found at $gradle" }

Push-Location $lab
try {
    & $gradle --no-daemon --console=plain :app:testDebugUnitTest --tests $Filter
    if ($LASTEXITCODE -ne 0) { throw "Render failed (exit $LASTEXITCODE)" }

    $shots = Join-Path $lab 'app\build\shots'
    $out = Join-Path $lab 'qa\out'
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    $pngs = Get-ChildItem $shots -Filter *.png -ErrorAction SilentlyContinue
    if (-not $pngs) { throw "No PNGs produced in $shots" }
    $pngs | Copy-Item -Destination $out -Force
    foreach ($p in $pngs) {
        Add-Type -AssemblyName System.Drawing
        $img = [System.Drawing.Image]::FromFile($p.FullName)
        "{0,-28} {1}x{2}" -f $p.Name, $img.Width, $img.Height
        $img.Dispose()
    }
    & (Join-Path $PSScriptRoot 'contrast.ps1') | Out-Host
}
finally {
    Pop-Location
}
