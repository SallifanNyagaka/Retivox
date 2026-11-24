param(
  [ValidateSet('apk', 'appbundle')]
  [string]$Target = 'apk'
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$configPath = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw 'Mobile release configuration is missing. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to apps/flutter/.env first.'
}

$values = @{}
foreach ($entry in Get-Content -LiteralPath $configPath) {
  $trimmed = $entry.Trim()
  if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
  $separator = $trimmed.IndexOf('=')
  if ($separator -lt 1) { continue }
  $name = $trimmed.Substring(0, $separator).Trim()
  if ($name -notin @('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'RETIVOX_WEB_API_URL')) { continue }
  $value = $trimmed.Substring($separator + 1).Trim()
  if ($value.Length -ge 2 -and
      (($value.StartsWith('"') -and $value.EndsWith('"')) -or
       ($value.StartsWith("'") -and $value.EndsWith("'")))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  $values[$name] = $value.Trim()
}

$supabaseUrl = $values['SUPABASE_URL']
$publishableKey = $values['SUPABASE_PUBLISHABLE_KEY']
if (-not $publishableKey) { $publishableKey = $values['SUPABASE_ANON_KEY'] }
if (-not $supabaseUrl -or -not $publishableKey) {
  throw 'Mobile release configuration must include SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY). Values were not displayed.'
}

$flutterArgs = @(
  'build', $Target, '--release',
  "--dart-define=SUPABASE_URL=$supabaseUrl",
  "--dart-define=SUPABASE_PUBLISHABLE_KEY=$publishableKey"
)
$webApiUrl = $values['RETIVOX_WEB_API_URL']
if ($webApiUrl) { $flutterArgs += "--dart-define=RETIVOX_WEB_API_URL=$webApiUrl" }

Push-Location $projectRoot
try {
  & flutter @flutterArgs
  if ($LASTEXITCODE -ne 0) { throw "Flutter build failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}
