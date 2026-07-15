param()

$ErrorActionPreference = 'Stop'

function fail {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  Write-Error $Message
  exit 1
}

function write-step {
  param(
    [AllowEmptyString()]
    [string]$Message = ''
  )

  Write-Host $Message
}

function test-command {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function normalize-local-path {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  return [System.IO.Path]::GetFullPath($Path)
}

function normalize-blob-path {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $value = $Path.Trim()
  $value = $value -replace '\\', '/'
  $value = $value.Trim('/')

  return $value
}

function get-optional-env {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Names
  )

  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name)

    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value
    }
  }

  return $null
}

function invoke-az {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  # Windows: az is `az.cmd`, must go through cmd.exe to resolve.
  # Linux/macOS: az is a script directly callable, no shell wrapper needed.
  if ($IsWindows -or ($PSVersionTable.PSEdition -eq 'Desktop')) {
    $cmdExe = if ([string]::IsNullOrWhiteSpace($env:ComSpec)) { 'cmd.exe' } else { $env:ComSpec }
    & $cmdExe '/d' '/s' '/c' 'az' @Arguments
  } else {
    & az @Arguments
  }

  if ($LASTEXITCODE -ne 0) {
    fail "azure cli command failed: az $($Arguments -join ' ')"
  }
}

function invoke-az-silent {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  # Suppress stderr; ErrorActionPreference=Stop would otherwise turn native-command
  # stderr lines into terminating exceptions on Windows PowerShell 5.1.
  $previousEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($IsWindows -or ($PSVersionTable.PSEdition -eq 'Desktop')) {
      $cmdExe = if ([string]::IsNullOrWhiteSpace($env:ComSpec)) { 'cmd.exe' } else { $env:ComSpec }
      $output = & $cmdExe '/d' '/s' '/c' 'az' @Arguments 2>$null
    } else {
      $output = & az @Arguments 2>$null
    }
  } finally {
    $ErrorActionPreference = $previousEap
  }
  return @{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
}

function get-relative-file-path {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BasePath,

    [Parameter(Mandatory = $true)]
    [string]$FullPath
  )

  # The trailing separator must match the platform: on Linux a '\' is NOT a
  # path separator, so a base of "<dist>\" makes System.Uri treat "dist\" as a
  # file and MakeRelativeUri keeps "dist/" in every relative path — which
  # silently uploaded the whole payload under a dcp/dist/ prefix no consumer
  # ever reads (all flat-layout CI publishes were dark until 2026-07-15).
  $separator = [System.IO.Path]::DirectorySeparatorChar
  $baseUri = New-Object System.Uri(($BasePath.TrimEnd('\', '/') + $separator))
  $fileUri = New-Object System.Uri($FullPath)
  $relativeUri = $baseUri.MakeRelativeUri($fileUri).ToString()

  return [System.Uri]::UnescapeDataString($relativeUri) -replace '\\', '/'
}

function get-auth-arguments {
  $connectionString = get-optional-env -Names @(
    'AZURE_STORAGE_CONNECTION_STRING'
  )

  if (-not [string]::IsNullOrWhiteSpace($connectionString)) {
    return @('--connection-string', $connectionString)
  }

  $storageAccount = get-optional-env -Names @(
    'AZURE_STORAGE_ACCOUNT',
    'AZURE_STORAGE_ACCOUNT_NAME'
  )

  if ([string]::IsNullOrWhiteSpace($storageAccount)) {
    $storageAccount = 'storagehypercomb'
  }

  $accountKey = get-optional-env -Names @(
    'AZURE_STORAGE_KEY',
    'AZURE_STORAGE_ACCOUNT_KEY'
  )

  if (-not [string]::IsNullOrWhiteSpace($accountKey)) {
    return @('--account-name', $storageAccount, '--account-key', $accountKey)
  }

  return @('--account-name', $storageAccount, '--auth-mode', 'login')
}

function test-blob-exists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ContainerName,

    [Parameter(Mandatory = $true)]
    [string]$BlobName,

    [Parameter(Mandatory = $true)]
    [string[]]$AuthArguments
  )

  $result = invoke-az-silent -Arguments (@(
    'storage', 'blob', 'exists',
    '--container-name', $ContainerName,
    '--name', $BlobName,
    '--only-show-errors',
    '--output', 'tsv'
  ) + $AuthArguments)

  if ($result.ExitCode -ne 0) { return $false }
  return $result.Output.Trim().ToLower() -eq 'true'
}

