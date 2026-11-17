$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'install_windows.ps1'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
  throw "Installer script not found: $installer"
}

# Replace the canonical installation without deleting its .env or local logs.
& $installer -Launch
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
  throw "Retivox install failed with exit code $LASTEXITCODE"
}

$canonical = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Retivox')).TrimEnd('\')
$bundleNames = @('Retivox.exe','retivox_client.exe','app_links_plugin.dll','connectivity_plus_plugin.dll','flutter_secure_storage_windows_plugin.dll','flutter_windows.dll','pdfium.dll','printing_plugin.dll','sqlite3.dll','url_launcher_windows_plugin.dll','icudtl.dat','native_assets.json')
$obsoleteInstallDirs = @(
  (Join-Path $env:USERPROFILE 'Retivox'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Retivox')
)
foreach ($obsolete in $obsoleteInstallDirs) {
  if (-not (Test-Path -LiteralPath $obsolete -PathType Container)) { continue }
  $resolvedObsolete = [System.IO.Path]::GetFullPath($obsolete).TrimEnd('\')
  if ($resolvedObsolete.Equals($canonical, [System.StringComparison]::OrdinalIgnoreCase)) { continue }

  # Keep .env, logs and helper scripts; remove only the old Flutter bundle.
  $obsoleteData = [System.IO.Path]::GetFullPath((Join-Path $resolvedObsolete 'data'))
  if ($obsoleteData.StartsWith($resolvedObsolete + '\', [System.StringComparison]::OrdinalIgnoreCase) -and
      (Test-Path -LiteralPath $obsoleteData -PathType Container)) {
    Remove-Item -LiteralPath $obsoleteData -Recurse -Force
  }
  foreach ($name in $bundleNames) {
    $file = Join-Path $resolvedObsolete $name
    if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file -Force }
  }
}
