import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const SKIP = new Set(['node_modules', 'dist', '.angular', 'hypercomb-legacy'])

const dryRun = process.argv.includes('--dry-run')

function readPkg(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writePkg(path: string, pkg: any): void {
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
}

// Root package.json is the single source of truth for @angular/* versions
const rootPkg = readPkg(resolve(ROOT, 'package.json'))
const angularVersions: Record<string, string> = {}

for (const section of ['dependencies', 'devDependencies'] as const) {
  for (const [name, version] of Object.entries(rootPkg[section] ?? {})) {
    if (name.startsWith('@angular/') || name.startsWith('@angular-devkit/')) {
      angularVersions[name] = version as string
    }
  }
}

console.log('Source of truth (root package.json):')
for (const [name, version] of Object.entries(angularVersions).sort()) {
  console.log(`  ${name}: ${version}`)
}
console.log()

// Find all package.json files in immediate subdirectories (project level)
const projects = readdirSync(ROOT)
  .filter(entry => {
    if (SKIP.has(entry)) return false
    const full = join(ROOT, entry)
    try {
      return statSync(full).isDirectory() && statSync(join(full, 'package.json')).isFile()
    } catch { return false }
  })

let changed = 0

for (const project of projects) {
  const pkgPath = join(ROOT, project, 'package.json')
  const pkg = readPkg(pkgPath)
  let dirty = false

  for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const deps = pkg[section]
    if (!deps) continue

    for (const [name, currentRaw] of Object.entries(deps)) {
      const current = currentRaw as string
      if (!name.startsWith('@angular/') && !name.startsWith('@angular-devkit/')) continue

      const canonical = angularVersions[name]
      if (!canonical) continue

      // For peer deps, use >= range (e.g., >=21.0.0)
      if (section === 'peerDependencies') {
        const major = canonical.split('.')[0]
        const expected = `>=${major}.0.0`
        if (current !== expected) {
          console.log(`  ${project}: ${name} ${section} ${current} → ${expected}`)
          deps[name] = expected
          dirty = true
        }
        continue
      }

      if (current !== canonical) {
        console.log(`  ${project}: ${name} ${current} → ${canonical}`)
        deps[name] = canonical
        dirty = true
      }
    }
  }

  if (dirty) {
    if (dryRun) {
      console.log(`  [dry-run] would update ${project}/package.json`)
    } else {
      writePkg(pkgPath, pkg)
      console.log(`  ✓ updated ${project}/package.json`)
    }
    changed++
  }
}

if (changed === 0) {
  console.log('All projects in sync.')
} else {
  console.log(`\n${dryRun ? 'Would update' : 'Updated'} ${changed} package.json file(s).`)
}