# HTTP-level blob availability check — verifies the public storage
# endpoint can actually serve the bytes, not just that metadata exists.
#
# Why this exists: `az storage blob exists` (metadata-level check) can
# return TRUE for blobs whose entry was written but byte data hasn't
# replicated to the read endpoint. We observed this in the wild: Phase
# 2.6 reported "verified: 210" while 14 of those bees returned 404 on
# public HTTP GET. The metadata-level check is too optimistic; an
# end-to-end HTTP HEAD against the public URL is what readers actually
# experience.
function test-blob-http-reachable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$StorageAccount,

    [Parameter(Mandatory = $true)]
    [string]$ContainerName,

    [Parameter(Mandatory = $true)]
    [string]$BlobName
  )

  $url = "https://$StorageAccount.blob.core.windows.net/$ContainerName/$BlobName"
  try {
    $resp = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -ErrorAction Stop -TimeoutSec 15
    return $resp.StatusCode -eq 200
  } catch {
    # 404, network error, anything that isn't 200 — treat as unreachable
    return $false
  }
}

function is-content-addressed {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RelativePath
  )

  # Flat layout: bare 64-hex blob at the container root, or a path inside a
  # 64-hex-named sigbag dir. The typed `__x__/` prefixes are LEGACY (kept so
  # a stale mixed dist still deploys incrementally during the transition —
  # new builds never emit them).
  if ($RelativePath -match '^[0-9a-f]{64}(/|$)') { return $true }
  return $RelativePath -match '^(__layers__|__bees__|__dependencies__)/'
}

