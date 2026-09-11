# scripts/bridge/install-breaks-tick.ps1
#
# Registers the break repair loop's tick with Task Scheduler: node only, no
# agent, at a fixed interval (documentation/break-repair-loop.md).
#
#   powershell -File scripts/bridge/install-breaks-tick.ps1              every 10 min
#   powershell -File scripts/bridge/install-breaks-tick.ps1 -Minutes 5
#   powershell -File scripts/bridge/install-breaks-tick.ps1 -Remove
#
# Runs as the signed-in user, because a repair conversation has to be able to
# open a window, and through breaks-tick.vbs, so no console flashes up per tick.
param(
  [int]$Minutes = 10,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$taskName = 'Hypercomb break repair tick'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "removed scheduled task '$taskName'"
  return
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$quiet = Join-Path $here 'breaks-tick.vbs'
if (-not (Test-Path $quiet)) { throw "missing $quiet" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node is not on PATH - the tick would have nothing to run' }
if ($Minutes -lt 1) { throw '-Minutes must be at least 1' }

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $quiet + '"') -WorkingDirectory $here

# -Once plus a repetition is the idiom for "every N minutes, forever".
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $Minutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

# IgnoreNew: a tick still waiting on a review swallows the ticks behind it.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 60) `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description 'Folds client breaks into the break log; starts an agent only when there is work.' `
  -Force | Out-Null
Write-Host "registered scheduled task '$taskName' (every $Minutes min, no window)"
