// hypercomb-essentials/scripts/build-module-legacy.ts
// production legacy build (dev-debug friendly)
// - dev hierarchy mirrors source folders directly:
//   /dev/<domain>/<folder>/<file>.js (inline sourcemaps; no .map files)
// - __dependencies__, __drones__, __layers__ are signature-only (dev + prod)
// - runtimes (alias entrypoints) are signature-only modules in __dependencies__
// - runtimes export only direct files in their folder via absolute /dev/... imports
// - single manifest: /public/dev/name.manifest.js
// - sourcemaps always enabled

import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, extname, join, relative, resolve } from 'path'
import { build } from 'esbuild'
import { SignatureService } from '@hypercomb/core'

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

// dev root (hypercomb-web)
const DEV_ROOT = resolve(PROJECT_ROOT, '../hypercomb-web/public/dev')

const TARGET = 'es2022'
const PLATFORM_EXTERNALS = ['@hypercomb/core', 'pixi.js']

const DEP_DIR = '__dependencies__'
const DRONES_DIR = '__drones__'
const LAYERS_DIR = '__layers__'

// hard rule: never emit @<domain> root runtime
const EMIT_DOMAIN_ROOT_NAMESPACE = false

// build stamp (watched by dev runner to restart web)
const BUILD_STAMP_FILE = join(DIST_ROOT, '.hc-build-stamp')

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
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

