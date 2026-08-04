// Deploy the assembled presentation to Azure Static Web Apps (hypercomb.com).
//
// Follows the same pattern as the other sites in this subscription:
// resource group swa-hypercomb-prod-west-001, West US 2, Free SKU.
// Requires `az login` and network access.
//
//   node scripts/presentation/build.cjs        # assemble first
//   node scripts/presentation/deploy-azure.cjs # then ship
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = __dirname
const APP = 'pbs-hypercomb-com'
const GROUP = 'swa-hypercomb-prod-west-001'

const dist = path.join(ROOT, 'dist', 'hypercomb-presentation.html')
if (!fs.existsSync(dist)) throw new Error('run build.cjs first — dist/hypercomb-presentation.html is missing')

const stage = path.join(ROOT, 'deploy')
fs.mkdirSync(stage, { recursive: true })
fs.copyFileSync(dist, path.join(stage, 'index.html'))
fs.writeFileSync(path.join(stage, 'staticwebapp.config.json'), JSON.stringify({
  navigationFallback: { rewrite: '/index.html' },
  globalHeaders: { 'cache-control': 'public, max-age=300, must-revalidate' },
  mimeTypes: { '.html': 'text/html; charset=utf-8' },
}, null, 2))

const az = (...args) => execFileSync('az', args, { encoding: 'utf8', shell: true }).trim()
const token = az('staticwebapp', 'secrets', 'list', '-n', APP, '-g', GROUP, '--query', 'properties.apiKey', '-o', 'tsv')
if (!token) throw new Error('could not read the deployment token — is `az login` current?')

console.log(`deploying ${(fs.statSync(dist).size / 1e6).toFixed(2)} MB to ${APP}…`)
execFileSync('npx', ['--yes', '@azure/static-web-apps-cli', 'deploy', stage,
  '--deployment-token', token, '--env', 'production'], { stdio: 'inherit', shell: true })
