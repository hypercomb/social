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

  $baseUri = New-Object System.Uri(($BasePath.TrimEnd('\') + '\'))
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

function is-content-addressed {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RelativePath
  )

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

$containerName = get-optional-env -Names @(
  'AZURE_STORAGE_CONTAINER',
  'AZURE_STORAGE_CONTAINER_NAME'
)

if ([string]::IsNullOrWhiteSpace($containerName)) {
  $containerName = 'dcp'
}

$authArguments = get-auth-arguments

# only upload content directories and manifest — skip .cache/
$contentItems = @('__layers__', '__bees__', '__dependencies__', 'manifest.json')
$files = @()
foreach ($item in $contentItems) {
  $itemPath = Join-Path $resolvedSource $item
  if (Test-Path -LiteralPath $itemPath -PathType Container) {
    $files += @(Get-ChildItem -LiteralPath $itemPath -Recurse -File | Sort-Object FullName)
  } elseif (Test-Path -LiteralPath $itemPath -PathType Leaf) {
    $files += @(Get-Item -LiteralPath $itemPath)
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

foreach ($file in $files) {
  $relativePath = get-relative-file-path -BasePath $resolvedSource -FullPath $file.FullName
  $blobName = if ($resolvedDestination) { "$resolvedDestination/$relativePath" } else { $relativePath }

  # content-addressed files: skip if blob already exists on remote
  if (is-content-addressed -RelativePath $relativePath) {
    $exists = test-blob-exists -ContainerName $containerName -BlobName $blobName -AuthArguments $authArguments
    if ($exists) {
      $skipped++
      continue
    }
  }

  $arguments = (@(
    'storage', 'blob', 'upload',
    '--container-name', $containerName,
    '--file', $file.FullName,
    '--name', $blobName,
    '--overwrite', 'true',
    '--only-show-errors'
  ) + $authArguments)

  invoke-az -Arguments $arguments
  $uploaded++
}

write-step ''
write-step " uploaded  : $uploaded"
write-step " skipped   : $skipped (already exist)"
write-step ''

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
