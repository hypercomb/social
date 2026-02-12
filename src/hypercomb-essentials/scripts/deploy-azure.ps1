# hypercomb-essentials/scripts/deploy-azure.ps1
# deploys:
#   dist/<signature>/** -> content/<signature>/**

param (
  [Parameter(Mandatory = $true)]
  [string]$Signature
)

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
$DistPath    = Join-Path $ProjectRoot "dist"

$PackageSource = Join-Path $DistPath $Signature
$PackageDest   = "content/$Signature"

$AccountName = "storagehypercomb"

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

if (-not (Test-Path (Join-Path $PackageSource "__drones__"))) {
  Write-Error "__drones__ missing in package: $PackageSource"
  exit 1
}

if (-not (Test-Path (Join-Path $PackageSource "__dependencies__"))) {
  Write-Error "__dependencies__ missing in package: $PackageSource"
  exit 1
}

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

Write-Host ""
Write-Host "deployment complete"
Write-Host "--------------------------------"
Write-Host " package : https://$AccountName.blob.core.windows.net/$PackageDest/"
Write-Host ""
