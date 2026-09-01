# Wire the auto-updating launcher into the shell, once.
#
#   powershell -ExecutionPolicy Bypass -File scripts\client\install-launcher.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\client\install-launcher.ps1 -Remove
#
# Two shortcuts, and neither one is a system change:
#
#   Desktop  "Hypercomb"        - update, then launch. This is the app icon now.
#   Startup  "Hypercomb Update" - update only, at logon, minimised. By the time
#                                 the app is opened the newest green build is
#                                 already installed, so the launch is instant
#                                 rather than a download.
#
# The Startup half is what makes it passive; the Desktop half is what makes it
# correct anyway if the machine was off when the build landed. Delete either
# shortcut by hand and the other still works.

param([switch]$Remove)

$ErrorActionPreference = 'Stop'

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$cmd     = Join-Path $here 'hypercomb.cmd'
$updater = Join-Path $here 'windows-client.mjs'
$icon    = Join-Path (Split-Path -Parent (Split-Path -Parent $here)) 'hypercomb-client\app\icons\icon.ico'

$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')

$launchLink = Join-Path $desktop 'Hypercomb.lnk'
$updateLink = Join-Path $startup 'Hypercomb Update.lnk'

if ($Remove) {
  foreach ($link in @($launchLink, $updateLink)) {
    if (Test-Path $link) { Remove-Item $link -Force; Write-Host "removed $link" }
  }
  return
}

if (-not (Test-Path $cmd))     { throw "missing $cmd" }
if (-not (Test-Path $updater)) { throw "missing $updater" }

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
$u.TargetPath       = $env:ComSpec
$u.Arguments        = '/c node "' + $updater + '"'
$u.WorkingDirectory = $here
$u.WindowStyle      = 7
$u.Description      = 'Install the newest green Hypercomb client build in the background'
if (Test-Path $icon) { $u.IconLocation = $icon }
$u.Save()
Write-Host "wrote $updateLink"
