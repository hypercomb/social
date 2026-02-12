// hypercomb-essentials/scripts/build-module.ts

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
const NAMESPACE_SEGMENTS_MAX = 3
const PLATFORM_EXTERNALS = ['@hypercomb/core', 'pixi.js']

// hard rule: never generate @<domain> root aggregator
const EMIT_DOMAIN_ROOT_NAMESPACE = false

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
  (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts')

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

const jsFileName = (sig: string): string => `${sig}.js`

const writeSigJsFile = (dir: string, sig: string, bytes: Uint8Array): void => {
  if (!isSig(sig)) throw new Error(`invalid signature: ${sig}`)
  writeFileSync(join(dir, jsFileName(sig)), bytes)
}

// layer json is always written as <sig>.json to prevent vite from treating it as js
const layerFileName = (sig: string): string => `${sig}.json`

const writeLayerJsonFile = (dir: string, sig: string, json: string): void => {
  if (!isSig(sig)) throw new Error(`invalid signature: ${sig}`)
  writeFileSync(join(dir, layerFileName(sig)), json, 'utf8')
}

const splitPath = (p: string): string[] =>
  p.split('/').filter(Boolean)

const uniq = (xs: string[]): string[] => Array.from(new Set(xs))

const uniqSorted = (xs: string[]): string[] =>
  uniq(xs).sort((a, b) => a.localeCompare(b))

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

const domainFromNamespaceRelDir = (namespaceRelDir: string): string => {
  const parts = splitPath(namespaceRelDir)
  return parts[0] ?? ''
}

const prefixesForNamespaceRelDir = (nsRelDir: string): string[] => {
  const parts = splitPath(nsRelDir)
  const out: string[] = []

  const start = EMIT_DOMAIN_ROOT_NAMESPACE ? 1 : 2

  for (let i = start; i <= Math.min(parts.length, NAMESPACE_SEGMENTS_MAX); i++) {
    out.push(parts.slice(0, i).join('/'))
  }

  return out
}

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
    layers,
  }

  const { sig, json } = await signJson(layer)
  out.set(sig, json)
  return sig
}

// -------------------------------------------------
// build helpers (prod)
// -------------------------------------------------

