#Requires -RunAsAdministrator
# A DEDICATED HOST FOR SOMEONE, ON THIS MACHINE — the same shape as jwize.com.
#
# One relay (relay.js) per domain, as its own Windows service, with its own
# content folder and ONLY its owner's key on the writers list; the
# framework-free shell answers the apex; the existing Cloudflare tunnel
# carries <domain> and content.<domain> to it. The owner's hive, opened at
# https://<domain>, takes <domain> as its own host, so host backup replicates
# their whole hive here and their publishes land here too. Nothing runs on
# their machine. Online while this machine is.
#
#   .\add-hosted-domain-elevated.ps1 -Domain cafesociety.me -Writer npub1... -Port 7778
#
# The shell must already be staged in <HostsRoot>\<Domain>\shell (a
# `node build.mjs --no-content` shim build), or pass -ShellSource to copy one.
#
# Re-runnable: an existing service gets the new parameters and a clean
# restart, and a tunnel route or DNS record already in place is kept.
param(
  [Parameter(Mandatory)] [string]$Domain,
  [Parameter(Mandatory)] [string]$Writer,
  [int]$Port = 7778,
  [string]$HostsRoot = 'C:\ProgramData\Hypercomb\hosts',
  [string]$ShellSource = '',
  [string]$Tunnel = 'hypercomb-relay',
  [string]$TunnelService = 'cloudflared',
  [string]$TunnelConfig = 'C:\Users\Jaime\.cloudflared\config.yml',
  [string]$Cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe',
  [string]$Node = 'C:\Program Files\nodejs\node.exe'
)

$ErrorActionPreference = 'Stop'
$Domain = $Domain.Trim().ToLowerInvariant()
$Writer = $Writer.Trim()
if ($Domain -notmatch '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$') { throw "Not a domain name: $Domain" }
if ($Writer -notmatch '^(?:npub1[02-9ac-hj-np-z]{58}|[0-9a-fA-F]{64})$') { throw 'The writer must be an npub1… key or 64 hex characters.' }
if ($Port -eq 7777) { throw 'Port 7777 is jwize.com''s relay. Choose another port.' }

