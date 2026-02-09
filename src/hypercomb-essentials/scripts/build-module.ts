// hypercomb-essentials/scripts/build-module.ts
// production + dev module builder
//
// dev
// - compile each source file into hypercomb-web/public/dev/** preserving structure
// - generate one runtime entry per domain:
//   - hypercomb-web/public/dev/<domain>/index.runtime.js
// - generate one flat name manifest at dev root:
//   - hypercomb-web/public/dev/name.manifest.js
//   - maps every namespace (@domain[/seg1[/seg2]]) -> /dev/<domain>/index.runtime.js
//
// prod
// - signed dependency bundles (namespace-based)
// - signed drone resources
// - signed layer tree
// - dist/<rootSig>/{__dependencies__,__resources__,__layers__}
//
// no meta
// no import maps
// no aliases
// structure is the contract

import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, extname, join, relative, resolve } from 'path'
import { build } from 'esbuild'
import { SignatureService } from '@hypercomb/core'
import ts from 'typescript'

// -------------------------------------------------
// esm globals
// -------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// -------------------------------------------------
// config
// -------------------------------------------------

const PROJECT_ROOT = resolve(__dirname, '..')
const SRC_ROOT = resolve(PROJECT_ROOT, 'src')
const DIST_ROOT = resolve(PROJECT_ROOT, 'dist')

// dev module root (hypercomb-web)
const DEV_ROOT = resolve(PROJECT_ROOT, '../hypercomb-web/public/dev')

const TARGET = 'es2022'
const NAMESPACE_SEGMENTS_MAX = 3
const PLATFORM_EXTERNALS = ['@hypercomb/core', 'pixi.js']

// -------------------------------------------------
// helpers
// -------------------------------------------------

const ensureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true })
}

const relPosix = (from: string, to: string): string =>
  relative(from, to).replace(/\\/g, '/') || ''

const walkFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const names = readdirSync(dir).slice().sort((a, b) => a.localeCompare(b))
  for (const name of names) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

const isSource = (f: string): boolean =>
  (f.endsWith('.ts') || f.endsWith('.js')) &&
  !f.endsWith('.d.ts')

const isDrone = (f: string): boolean =>
  f.endsWith('.drone.ts') || f.endsWith('.drone.js')

const isEntry = (f: string): boolean =>
  f.endsWith('.entry.ts') || f.endsWith('.entry.js')

const stripExt = (p: string): string =>
  p.slice(0, -extname(p).length)

const textToBytes = (text: string): Uint8Array =>
  new TextEncoder().encode(text)

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

const isSig = (v: string): boolean =>
  /^[a-f0-9]{64}$/i.test(v)

const writeSigFile = (dir: string, sig: string, bytes: Uint8Array): void => {
  if (!isSig(sig)) throw new Error(`invalid signature: ${sig}`)
  writeFileSync(join(dir, sig), bytes)
}

const splitPath = (p: string): string[] =>
  p.split('/').filter(Boolean)

const namespaceRelDirFromRelDir = (relDir: string): string => {
  const parts = splitPath(relDir)
  return parts.slice(0, Math.min(NAMESPACE_SEGMENTS_MAX, parts.length)).join('/')
}

const specifierFromNamespaceRelDir = (namespaceRelDir: string): string =>
  `@${namespaceRelDir}`

const domainFromRelPath = (relPath: string): string => {
  const parts = splitPath(relPath)
  return parts[0] ?? ''
}

const relWithinDomainFromRelPath = (domain: string, relPath: string): string => {
  const prefix = `${domain}/`
  if (relPath.startsWith(prefix)) return relPath.slice(prefix.length)
  return relPath
}

const uniq = (xs: string[]): string[] => Array.from(new Set(xs))

const uniqSorted = (xs: string[]): string[] =>
  uniq(xs).sort((a, b) => a.localeCompare(b))

const addToBucket = (map: Map<string, { drones: string[]; deps: string[] }>, relDir: string, sig: string, kind: 'dep' | 'drone'): void => {
  const bucket = map.get(relDir) ?? { drones: [], deps: [] }
  if (kind === 'dep') bucket.deps.push(sig)
  else bucket.drones.push(sig)
  map.set(relDir, bucket)
}

