$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$updater = Join-Path $repoRoot 'uninstall_and_install_latest.ps1'
if (-not (Test-Path -LiteralPath $updater -PathType Leaf)) {
  throw "Update script not found: $updater"
}
& $updater
