// hypercomb-essentials/scripts/prepare.ts
// production-grade prepare script
// - pre-cleans stale generated files (index.ts, *-keys.ts)
// - generates per-folder index.ts (barrel exports for tsup)
// - generates one master essentials-keys.ts (all IoC keys in one place)
// - drones exported as types only
// - deterministic
// - overwrites generated files

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join, resolve } from 'path'
import ts from 'typescript'
import { fileURLToPath } from 'url'

// -------------------------------------------------
// anchors
// -------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SRC_ROOT = resolve(__dirname, '../src')
const TYPES_ROOT = join(SRC_ROOT, 'types')

// -------------------------------------------------
// helpers
// -------------------------------------------------

const isSource = (f: string) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts')
const isBee = (f: string) =>
  f.endsWith('.drone.ts') || f.endsWith('.drone.js') ||
  f.endsWith('.worker.ts') || f.endsWith('.worker.js')
const isGenerated = (f: string) => f.endsWith('-keys.ts') || basename(f) === 'index.ts'

const relFrom = (root: string, full: string) =>
  full.replace(root, '').replace(/^[\\/]/, '').replace(/\\/g, '/')

const toPascal = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(p => p[0].toUpperCase() + p.slice(1))
    .join('')

const toCamel = (name: string) => {
  const pascal = toPascal(name)
  return pascal[0].toLowerCase() + pascal.slice(1)
}

// -------------------------------------------------
// walking
// -------------------------------------------------

const walkDirs = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(full)
      out.push(...walkDirs(full))
    }
  }
  return out
}

const walkFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkFiles(full))
    else if (st.isFile()) out.push(full)
  }
  return out
}

// -------------------------------------------------
// pre-clean: remove all generated files before regenerating
// -------------------------------------------------

const preClean = () => {
  let removed = 0
  for (const file of walkFiles(SRC_ROOT)) {
    const name = basename(file)
    if (name === 'index.ts' || name.endsWith('-keys.ts')) {
      rmSync(file, { force: true })
      removed++
    }
  }
  // also remove the master keys file if it exists
  const masterKeys = join(SRC_ROOT, 'essentials-keys.ts')
  if (existsSync(masterKeys)) {
    rmSync(masterKeys, { force: true })
    removed++
  }
  if (removed) console.log(`[prepare] cleaned ${removed} stale generated file(s)`)
}

// -------------------------------------------------
// export parsing
// -------------------------------------------------

type ExportInfo = { value: string[]; type: string[] }

const parseExports = (file: string): ExportInfo => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const out: ExportInfo = { value: [], type: [] }

  source.forEachChild(node => {
    if (ts.canHaveModifiers(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node)) {
        if (node.name) {
          if (isBee(file)) out.type.push(node.name.text)
          else out.value.push(node.name.text)
        }
      }

      if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach(d => {
          if (ts.isIdentifier(d.name)) out.value.push(d.name.text)
        })
      }

      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        out.type.push(node.name.text)
      }
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      node.exportClause.elements.forEach(e => {
        const name = (e.name || e.propertyName)?.text
        if (!name) return
        if (isBee(file)) out.type.push(name)
        else out.value.push(name)
      })
    }
  })

  return {
    value: Array.from(new Set(out.value)).sort(),
    type: Array.from(new Set(out.type)).sort()
  }
}

// -------------------------------------------------
// master keys: one file with all IoC keys
// -------------------------------------------------

type FolderSymbols = { folderRel: string; symbols: Map<string, string> }

const collectAllKeys = (domain: string, domainRoot: string): FolderSymbols[] => {
  const allDirs = [domainRoot, ...walkDirs(domainRoot)]
  const result: FolderSymbols[] = []

  for (const dir of allDirs) {
    const folderRel = relFrom(domainRoot, dir)
    const moduleKey = folderRel ? `${domain}/${folderRel}` : `${domain}`
    const bySymbol = new Map<string, string>()

    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      if (!statSync(full).isFile()) continue
      if (!isSource(full)) continue
      if (isGenerated(full)) continue

      const exp = parseExports(full)
      const stem = name.replace(extname(name), '')
      const keyBase = `@${moduleKey}/${stem}`

      for (const sym of [...exp.value, ...exp.type]) bySymbol.set(sym, keyBase)
    }

    if (bySymbol.size) result.push({ folderRel, symbols: bySymbol })
  }

  return result
}

