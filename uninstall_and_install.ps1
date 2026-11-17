$ErrorActionPreference = 'Stop'
$updater = Join-Path $PSScriptRoot 'uninstall_and_install_latest.ps1'
if (-not (Test-Path -LiteralPath $updater -PathType Leaf)) {
  throw "Update script not found: $updater"
}
& $updater
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
  throw "Retivox install failed with exit code $LASTEXITCODE"
}
