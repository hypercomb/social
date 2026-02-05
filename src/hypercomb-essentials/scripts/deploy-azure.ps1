# scripts/deploy-azure.ps1
param (
  [Parameter(Mandatory = $true)]
  [string]$Signature
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
$DistPath = Join-Path $ProjectRoot "dist"

$AccountName = "storagehypercomb"

$Source = Join-Path $DistPath $Signature
$Destination = "content/$Signature"

if (-not (Test-Path $DistPath)) {
  Write-Error "dist folder does not exist: $DistPath"
  exit 1
}

if (-not (Test-Path $Source)) {
  Write-Error "source folder does not exist: $Source"
  exit 1
}

Write-Host "deploying hypercomb essentials"
Write-Host "  signature : $Signature"
Write-Host "  source    : $Source"
Write-Host "  dest      : $Destination"

az storage blob upload-batch `
  --account-name $AccountName `
  --destination $Destination `
  --source $Source `
  --auth-mode login `
  --overwrite

if ($LASTEXITCODE -ne 0) {
  Write-Error "deployment failed"
  exit 1
}

Write-Host "deployment complete"
