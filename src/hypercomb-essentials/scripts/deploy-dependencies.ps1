# scripts/deploy-dependencies.ps1
# uploads dist/__dependencies__ as a single batch
# (no signature param; each file name is already its signature)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
$DistPath = Join-Path $ProjectRoot "dist"

$AccountName = "storagehypercomb"

$DepsSource = Join-Path $DistPath "__dependencies__"
$DepsDest   = "content/__dependencies__"

if (-not (Test-Path $DepsSource)) {
  Write-Error "dependencies folder does not exist: $DepsSource"
  exit 1
}

Write-Host "deploying shared dependencies"
Write-Host "  source : $DepsSource"
Write-Host "  dest   : $DepsDest"

az storage blob upload-batch `
  --account-name $AccountName `
  --destination $DepsDest `
  --source $DepsSource `
  --auth-mode login `
  --overwrite

if ($LASTEXITCODE -ne 0) {
  Write-Error "dependency deployment failed"
  exit 1
}

Write-Host "dependencies deployed"