// -------------------------------------------------
// discovery
// -------------------------------------------------

type SourceFile = {
  entry: string
  relPath: string
  relDir: string
  kind: 'dependency' | 'drone'
}

const discoverSources = (): SourceFile[] =>
  walkFiles(SRC_ROOT)
    .filter(isSource)
    .filter(f => {
      const relPath = relPosix(SRC_ROOT, f)

      // skip src/types/**
      if (relPath === 'types' || relPath.startsWith('types/')) return false

      // skip entry sources (dev runtime is per-domain index.runtime.js)
      if (isEntry(relPath)) return false

      // skip root src files
      const relDir = relPosix(SRC_ROOT, dirname(f))
      if (!relDir) return false

      return true
    })
    .map(file => ({
      entry: file,
      relPath: relPosix(SRC_ROOT, file),
      relDir: relPosix(SRC_ROOT, dirname(file)),
      kind: isDrone(file) ? 'drone' : 'dependency',
    }))

// -------------------------------------------------
// dev build (ts transpile, no resolution, no externals)
// -------------------------------------------------

const getDevTsOptions = (): ts.CompilerOptions => {
  const configPath = resolve(PROJECT_ROOT, 'tsconfig.json')
  const cfg = ts.readConfigFile(configPath, ts.sys.readFile)
  if (cfg.error) {
    const msg = ts.flattenDiagnosticMessageText(cfg.error.messageText, '\n')
    throw new Error(msg)
  }

  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, PROJECT_ROOT)

  return {
    ...parsed.options,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    sourceMap: true,
    inlineSources: true,
    declaration: false,
    declarationMap: false,
    noEmitOnError: false,
  }
}

const buildDevFile = (src: SourceFile, devTsOptions: ts.CompilerOptions): void => {
  const outJs = join(DEV_ROOT, stripExt(src.relPath) + '.js')
  ensureDir(dirname(outJs))

  if (src.entry.endsWith('.js')) {
    copyFileSync(src.entry, outJs)
    return
  }

  const code = readFileSync(src.entry, 'utf8')
  const r = ts.transpileModule(code, { compilerOptions: devTsOptions, fileName: src.relPath })

  writeFileSync(outJs, r.outputText, 'utf8')
  if (r.sourceMapText) writeFileSync(outJs + '.map', r.sourceMapText, 'utf8')
}

// -------------------------------------------------
// dev: per-domain runtime entry + one flat name manifest
// -------------------------------------------------

type NameManifest = {
  domains: Record<string, string>
  imports: Record<string, string>
}

const generateDevDomainRuntimeAndNameManifest = (sources: SourceFile[]): void => {
  const deps = sources.filter(s => s.kind === 'dependency')

  const domainToDeps = new Map<string, SourceFile[]>()
  for (const s of deps) {
    const domain = domainFromRelPath(s.relPath)
    if (!domain) continue
    const list = domainToDeps.get(domain) ?? []
    list.push(s)
    domainToDeps.set(domain, list)
  }

  const domains = Array.from(domainToDeps.keys()).sort((a, b) => a.localeCompare(b))
  const domainsMap: Record<string, string> = {}
  const importsMap: Record<string, string> = {}

  for (const domain of domains) {
    const domainDevRoot = join(DEV_ROOT, domain)
    ensureDir(domainDevRoot)

    const entryOut = join(domainDevRoot, 'index.runtime.js')
    const members = (domainToDeps.get(domain) ?? []).slice().sort((a, b) => a.relPath.localeCompare(b.relPath))

    const exportLines = uniqSorted(
      members.map(m => {
        const relWithinDomain = relWithinDomainFromRelPath(domain, m.relPath)
        return `export * from './${stripExt(relWithinDomain)}.js';`
      })
    )

    writeFileSync(entryOut, exportLines.join('\n') + '\n', 'utf8')

    const entryUrl = `/dev/${domain}/index.runtime.js`
    domainsMap[domain] = entryUrl

    const domainNamespaces = uniqSorted(
      members.map(m => {
        const nsRelDir = namespaceRelDirFromRelDir(m.relDir)
        return specifierFromNamespaceRelDir(nsRelDir)
      })
    )

    for (const ns of domainNamespaces) {
      importsMap[ns] = entryUrl
    }

    const rootNs = `@${domain}`
    if (!importsMap[rootNs]) importsMap[rootNs] = entryUrl
  }

  const manifest: NameManifest = { domains: domainsMap, imports: importsMap }

  const manifestFile = join(DEV_ROOT, 'name.manifest.js')
  const manifestSource =
    `// auto-generated by hypercomb-essentials/scripts/build-module.ts\n` +
    `// flat dev name manifest (domains + namespace imports)\n\n` +
    `export const nameManifest = ${JSON.stringify(manifest, null, 2)}\n` +
    `export const domains = nameManifest.domains\n` +
    `export const imports = nameManifest.imports\n`

  writeFileSync(manifestFile, manifestSource, 'utf8')

  if (!existsSync(manifestFile)) {
    throw new Error(`dev name manifest was not written: ${manifestFile}`)
  }
}

