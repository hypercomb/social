param(
  [string]$StorageAccount = 'storagehypercomb',
  [string]$WebContainer = '$web',
  [switch]$SkipEssentialsDeploy,
  [switch]$SkipWebDeploy
)

$ErrorActionPreference = 'Stop'

function Assert-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $name"
  }
}

function Invoke-Step([string]$title, [scriptblock]$action) {
  Write-Host ""
  Write-Host "==> $title" -ForegroundColor Cyan
  & $action
  Write-Host "✓ $title" -ForegroundColor Green
}

function Invoke-Npm([string]$prefix, [string]$script) {
  Push-Location $prefix
  try {
    npm run $script
  }
  finally {
    Pop-Location
  }
}

function Get-WebDistPath([string]$root) {
  return Join-Path $root 'hypercomb-web/dist/hypercomb-web/browser'
}

$root = Split-Path -Parent $PSCommandPath
$essentials = Join-Path $root 'hypercomb-essentials'
$web = Join-Path $root 'hypercomb-web'
$webDist = Get-WebDistPath $root

Assert-Command 'npm'
Assert-Command 'az'

Invoke-Step 'Validate Azure session' {
  az account show --output none
}

if (-not $SkipEssentialsDeploy) {
  Invoke-Step 'Build and deploy hypercomb-essentials (publishes latest pointers)' {
    Invoke-Npm $essentials 'build'
  }

  Invoke-Step 'Verify latest pointers are readable' {
    $latestJson = Invoke-WebRequest -UseBasicParsing -Uri "https://$StorageAccount.blob.core.windows.net/content/latest.json"

    $data = $latestJson.Content | ConvertFrom-Json
    $sig = ($data.seed -replace "`uFEFF", '').Trim()
    if ($sig -notmatch '^[a-f0-9]{64}$') {
      throw "latest.json does not contain a valid seed signature: '$sig'"
    }

    Write-Host "latest signature: $sig"
  }
}

Invoke-Step 'Build hypercomb-web runtime assets' {
  Invoke-Npm $web 'runtime'
}

Invoke-Step 'Build hypercomb-web app' {
  Invoke-Npm $web 'build'
}

if (-not (Test-Path $webDist)) {
  throw "Web dist output not found: $webDist"
}

if (-not $SkipWebDeploy) {
  Invoke-Step 'Upload web app to Azure static hosting container' {
    az storage blob upload-batch `
      --account-name $StorageAccount `
      --destination $WebContainer `
      --source $webDist `
      --auth-mode login `
      --overwrite `
      --no-progress | Out-Null
  }

  Invoke-Step 'Set no-cache on index.html' {
    $indexPath = Join-Path $webDist 'index.html'
    az storage blob upload `
      --account-name $StorageAccount `
      --container-name $WebContainer `
      --name index.html `
      --file $indexPath `
      --content-cache-control 'no-cache, no-store, must-revalidate' `
      --auth-mode login `
      --overwrite `
      --no-progress | Out-Null
  }

  Invoke-Step 'Set no-store on service worker and import map runtime shim' {
    $swPath = Join-Path $webDist 'hypercomb.worker.js'
    $runtimePath = Join-Path $webDist 'hypercomb-core.runtime.js'

    az storage blob upload `
      --account-name $StorageAccount `
      --container-name $WebContainer `
      --name hypercomb.worker.js `
      --file $swPath `
      --content-cache-control 'no-cache, no-store, must-revalidate' `
      --auth-mode login `
      --overwrite `
      --no-progress | Out-Null

    az storage blob upload `
      --account-name $StorageAccount `
      --container-name $WebContainer `
      --name hypercomb-core.runtime.js `
      --file $runtimePath `
      --content-cache-control 'no-cache, no-store, must-revalidate' `
      --auth-mode login `
      --overwrite `
      --no-progress | Out-Null
  }
}

Write-Host ""
Write-Host 'Release flow complete.' -ForegroundColor Green
Write-Host "Web dist: $webDist"
if (-not $SkipWebDeploy) {
  Write-Host "Live URL (if static website enabled): https://$StorageAccount.z13.web.core.windows.net/"
}