if (-not (test-command -Name 'az')) {
  fail 'azure cli (az) is not installed or is not on PATH'
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$resolvedSource = normalize-local-path -Path (Join-Path $scriptDir '..\dist')
$resolvedDestination = ''

if (-not (Test-Path -LiteralPath $resolvedSource)) {
  fail "source path does not exist: $resolvedSource"
}

if (-not (Test-Path -LiteralPath $resolvedSource -PathType Container)) {
  fail "source path must be a directory: $resolvedSource"
}

# Resolved at script level so Phase 2.6's HTTP HEAD verifier can build
# the public URL ('https://<account>.blob.core.windows.net/<container>/<blob>').
# Same fallback chain as the auth-args resolver — if env doesn't set it,
# default to 'storagehypercomb'.
$resolvedStorageAccount = get-optional-env -Names @(
  'AZURE_STORAGE_ACCOUNT',
  'AZURE_STORAGE_ACCOUNT_NAME'
)
if ([string]::IsNullOrWhiteSpace($resolvedStorageAccount)) {
  $resolvedStorageAccount = 'storagehypercomb'
}

$containerName = get-optional-env -Names @(
  'AZURE_STORAGE_CONTAINER',
  'AZURE_STORAGE_CONTAINER_NAME'
)

if ([string]::IsNullOrWhiteSpace($containerName)) {
  $containerName = 'dcp'
}

$authArguments = get-auth-arguments

# Flat delivery layout: content entries are 64-hex sig names at the dist root
# (file = layer/bee/dependency bytes, dir = sigbag) plus manifest.json — see
# build-module.ts. Never .cache/. The legacy typed dirs are still swept up
# when a stale dist carries them (transition safety); new builds don't emit
# them. Blobs already on Azure under the typed `__x__/` names are NEVER
# deleted or renamed — old deployed clients keep resolving them forever.
$sigNamePattern = '^[0-9a-f]{64}$'
$legacyContentDirs = @('__layers__', '__bees__', '__dependencies__')
$files = @()
foreach ($entry in (Get-ChildItem -LiteralPath $resolvedSource | Sort-Object Name)) {
  if ($entry.PSIsContainer) {
    if ($entry.Name -match $sigNamePattern -or $legacyContentDirs -contains $entry.Name) {
      $files += @(Get-ChildItem -LiteralPath $entry.FullName -Recurse -File | Sort-Object FullName)
    }
  } elseif ($entry.Name -match $sigNamePattern -or $entry.Name -eq 'manifest.json') {
    $files += @(Get-Item -LiteralPath $entry.FullName)
  }
}

if ($files.Count -eq 0) {
  fail "no files found in source directory: $resolvedSource"
}

write-step ''
write-step 'deploying hypercomb content (incremental)'
write-step '--------------------------------'
write-step " source    : $resolvedSource"
write-step " dest      : $resolvedDestination"
write-step " files     : $($files.Count)"
write-step ''

# --- Phase 1: Merge manifest with remote before uploading ---

$localManifestPath = Join-Path $resolvedSource 'manifest.json'
if (Test-Path -LiteralPath $localManifestPath -PathType Leaf) {
  $manifestBlobName = if ($resolvedDestination) { "$resolvedDestination/manifest.json" } else { 'manifest.json' }
  # Cross-platform temp dir: Windows uses $env:TEMP, Linux/macOS use
  # $env:TMPDIR (or /tmp as fallback). Without this, CI runs on Ubuntu
  # crash with "Cannot bind argument to parameter 'Path' because it is null".
  $tempDir = if (-not [string]::IsNullOrWhiteSpace($env:TEMP)) { $env:TEMP } `
            elseif (-not [string]::IsNullOrWhiteSpace($env:TMPDIR)) { $env:TMPDIR } `
            else { '/tmp' }
  $tempManifestPath = Join-Path $tempDir 'hypercomb-remote-manifest.json'

  # download existing remote manifest (if any)
  $downloadResult = invoke-az-silent -Arguments (@(
    'storage', 'blob', 'download',
    '--container-name', $containerName,
    '--name', $manifestBlobName,
    '--file', $tempManifestPath,
    '--overwrite', 'true',
    '--only-show-errors'
  ) + $authArguments)

  if ($downloadResult.ExitCode -eq 0 -and (Test-Path -LiteralPath $tempManifestPath -PathType Leaf)) {
    write-step 'merging with existing remote manifest'

    # merge: remote packages + local packages (local wins on collision)
    $remoteManifest = Get-Content -LiteralPath $tempManifestPath -Raw | ConvertFrom-Json
    $localManifest = Get-Content -LiteralPath $localManifestPath -Raw | ConvertFrom-Json

    if ($null -ne $remoteManifest.packages -and $null -ne $localManifest.packages) {
      # set-or-add a NoteProperty on a PSCustomObject (entries from
      # ConvertFrom-Json are PSCustomObjects; build-module already writes
      # `label`/`previous`, so those get set; `at` gets added).
      function set-prop($obj, $name, $value) {
        if ($obj.PSObject.Properties[$name]) { $obj.$name = $value }
        else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
      }

      # ── Branch-name chaining ──────────────────────────────────────────
      # build-module writes a single local package with a STABLE genesis
      # `label` (the git branch) and `previous: null`. Here, where the remote
      # manifest is in hand, we name this deploy "<previous>-updated-<stamp>"
      # against the most recent remote package, and record `at` (deploy time)
      # + `previous` (the version this supersedes) so the installer can walk
      # the chain back by name. These are sidecar fields — they never affect
      # the package's rootLayerSig.
      $newProp  = $localManifest.packages.PSObject.Properties | Select-Object -First 1
      if ($newProp) {
      $newSig   = $newProp.Name
      $newEntry = $newProp.Value
      $remoteForNew = $remoteManifest.packages.PSObject.Properties[$newSig]
      if ($remoteForNew) {
        # identical content re-deploy: keep the label/at/previous it already
        # had remotely — do not re-chain a package that hasn't changed.
        $r = $remoteForNew.Value
        if ($r.PSObject.Properties['label'])    { set-prop $newEntry 'label'    $r.label }
        if ($r.PSObject.Properties['at'])       { set-prop $newEntry 'at'       $r.at }
        if ($r.PSObject.Properties['previous']) { set-prop $newEntry 'previous' $r.previous }
        write-step " manifest label: $($newEntry.label) (unchanged re-deploy)"
      } else {
        # most recent prior package = highest `at` (ISO sorts chronologically);
        # falls back to first enumerated when none carry `at` (pre-feature).
        $prevProp = $remoteManifest.packages.PSObject.Properties |
          Sort-Object @{ Expression = { if ($_.Value.PSObject.Properties['at']) { [string]$_.Value.at } else { '' } } } -Descending |
          Select-Object -First 1
        $previousSig   = if ($prevProp) { $prevProp.Name } else { $null }
        $previousLabel = if ($prevProp -and $prevProp.Value.PSObject.Properties['label']) { [string]$prevProp.Value.label } else { $null }
        $stamp = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
        $genesis = if ($newEntry.PSObject.Properties['label'] -and $newEntry.label) { [string]$newEntry.label } else { 'genesis' }
        $newLabel = if ($previousLabel) { "$previousLabel-updated-$stamp" } else { $genesis }
        set-prop $newEntry 'label'    $newLabel
        set-prop $newEntry 'at'       $stamp
        set-prop $newEntry 'previous' $previousSig
        write-step " manifest label: $newLabel"
      }
      }

      # add remote packages that are not in the local manifest
      foreach ($property in $remoteManifest.packages.PSObject.Properties) {
        if (-not $localManifest.packages.PSObject.Properties[$property.Name]) {
          $localManifest.packages | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value
        }
      }

      # write merged manifest back to local dist (UTF-8 without BOM, cross-version)
      $mergedJson = $localManifest | ConvertTo-Json -Depth 10
      [System.IO.File]::WriteAllText($localManifestPath, $mergedJson, (New-Object System.Text.UTF8Encoding($false)))
      $packageCount = @($localManifest.packages.PSObject.Properties).Count
      write-step " manifest packages: $packageCount"
    }

    Remove-Item -LiteralPath $tempManifestPath -Force -ErrorAction SilentlyContinue
  } else {
    write-step 'no existing remote manifest — uploading fresh'
  }
}

# --- Phase 2: Upload files (skip existing content-addressed blobs) ---

$uploaded = 0
$skipped = 0
# Track files we attempted to upload so we can verify they actually landed.
# Observed: `az storage blob upload` can return 0 (success) without actually
# writing the blob, especially for newly-created content-addressed paths.
# We saw this for the new nostr-mesh bee — a manual `az storage blob upload`
# later succeeded with no other changes. Match the pattern that fixed the
# same bug for manifest.json (explicit content-type + no-progress flags),
# AND verify each upload after the fact, retrying any that silently dropped.
$uploadAttempts = @()

# Flat blobs carry no extension, so MIME comes from what the manifest says
# each sig IS: bees/dependencies are ES modules, layers are JSON. Consumers
# fetch bytes (never import()-by-URL), but keeping honest content-types
# avoids the octet-stream class of bugs for anything that does care.
$sigContentTypes = @{}
try {
  $kindManifest = Get-Content -LiteralPath (Join-Path $resolvedSource 'manifest.json') -Raw | ConvertFrom-Json
  if ($null -ne $kindManifest.packages) {
    foreach ($pkgProp in $kindManifest.packages.PSObject.Properties) {
      foreach ($s in @($pkgProp.Value.layers))       { if ($s) { $sigContentTypes[[string]$s] = 'application/json' } }
      foreach ($s in @($pkgProp.Value.bees))         { if ($s) { $sigContentTypes[[string]$s] = 'application/javascript' } }
      foreach ($s in @($pkgProp.Value.dependencies)) { if ($s) { $sigContentTypes[[string]$s] = 'application/javascript' } }
    }
  }
} catch {
  write-step 'warning: could not index sig kinds from manifest.json — bare-sig blobs upload as octet-stream'
}

function get-content-type {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ($Path -match '\.js$')   { return 'application/javascript' }
  if ($Path -match '\.json$') { return 'application/json' }
  if ($Path -match '\.css$')  { return 'text/css' }
  if ($Path -match '\.html$') { return 'text/html' }
  if ($Path -match '\.svg$')  { return 'image/svg+xml' }
  if ($Path -match '^[0-9a-f]{64}$' -and $script:sigContentTypes.ContainsKey($Path)) {
    return $script:sigContentTypes[$Path]  # flat sig blob — kind from manifest
  }
  return 'application/octet-stream'  # bag entries (no extension)
}

foreach ($file in $files) {
  $relativePath = get-relative-file-path -BasePath $resolvedSource -FullPath $file.FullName
  $blobName = if ($resolvedDestination) { "$resolvedDestination/$relativePath" } else { $relativePath }

  # Every enumerated file must resolve to a name consumers can actually
  # fetch: a flat sig, a sigbag entry, a legacy typed path, or manifest.json.
  # Anything else means relative-path resolution broke (e.g. the dist/ prefix
  # bug) — fail loudly instead of publishing 300 unreachable blobs green.
  if (-not (is-content-addressed -RelativePath $relativePath) -and $relativePath -ne 'manifest.json') {
    fail "unexpected blob name '$relativePath' for '$($file.FullName)' — relative path resolution is broken; refusing to upload unreachable content"
  }

  # content-addressed files: skip if blob already exists on remote.
  # We require BOTH the metadata check AND the public HTTP HEAD to pass
  # before skipping. The metadata-only check was returning TRUE for blobs
  # whose entry was written but bytes never replicated — those files were
  # then skipped here (not added to $uploadAttempts) so Phase 2.6 never
  # caught the silent drop. The HTTP HEAD is what readers actually
  # experience, so it's the source of truth for "this is already served."
  if (is-content-addressed -RelativePath $relativePath) {
    $existsMeta = test-blob-exists -ContainerName $containerName -BlobName $blobName -AuthArguments $authArguments
    $existsHttp = if ($existsMeta) { test-blob-http-reachable -StorageAccount $resolvedStorageAccount -ContainerName $containerName -BlobName $blobName } else { $false }
    if ($existsMeta -and $existsHttp) {
      $skipped++
      continue
    }
  }

  $contentType = get-content-type -Path $relativePath

  $arguments = (@(
    'storage', 'blob', 'upload',
    '--container-name', $containerName,
    '--file', $file.FullName,
    '--name', $blobName,
    '--overwrite', 'true',
    '--content-type', $contentType,
    '--no-progress',
    '--only-show-errors'
  ) + $authArguments)

  invoke-az -Arguments $arguments
  $uploaded++
  $uploadAttempts += @{ Name = $blobName; Path = $file.FullName; ContentType = $contentType }
}

write-step ''
write-step " uploaded  : $uploaded"
write-step " skipped   : $skipped (already exist)"
write-step ''

# --- Phase 2.6: Retry pass for silently-dropped uploads ---
#
# The az CLI's `storage blob upload` will sometimes return 0 without
# actually writing the blob for newly-created content-addressed paths.
# We can't reliably reproduce when this happens — it's not auth-related,
# not file-size-related, and not content-related. The safest fix is to
# verify every file we tried to upload actually exists at the target,
# and explicitly re-upload any that don't.

if ($uploadAttempts.Count -gt 0) {
  write-step '--- Phase 2.6: verifying uploads landed (retry silent drops) ---'

  # Verification is two-layered: the az CLI metadata check is fast but
  # too optimistic (returns true for blobs whose metadata was written
  # but byte data didn't replicate). The HTTP HEAD against the public
  # endpoint is what readers actually experience, and is the source of
  # truth for "is this blob serving."
  #
  # We observed in production that metadata-only verification declared
  # "verified: 210" while 14 content-addressed bees in the same deploy
  # returned 404 on public GET. So we now require BOTH checks to pass.
  $retryCount = 0
  $verified = 0
  $stillMissing = @()
  foreach ($attempt in $uploadAttempts) {
    $existsMeta = test-blob-exists -ContainerName $containerName -BlobName $attempt.Name -AuthArguments $authArguments
    $existsHttp = test-blob-http-reachable -StorageAccount $resolvedStorageAccount -ContainerName $containerName -BlobName $attempt.Name
    if (-not $existsMeta -or -not $existsHttp) {
      $retryCount++
      $reason = if (-not $existsMeta) { 'metadata check failed' } elseif (-not $existsHttp) { 'HTTP HEAD 404 (metadata claimed present)' } else { 'unknown' }
      write-step "  retry: $($attempt.Name) — $reason"
      invoke-az -Arguments (@(
        'storage', 'blob', 'upload',
        '--container-name', $containerName,
        '--file', $attempt.Path,
        '--name', $attempt.Name,
        '--overwrite', 'true',
        '--content-type', $attempt.ContentType,
        '--no-progress',
        '--only-show-errors'
      ) + $authArguments)

      # Verify the retry actually landed via BOTH checks.
      $existsMetaAfter = test-blob-exists -ContainerName $containerName -BlobName $attempt.Name -AuthArguments $authArguments
      $existsHttpAfter = test-blob-http-reachable -StorageAccount $resolvedStorageAccount -ContainerName $containerName -BlobName $attempt.Name
      if (-not $existsMetaAfter -or -not $existsHttpAfter) {
        $stillMissing += $attempt.Name
      }
    } else {
      $verified++
    }
  }

  if ($stillMissing.Count -gt 0) {
    $missingList = ($stillMissing | ForEach-Object { "    - $_" }) -join "`n"
    fail @"
verification failed after retry: the following blobs are still missing
after a second upload attempt. The az CLI claimed upload success but
public HTTP GET continues to 404. Failing the deploy so callers don't
mistake an incomplete upload for a successful one.

$missingList
"@
  }

  write-step " verified  : $verified"
  write-step " retried   : $retryCount (silently-dropped on first attempt)"
  write-step ''
}

# --- Phase 3: Post-upload verification ---
#
# Trust nothing. Earlier the pipeline reported "uploaded: 210, skipped: 0"
# for several days in a row while the live manifest never actually changed
# (blob etag stayed pinned to a stale value, possibly an `az storage blob
# upload` silently no-op'ing under some auth / storage-account-policy /
# CDN-passthrough condition we don't yet understand). The fix to that is
# not to debug the symptom — it's to refuse to claim success unless we can
# read back what we just wrote and confirm it's our content.
#
# Download the live manifest.json, parse it, and compare its rootHash to
# the local manifest we just attempted to upload. If they don't match, the
# deploy did not actually publish — fail loudly with diagnostic info.

# --- Phase 2.5: Force manifest.json re-upload as the last write ---
#
# The Phase 2 foreach claims to upload manifest.json (it's the last item
# in $files), and the az CLI returns 0 + a fresh etag. But the verify
# step then downloads the blob and finds the OLD content unchanged. The
# upload appears to be either silently no-op'd or shadowed by some other
# write. Re-uploading explicitly here, AFTER all content-addressed
# blobs have landed, gives us a final chance to flip the pointer — and
# we log the az response in full so the diagnostic shows the etag the
# upload claims to have written.

if (Test-Path -LiteralPath $localManifestPath -PathType Leaf) {
  write-step '--- Phase 2.5: explicit final manifest re-upload ---'

  $manifestBlobNameFinal = if ($resolvedDestination) { "$resolvedDestination/manifest.json" } else { 'manifest.json' }
  $finalSize = (Get-Item -LiteralPath $localManifestPath).Length
  write-step " local manifest size : $finalSize bytes"
  write-step " blob target         : $containerName/$manifestBlobNameFinal"

  $finalArgs = (@(
    'storage', 'blob', 'upload',
    '--container-name', $containerName,
    '--file', $localManifestPath,
    '--name', $manifestBlobNameFinal,
    '--overwrite', 'true',
    '--content-type', 'application/json',
    '--no-progress'
  ) + $authArguments)

  invoke-az -Arguments $finalArgs

  write-step ''
}

if (Test-Path -LiteralPath $localManifestPath -PathType Leaf) {
  write-step '--- Phase 3: verifying live manifest matches local ---'

  # Compare the manifest as bytes, not by relying on a specific JSON field.
  # The previous version compared `.rootHash`, which doesn't exist on the
  # uploaded manifest — both sides came back empty and "matched," silently
  # confirming a broken deploy. SHA-256 of the raw file bytes is the
  # honest test: same bytes → same content → upload propagated.

  $localBytes = [System.IO.File]::ReadAllBytes($localManifestPath)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $localHash = ($sha.ComputeHash($localBytes) | ForEach-Object { $_.ToString('x2') }) -join ''

  $localManifest = Get-Content -LiteralPath $localManifestPath -Raw | ConvertFrom-Json
  $localPackageCount = if ($null -ne $localManifest.packages) {
    @($localManifest.packages.PSObject.Properties).Count
  } else { 0 }
  $localPackageKeys = if ($null -ne $localManifest.packages) {
    @($localManifest.packages.PSObject.Properties.Name | Sort-Object)
  } else { @() }

  write-step " local content-hash  : $localHash"
  write-step " local package count : $localPackageCount"

  $manifestBlobNameVerify = if ($resolvedDestination) { "$resolvedDestination/manifest.json" } else { 'manifest.json' }
  $tempDirVerify = if (-not [string]::IsNullOrWhiteSpace($env:TEMP)) { $env:TEMP } `
                  elseif (-not [string]::IsNullOrWhiteSpace($env:TMPDIR)) { $env:TMPDIR } `
                  else { '/tmp' }
  $tempVerifyPath = Join-Path $tempDirVerify 'hypercomb-verify-manifest.json'
  Remove-Item -LiteralPath $tempVerifyPath -Force -ErrorAction SilentlyContinue

  $verifyResult = invoke-az-silent -Arguments (@(
    'storage', 'blob', 'download',
    '--container-name', $containerName,
    '--name', $manifestBlobNameVerify,
    '--file', $tempVerifyPath,
    '--overwrite', 'true',
    '--only-show-errors'
  ) + $authArguments)

  if ($verifyResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $tempVerifyPath -PathType Leaf)) {
    fail "verification failed: could not download manifest.json after upload (container=$containerName blob=$manifestBlobNameVerify exit=$($verifyResult.ExitCode))"
  }

  $remoteBytes = [System.IO.File]::ReadAllBytes($tempVerifyPath)
  $remoteHash = ($sha.ComputeHash($remoteBytes) | ForEach-Object { $_.ToString('x2') }) -join ''

  $remoteManifest = Get-Content -LiteralPath $tempVerifyPath -Raw | ConvertFrom-Json
  $remotePackageCount = if ($null -ne $remoteManifest.packages) {
    @($remoteManifest.packages.PSObject.Properties).Count
  } else { 0 }
  $remotePackageKeys = if ($null -ne $remoteManifest.packages) {
    @($remoteManifest.packages.PSObject.Properties.Name | Sort-Object)
  } else { @() }

  write-step " remote content-hash : $remoteHash"
  write-step " remote package count: $remotePackageCount"

  Remove-Item -LiteralPath $tempVerifyPath -Force -ErrorAction SilentlyContinue

  if ($localHash -ne $remoteHash) {
    $localOnly = @($localPackageKeys | Where-Object { $remotePackageKeys -notcontains $_ })
    $remoteOnly = @($remotePackageKeys | Where-Object { $localPackageKeys -notcontains $_ })

    $diffLines = @()
    if ($localOnly.Count -gt 0) {
      $diffLines += "  packages in LOCAL but missing from REMOTE ($($localOnly.Count)):"
      foreach ($k in $localOnly) { $diffLines += "    + $k" }
    }
    if ($remoteOnly.Count -gt 0) {
      $diffLines += "  packages in REMOTE but missing from LOCAL ($($remoteOnly.Count)):"
      foreach ($k in $remoteOnly) { $diffLines += "    - $k" }
    }
    $diff = $diffLines -join "`n"

    fail @"
verification failed: live manifest does not match local after upload.

  local content-hash  : $localHash    ($localPackageCount packages)
  remote content-hash : $remoteHash    ($remotePackageCount packages)

$diff

The az CLI reported $uploaded uploads completed, but the manifest at
$containerName/$manifestBlobNameVerify did not actually update. This is
the silent-success bug we are trying to surface. Likely causes to
investigate, in order of probability:

  1. The az upload to manifest.json is being silently no-op'd (auth
     scope, container-level RBAC permissions, or storage account
     soft-delete/immutability policy).
  2. The merge phase wrote to a different local path than the upload
     reads from (encoding, BOM, or path-resolution mismatch).
  3. A different process is racing the deploy and restoring the old
     manifest after this script completes.

Failing the deploy so it cannot be mistaken for a success.
"@
  }

  write-step " ✓ verified — live manifest bytes match local (sha256 $($localHash.Substring(0,16))...)"
  write-step ''
}
