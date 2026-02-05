# scripts/deploy-azure.ps1
# deploys:
#   dist/<signature>/**   -> content/<signature>/**
#   dist/__resources__/** -> content/__resources__/**

param (
  [Parameter(Mandatory = $true)]
  [string]$Signature
)

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
$DistPath    = Join-Path $ProjectRoot "dist"

$PackageSource   = Join-Path $DistPath $Signature
$ResourcesSource = Join-Path $DistPath "__resources__"

$PackageDest   = "content/$Signature"
$ResourcesDest = "content/__resources__"

$AccountName = "storagehypercomb"

# -------------------------------------------------
# validation
# -------------------------------------------------

if (-not (Test-Path $DistPath)) {
  Write-Error "dist folder does not exist: $DistPath"
  exit 1
}

if (-not (Test-Path $PackageSource)) {
  Write-Error "package folder does not exist: $PackageSource"
  exit 1
}

if (-not (Test-Path (Join-Path $PackageSource "__layers__"))) {
  Write-Error "__layers__ missing in package: $PackageSource"
  exit 1
}

if (-not (Test-Path $ResourcesSource)) {
  Write-Error "__resources__ missing in dist root: $ResourcesSource"
  exit 1
}

# -------------------------------------------------
# deploy package (layers + metadata)
# -------------------------------------------------

Write-Host ""
Write-Host "deploying hypercomb package"
Write-Host "--------------------------------"
Write-Host " signature : $Signature"
Write-Host " source    : $PackageSource"
Write-Host " dest      : $PackageDest"
Write-Host ""

az storage blob upload-batch `
  --account-name $AccountName `
  --destination $PackageDest `
  --source $PackageSource `
  --auth-mode login `
  --overwrite `
  --no-progress

if ($LASTEXITCODE -ne 0) {
  Write-Error "package deployment failed"
  exit 1
}

# -------------------------------------------------
# deploy shared resources (flat, global)
# -------------------------------------------------

Write-Host ""
Write-Host "deploying shared resources"
Write-Host "--------------------------------"
Write-Host " source : $ResourcesSource"
Write-Host " dest   : $ResourcesDest"
Write-Host ""

az storage blob upload-batch `
  --account-name $AccountName `
  --destination $ResourcesDest `
  --source $ResourcesSource `
  --auth-mode login `
  --overwrite `
  --no-progress

if ($LASTEXITCODE -ne 0) {
  Write-Error "resources deployment failed"
  exit 1
}

# -------------------------------------------------
# done
# -------------------------------------------------

Write-Host ""
Write-Host "deployment complete"
Write-Host "--------------------------------"
Write-Host " package   : https://$AccountName.blob.core.windows.net/$PackageDest/"
Write-Host " resources : https://$AccountName.blob.core.windows.net/$ResourcesDest/"
Write-Host ""
