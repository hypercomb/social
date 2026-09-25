#Requires -RunAsAdministrator
# One-time host installation. The signed shell payload is already staged in
# ProgramData; normal content and future revisions remain in the live hive.
param(
  [string]$ShellDir = 'C:\ProgramData\Hypercomb\host-shell',
  [string]$ServiceName = 'hypercomb-relay'
)

$ErrorActionPreference = 'Stop'
$shell = [IO.Path]::GetFullPath($ShellDir)
$pin = (Get-Content -LiteralPath (Join-Path $shell 'pin') -Raw).Trim()
if ($pin -notmatch '^[0-9a-f]{64}$') { throw 'The staged shell has no valid pin.' }
if (-not (Test-Path -LiteralPath (Join-Path $shell 'index.html') -PathType Leaf)) {
  throw 'The staged shell has no index.html.'
}
$actual = (Get-FileHash -LiteralPath (Join-Path $shell $pin) -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $pin) { throw 'The staged bootstrap bytes do not match the pin.' }

$before = (nssm.exe get $ServiceName AppParameters).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not read the relay service arguments.' }
if ($before -match '(?:^|\s)--shell-dir(?:\s|=)') {
  throw 'The relay already has a shell directory. Inspect its service configuration first.'
}
$after = "$before --shell-dir `"$shell`""
nssm.exe set $ServiceName AppParameters $after | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not update the relay service arguments.' }

try {
  Restart-Service -Name $ServiceName -ErrorAction Stop
  $seen = ''
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try { $seen = (Invoke-RestMethod 'http://127.0.0.1:7777/pin' -TimeoutSec 2).Trim() } catch { }
    if ($seen -eq $pin) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($seen -ne $pin) { throw "The restarted relay did not serve the staged pin ($seen)." }
  Write-Output "Relay serves the pure host at http://127.0.0.1:7777 (pin $pin)."
} catch {
  nssm.exe set $ServiceName AppParameters $before | Out-Null
  Restart-Service -Name $ServiceName -ErrorAction SilentlyContinue
  throw
}
