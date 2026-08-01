# correct-manifest-versions.ps1
#
# ONE-TIME correction for the deployed Azure manifest.json: back-fills the
# `generation` version counter onto every historical package entry and repairs
# the degenerate labels produced by the old "<previous>-updated-<stamp>"
# chaining (which concatenated without bound - see live-manifest.json).
#
# Ordering: follows the `previous` chain forward from genesis when the chain
# is intact and linear; any entry outside the chain falls back to `at`
# (ISO timestamp) ordering. Genesis = generation 1. Labels are cut at the
# first "-updated-" so each entry keeps its short human base name; the
# generation number is what distinguishes versions from here on.
#
# Auth/env contract matches deploy-azure.ps1 (AZURE_STORAGE_CONNECTION_STRING
# or AZURE_STORAGE_ACCOUNT[_NAME] + AZURE_STORAGE_KEY / login).
#
# Usage:
#   pwsh scripts/correct-manifest-versions.ps1 -DryRun   # show, don't upload
#   pwsh scripts/correct-manifest-versions.ps1           # correct + upload

param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function fail { param([string]$Message) Write-Error $Message; exit 1 }

function get-optional-env {
  param([string[]]$Names)
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
  }
  return $null
}

function invoke-az {
  param([string[]]$Arguments)
  if ($IsWindows -or ($PSVersionTable.PSEdition -eq 'Desktop')) {
    $cmdExe = if ([string]::IsNullOrWhiteSpace($env:ComSpec)) { 'cmd.exe' } else { $env:ComSpec }
    & $cmdExe '/d' '/s' '/c' 'az' @Arguments
  } else {
    & az @Arguments
  }
  if ($LASTEXITCODE -ne 0) { fail "azure cli command failed: az $($Arguments -join ' ')" }
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

$containerName = get-optional-env -Names @('AZURE_STORAGE_CONTAINER', 'AZURE_STORAGE_CONTAINER_NAME')
if ([string]::IsNullOrWhiteSpace($containerName)) { $containerName = 'dcp' }
$authArguments = get-auth-arguments

$tempDir = if (-not [string]::IsNullOrWhiteSpace($env:TEMP)) { $env:TEMP } `
          elseif (-not [string]::IsNullOrWhiteSpace($env:TMPDIR)) { $env:TMPDIR } `
          else { '/tmp' }
$tempManifestPath = Join-Path $tempDir 'hypercomb-correct-manifest.json'

Write-Host "downloading manifest.json from container '$containerName'"
invoke-az -Arguments (@(
  'storage', 'blob', 'download',
  '--container-name', $containerName,
  '--name', 'manifest.json',
  '--file', $tempManifestPath,
  '--overwrite', 'true',
  '--only-show-errors'
) + $authArguments)

$manifest = Get-Content -LiteralPath $tempManifestPath -Raw | ConvertFrom-Json
if ($null -eq $manifest.packages) { fail 'remote manifest has no packages' }

function set-prop($obj, $name, $value) {
  if ($obj.PSObject.Properties[$name]) { $obj.$name = $value }
  else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}

# -- Order the versions --------------------------------------------------
# Global deterministic ordering, oldest first: the pre-feature era (entries
# with NO `at`) numbers first, by sig for stability; everything since is
# ordered by its deploy timestamp (ties broken by sig). Chain-walking the
# `previous` links was tried first and proved unreliable — old deploys
# left multiple entries claiming the same predecessor, which dropped the
# losers out of the walk and stranded them AFTER the newest deploy. `at`
# is deploy-minted alongside `previous`, so it carries the same ordering
# without the branch pathology.
$entriesBySig = @{}
foreach ($p in $manifest.packages.PSObject.Properties) { $entriesBySig[$p.Name] = $p.Value }

function at-of($sig) {
  $e = $entriesBySig[$sig]
  $p = $e.PSObject.Properties['at']
  if ($p -and $p.Value) { return [string]$p.Value }
  return ''
}
$allSigs = @($entriesBySig.Keys)
$ordered  = @($allSigs | Where-Object { (at-of $_) -eq '' } | Sort-Object)
$ordered += @($allSigs | Where-Object { (at-of $_) -ne '' } |
  Sort-Object @{ Expression = { at-of $_ } }, @{ Expression = { $_ } })

# -- Assign generations + repair labels ----------------------------------
$generation = 0
foreach ($sig in $ordered) {
  $generation++
  $entry = $entriesBySig[$sig]
  $oldLabel = if ($entry.PSObject.Properties['label']) { [string]$entry.label } else { '' }
  $baseLabel = if ($oldLabel) { ($oldLabel -split '-updated-', 2)[0] } else { 'genesis' }
  set-prop $entry 'label'      $baseLabel
  set-prop $entry 'generation' $generation
  $at = if ($entry.PSObject.Properties['at']) { [string]$entry.at } else { '' }
  Write-Host ("v{0,-4} {1}  '{2}'  {3}" -f $generation, $sig.Substring(0, 12), $baseLabel, $at)
}

if ($DryRun) {
  Write-Host "dry run - manifest NOT uploaded ($generation packages)"
  exit 0
}

$correctedJson = $manifest | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($tempManifestPath, $correctedJson, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "uploading corrected manifest.json ($generation packages)"
invoke-az -Arguments (@(
  'storage', 'blob', 'upload',
  '--container-name', $containerName,
  '--name', 'manifest.json',
  '--file', $tempManifestPath,
  '--content-type', 'application/json',
  '--overwrite',
  '--no-progress',
  '--only-show-errors'
) + $authArguments)

Remove-Item -LiteralPath $tempManifestPath -Force -ErrorAction SilentlyContinue
Write-Host 'done'
