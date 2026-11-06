param(
  [string]$ExecutablePath = (Join-Path $PSScriptRoot 'retivox_client.exe'),
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$taskName = 'Retivox Offline Sale Sync'

if ($Remove) {
  $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existingTask) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
    Write-Output 'Retivox background sale sync task removed.'
  }
  else {
    Write-Output 'Retivox background sale sync task was already absent.'
  }
  exit 0
}

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$workingDirectory = Split-Path -Parent $resolvedExecutable
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$xmlExecutable = [Security.SecurityElement]::Escape($resolvedExecutable)
$xmlWorkingDirectory = [Security.SecurityElement]::Escape($workingDirectory)

$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Retries queued Retivox sales while the signed-in Windows account is active.</Description>
    <URI>\Retivox\OfflineSaleSync</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$userSid</UserId>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$userSid</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$xmlExecutable</Command>
      <Arguments>--background-sync</Arguments>
      <WorkingDirectory>$xmlWorkingDirectory</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

Register-ScheduledTask -TaskName $taskName -Xml $taskXml -Force | Out-Null
Write-Output "Registered '$taskName' for the current Windows user."
