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
$LatestTxtPath = Join-Path $DistPath "latest.txt"
$LatestJsonPath = Join-Path $DistPath "latest.json"

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

if (-not (Test-Path (Join-Path $PackageSource "__bees__"))) {
  Write-Error "__bees__ missing in package: $PackageSource"
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

Set-Content -Path $LatestTxtPath -Value $Signature -NoNewline -Encoding utf8
$LatestJsonContent = '{{"signature":"{0}"}}' -f $Signature
Set-Content -Path $LatestJsonPath -Value $LatestJsonContent -NoNewline -Encoding utf8

az storage blob upload `
  --account-name $AccountName `
  --container-name content `
  --name latest.txt `
  --file $LatestTxtPath `
  --auth-mode login `
  --overwrite `
  --no-progress

if ($LASTEXITCODE -ne 0) {
  Write-Error "latest.txt deployment failed"
  exit 1
}

az storage blob upload `
  --account-name $AccountName `
  --container-name content `
  --name latest.json `
  --file $LatestJsonPath `
  --auth-mode login `
  --overwrite `
  --no-progress

if ($LASTEXITCODE -ne 0) {
  Write-Error "latest.json deployment failed"
  exit 1
}

Write-Host ""
Write-Host "deployment complete"
Write-Host "--------------------------------"
Write-Host " package : https://$AccountName.blob.core.windows.net/$PackageDest/"
Write-Host " latest  : https://$AccountName.blob.core.windows.net/content/latest.txt"
Write-Host ""
