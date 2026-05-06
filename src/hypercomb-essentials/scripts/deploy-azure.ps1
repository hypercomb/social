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