$root = Join-Path $HostsRoot $Domain
$content = Join-Path $root 'content'
$shell = Join-Path $root 'shell'
New-Item -ItemType Directory -Force -Path $content, $shell | Out-Null
Start-Transcript -Path (Join-Path $root 'setup.log') -Force | Out-Null
try {
  # ── the shell: the app the domain's apex opens ────────────────────────────
  if ($ShellSource) {
    robocopy $ShellSource $shell /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Could not copy the shell from $ShellSource." }
  }
  $pin = (Get-Content -LiteralPath (Join-Path $shell 'pin') -Raw).Trim()
  if ($pin -notmatch '^[0-9a-f]{64}$') { throw "The shell in $shell has no valid pin." }
  if (-not (Test-Path -LiteralPath (Join-Path $shell 'index.html') -PathType Leaf)) { throw "The shell in $shell has no index.html." }
  $actual = (Get-FileHash -LiteralPath (Join-Path $shell $pin) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $pin) { throw 'The staged bootstrap bytes do not match the pin.' }
  "shell: $shell (pin $pin)"

  # ── the relay: its own service, its own folder, one writer ────────────────
  $service = 'hypercomb-relay-' + ($Domain -replace '\.', '-')
  $relayJs = Join-Path $PSScriptRoot 'relay.js'
  $params = "`"$relayJs`" --port $Port --content-dir `"$content`" --shell-dir `"$shell`" --writers $Writer"
  $exists = [bool](Get-Service -Name $service -ErrorAction SilentlyContinue)
  if (-not $exists) {
    $taken = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($taken) { throw "Port $Port is already in use (PID $($taken[0].OwningProcess)). Choose another with -Port." }
    nssm.exe install $service $Node | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not install the service $service." }
  }
  nssm.exe set $service AppParameters $params | Out-Null
  nssm.exe set $service AppDirectory $PSScriptRoot | Out-Null
  nssm.exe set $service AppStdout (Join-Path $root 'relay.out.log') | Out-Null
  nssm.exe set $service AppStderr (Join-Path $root 'relay.err.log') | Out-Null
  nssm.exe set $service AppRotateFiles 1 | Out-Null
  nssm.exe set $service AppRotateBytes 10485760 | Out-Null
  nssm.exe set $service Start SERVICE_AUTO_START | Out-Null
  nssm.exe set $service Description "Hypercomb host for $Domain (relay.js, one writer)" | Out-Null

  # A clean (re)start: a bare restart can leave an orphan listener and the new
  # instance dies EADDRINUSE (see add-writer-elevated.ps1).
  $svc = Get-CimInstance Win32_Service -Filter "Name='$service'"
  if ($svc.ProcessId -and $svc.ProcessId -ne 0) { taskkill /F /T /PID $svc.ProcessId | Out-Null }
  foreach ($c in @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { taskkill /F /PID $c.OwningProcess | Out-Null }
  Start-Sleep -Seconds 1
  Start-Service -Name $service
  $seen = ''
  for ($i = 0; $i -lt 40; $i++) {
    try { $seen = (Invoke-RestMethod "http://127.0.0.1:$Port/pin" -TimeoutSec 2).Trim() } catch { }
    if ($seen -eq $pin) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($seen -ne $pin) { throw "The relay on port $Port did not serve the shell's pin. See $(Join-Path $root 'relay.err.log')." }
  "relay: $service on http://127.0.0.1:$Port (writer $($Writer.Substring(0, 12))…)"

  # ── the tunnel: <domain> and content.<domain> → this relay ────────────────
  $hosts = @($Domain, "content.$Domain")
  $config = Get-Content -LiteralPath $TunnelConfig -Raw
  $catchAll = '(?m)^(\s*)- service: http_status:404'
  if ($config -notmatch $catchAll) { throw "$TunnelConfig has no catch-all rule to insert before." }
  $missing = @($hosts | Where-Object { $config -notmatch "(?m)^\s*- hostname:\s*$([regex]::Escape($_))\s*$" })
  if ($missing.Count) {
    Copy-Item -LiteralPath $TunnelConfig -Destination "$TunnelConfig.bak-$(Get-Date -Format yyyyMMddHHmmss)"
    $indent = [regex]::Match($config, $catchAll).Groups[1].Value
    $rules = ($missing | ForEach-Object { "$indent- hostname: $_`n$indent  service: http://localhost:$Port`n" }) -join ''
    $config = [regex]::Replace($config, $catchAll, { param($m) $rules + $m.Value }, 1)
    [IO.File]::WriteAllText($TunnelConfig, $config, (New-Object Text.UTF8Encoding $false))
  }
  & $Cloudflared tunnel --config $TunnelConfig ingress validate
  if ($LASTEXITCODE -ne 0) { throw "The tunnel config no longer validates. The previous copy is beside it (.bak-*)." }
  "tunnel: $($hosts -join ', ') → localhost:$Port"

  # The DNS records point each name at the tunnel. The zone must be in the
  # same Cloudflare account as the tunnel.
  $cert = Join-Path (Split-Path $TunnelConfig) 'cert.pem'
  foreach ($h in $hosts) {
    $out = & $Cloudflared --origincert $cert tunnel route dns $Tunnel $h 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -and $out -notmatch 'already exists') {
      throw "No DNS record for ${h}: $($out.Trim())`nIs the $Domain zone in the same Cloudflare account as the '$Tunnel' tunnel?"
    }
    "dns: $h → $Tunnel"
  }

  Restart-Service -Name $TunnelService
  "tunnel service restarted (jwize.com blinks for a few seconds)"

  $live = ''
  for ($i = 0; $i -lt 30; $i++) {
    try { $live = (Invoke-RestMethod "https://$Domain/pin" -TimeoutSec 5).Trim() } catch { }
    if ($live -eq $pin) { break }
    Start-Sleep -Seconds 2
  }
  if ($live -eq $pin) { "LIVE: https://$Domain serves pin $pin" }
  else { "Not answering yet at https://$Domain — the zone may still be activating. Check: node hypercomb-shim/host/check-host.mjs https://$Domain" }
} finally {
  Stop-Transcript | Out-Null
}
