param([switch]$Launch)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$release = Join-Path $repoRoot 'apps\flutter\build\windows\x64\runner\Release'
$installDir = Join-Path $env:LOCALAPPDATA 'Retivox'
$releaseExe = Join-Path $release 'retivox_client.exe'

if (-not (Test-Path -LiteralPath $releaseExe -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $release 'data') -PathType Container)) {
  throw "Fresh Windows release is incomplete. Build apps/flutter for Windows first: $release"
}

# Stop both names used by previous Retivox installers before replacing files.
$runningApps = @(Get-Process -Name 'retivox_client', 'Retivox' -ErrorAction SilentlyContinue)
$knownInstallRoots = @(
  [System.IO.Path]::GetFullPath($installDir).TrimEnd('\'),
  [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\Retivox')).TrimEnd('\'),
  [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Retivox')).TrimEnd('\')
)
foreach ($app in $runningApps) {
  $appPath = [System.IO.Path]::GetFullPath($app.Path)
  $isKnownInstall = $false
  foreach ($root in $knownInstallRoots) {
    if ($appPath.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
      $isKnownInstall = $true
      break
    }
  }
  if (-not $isKnownInstall) {
    throw "A Retivox-named process is running from an unexpected location: $appPath"
  }

  if ($app.MainWindowHandle -ne 0) {
    [void]$app.CloseMainWindow()
    if (-not $app.WaitForExit(10000)) {
      throw 'Retivox is still open. Close it and run the installer again.'
    }
  } else {
    # Background sync instances normally exit themselves; terminate only a
    # stale process running from one of the known Retivox installation paths.
    if (-not $app.WaitForExit(10000)) {
      Stop-Process -Id $app.Id -Force
      if (-not $app.WaitForExit(5000)) {
        throw "Could not stop stale Retivox background process $($app.Id)."
      }
    }
  }
}

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$resolvedInstall = [System.IO.Path]::GetFullPath($installDir).TrimEnd('\')
$bundleData = [System.IO.Path]::GetFullPath((Join-Path $resolvedInstall 'data'))
if (-not $bundleData.StartsWith($resolvedInstall + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to clean a Flutter bundle outside the install folder: $bundleData"
}

# Remove only known app bundle files. Keep the sidecar config and local logs.
if (Test-Path -LiteralPath $bundleData -PathType Container) {
  Remove-Item -LiteralPath $bundleData -Recurse -Force
}
$bundleFiles = @(
  'Retivox.exe', 'retivox_client.exe', 'app_links_plugin.dll',
  'connectivity_plus_plugin.dll', 'flutter_secure_storage_windows_plugin.dll',
  'flutter_windows.dll', 'pdfium.dll', 'printing_plugin.dll', 'sqlite3.dll',
  'url_launcher_windows_plugin.dll', 'icudtl.dat', 'native_assets.json'
)
foreach ($name in $bundleFiles) {
  $file = Join-Path $resolvedInstall $name
  if (Test-Path -LiteralPath $file -PathType Leaf) {
    Remove-Item -LiteralPath $file -Force
  }
}

Copy-Item -Path (Join-Path $release '*') -Destination $resolvedInstall -Recurse -Force
$installedExe = Join-Path $resolvedInstall 'retivox_client.exe'
$brandedExe = Join-Path $resolvedInstall 'Retivox.exe'
Copy-Item -LiteralPath $installedExe -Destination $brandedExe -Force
$syncManager = Join-Path $repoRoot 'apps\flutter\windows\manage_background_sync.ps1'
if (Test-Path -LiteralPath $syncManager -PathType Leaf) {
  Copy-Item -LiteralPath $syncManager -Destination (Join-Path $resolvedInstall 'manage_background_sync.ps1') -Force
}

# Keep existing Supabase configuration. Seed it from the project only on first install.
$installedEnv = Join-Path $resolvedInstall '.env'
$sourceEnv = Join-Path $repoRoot 'apps\flutter\.env'
if (-not (Test-Path -LiteralPath $installedEnv -PathType Leaf) -and
    (Test-Path -LiteralPath $sourceEnv -PathType Leaf)) {
  Copy-Item -LiteralPath $sourceEnv -Destination $installedEnv
}

$shortcutPath = Join-Path $env:USERPROFILE 'Desktop\Retivox.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $brandedExe
$shortcut.WorkingDirectory = $resolvedInstall
$shortcut.IconLocation = "$brandedExe,0"
$shortcut.Save()

Write-Host "Retivox installed at $resolvedInstall"
Write-Host 'The installed shortcut starts with the app folder as its working directory.'
if ($Launch) {
  $launchedApp = Start-Process -FilePath $brandedExe `
    -WorkingDirectory $resolvedInstall -PassThru
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 300
    $launchedApp.Refresh()
  } while (-not $launchedApp.HasExited -and
    $launchedApp.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline)
  if ($launchedApp.HasExited -or $launchedApp.MainWindowHandle -eq 0) {
    throw 'Retivox did not create an application window.'
  }
  [void]$shell.AppActivate($launchedApp.Id)
  Start-Sleep -Seconds 2
  $launchedApp.Refresh()
  if ($launchedApp.HasExited -or $launchedApp.MainWindowHandle -eq 0) {
    throw 'Retivox window closed during startup.'
  }
  Write-Host "Retivox window opened (process $($launchedApp.Id))."
}
