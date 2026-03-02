import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const CORE_DIR = resolve(ROOT, 'hypercomb-core')
const ESSENTIALS_DIR = resolve(ROOT, 'hypercomb-essentials')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const coreOnly = args.includes('--core-only')
const essentialsOnly = args.includes('--essentials-only')

function run(cmd: string, cwd: string): void {
  console.log(`> ${cmd}`)
  execSync(cmd, { cwd, stdio: 'inherit' })
}

function readPkgVersion(dir: string): string {
  const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
  return pkg.version as string
}

// Verify login
try {
  const user = execSync('npm whoami', { cwd: ROOT, encoding: 'utf8' }).trim()
  console.log(`Logged in as: ${user}`)
} catch {
  console.error('ERROR: Not logged in to npm. Run `npm login` first.')
  process.exit(1)
}

// Build and publish core
if (!essentialsOnly) {
  console.log('\n=== @hypercomb/core ===')
  const version = readPkgVersion(CORE_DIR)
  console.log(`Version: ${version}`)

  run('npm run build', CORE_DIR)
  run('npm pack --dry-run', CORE_DIR)

  if (!dryRun) {
    run('npm publish --access public', CORE_DIR)
    console.log(`Published @hypercomb/core@${version}`)
  } else {
    console.log(`[DRY RUN] Would publish @hypercomb/core@${version}`)
  }
}

// Build and publish essentials
if (!coreOnly) {
  console.log('\n=== @hypercomb/essentials ===')
  const version = readPkgVersion(ESSENTIALS_DIR)
  console.log(`Version: ${version}`)

  run('npm run build', ESSENTIALS_DIR)
  run('npm pack --dry-run', ESSENTIALS_DIR)

  if (!dryRun) {
    run('npm publish --access public', ESSENTIALS_DIR)
    console.log(`Published @hypercomb/essentials@${version}`)
  } else {
    console.log(`[DRY RUN] Would publish @hypercomb/essentials@${version}`)
  }
}

console.log('\nDone.')
