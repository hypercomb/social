# mirror-content-to-azure.ps1
#
# Mirror the relay's content dir (the byte-equal store host-sync PUTs to
# jwize.com) up to Azure Blob, FLATTENED, so the same bytes are fetchable from a
# second host. This is the auxiliary byte source the ContentBroker falls back to:
#
#   pluginthematrix.io  --(custom domain / CDN)-->  storagehypercomb account
#   GET https://pluginthematrix.io/sigs/<sig>  ==  blob  sigs/<sig>
#
# The broker (content-broker.drone.ts BETA_FALLBACK_DOMAINS) advertises the host
# string `pluginthematrix.io/sigs`, so it GETs `https://pluginthematrix.io/sigs/<sig>`.
# Mapping that to Azure: a container literally named `sigs`, anonymously
# readable, holding flat `<sig>`-named blobs. A custom domain on the storage
# account makes `pluginthematrix.io/<container>/<blob>` resolve to
# `<account>.blob.core.windows.net/<container>/<blob>` — i.e. `/sigs/<sig>`.
#
# FULL REDUNDANCY (default): every content-addressed byte file in the content
# dir is flattened to `<sig>` and uploaded — the flat authored heap at the root
# (resources, layers, page bodies) AND the typed essentials pools
# (__bees__/<sig>.js, __dependencies__/<sig>.js, __layers__/<sig>.json). The sig
# IS sha256 of the bytes, so `<sig>.js` flattens to blob `<sig>` and still
# verifies. After a full run, pluginthematrix.io can serve ANY sig flat —
# matching the relay's own flat-heap model. (The separate `deploy:essentials`
# path still publishes the TYPED layout to the `dcp` container for the install
# pipeline; this flat mirror is the broker's view.) Use -RootOnly to mirror just
# the authored flat heap and skip the typed pools.
#
# Skipped: sigbag markers (0000, 0001…), manifest.json, and anything whose
# basename (minus a .js/.json extension) is not a 64-hex sig.
#
# Scale: the content dir holds tens of thousands of files, so this does NOT make
# one `az` call per file. It (1) lists the container once to learn what's already
# mirrored (content-addressed ⇒ immutable ⇒ skip), (2) hardlinks just the NEW
# sigs into a flat staging dir, (3) `az storage blob upload-batch` uploads the
# staging dir in one parallel pass, (4) removes the staging dir. Content-Type is
# forced to application/octet-stream so the broker's text/html guard never
# rejects a page body.
#
# Usage (run where the relay's content dir lives — the jwize.com box, or a
# synced copy):
#
#   pwsh ./mirror-content-to-azure.ps1                 # incremental full mirror
#   pwsh ./mirror-content-to-azure.ps1 -SetupCors      # one-time: container + CORS, then mirror
#   pwsh ./mirror-content-to-azure.ps1 -RootOnly       # authored flat heap only (skip typed pools)
#   pwsh ./mirror-content-to-azure.ps1 -SourceDir D:\relay\content -Container sigs
#   pwsh ./mirror-content-to-azure.ps1 -Overwrite      # re-upload all (rarely needed; bytes are immutable)
#
# Auth (same precedence as deploy-azure.ps1):
#   AZURE_STORAGE_CONNECTION_STRING                 (preferred), or
#   AZURE_STORAGE_ACCOUNT + AZURE_STORAGE_KEY,      or
#   `az login` (falls back to --auth-mode login)
#
# Account/container default to storagehypercomb / sigs; override via
# AZURE_STORAGE_ACCOUNT / AZURE_MIRROR_CONTAINER or the -Container param.

param(
  [string]$SourceDir = '',
  [string]$Container = '',
  [switch]$SetupCors,
  [switch]$RootOnly,
  [switch]$Overwrite
)

$ErrorActionPreference = 'Stop'

function fail {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Error $Message
  exit 1
}

function write-step {
  param([AllowEmptyString()][string]$Message = '')
  Write-Host $Message
}

