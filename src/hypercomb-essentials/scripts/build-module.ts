// hypercomb-essentials/scripts/build-module.ts
// hypercomb-essentials/scripts/build-module.ts
// MINIMAL UPGRADE:
// - exclude *.keys.ts / *.keys.js at discovery time
// - add install.manifest.json at dist/<rootSignature>/install.manifest.json with only signatures (no root field)
// - nothing else changed (deploy, layers, signing untouched)

import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, extname, join, relative, resolve } from 'path'
import { build } from 'esbuild'
import { SignatureService } from '@hypercomb/core'

// ── layer v2 types + helpers (inlined from @hypercomb/core/layer) ──

type LayerV2 = {
  v: 2
  lineage: string
  bees: string
  deps: string
  resources: string
  children: string
}

const computeLineageSig = async (segments: string[]): Promise<string> =>
  SignatureService.sign(toArrayBuffer(textToBytes(JSON.stringify(segments))))

const computeListSig = async (sigs: string[]): Promise<string> => {
  const content = [...sigs].sort().join('\n')
  return SignatureService.sign(toArrayBuffer(textToBytes(content)))
}

const listResourceContent = (sigs: string[]): string =>
  [...sigs].sort().join('\n')

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

const TARGET = 'es2022'

// domains to exclude from the build output
const EXCLUDED_DOMAINS: string[] = ['revolucionstyle.com']
const NAMESPACE_SEGMENTS_MAX = 3
const PLATFORM_EXTERNALS = ['@hypercomb/core', 'pixi.js']

// hard rule: never generate @<domain> root aggregator
const EMIT_DOMAIN_ROOT_NAMESPACE = false

// new: minimal manifest name
const INSTALL_MANIFEST_FILE = 'install.manifest.json'

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

// exclude key-only files from artifact pipeline
const isKeysFile = (f: string): boolean =>
  f.endsWith('.keys.ts') || f.endsWith('.keys.js') || f.endsWith('-keys.ts') || f.endsWith('-keys.js')

const isBee = (f: string): boolean =>
  f.endsWith('.drone.ts') || f.endsWith('.drone.js') || f.endsWith('.worker.ts') || f.endsWith('.worker.js')

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
  map: Map<string, { bees: string[]; deps: string[] }>,
  relDir: string,
  fileName: string,
  kind: 'dep' | 'bee'
): void => {
  const bucket = map.get(relDir) ?? { bees: [], deps: [] }
  if (kind === 'dep') bucket.deps.push(fileName)
  else bucket.bees.push(fileName)
  map.set(relDir, bucket)
}

// -------------------------------------------------
// discovery
// -------------------------------------------------

type SourceFile = {
  entry: string
  relPath: string
  relDir: string
  kind: 'dependency' | 'bee'
}

