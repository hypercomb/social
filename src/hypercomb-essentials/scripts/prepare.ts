// hypercomb-essentials/scripts/prepare.ts
// production-grade prepare script
// - generates per-folder *-keys.ts
// - generates per-folder index.ts
// - generates per-domain root index.ts
// - generates root index.ts
// - drones exported as types only
// - deterministic
// - overwrites generated files
debugger
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
const isDrone = (f: string) => f.endsWith('.drone.ts') || f.endsWith('.drone.js')
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
          if (isDrone(file)) out.type.push(node.name.text)
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
        if (isDrone(file)) out.type.push(name)
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
// folder keys
// -------------------------------------------------

const writeFolderKeys = (domain: string, domainRoot: string, dir: string) => {
  const dirName = dir.split(/[\\/]/).pop()
  if (!dirName) return

  const folderRel = relFrom(domainRoot, dir)
  const moduleKey = folderRel ? `${domain}/${folderRel}` : `${domain}`

  const keysConst = `${toPascal(dirName)}Keys`
  const moduleConst = `${toPascal(dirName)}Module`
  const outFile = join(dir, `${dirName}-keys.ts`)

  const bySymbol = new Map<string, string>()

  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (!statSync(full).isFile()) continue
    if (!isSource(full)) continue
    if (isGenerated(full)) continue

    const exp = parseExports(full)
    const stem = name.replace(extname(name), '')
    const keyBase = `${moduleKey}/${stem}`

    for (const sym of [...exp.value, ...exp.type]) bySymbol.set(sym, keyBase)
  }

  if (!bySymbol.size) return

  const symbols = Array.from(bySymbol.keys()).sort()

  let out = `// auto-generated
// do not edit manually

export const ${moduleConst} = '@${moduleKey}'
`

  for (const s of symbols) out += `export const ${s} = '@${bySymbol.get(s)}'\n`

  out += `export const ${keysConst} = { ${symbols.join(', ')} } as const\n`

  writeFileSync(outFile, out, 'utf8')
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
// folder index (exports subfolders + files; subfolders ensure you don't "stop after the first")
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
    if (isDrone(full)) lines.push(`export * from '${rel}'`)
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

rmSync(TYPES_ROOT, { recursive: true, force: true })
mkdirSync(TYPES_ROOT, { recursive: true })

const domains = readdirSync(SRC_ROOT)
  .filter(n => n !== 'types' && statSync(join(SRC_ROOT, n)).isDirectory())
  .sort()

const rootExports: string[] = []

for (const domain of domains) {
  const domainRoot = join(SRC_ROOT, domain)

  const meta = buildDirMeta(domainRoot)
  const hasDeep = computeHasDeepSources(meta)

  const allDirs = [domainRoot, ...walkDirs(domainRoot)]

  for (const dir of allDirs) {
    writeFolderKeys(domain, domainRoot, dir)
  }

  for (const dir of allDirs) {
    writeFolderIndex(dir, meta, hasDeep)
  }

  for (const dir of allDirs) {
    if (hasDeep(dir)) {
      const rel = relFrom(SRC_ROOT, dir)
      rootExports.push(`export * from './${rel}'`)
    }
  }
}

const rootIndex = `// auto-generated
// package root entrypoint
// do not edit manually

${rootExports.sort().join('\n')}
`

writeFileSync(join(SRC_ROOT, 'index.ts'), rootIndex, 'utf8')

console.log('[prepare] complete')