const buildNamespaceDependency = async (
  namespaceRelDir: string,
  directMemberFiles: SourceFile[],
  allNamespaceSpecifiers: string[]
): Promise<{ sig: string; bytes: Uint8Array; namespaceSpecifier: string }> => {
  const namespaceSpecifier = specifierFromNamespaceRelDir(namespaceRelDir)

  const namespaceRootFs = join(SRC_ROOT, namespaceRelDir)
  const resolveDir = existsSync(namespaceRootFs) ? namespaceRootFs : SRC_ROOT

  const exportLocalLines = directMemberFiles
    .map(f => {
      const relFromNs = relPosix(namespaceRootFs, f.entry)
      const relNoExt = stripExt(relFromNs)
      const spec = relNoExt.startsWith('.') ? relNoExt : `./${relNoExt}`
      return `export * from '${spec}';`
    })
    .sort((a, b) => a.localeCompare(b))

  const entrySource =
    exportLocalLines.length > 0
      ? exportLocalLines.join('\n') + '\n'
      : `export {};\n`

  const externals = [
    ...PLATFORM_EXTERNALS,
    ...allNamespaceSpecifiers.filter(s => s !== namespaceSpecifier),
  ]

  const r = await build({
    stdin: {
      contents: entrySource,
      resolveDir,
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

  const withHeader = `// ${namespaceSpecifier}\n${compiled}`
  const bytes = textToBytes(withHeader)
  const sig = await SignatureService.sign(toArrayBuffer(bytes))

  return { sig, bytes, namespaceSpecifier }
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
// dev emitters
// -------------------------------------------------

const writeDevNameManifest = (
  imports: Record<string, string>,
  domains: string[],
  resources: Record<string, string[]>,
  root: string
): void => {
  const manifestFile = join(DEV_ROOT, 'name.manifest.js')
  writeFileSync(
    manifestFile,
    `// auto-generated by hypercomb-essentials/scripts/build-module.ts\n` +
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
  const dependencyBytes = new Map<string, Uint8Array>()
  const resourceBytes = new Map<string, Uint8Array>()
  const layers = new Map<string, string>()

  const devImports: Record<string, string> = {}
  const devDomainDeps = new Map<string, Set<string>>()
  const devDomainRes = new Map<string, Set<string>>()
  const devDomainNsToDepSig = new Map<string, Map<string, string>>()

  // -----------------------------
  // dependencies
  // -----------------------------

  const deps = sources.filter(s => s.kind === 'dependency')
  const namespaceToDirectMembers = new Map<string, SourceFile[]>()
  const nsDerived = new Set<string>()

  for (const src of deps) {
    const nsRelDir = namespaceRelDirFromRelDir(src.relDir)
    nsDerived.add(nsRelDir)
    const list = namespaceToDirectMembers.get(nsRelDir) ?? []
    list.push(src)
    namespaceToDirectMembers.set(nsRelDir, list)
  }

  const nsAllSet = new Set<string>()
  for (const nsRelDir of nsDerived) {
    for (const p of prefixesForNamespaceRelDir(nsRelDir)) nsAllSet.add(p)
  }

  const allNamespaceRelDirs = Array.from(nsAllSet)
    .filter(ns => EMIT_DOMAIN_ROOT_NAMESPACE || splitPath(ns).length >= 2)
    .sort((a, b) => a.localeCompare(b))

  const allNamespaceSpecifiers = allNamespaceRelDirs.map(specifierFromNamespaceRelDir)

  for (const nsRelDir of allNamespaceRelDirs) {
    const directMembers =
      namespaceToDirectMembers.get(nsRelDir)?.slice().sort((a, b) =>
        a.entry.localeCompare(b.entry)
      ) ?? []

    const built = await buildNamespaceDependency(nsRelDir, directMembers, allNamespaceSpecifiers)
    dependencyBytes.set(built.sig, built.bytes)

    addToBucket(resourcesByDir, nsRelDir, jsFileName(built.sig), 'dep')
    for (const f of directMembers) addToBucket(resourcesByDir, f.relDir, jsFileName(built.sig), 'dep')

    const domain = domainFromNamespaceRelDir(nsRelDir)
    if (!domain) continue

    const depSet = devDomainDeps.get(domain) ?? new Set<string>()
    depSet.add(built.sig)
    devDomainDeps.set(domain, depSet)

    const m = devDomainNsToDepSig.get(domain) ?? new Map<string, string>()
    m.set(nsRelDir, built.sig)
    devDomainNsToDepSig.set(domain, m)
  }

  const rootDependencies = uniqSorted(Array.from(dependencyBytes.keys()).map(jsFileName))

  // -----------------------------
  // drones
  // -----------------------------

  const droneExternals = [...PLATFORM_EXTERNALS, ...allNamespaceSpecifiers]
  for (const src of sources.filter(s => s.kind === 'drone')) {
    const bytes = await buildDrone(src.entry, droneExternals)
    const sig = await SignatureService.sign(toArrayBuffer(bytes))

    resourceBytes.set(sig, bytes)
    addToBucket(resourcesByDir, src.relDir, jsFileName(sig), 'drone')

    const domain = domainFromRelPath(src.relPath)
    if (!domain) continue
    const set = devDomainRes.get(domain) ?? new Set<string>()
    set.add(sig)
    devDomainRes.set(domain, set)
  }

  // -----------------------------
  // layers (prod)
  // -----------------------------

  const tree = readDirTree(SRC_ROOT, '')
  const rootLayerSig = await buildLayersFromTree(tree, resourcesByDir, layers, rootDependencies)

  // -----------------------------
  // write prod package
  // -----------------------------

  const rootDir = join(DIST_ROOT, rootLayerSig)
  const layersDir = join(rootDir, '__layers__')
  const resourcesDir = join(rootDir, '__drones__')
  const dependenciesDir = join(rootDir, '__dependencies__')

  ensureDir(layersDir)
  ensureDir(resourcesDir)
  ensureDir(dependenciesDir)

  for (const [sig, json] of layers) writeLayerJsonFile(layersDir, sig, json)
  for (const [sig, bytes] of dependencyBytes) writeSigJsFile(dependenciesDir, sig, bytes)
  for (const [sig, bytes] of resourceBytes) writeSigJsFile(resourcesDir, sig, bytes)

  // -----------------------------
  // write dev package
  // -----------------------------

  const devDomains = uniqSorted([
    ...Array.from(devDomainDeps.keys()),
    ...Array.from(devDomainRes.keys()),
  ])

  for (const domain of devDomains) {
    const domainDir = join(DEV_ROOT, domain)
    const devDepsDir = join(domainDir, '__dependencies__')
    const devResDir = join(domainDir, '__drones__')
    const devLayersDir = join(domainDir, '__layers__')

    ensureDir(domainDir)
    ensureDir(devDepsDir)
    ensureDir(devResDir)
    ensureDir(devLayersDir)

    for (const sig of Array.from(devDomainDeps.get(domain) ?? [])) {
      const bytes = dependencyBytes.get(sig)
      if (!bytes) throw new Error(`missing dependency bytes (${sig})`)
      writeSigJsFile(devDepsDir, sig, bytes)
    }

    for (const sig of Array.from(devDomainRes.get(domain) ?? [])) {
      const bytes = resourceBytes.get(sig)
      if (!bytes) throw new Error(`missing resource bytes (${sig})`)
      writeSigJsFile(devResDir, sig, bytes)
    }

    const domainTree = readDirTree(SRC_ROOT, domain)
    const devLayers = new Map<string, string>()
    await buildLayersFromTree(domainTree, resourcesByDir, devLayers, rootDependencies)
    for (const [sig, json] of devLayers) writeLayerJsonFile(devLayersDir, sig, json)

    writeLayerJsonFile(devLayersDir, rootLayerSig, layers.get(rootLayerSig)!)

    const nsToSig = devDomainNsToDepSig.get(domain) ?? new Map<string, string>()
    for (const [nsRelDir, depSig] of nsToSig) {
      if (!EMIT_DOMAIN_ROOT_NAMESPACE && splitPath(nsRelDir).length === 1) continue
      devImports[specifierFromNamespaceRelDir(nsRelDir)] =
        `/dev/${domain}/__dependencies__/${jsFileName(depSig)}`
    }
  }

  const devResourcesByDomain: Record<string, string[]> = {}
  for (const domain of devDomains) {
    devResourcesByDomain[domain] = Array.from(devDomainRes.get(domain) ?? []).map(jsFileName).sort()
  }

  writeDevNameManifest(devImports, devDomains, devResourcesByDomain, rootLayerSig)

  const ps1 = resolve(__dirname, 'deploy-azure.ps1')
  if (existsSync(ps1)) {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Signature', rootLayerSig],
      { stdio: 'inherit' }
    )
    if (r.status !== 0) throw new Error('deployment failed')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