// -------------------------------------------------
// layers
// -------------------------------------------------

type DirNode = { rel: string; children: DirNode[] }

const readDirTree = (root: string, rel: string): DirNode => {
  const children: DirNode[] = []
  const full = join(root, rel)

  const names = readdirSync(full).slice().sort((a, b) => a.localeCompare(b))
  for (const name of names) {
    if (!rel && name === 'types') continue
    const child = join(full, name)
    if (statSync(child).isDirectory()) {
      children.push(readDirTree(root, rel ? `${rel}/${name}` : name))
    }
  }

  return { rel, children }
}

const signJson = async (value: unknown) => {
  const json = JSON.stringify(value)
  const sig = await SignatureService.sign(toArrayBuffer(textToBytes(json)))
  return { sig, json }
}

// -------------------------------------------------
// build helpers (prod)
// -------------------------------------------------

const buildNamespaceDependency = async (namespaceRelDir: string, memberFiles: SourceFile[], allNamespaceSpecifiers: string[]): Promise<{ sig: string; bytes: Uint8Array }> => {
  const namespaceRootFs = join(SRC_ROOT, namespaceRelDir)
  const namespaceSpecifier = specifierFromNamespaceRelDir(namespaceRelDir)

  const exports = memberFiles
    .map(f => {
      const relFromNs = relPosix(namespaceRootFs, f.entry)
      const relNoExt = stripExt(relFromNs)
      const spec = relNoExt.startsWith('.') ? relNoExt : `./${relNoExt}`
      return spec
    })
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))

  const entrySource = exports.map(p => `export * from '${p}'`).join('\n') + '\n'

  const externals = [
    ...PLATFORM_EXTERNALS,
    ...allNamespaceSpecifiers.filter(s => s !== namespaceSpecifier),
  ]

  const r = await build({
    stdin: {
      contents: entrySource,
      resolveDir: namespaceRootFs,
      sourcefile: `virtual:${namespaceSpecifier}`,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: TARGET,
    tsconfig: resolve(PROJECT_ROOT, 'tsconfig.json'),
    external: externals,
    sourcemap: false,
    minify: false,
  })

  const compiled = r.outputFiles?.[0]?.text
  if (!compiled) throw new Error(`no output: ${namespaceSpecifier}`)

  const bytes = textToBytes(compiled)
  const sig = await SignatureService.sign(toArrayBuffer(bytes))
  return { sig, bytes }
}

const buildDrone = async (entry: string, externals: string[]): Promise<Uint8Array> => {
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    splitting: false,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: TARGET,
    tsconfig: resolve(PROJECT_ROOT, 'tsconfig.json'),
    external: externals,
    sourcemap: false,
    minify: false,
  })

  const compiled = r.outputFiles?.[0]?.text
  if (!compiled) throw new Error(`no output: ${entry}`)
  return textToBytes(compiled)
}

