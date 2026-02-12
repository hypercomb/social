// hypercomb-essentials/scripts/prepare.ts
// generates ambient externals per domain by parsing real exports
// generates per-folder *-keys.ts files (module + symbol keys)
// - domains = first-level folders under src (except "types")
// - namespaces = @<domain>/<up to 2 subfolders>
// - folders only (never files) define module names
// - explicit symbol exports only
// - ignore .drone.*
// - ignore generated *-keys.* when building externals
// - deterministic
// - overwrites existing generated files

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { dirname, extname, join, resolve } from 'path'
import ts from 'typescript'
import { fileURLToPath } from 'url'

// -------------------------------------------------
// anchors
// -------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// -------------------------------------------------
// config
// -------------------------------------------------

const SRC_ROOT = resolve(__dirname, '../src')
const TYPES_ROOT = resolve(SRC_ROOT, 'types')

// -------------------------------------------------
// helpers
// -------------------------------------------------

const isSource = (f: string): boolean =>
  (f.endsWith('.ts') || f.endsWith('.js')) &&
  !f.endsWith('.d.ts') &&
  !f.endsWith('.drone.ts') &&
  !f.endsWith('.drone.js')

const isGeneratedKeysFile = (f: string): boolean =>
  f.endsWith('-keys.ts') || f.endsWith('-keys.js')

const isExternalSource = (f: string): boolean =>
  isSource(f) && !isGeneratedKeysFile(f)

const isKeyInput = (full: string): boolean => {
  if (!isSource(full)) return false

  const base = full.replace(extname(full), '').split(/[\\/]/).pop() ?? ''
  if (base === 'index') return false
  if (base.endsWith('-keys')) return false

  return true
}

const relFrom = (root: string, full: string): string =>
  full.replace(root, '').replace(/^[\\/]/, '').replace(/\\/g, '/')

const relNoExtFrom = (root: string, full: string): string =>
  relFrom(root, full).replace(extname(full), '')

const toPascal = (name: string): string =>
  name
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(p => p.slice(0, 1).toUpperCase() + p.slice(1))
    .join('')

// -------------------------------------------------
// walking
// -------------------------------------------------

const walkFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []

  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    const st = statSync(full)

    if (st.isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }

  return out
}

const walkDirs = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []

  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    const st = statSync(full)
    if (!st.isDirectory()) continue

    out.push(full)
    out.push(...walkDirs(full))
  }

  return out
}

// -------------------------------------------------
// export parsing
// -------------------------------------------------

type ExportInfo = {
  value: string[]
  type: string[]
}

const parseExports = (file: string): ExportInfo => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )

  const out: ExportInfo = { value: [], type: [] }

  source.forEachChild(node => {
    if (
      ts.canHaveModifiers(node) &&
      node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node)) {
        if (node.name) out.value.push(node.name.text)
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
        if (name) out.value.push(name)
      })
    }
  })

  out.value = Array.from(new Set(out.value)).sort()
  out.type = Array.from(new Set(out.type)).sort()

  return out
}

// -------------------------------------------------
// namespace helpers
// -------------------------------------------------

const getNamespace = (domain: string, file: string): string | null => {
  const rel = relFrom(join(SRC_ROOT, domain), file)
  const parts = rel.split('/')

  parts.pop()

  if (parts.length === 0) return `@${domain}`

  return `@${[domain, ...parts.slice(0, 2)].join('/')}`
}

const getModulePath = (domain: string, file: string): string =>
  '../' + relNoExtFrom(SRC_ROOT, file)

// -------------------------------------------------
// per-folder keys generation
// -------------------------------------------------

const writeFolderKeys = (domain: string, domainRoot: string, dir: string): void => {
  const dirName = dir.split(/[\\/]/).pop() ?? ''
  if (!dirName) return

  const folderRel = relFrom(domainRoot, dir) // e.g. "settings" or "core/zoom"
  const folderModuleKey = `${domain}/${folderRel}`

  const keysConstName = `${toPascal(dirName)}Keys`
  const moduleConstName = `${toPascal(dirName)}Module`
  const outFile = join(dir, `${dirName}-keys.ts`)

  const bySymbol = new Map<string, string>()

  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    const st = statSync(full)
    if (!st.isFile()) continue
    if (!isKeyInput(full)) continue

    const exp = parseExports(full)
    if (!exp.value.length && !exp.type.length) continue

    const fileStem = name.replace(extname(name), '')
    const symbolKey = `${folderModuleKey}/${fileStem}`

    // value + type exports both become key constants
    for (const sym of [...exp.value, ...exp.type]) {
      if (!sym) continue
      if (sym === keysConstName) continue
      if (sym === moduleConstName) continue

      if (bySymbol.has(sym)) {
        const existing = bySymbol.get(sym)
        if (existing !== symbolKey) {
          console.warn(`[prepare] duplicate export name "${sym}" in ${dir} (${existing} vs ${symbolKey})`)
        }
        continue
      }

      bySymbol.set(sym, symbolKey)
    }
  }

  if (!bySymbol.size) return

  const symbols = Array.from(bySymbol.keys()).sort()

  let out = `// auto-generated by scripts/prepare.ts
// public module keys for ${domain}/${folderRel}
// do not edit manually

 export const ${moduleConstName} = '@${folderModuleKey}'
`

  for (const sym of symbols) {
    out += `export const ${sym} = '@${bySymbol.get(sym)}'\n`
  }

  out += `export const ${keysConstName} = { ${symbols.join(', ')} } as const\n`

  writeFileSync(outFile, out, 'utf8')
  console.log(`[prepare] wrote ${outFile}`)
}

const generateKeysForDomain = (domain: string): void => {
  const domainRoot = join(SRC_ROOT, domain)
  for (const dir of walkDirs(domainRoot)) writeFolderKeys(domain, domainRoot, dir)
}

// -------------------------------------------------
// main
// -------------------------------------------------

mkdirSync(TYPES_ROOT, { recursive: true })

const domains = readdirSync(SRC_ROOT).filter(name => {
  if (name === 'types') return false
  const full = join(SRC_ROOT, name)
  return statSync(full).isDirectory()
}).sort()

// 1) generate per-folder keys
for (const domain of domains) {
  generateKeysForDomain(domain)
}

// 2) generate ambient externals per domain (exclude generated *-keys.* so externals stay clean)
for (const domain of domains) {
  const domainRoot = join(SRC_ROOT, domain)

  const namespaces = new Map<string, Map<string, ExportInfo>>()

  for (const file of walkFiles(domainRoot)) {
    if (!isExternalSource(file)) continue

    const exports = parseExports(file)
    if (!exports.value.length && !exports.type.length) continue

    const ns = getNamespace(domain, file)
    if (!ns) continue

    const mod = getModulePath(domain, file)
    const bucket = namespaces.get(ns) ?? new Map()
    bucket.set(mod, exports)
    namespaces.set(ns, bucket)
  }

  if (!namespaces.size) continue

  const outFile = join(TYPES_ROOT, `${domain}.externals.d.ts`)

  let out = `// auto-generated by scripts/prepare.ts
// ambient externals for ${domain}
// do not edit manually

`

  for (const [ns, modules] of Array.from(namespaces.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    out += `declare module '${ns}' {\n`

    for (const [mod, exp] of Array.from(modules.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      if (exp.value.length) out += `  export { ${exp.value.join(', ')} } from '${mod}'\n`
      if (exp.type.length) out += `  export type { ${exp.type.join(', ')} } from '${mod}'\n`
    }

    out += `}\n\n`
  }

  writeFileSync(outFile, out, 'utf8')
  console.log(`[prepare] wrote ${outFile}`)
}
