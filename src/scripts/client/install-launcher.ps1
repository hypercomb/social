# Wire the auto-updating client into the shell, once.
#
#   powershell -ExecutionPolicy Bypass -File scripts\client\install-launcher.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\client\install-launcher.ps1 -Remove
#
# Three pieces, none of them a system change, each removable on its own:
#
#   Desktop shortcut  "Hypercomb"        update, then launch.
#   Startup shortcut  "Hypercomb Update" update only, minimised, at logon.
#   Scheduled task    every 3 hours      update only, in the background.
#
# The shortcuts alone leave one gap: a build that goes green after logon is not
# installed until the next one. The task closes it. It cannot interrupt anything
# either way, because the updater refuses to install over a running app and
# defers to the next launch - so in practice it installs while the app is shut.
#
# The task deliberately does NOT pass an install directory. The updater finds
# the binary instead, which matters here: a Claude Code session runs inside the
# desktop app's MSIX container and installs into its redirected LocalAppData,
# while this task runs outside it. Pinning a path would update one copy and
# leave the other - the one the taskbar actually points at - stale.

param([switch]$Remove)

$ErrorActionPreference = 'Stop'

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$cmd     = Join-Path $here 'hypercomb.cmd'
$updater = Join-Path $here 'windows-client.mjs'
$quiet   = Join-Path $here 'update-quiet.vbs'
$icon    = Join-Path (Split-Path -Parent (Split-Path -Parent $here)) 'hypercomb-client\app\icons\icon.ico'

$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')

$launchLink = Join-Path $desktop 'Hypercomb.lnk'
$updateLink = Join-Path $startup 'Hypercomb Update.lnk'
$taskName   = 'Hypercomb Client Update'

if ($Remove) {
  foreach ($link in @($launchLink, $updateLink)) {
    if (Test-Path $link) { Remove-Item $link -Force; Write-Host "removed $link" }
  }
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "removed scheduled task '$taskName'"
  }
  return
}

if (-not (Test-Path $cmd))     { throw "missing $cmd" }
if (-not (Test-Path $updater)) { throw "missing $updater" }
if (-not (Test-Path $quiet))   { throw "missing $quiet" }

$shell = New-Object -ComObject WScript.Shell

# WindowStyle 7 = minimised: the console the batch file needs is not something
# anyone should have to look at.
$s = $shell.CreateShortcut($launchLink)
$s.TargetPath       = $env:ComSpec
$s.Arguments        = '/c "' + $cmd + '"'
$s.WorkingDirectory = $here
$s.WindowStyle      = 7
$s.Description      = 'Hypercomb - updates to the newest green build, then launches'
if (Test-Path $icon) { $s.IconLocation = $icon }
$s.Save()
Write-Host "wrote $launchLink"

$u = $shell.CreateShortcut($updateLink)
$u.TargetPath       = 'wscript.exe'
$u.Arguments        = '"' + $quiet + '"'
$u.WorkingDirectory = $here
$u.WindowStyle      = 7
$u.Description      = 'Install the newest green Hypercomb client build in the background'
if (Test-Path $icon) { $u.IconLocation = $icon }
$u.Save()
Write-Host "wrote $updateLink"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node is not on PATH - the scheduled task would have nothing to run' }

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $quiet + '"') -WorkingDirectory $here

# -Once plus a repetition is the idiom for "every N hours, forever"; a bare
# -Daily trigger fires once and waits a day. StartWhenAvailable is what makes a
# run missed while the machine was asleep happen on wake instead of being lost.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(10) `
  -RepetitionInterval (New-TimeSpan -Hours 3) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description 'Install the newest green Hypercomb client build. Skips while the app is running.' `
  -Force | Out-Null
Write-Host "registered scheduled task '$taskName' (every 3h, no window)"