// -------------------------------------------------
// main
// -------------------------------------------------

const main = async (): Promise<void> => {
  rmSync(DIST_ROOT, { recursive: true, force: true })
  rmSync(DEV_ROOT, { recursive: true, force: true })
  ensureDir(DIST_ROOT)
  ensureDir(DEV_ROOT)

  const sources = discoverSources()
  if (!sources.length) throw new Error('no sources found')

  // dev
  const devTsOptions = getDevTsOptions()
  for (const src of sources) buildDevFile(src, devTsOptions)
  generateDevDomainRuntimeAndNameManifest(sources)

  // prod (signed, identical package structure)
  const resourcesByDir = new Map<string, { drones: string[]; deps: string[] }>()
  const dependencyBytes = new Map<string, Uint8Array>()
  const resourceBytes = new Map<string, Uint8Array>()

  const deps = sources.filter(s => s.kind === 'dependency')
  const namespaceToFiles = new Map<string, SourceFile[]>()

  for (const src of deps) {
    const nsRelDir = namespaceRelDirFromRelDir(src.relDir)
    const list = namespaceToFiles.get(nsRelDir) ?? []
    list.push(src)
    namespaceToFiles.set(nsRelDir, list)
  }

  const allNamespaceRelDirs = Array.from(namespaceToFiles.keys()).sort((a, b) => a.localeCompare(b))
  const allNamespaceSpecifiers = allNamespaceRelDirs.map(specifierFromNamespaceRelDir)

  for (const nsRelDir of allNamespaceRelDirs) {
    const files = (namespaceToFiles.get(nsRelDir) ?? []).slice().sort((a, b) => a.entry.localeCompare(b.entry))
    const { sig, bytes } = await buildNamespaceDependency(nsRelDir, files, allNamespaceSpecifiers)

    dependencyBytes.set(sig, bytes)

    for (const f of files) addToBucket(resourcesByDir, f.relDir, sig, 'dep')
    addToBucket(resourcesByDir, nsRelDir, sig, 'dep')
  }

  const droneExternals = [...PLATFORM_EXTERNALS, ...allNamespaceSpecifiers]
  for (const src of sources.filter(s => s.kind === 'drone')) {
    const bytes = await buildDrone(src.entry, droneExternals)
    const sig = await SignatureService.sign(toArrayBuffer(bytes))

    resourceBytes.set(sig, bytes)
    addToBucket(resourcesByDir, src.relDir, sig, 'drone')
  }

  const tree = readDirTree(SRC_ROOT, '')
  const layers = new Map<string, string>()

  const buildLayers = async (node: DirNode): Promise<string> => {
    const children: string[] = []
    for (const c of node.children) children.push(await buildLayers(c))

    const entry = resourcesByDir.get(node.rel) ?? { drones: [], deps: [] }

    const layer = {
      version: 1,
      name: node.rel.split('/').pop() || 'root',
      rel: node.rel,
      drones: uniqSorted(entry.drones),
      dependencies: uniqSorted(entry.deps),
      children,
    }

    const { sig, json } = await signJson(layer)
    layers.set(sig, json)
    return sig
  }

  const rootLayerSig = await buildLayers(tree)

  const rootDir = join(DIST_ROOT, rootLayerSig)
  const layersDir = join(rootDir, '__layers__')
  const resourcesDir = join(rootDir, '__resources__')
  const dependenciesDir = join(rootDir, '__dependencies__')

  ensureDir(layersDir)
  ensureDir(resourcesDir)
  ensureDir(dependenciesDir)

  for (const [sig, json] of layers) writeFileSync(join(layersDir, sig), json, 'utf8')
  for (const [sig, bytes] of dependencyBytes) writeSigFile(dependenciesDir, sig, bytes)
  for (const [sig, bytes] of resourceBytes) writeSigFile(resourcesDir, sig, bytes)

  const ps1 = resolve(__dirname, 'deploy-azure.ps1')
  if (existsSync(ps1)) {
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Signature', rootLayerSig], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error('deployment failed')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