const discoverSources = (): SourceFile[] =>
  walkFiles(SRC_ROOT)
    .filter(isSource)
    .filter(f => !isKeysFile(f))
    .filter(f => {
      const relPath = relPosix(SRC_ROOT, f)
      if (relPath === 'types' || relPath.startsWith('types/')) return false
      const domain = relPath.split('/')[0]
      if (EXCLUDED_DOMAINS.includes(domain)) return false
      if (isEntry(relPath)) return false
      const relDir = relPosix(SRC_ROOT, dirname(f))
      if (!relDir) return false
      return true
    })
    .map(file => ({
      entry: file,
      relPath: relPosix(SRC_ROOT, file),
      relDir: relPosix(SRC_ROOT, dirname(file)),
      kind: isBee(file) ? 'bee' : 'dependency',
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
    if (!rel && EXCLUDED_DOMAINS.includes(name)) continue
    const child = join(full, name)
    if (statSync(child).isDirectory()) {
      children.push(readDirTree(root, rel ? `${rel}/${name}` : name))
    }
  }
  return { rel, children }
}

/**
 * Build v2 layers from the directory tree.
 *
 * Each directory node becomes a layer with 5 typed fields (lineage, bees,
 * deps, resources, children). Each field is a content-addressed signature
 * pointing to a sorted list stored in __resources__/.
 *
 * Children are referenced by lineage sig (not layer sig) — no Merkle cascade.
 * Returns the lineage sig for this node (used by parent's children list).
 */
const buildLayersV2FromTree = async (
  node: DirNode,
  resourcesByDir: Map<string, { bees: string[]; deps: string[] }>,
  listResources: Map<string, string>,
  lineageResources: Map<string, string>,
  history: Map<string, LayerV2>,
  rootDepSigs: string[]
): Promise<string> => {
  const segments = node.rel ? splitPath(node.rel) : []
  const lineageSig = await computeLineageSig(segments)
  lineageResources.set(lineageSig, JSON.stringify(segments))

  // process children first (bottom-up), collecting their lineage sigs
  const childLineageSigs: string[] = []
  for (const child of node.children) {
    childLineageSigs.push(
      await buildLayersV2FromTree(child, resourcesByDir, listResources, lineageResources, history, rootDepSigs)
    )
  }

  // bees at this node (strip .js from bucket entries)
  const entry = resourcesByDir.get(node.rel) ?? { bees: [], deps: [] }
  const beeSigs = uniqSorted(entry.bees.map(b => b.replace(/\.js$/i, '')))

  // deps: only root layer carries dependencies
  const depSigs = node.rel === '' ? rootDepSigs : []

  // resources: none at build time (static assets TBD)
  const resourceSigs: string[] = []

  // compute and store list resources
  const beesListSig = await computeListSig(beeSigs)
  listResources.set(beesListSig, listResourceContent(beeSigs))

  const depsListSig = await computeListSig(depSigs)
  listResources.set(depsListSig, listResourceContent(depSigs))

  const resourcesListSig = await computeListSig(resourceSigs)
  listResources.set(resourcesListSig, listResourceContent(resourceSigs))

  const childrenListSig = await computeListSig(childLineageSigs)
  listResources.set(childrenListSig, listResourceContent(childLineageSigs))

  const layer: LayerV2 = {
    v: 2,
    lineage: lineageSig,
    bees: beesListSig,
    deps: depsListSig,
    resources: resourcesListSig,
    children: childrenListSig,
  }

  history.set(lineageSig, layer)
  return lineageSig
}

// -------------------------------------------------
// build helpers
// -------------------------------------------------

const buildNamespaceDependency = async (
  namespaceRelDir: string,
  directMemberFiles: SourceFile[],
  allNamespaceSpecifiers: string[]
): Promise<{ sig: string; bytes: Uint8Array } | null> => {
  const namespaceSpecifier = specifierFromNamespaceRelDir(namespaceRelDir)
  const namespaceRootFs = join(SRC_ROOT, namespaceRelDir)
  const resolveDir = existsSync(namespaceRootFs) ? namespaceRootFs : SRC_ROOT

  const exportLines = directMemberFiles
    .map(f => {
      const relFromNs = relPosix(namespaceRootFs, f.entry)
      const relNoExt = stripExt(relFromNs)
      const spec = relNoExt.startsWith('.') ? relNoExt : `./${relNoExt}`
      return `export * from '${spec}';`
    })
    .sort()

  const entrySource = exportLines.length ? exportLines.join('\n') + '\n' : 'export {};\n'

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
    sourcemap: 'inline',
    tsconfig: resolve(PROJECT_ROOT, 'tsconfig.json'),
    external: externals,
  })

  const compiled = r.outputFiles?.[0]?.text
  if (!compiled || compiled.trim().length === 0) {
    console.log(`[build-module] skipping empty namespace: ${namespaceSpecifier}`)
    return null
  }

  const bytes = textToBytes(`// ${namespaceSpecifier}\n${compiled}`)
  const sig = await SignatureService.sign(toArrayBuffer(bytes))
  return { sig, bytes }
}

