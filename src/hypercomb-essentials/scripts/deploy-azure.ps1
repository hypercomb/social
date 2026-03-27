param(
  [Parameter(Mandatory = $true)]
  [string]$Signature
)

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

  & az @Arguments

  if ($LASTEXITCODE -ne 0) {
    fail "azure cli command failed: az $($Arguments -join ' ')"
  }
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

  $accountKey = get-optional-env -Names @(
    'AZURE_STORAGE_KEY',
    'AZURE_STORAGE_ACCOUNT_KEY'
  )

  if (-not [string]::IsNullOrWhiteSpace($storageAccount) -and -not [string]::IsNullOrWhiteSpace($accountKey)) {
    return @('--account-name', $storageAccount, '--account-key', $accountKey)
  }

  if (-not [string]::IsNullOrWhiteSpace($storageAccount)) {
    return @('--account-name', $storageAccount, '--auth-mode', 'login')
  }

  return @()
}

if (-not (test-command -Name 'az')) {
  fail 'azure cli (az) is not installed or is not on PATH'
}

if ($Signature -notmatch '^[a-fA-F0-9]{64}$') {
  fail "invalid signature: $Signature"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$distRoot = normalize-local-path -Path (Join-Path $scriptDir '..\dist')
$resolvedSource = normalize-local-path -Path (Join-Path $distRoot $Signature)
$resolvedDestination = normalize-blob-path -Path ("content/$Signature")

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
  $containerName = '$web'
}

$authArguments = get-auth-arguments
$files = @(Get-ChildItem -LiteralPath $resolvedSource -Recurse -File | Sort-Object FullName)

if ($files.Count -eq 0) {
  fail "no files found in source directory: $resolvedSource"
}

write-step ''
write-step 'deploying hypercomb package'
write-step '--------------------------------'
write-step " signature : $Signature"
write-step " source    : $resolvedSource"
write-step " dest      : $resolvedDestination"
write-step " files     : $($files.Count)"
write-step ''

foreach ($file in $files) {
  $relativePath = get-relative-file-path -BasePath $resolvedSource -FullPath $file.FullName
  $blobName = "$resolvedDestination/$relativePath"

  $arguments = @(
    'storage', 'blob', 'upload',
    '--container-name', $containerName,
    '--file', $file.FullName,
    '--name', $blobName,
    '--overwrite', 'true',
    '--only-show-errors'
  ) + $authArguments

  invoke-az -Arguments $arguments
}