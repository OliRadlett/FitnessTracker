# Contrast gate. Reads the token hex values straight out of Tokens.kt, so the
# check cannot drift from the code, and prints every foreground/background pair
# the screens actually use against the 4.5:1 floor for small text.
#
#   pwsh -File qa/contrast.ps1

$ErrorActionPreference = 'Stop'
$lab = Split-Path $PSScriptRoot -Parent
$tokens = Get-Content (Join-Path $lab 'app\src\main\java\uk\oli\fittrack\lab\ui\Tokens.kt') -Raw

function Get-Token([string]$name) {
    $m = [regex]::Match($tokens, "val\s+$name\s*=\s*Color\(0x([0-9A-Fa-f]{8})\)")
    if (-not $m.Success) { throw "token $name not found in Tokens.kt" }
    $hex = $m.Groups[1].Value
    return @(
        [Convert]::ToInt32($hex.Substring(2, 2), 16),
        [Convert]::ToInt32($hex.Substring(4, 2), 16),
        [Convert]::ToInt32($hex.Substring(6, 2), 16)
    )
}

function Get-Lum([int[]]$rgb) {
    $c = @($rgb | ForEach-Object {
        $v = $_ / 255.0
        if ($v -le 0.04045) { $v / 12.92 } else { [Math]::Pow(($v + 0.055) / 1.055, 2.4) }
    })
    return 0.2126 * $c[0] + 0.7152 * $c[1] + 0.0722 * $c[2]
}

function Get-Ratio([int[]]$fg, [int[]]$bg) {
    $a = Get-Lum $fg; $b = Get-Lum $bg
    $hi = [Math]::Max($a, $b); $lo = [Math]::Min($a, $b)
    return [Math]::Round(($hi + 0.05) / ($lo + 0.05), 2)
}

$bg      = Get-Token 'Bg'
$surface = Get-Token 'Surface'
$fg      = Get-Token 'Fg'
$muted   = Get-Token 'Muted'
$accent  = Get-Token 'Accent'
$onAcc   = Get-Token 'OnAccent'
$soft    = Get-Token 'SurfaceLight'

$pairs = @(
    @('Fg on Bg',            $fg,    $bg),
    @('Muted on Bg',         $muted, $bg),
    @('Muted on Surface',    $muted, $surface),
    @('Muted on SurfaceLight', $muted, $soft),
    @('Accent on Bg',        $accent,$bg),
    @('Accent on Surface',   $accent,$surface),
    @('OnAccent on Accent',  $onAcc, $accent)
)

$fail = 0
""
"{0,-24} {1,7}  {2}" -f 'PAIR', 'RATIO', 'VERDICT'
foreach ($p in $pairs) {
    $r = Get-Ratio $p[1] $p[2]
    $ok = $r -ge 4.5
    if (-not $ok) { $fail++ }
    "{0,-24} {1,7}:1  {2}" -f $p[0], $r, $(if ($ok) { 'pass' } else { 'FAIL (<4.5)' })
}
""
if ($fail -gt 0) { throw "$fail contrast token pair(s) below the 4.5:1 floor" }
'Contrast gate: pass'