const buildBee = async (entry: string, externals: string[]): Promise<Uint8Array> => {
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: TARGET,
    sourcemap: 'inline',
    tsconfig: resolve(PROJECT_ROOT, 'tsconfig.json'),
    external: externals,
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
  ensureDir(DIST_ROOT)

  const sources = discoverSources()
  if (!sources.length) throw new Error('no sources found')

  const resourcesByDir = new Map<string, { bees: string[]; deps: string[] }>()
  const dependencyBytes = new Map<string, Uint8Array>()
  const resourceBytes = new Map<string, Uint8Array>()

  // dependencies
  const deps = sources.filter(s => s.kind === 'dependency')
  const namespaceToMembers = new Map<string, SourceFile[]>()
  const nsDerived = new Set<string>()

  for (const src of deps) {
    const ns = namespaceRelDirFromRelDir(src.relDir)
    nsDerived.add(ns)
    const list = namespaceToMembers.get(ns) ?? []
    list.push(src)
    namespaceToMembers.set(ns, list)
  }

  const nsAll = new Set<string>()
  for (const ns of nsDerived) {
    for (const p of prefixesForNamespaceRelDir(ns)) nsAll.add(p)
  }

  const allNs = Array.from(nsAll).sort()
  const allSpecifiers = allNs.map(specifierFromNamespaceRelDir)

  for (const ns of allNs) {
    const members = namespaceToMembers.get(ns) ?? []
    const built = await buildNamespaceDependency(ns, members, allSpecifiers)
    if (!built) continue
    dependencyBytes.set(built.sig, built.bytes)
    addToBucket(resourcesByDir, ns, jsFileName(built.sig), 'dep')
    for (const f of members) addToBucket(resourcesByDir, f.relDir, jsFileName(built.sig), 'dep')
  }

  const dependencySigs = Array.from(dependencyBytes.keys()).sort((a, b) => a.localeCompare(b))

  // class-to-dep reverse index: scan each namespace bundle for exported class names
  const classToDepSig = new Map<string, string>()
  for (const [sig, bytes] of dependencyBytes) {
    const text = new TextDecoder().decode(bytes)
    for (const m of text.matchAll(/(?:var\s+(\w+)\s*=\s*class|class\s+(\w+))/g)) {
      const name = m[1] || m[2]
      if (name) classToDepSig.set(name, sig)
    }
  }
  console.log(`[build-module] class-to-dep index: ${classToDepSig.size} classes across ${dependencyBytes.size} namespaces`)

  // bees — extract deps from compiled output and map to dep sigs
  const beeDepsMap = new Map<string, string[]>()
  const beeExternals = [...PLATFORM_EXTERNALS, ...allSpecifiers]
  for (const src of sources.filter(s => s.kind === 'bee')) {
    const bytes = await buildBee(src.entry, beeExternals)
    const sig = await SignatureService.sign(toArrayBuffer(bytes))
    resourceBytes.set(sig, bytes)
    addToBucket(resourcesByDir, src.relDir, jsFileName(sig), 'bee')

    // Extract deps = { ... } from compiled output, map IoC keys to dep sigs
    const text = new TextDecoder().decode(bytes)
    const depSigs = new Set<string>()
    const depsMatch = text.match(/deps\s*=\s*\{([^}]+)\}/)
    if (depsMatch) {
      for (const m of depsMatch[1].matchAll(/@[^"'/]+\/(\w+)/g)) {
        const cls = m[1]
        if (cls && classToDepSig.has(cls)) depSigs.add(classToDepSig.get(cls)!)
      }
    }
    if (depSigs.size) {
      beeDepsMap.set(sig, [...depSigs].sort())
      const relName = src.relPath.split('/').pop() ?? src.relPath
      console.log(`[build-module] ${relName} → ${depSigs.size} dep(s)`)
    }
  }

  // v2 layers (history snapshots + list resources)
  const listResources = new Map<string, string>()
  const lineageResources = new Map<string, string>()
  const history = new Map<string, LayerV2>()
  const rootDepSigs = Array.from(dependencyBytes.keys()).sort((a, b) => a.localeCompare(b))

  const tree = readDirTree(SRC_ROOT, '')
  await buildLayersV2FromTree(tree, resourcesByDir, listResources, lineageResources, history, rootDepSigs)

  // build v2 manifest
  const allResourceSigs = uniqSorted([...listResources.keys(), ...lineageResources.keys()])
  const historyEntries: Record<string, LayerV2> = {}
  for (const [lineageSig, layer] of history) historyEntries[lineageSig] = layer

  const installManifest = {
    version: 2,
    bees: Array.from(resourceBytes.keys()).sort((a, b) => a.localeCompare(b)),
    dependencies: dependencySigs,
    resources: allResourceSigs,
    history: historyEntries,
    beeDeps: Object.fromEntries(beeDepsMap),
  }

  // root sig = hash of manifest (changes when ANY content changes)
  const manifestJson = JSON.stringify(installManifest)
  const rootSig = await SignatureService.sign(toArrayBuffer(textToBytes(manifestJson)))

  // write package
  const rootDir = join(DIST_ROOT, rootSig)
  const beesDir = join(rootDir, '__bees__')
  const depDir  = join(rootDir, '__dependencies__')
  const resDir  = join(rootDir, '__resources__')

  ensureDir(beesDir)
  ensureDir(depDir)
  ensureDir(resDir)

  for (const [sig, bytes] of dependencyBytes) writeSigJsFile(depDir, sig, bytes)
  for (const [sig, bytes] of resourceBytes) writeSigJsFile(beesDir, sig, bytes)

  // write list resources and lineage resources (plain text, no .js extension)
  for (const [sig, content] of listResources) {
    if (!isSig(sig)) throw new Error(`invalid list resource sig: ${sig}`)
    writeFileSync(join(resDir, sig), content, 'utf8')
  }
  for (const [sig, content] of lineageResources) {
    if (!isSig(sig)) throw new Error(`invalid lineage resource sig: ${sig}`)
    writeFileSync(join(resDir, sig), content, 'utf8')
  }

  writeFileSync(join(rootDir, INSTALL_MANIFEST_FILE), manifestJson + '\n', 'utf8')

  // deploy (skip with --local flag)
  const skipDeploy = process.argv.includes('--local')
  if (skipDeploy) {
    console.log(`[build-module] --local: skipping Azure deploy`)
    console.log(`[build-module] root signature: ${rootSig}`)
    console.log(`[build-module] output: ${rootDir}`)
  } else {
    const ps1 = resolve(__dirname, 'deploy-azure.ps1')
    if (existsSync(ps1)) {
      const r = spawnSync(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Signature', rootSig],
        { stdio: 'inherit' }
      )
      if (r.status !== 0) throw new Error('deployment failed')
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
