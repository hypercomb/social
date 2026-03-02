import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const CORE_PKG = resolve(ROOT, 'hypercomb-core/package.json')
const ESSENTIALS_PKG = resolve(ROOT, 'hypercomb-essentials/package.json')

type BumpType = 'patch' | 'minor' | 'major'

const args = process.argv.slice(2)
const bumpType = (['patch', 'minor', 'major'] as const).find(t => args.includes(t)) ?? 'patch'
const coreOnly = args.includes('--core-only')
const essentialsOnly = args.includes('--essentials-only')
const dryRun = args.includes('--dry-run')

function bump(current: string, type: BumpType): string {
  const [major, minor, patch] = current.split('.').map(Number)
  switch (type) {
    case 'major': return `${major + 1}.0.0`
    case 'minor': return `${major}.${minor + 1}.0`
    case 'patch': return `${major}.${minor}.${patch + 1}`
  }
}

function readPkg(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writePkg(path: string, pkg: any): void {
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
}

const corePkg = readPkg(CORE_PKG)
const essentialsPkg = readPkg(ESSENTIALS_PKG)

const oldCoreVersion = corePkg.version as string
const oldEssentialsVersion = essentialsPkg.version as string

console.log(`Bump type: ${bumpType}`)
console.log()

if (!essentialsOnly) {
  const newVersion = bump(oldCoreVersion, bumpType)
  console.log(`@hypercomb/core: ${oldCoreVersion} -> ${newVersion}`)
  corePkg.version = newVersion

  if (!dryRun) {
    writePkg(CORE_PKG, corePkg)
  }

  // Update essentials' dependency on core
  if (essentialsPkg.dependencies?.['@hypercomb/core']) {
    const newRange = `^${newVersion}`
    console.log(`@hypercomb/essentials dependency @hypercomb/core: ${essentialsPkg.dependencies['@hypercomb/core']} -> ${newRange}`)
    essentialsPkg.dependencies['@hypercomb/core'] = newRange

    if (!dryRun) {
      writePkg(ESSENTIALS_PKG, essentialsPkg)
    }
  }
}

if (!coreOnly) {
  const newVersion = bump(oldEssentialsVersion, bumpType)
  console.log(`@hypercomb/essentials: ${oldEssentialsVersion} -> ${newVersion}`)
  essentialsPkg.version = newVersion

  if (!dryRun) {
    writePkg(ESSENTIALS_PKG, essentialsPkg)
  }
}

if (dryRun) {
  console.log('\n[DRY RUN] No files were modified.')
} else {
  console.log('\nVersions updated.')
}