const writeMasterKeys = (allDomainKeys: Map<string, FolderSymbols[]>) => {
  const lines: string[] = [
    '// auto-generated — single facade for all IoC keys',
    '// do not edit manually',
    '',
  ]

  // flat exports: every symbol as a named constant
  const allSymbols = new Map<string, string>()
  for (const [, folders] of allDomainKeys) {
    for (const folder of folders) {
      for (const [sym, key] of folder.symbols) allSymbols.set(sym, key)
    }
  }

  for (const sym of Array.from(allSymbols.keys()).sort()) {
    lines.push(`export const ${sym} = '${allSymbols.get(sym)}'`)
  }

  lines.push('')

  // hierarchical object: EssentialsKeys.domain.folder.Symbol
  lines.push('export const EssentialsKeys = {')
  for (const [domain, folders] of Array.from(allDomainKeys.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const domainProp = toCamel(domain.replace(/\.com$|\.ca$|\.io$/i, ''))
    lines.push(`  ${domainProp}: {`)

    for (const folder of folders) {
      const folderProp = folder.folderRel
        ? toCamel(folder.folderRel.split('/').pop()!)
        : '_root'

      const symbols = Array.from(folder.symbols.keys()).sort()
      lines.push(`    ${folderProp}: { ${symbols.join(', ')} },`)
    }

    lines.push('  },')
  }
  lines.push('} as const')
  lines.push('')

  writeFileSync(join(SRC_ROOT, 'essentials-keys.ts'), lines.join('\n'), 'utf8')
}

// -------------------------------------------------
// index planning (so folder exports don't stop after the first)
// -------------------------------------------------

type DirMeta = { children: string[]; exportFiles: string[] }

const buildDirMeta = (root: string): Map<string, DirMeta> => {
  const dirs = [root, ...walkDirs(root)]
  const map = new Map<string, DirMeta>()

  for (const dir of dirs) {
    const children: string[] = []
    const exportFiles: string[] = []

    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      const st = statSync(full)

      if (st.isDirectory()) {
        children.push(full)
        continue
      }

      if (!st.isFile()) continue
      if (!isSource(full)) continue
      if (isGenerated(full)) continue

      const base = name.replace(extname(name), '')
      if (base === 'index') continue

      exportFiles.push(full)
    }

    map.set(dir, { children, exportFiles })
  }

  return map
}

const computeHasDeepSources = (meta: Map<string, DirMeta>) => {
  const cache = new Map<string, boolean>()

  const hasDeep = (dir: string): boolean => {
    const hit = cache.get(dir)
    if (hit !== undefined) return hit

    const m = meta.get(dir)
    if (!m) {
      cache.set(dir, false)
      return false
    }

    if (m.exportFiles.length) {
      cache.set(dir, true)
      return true
    }

    for (const child of m.children) {
      if (hasDeep(child)) {
        cache.set(dir, true)
        return true
      }
    }

    cache.set(dir, false)
    return false
  }

  return hasDeep
}

// -------------------------------------------------
// folder index (exports subfolders + files)
// -------------------------------------------------

const writeFolderIndex = (dir: string, meta: Map<string, DirMeta>, hasDeep: (dir: string) => boolean) => {
  if (!hasDeep(dir)) return

  const m = meta.get(dir)
  if (!m) return

  const lines: string[] = []

  for (const child of m.children.sort()) {
    if (!hasDeep(child)) continue
    lines.push(`export * from './${basename(child)}'`)
  }

  for (const full of m.exportFiles.sort()) {
    const name = basename(full)
    const base = name.replace(extname(name), '')
    const rel = `./${base}`
    if (isBee(full)) lines.push(`export type * from '${rel}'`)
    else lines.push(`export * from '${rel}'`)
  }

  if (!lines.length) return

  const content = `// auto-generated
// do not edit manually

${lines.join('\n')}
`

  writeFileSync(join(dir, 'index.ts'), content, 'utf8')
}

// -------------------------------------------------
// main
// -------------------------------------------------

// step 0: pre-clean stale generated files
preClean()

rmSync(TYPES_ROOT, { recursive: true, force: true })
mkdirSync(TYPES_ROOT, { recursive: true })

const domains = readdirSync(SRC_ROOT)
  .filter(n => n !== 'types' && n !== 'essentials-keys.ts' && statSync(join(SRC_ROOT, n)).isDirectory())
  .sort()

const rootExports: string[] = []
const allDomainKeys = new Map<string, FolderSymbols[]>()

for (const domain of domains) {
  const domainRoot = join(SRC_ROOT, domain)

  const meta = buildDirMeta(domainRoot)
  const hasDeep = computeHasDeepSources(meta)

  if (hasDeep(domainRoot)) {
    rootExports.push(`export * from './${domain}'`)
  }

  // collect keys for master file
  allDomainKeys.set(domain, collectAllKeys(domain, domainRoot))

  // generate index files only (no per-folder keys)
  const allDirs = [domainRoot, ...walkDirs(domainRoot)]
  for (const dir of allDirs) {
    writeFolderIndex(dir, meta, hasDeep)
  }
}

// write one master keys file
writeMasterKeys(allDomainKeys)
rootExports.push(`export * from './essentials-keys'`)

const rootIndex = `// auto-generated
// package root entrypoint
// do not edit manually

${rootExports.sort().join('\n')}
`

writeFileSync(join(SRC_ROOT, 'index.ts'), rootIndex, 'utf8')

console.log('[prepare] complete')