const isSource = (f: string): boolean =>
  (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts')

const isDrone = (f: string): boolean =>
  f.endsWith('.drone.ts') || f.endsWith('.drone.js')

const isEntry = (f: string): boolean =>
  f.endsWith('.entry.ts') || f.endsWith('.entry.js')

const stripExt = (p: string): string =>
  p.slice(0, -extname(p).length)

const splitPath = (p: string): string[] =>
  p.split('/').filter(Boolean)

const domainFromRelPath = (relPath: string): string =>
  splitPath(relPath)[0] ?? ''

const textToBytes = (text: string): Uint8Array =>
  new TextEncoder().encode(text)

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

const isSig = (v: string): boolean =>
  /^[a-f0-9]{64}$/i.test(v)

const jsFileName = (sig: string): string => `${sig}.js`

const writeSigJsFile = (dir: string, sig: string, bytes: Uint8Array): void => {
  if (!isSig(sig)) throw new Error(`invalid signature: ${sig}`)
  writeFileSync(join(dir, jsFileName(sig)), bytes)
}

const layerFileName = (sig: string): string => `${sig}.json`

const writeLayerJsonFile = (dir: string, sig: string, json: string): void => {
  if (!isSig(sig)) throw new Error(`invalid signature: ${sig}`)
  writeFileSync(join(dir, layerFileName(sig)), json, 'utf8')
}

const uniqSorted = (xs: string[]): string[] =>
  Array.from(new Set(xs)).sort((a, b) => a.localeCompare(b))

const addToBucket = (
  map: Map<string, { drones: string[]; deps: string[] }>,
  relDir: string,
  fileName: string,
  kind: 'dep' | 'drone'
): void => {
  const bucket = map.get(relDir) ?? { drones: [], deps: [] }
  if (kind === 'dep') bucket.deps.push(fileName)
  else bucket.drones.push(fileName)
  map.set(relDir, bucket)
}

const writeBuildStamp = (): void => {
  // touch a single file after a successful build
  // external dev runner watches this and restarts hypercomb-web
  writeFileSync(BUILD_STAMP_FILE, String(Date.now()), 'utf8')
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
      if (relPath === 'types' || relPath.startsWith('types/')) return false
      if (isEntry(relPath)) return false
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

const buildLayersFromTree = async (
  node: DirNode,
  resourcesByDir: Map<string, { drones: string[]; deps: string[] }>,
  out: Map<string, string>,
  rootDependencies: string[]
): Promise<string> => {
  const layers: string[] = []
  for (const c of node.children) {
    layers.push(await buildLayersFromTree(c, resourcesByDir, out, rootDependencies))
  }

  const entry = resourcesByDir.get(node.rel) ?? { drones: [], deps: [] }

  const layer = {
    version: 1,
    name: node.rel.split('/').pop() || 'root',
    rel: node.rel,
    drones: uniqSorted(entry.drones),
    dependencies: node.rel ? [] : rootDependencies,
    layers: uniqSorted(layers),
  }

  const { sig, json } = await signJson(layer)
  out.set(sig, json)
  return sig
}

// -------------------------------------------------
// esbuild helpers
// -------------------------------------------------

const buildDevHierarchyFile = async (
  entry: string,
  outBaseName: string
): Promise<Uint8Array> => {
  const r = await build({
    entryPoints: [entry],
    bundle: false,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: TARGET,
    tsconfig: resolve(PROJECT_ROOT, 'tsconfig.json'),

    // keep a stable output label for diagnostics, but do not rely on it for lookup
    outfile: outBaseName,

    // inline maps for dev hierarchy (no .map files)
    sourcemap: 'inline',
    minify: false,
  })

  // do not search by path; inline sourcemaps change output paths
  const file = r.outputFiles?.find(f => f.path.endsWith('.js')) ?? r.outputFiles?.[0]
  if (!file) throw new Error(`no output: ${entry}`)

  return file.contents
}

const buildRuntime = async (
  alias: string,
  exportDevPaths: string[],
  allAliases: string[]
): Promise<Uint8Array> => {
  const lines = exportDevPaths
    .map(p => `export * from '${p}';`)
    .sort((a, b) => a.localeCompare(b))

  const entrySource = (lines.length ? lines.join('\n') + '\n' : `export {};\n`)

  const r = await build({
    stdin: {
      contents: entrySource,
      sourcefile: `virtual:${alias}`,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: TARGET,
    tsconfig: resolve(PROJECT_ROOT, 'tsconfig.json'),
    external: [
      ...PLATFORM_EXTERNALS,
      ...allAliases.filter(a => a !== alias),
      '/dev/*',
    ],
    sourcemap: 'inline',
    minify: false,
  })

  const compiled = r.outputFiles?.[0]?.text
  if (!compiled) throw new Error(`no output: ${alias}`)

  return textToBytes(`// ${alias}\n${compiled}`)
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
    sourcemap: 'inline',
    minify: false,
  })

  const compiled = r.outputFiles?.[0]?.text
  if (!compiled) throw new Error(`no output: ${entry}`)

  const file = entry.replace(/\\/g, '/').split('/').pop() ?? ''
  const label = file.replace(/\.drone\.(ts|js)$/, '')
  const meta = `// @hypercomb ${JSON.stringify({ label, kind: 'drone', lang: 'js' })}\n`

  return textToBytes(meta + compiled)
}

// -------------------------------------------------
// manifest (single)
// -------------------------------------------------

const writeManifest = (
  outDir: string,
  imports: Record<string, string>,
  domains: string[],
  resources: Record<string, string[]>,
  root: string
): void => {
  writeFileSync(
    join(outDir, 'name.manifest.js'),
    `// auto-generated\n` +
      `export const imports = ${JSON.stringify(imports, null, 2)}\n` +
      `export const domains = ${JSON.stringify(domains, null, 2)}\n` +
      `export const resources = ${JSON.stringify(resources, null, 2)}\n` +
      `export const root = ${JSON.stringify(root)}\n`,
    'utf8'
  )
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

  const resourcesByDir = new Map<string, { drones: string[]; deps: string[] }>()
  const runtimeBytes = new Map<string, Uint8Array>() // sig -> bytes
  const droneBytes = new Map<string, Uint8Array>()   // sig -> bytes
  const layers = new Map<string, string>()           // sig -> json

  const manifestImports: Record<string, string> = {}
  const domainSet = new Set<string>()
  const devDomainRes = new Map<string, Set<string>>() // domain -> drone sigs

  // -----------------------------
  // dev hierarchy (real files)
  // - includes dependencies and drones
  // - inline sourcemaps (no .map files)
  // -----------------------------

  for (const src of sources) {
    const relJsPath = `${stripExt(src.relPath)}.js` // domain/folder/file(.drone).js
    const absOutJs = join(DEV_ROOT, relJsPath)
    ensureDir(dirname(absOutJs))

    const outBase =
      `${src.relPath.replace(/\\/g, '/').split('/').pop()!.replace(/\.(ts|js)$/, '')}.js`

    const bytes = await buildDevHierarchyFile(src.entry, outBase)
    writeFileSync(absOutJs, bytes)

    domainSet.add(domainFromRelPath(src.relPath))
  }

  // -----------------------------
  // runtimes (signature-only in __dependencies__)
  // - one runtime per folder with direct dependency files
  // -----------------------------

  const deps = sources.filter(s => s.kind === 'dependency')

  const dirToMembers = new Map<string, SourceFile[]>()
  for (const src of deps) {
    const list = dirToMembers.get(src.relDir) ?? []
    list.push(src)
    dirToMembers.set(src.relDir, list)
  }

  const allRuntimeDirs = Array.from(dirToMembers.keys())
    .filter(relDir => {
      const parts = splitPath(relDir)
      if (!parts.length) return false
      if (!EMIT_DOMAIN_ROOT_NAMESPACE && parts.length === 1) return false
      return true
    })
    .sort((a, b) => a.localeCompare(b))

  const allAliases = allRuntimeDirs.map(relDir => `@${relDir}`)

  for (const relDir of allRuntimeDirs) {
    const members =
      (dirToMembers.get(relDir) ?? []).slice().sort((a, b) => a.relPath.localeCompare(b.relPath))

    const alias = `@${relDir}`

    const exportDevPaths = members.map(m => `/dev/${stripExt(m.relPath)}.js`)
    const bytes = await buildRuntime(alias, exportDevPaths, allAliases)
    const sig = await SignatureService.sign(toArrayBuffer(bytes))

    runtimeBytes.set(sig, bytes)
    addToBucket(resourcesByDir, relDir, jsFileName(sig), 'dep')

    const domain = domainFromRelPath(relDir)
    domainSet.add(domain)

    const devDepsDir = join(DEV_ROOT, domain, DEP_DIR)
    ensureDir(devDepsDir)
    writeSigJsFile(devDepsDir, sig, bytes)

    manifestImports[alias] = `/dev/${domain}/${DEP_DIR}/${jsFileName(sig)}`
  }

  const rootDependencies = uniqSorted(Array.from(runtimeBytes.keys()).map(jsFileName))

  // -----------------------------
  // drones (signature-only in __drones__)
  // -----------------------------

  const droneExternals = [...PLATFORM_EXTERNALS, ...allAliases, '/dev/*']

  for (const src of sources.filter(s => s.kind === 'drone')) {
    const bytes = await buildDrone(src.entry, droneExternals)
    const sig = await SignatureService.sign(toArrayBuffer(bytes))

    droneBytes.set(sig, bytes)
    addToBucket(resourcesByDir, src.relDir, jsFileName(sig), 'drone')

    const domain = domainFromRelPath(src.relPath)
    domainSet.add(domain)

    const devDronesDir = join(DEV_ROOT, domain, DRONES_DIR)
    ensureDir(devDronesDir)
    writeSigJsFile(devDronesDir, sig, bytes)

    const set = devDomainRes.get(domain) ?? new Set<string>()
    set.add(sig)
    devDomainRes.set(domain, set)
  }

  // -----------------------------
  // layers (prod + dev)
  // -----------------------------

  const tree = readDirTree(SRC_ROOT, '')
  const rootLayerSig = await buildLayersFromTree(tree, resourcesByDir, layers, rootDependencies)

  for (const domain of Array.from(domainSet).sort((a, b) => a.localeCompare(b))) {
    const domainTree = readDirTree(SRC_ROOT, domain)
    const devLayers = new Map<string, string>()
    await buildLayersFromTree(domainTree, resourcesByDir, devLayers, rootDependencies)

    const devLayersDir = join(DEV_ROOT, domain, LAYERS_DIR)
    ensureDir(devLayersDir)

    for (const [sig, json] of devLayers) writeLayerJsonFile(devLayersDir, sig, json)

    const rootJson = layers.get(rootLayerSig)
    if (rootJson) writeLayerJsonFile(devLayersDir, rootLayerSig, rootJson)
  }

  // -----------------------------
  // prod package (everything under dist/<rootLayerSig>/)
  // -----------------------------

  const prodRoot = join(DIST_ROOT, rootLayerSig)
  const prodDeps = join(prodRoot, DEP_DIR)
  const prodDrones = join(prodRoot, DRONES_DIR)
  const prodLayers = join(prodRoot, LAYERS_DIR)

  ensureDir(prodDeps)
  ensureDir(prodDrones)
  ensureDir(prodLayers)

  for (const [sig, bytes] of runtimeBytes) writeSigJsFile(prodDeps, sig, bytes)
  for (const [sig, bytes] of droneBytes) writeSigJsFile(prodDrones, sig, bytes)
  for (const [sig, json] of layers) writeLayerJsonFile(prodLayers, sig, json)

  writeFileSync(join(prodRoot, 'root.txt'), `${rootLayerSig}\n`, 'utf8')

  // -----------------------------
  // single manifest (dev root)
  // -----------------------------

  const domains = Array.from(domainSet).sort((a, b) => a.localeCompare(b))

  const devResourcesByDomain: Record<string, string[]> = {}
  for (const domain of domains) {
    devResourcesByDomain[domain] = Array.from(devDomainRes.get(domain) ?? []).map(jsFileName).sort()
  }

  writeManifest(DEV_ROOT, manifestImports, domains, devResourcesByDomain, rootLayerSig)

  // -----------------------------
  // deploy
  // -----------------------------

  const ps1 = resolve(__dirname, 'deploy-azure.ps1')
  if (existsSync(ps1)) {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Signature', rootLayerSig],
      { stdio: 'inherit' }
    )
    if (r.status !== 0) throw new Error('deployment failed')
  }

  // -----------------------------
  // update signal
  // -----------------------------

  writeBuildStamp()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