function test-command {
  param([Parameter(Mandatory = $true)][string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function get-optional-env {
  param([Parameter(Mandatory = $true)][string[]]$Names)
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
  }
  return $null
}

function invoke-az {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $cmdExe = if ([string]::IsNullOrWhiteSpace($env:ComSpec)) { 'cmd.exe' } else { $env:ComSpec }
  & $cmdExe '/d' '/s' '/c' 'az' @Arguments
  if ($LASTEXITCODE -ne 0) { fail "azure cli command failed: az $($Arguments -join ' ')" }
}

function invoke-az-silent {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $cmdExe = if ([string]::IsNullOrWhiteSpace($env:ComSpec)) { 'cmd.exe' } else { $env:ComSpec }
  $output = & $cmdExe '/d' '/s' '/c' 'az' @Arguments 2>&1
  return @{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
}

function get-auth-arguments {
  $connectionString = get-optional-env -Names @('AZURE_STORAGE_CONNECTION_STRING')
  if (-not [string]::IsNullOrWhiteSpace($connectionString)) {
    return @('--connection-string', $connectionString)
  }

  $storageAccount = get-optional-env -Names @('AZURE_STORAGE_ACCOUNT', 'AZURE_STORAGE_ACCOUNT_NAME')
  if ([string]::IsNullOrWhiteSpace($storageAccount)) { $storageAccount = 'storagehypercomb' }

  $accountKey = get-optional-env -Names @('AZURE_STORAGE_KEY', 'AZURE_STORAGE_ACCOUNT_KEY')
  if (-not [string]::IsNullOrWhiteSpace($accountKey)) {
    return @('--account-name', $storageAccount, '--account-key', $accountKey)
  }
  return @('--account-name', $storageAccount, '--auth-mode', 'login')
}

# A content-addressed byte file: bare 64-hex name, optionally a single .js/.json
# extension (essentials pools). Returns the bare <sig>, or $null for anything
# else (sigbag markers like 0000, manifest.json, etc.).
function get-sig-name {
  param([Parameter(Mandatory = $true)][string]$FileName)
  $base = $FileName -replace '\.(js|json)$', ''
  if ($base -match '^[0-9a-f]{64}$') { return $base }
  return $null
}

if (-not (test-command -Name 'az')) {
  fail 'azure cli (az) is not installed or is not on PATH'
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Source: the relay's content dir. Default to <scriptDir>/content (matches
# relay.js default + configure-writers.bat), override with -SourceDir or the
# CONTENT_DIR env the relay itself honours.
if ([string]::IsNullOrWhiteSpace($SourceDir)) {
  $SourceDir = get-optional-env -Names @('CONTENT_DIR')
}
if ([string]::IsNullOrWhiteSpace($SourceDir)) {
  $SourceDir = Join-Path $scriptDir 'content'
}
$resolvedSource = [System.IO.Path]::GetFullPath($SourceDir)

if (-not (Test-Path -LiteralPath $resolvedSource -PathType Container)) {
  fail "content dir does not exist (run the relay / sync its content first): $resolvedSource"
}

if ([string]::IsNullOrWhiteSpace($Container)) {
  $Container = get-optional-env -Names @('AZURE_MIRROR_CONTAINER')
}
if ([string]::IsNullOrWhiteSpace($Container)) { $Container = 'sigs' }

$authArguments = get-auth-arguments

# --- One-time setup: container (anon blob read) + CORS (idempotent) ---
# The broker fetch is a cross-origin browser fetch() reading res.arrayBuffer();
# without a permissive CORS rule the browser blocks the read and the cascade
# silently falls through. Anon blob read is needed because the GET is
# unauthenticated. Run once with -SetupCors (needs account-level perms).
if ($SetupCors) {
  write-step 'ensuring container exists + anonymous blob read'
  invoke-az -Arguments (@(
    'storage', 'container', 'create',
    '--name', $Container,
    '--public-access', 'blob',
    '--only-show-errors'
  ) + $authArguments)

  write-step 'setting blob-service CORS rule (GET/HEAD/OPTIONS, any origin)'
  invoke-az -Arguments (@(
    'storage', 'cors', 'add',
    '--services', 'b',
    '--methods', 'GET', 'HEAD', 'OPTIONS',
    '--origins', '*',
    '--allowed-headers', '*',
    '--exposed-headers', '*',
    '--max-age', '3600',
    '--only-show-errors'
  ) + $authArguments)
  write-step ''
  write-step 'NOTE: map the custom domain so pluginthematrix.io/sigs/<sig> resolves to this'
  write-step '      container. Azure Portal > Storage account > Networking > Custom domain,'
  write-step '      or front it with Azure Front Door / CDN pointing at the blob endpoint.'
  write-step ''
}

# --- Enumerate content-addressed files (deduped by sig) ---
$gciArgs = @{ LiteralPath = $resolvedSource; File = $true }
if (-not $RootOnly) { $gciArgs['Recurse'] = $true }

$bySig = @{}   # sig -> full path of one source file holding those bytes
foreach ($file in (Get-ChildItem @gciArgs)) {
  $sig = get-sig-name -FileName $file.Name
  if (-not $sig) { continue }
  if (-not $bySig.ContainsKey($sig)) { $bySig[$sig] = $file.FullName }
}

if ($bySig.Count -eq 0) {
  fail "no content-addressed files found under: $resolvedSource (is the relay populated?)"
}

# --- Learn what's already mirrored (immutable => skip), one list call ---
$existing = New-Object 'System.Collections.Generic.HashSet[string]'
if (-not $Overwrite) {
  $listResult = invoke-az-silent -Arguments (@(
    'storage', 'blob', 'list',
    '--container-name', $Container,
    '--query', '[].name',
    '--num-results', '*',
    '--output', 'tsv',
    '--only-show-errors'
  ) + $authArguments)
  if ($listResult.ExitCode -eq 0) {
    foreach ($name in ($listResult.Output -split "`n")) {
      $t = $name.Trim()
      if ($t) { [void]$existing.Add($t) }
    }
  } else {
    write-step 'note: could not list container (first run / not yet created) — uploading all'
  }
}

$toUpload = @($bySig.Keys | Where-Object { $Overwrite -or (-not $existing.Contains($_)) })
$skipped = $bySig.Count - $toUpload.Count

$displayAccount = get-optional-env -Names @('AZURE_STORAGE_ACCOUNT', 'AZURE_STORAGE_ACCOUNT_NAME')
if ([string]::IsNullOrWhiteSpace($displayAccount)) { $displayAccount = 'storagehypercomb (or per connection string)' }

write-step ''
write-step 'mirroring relay content -> azure (flattened, incremental)'
write-step '--------------------------------'
write-step " source    : $resolvedSource"
write-step " mode      : $(if ($RootOnly) { 'root only (authored flat heap)' } else { 'full (flat heap + typed pools)' })"
write-step " account   : $displayAccount"
write-step " container : $Container"
write-step " sigs      : $($bySig.Count) total, $($toUpload.Count) new, $skipped already mirrored"
write-step " url shape : https://pluginthematrix.io/$Container/<sig>"
write-step ''

if ($toUpload.Count -eq 0) {
  write-step 'nothing new to upload — mirror is current.'
  write-step ''
  return
}

# --- Stage NEW sigs (flat, hardlink with copy fallback), then upload-batch ---
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("hc-mirror-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
try {
  $linked = 0
  foreach ($sig in $toUpload) {
    $src = $bySig[$sig]
    $dst = Join-Path $staging $sig
    try {
      New-Item -ItemType HardLink -Path $dst -Target $src -ErrorAction Stop | Out-Null
    } catch {
      # Cross-volume or filesystem without hardlinks — copy the bytes instead.
      Copy-Item -LiteralPath $src -Destination $dst -Force
    }
    $linked++
  }

  write-step "staged $linked sigs; uploading (one parallel batch)..."
  invoke-az -Arguments (@(
    'storage', 'blob', 'upload-batch',
    '--destination', $Container,
    '--source', $staging,
    '--content-type', 'application/octet-stream',
    '--overwrite', 'true',
    '--only-show-errors'
  ) + $authArguments)
} finally {
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}

write-step ''
write-step " uploaded  : $($toUpload.Count)"
write-step " skipped   : $skipped (already mirrored)"
write-step ''
write-step 'done. verify one sig is reachable + non-html:'
write-step "  curl -I https://pluginthematrix.io/$Container/<sig>"
write-step ''
