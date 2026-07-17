// hypercomb-essentials/scripts/build-module.ts
//
// DELIVERY LAYOUT (flat — no typed `__x__` dirs, ever):
//   dist/manifest.json      package entry keyed by rootLayerSig; its
//                           layers[]/bees[]/dependencies[] arrays carry the
//                           KIND of every sig (the flat files don't)
//   dist/<sig>              every layer (JSON bytes), bee (JS bytes) and
//                           namespace dependency (JS bytes) as a bare
//                           sig-named file at the dist root
//   dist/<bagSig>/0000…     the two sigbags (dependencies, bees) — dirs
//                           named by bag sig, discovered ONLY via the
//                           manifest's dependenciesBag/beesBag fields
//   dist/.cache/            build cache — never copied or deployed
// Consumers fetch `<base>/<sig>` flat-first and fall back to the legacy
// `__layers__/<sig>.json` | `__bees__/<sig>.js` | `__dependencies__/<sig>.js`
// URL shapes only for OLD deployed content (live Azure stays old-layout
// until redeployed; those legacy blobs are never deleted).

import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, extname, join, relative, resolve } from 'path'
import { build } from 'esbuild'

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

// -------------------------------------------------
// ensure @hypercomb/core is built
// -------------------------------------------------

const CORE_DIST = resolve(PROJECT_ROOT, '..', 'hypercomb-core', 'dist', 'index.js')
if (!existsSync(CORE_DIST)) {
  console.log('⚙ @hypercomb/core not built — building now…')
  const r = spawnSync('npm', ['run', 'build'], {
    cwd: resolve(PROJECT_ROOT, '..', 'hypercomb-core'),
    stdio: 'inherit',
    shell: true,
  })
  if (r.status !== 0) throw new Error('@hypercomb/core build failed')
}

const { SignatureService } = await import('@hypercomb/core')

const TARGET = 'es2022'

// domains to exclude from the build output
const EXCLUDED_DOMAINS: string[] = ['revolucionstyle.com']
const NAMESPACE_SEGMENTS_MAX = 3
const PLATFORM_EXTERNALS = ['@hypercomb/core', 'pixi.js']

// hard rule: never generate @<domain> root aggregator
const EMIT_DOMAIN_ROOT_NAMESPACE = false

// content manifest (replaces latest.json — supports multiple entry points)
const MANIFEST_FILE = 'manifest.json'

// Genesis label for a freshly built package. This is a STABLE sidecar handle —
// the current git branch (or 'genesis' outside a repo) — NOT a timestamp, so a
// rebuild of identical content keeps manifest.json byte-identical and the
// skip-write below still fires. The deploy step (deploy-azure.ps1) is what
// chains "<previous>-updated-<stamp>" against the remote manifest; locally we
// just stamp the branch. The label never enters rootLayerSig (see the manifest
// comment below) — it is discovery metadata, not part of the package identity.
const resolveGenesisLabel = (): string => {
  try {
    const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' })
    const branch = (r.status === 0 ? r.stdout : '').trim()
    return branch && branch !== 'HEAD' ? branch : 'genesis'
  } catch {
    return 'genesis'
  }
}

// -------------------------------------------------
// build cache — Merkle tree with mtime pre-filter
// -------------------------------------------------

/** Leaf: per-source-file mtime + content hash */
interface FileLeaf { mtime: number; sig: string }

/** Namespace or bee compilation unit cache */
interface UnitCache {
  files: Record<string, FileLeaf>   // relPath → { mtime, sig }
  inputSig: string                  // Merkle hash of all file sigs + entry source
  outputSig: string                 // SHA-256 of compiled output
}

/** Cached layer: input components → layer signature + JSON */
interface LayerCacheEntry {
  inputSig: string     // hash of (beeSigs + depSigs + childLayerSigs + docs)
  layerSig: string     // signature of the output layer JSON
  layerJson: string    // the JSON itself
}

/** Cached bee doc extraction */
interface DocCacheEntry {
  contentSignature: string   // hash of source file content
  doc: BeeDocEntry | null
}

/** Cached bee dependency mapping */
interface BeeDepCacheEntry {
  outputSig: string     // signature of compiled bee output
  depSigs: string[]     // resolved dependency signatures
}

// version 4 = flat delivery layout (bare sig files at the dist root).
// The bump busts every version-3 cache so the first post-flip build can
// never take the "Merkle root unchanged" early exit and re-deploy a dist
// that still holds the typed `__x__` layout.
interface BuildCache {
  version: 4
  rootHash: string                            // Merkle root of all unit hashes
  rootLayerSig: string                        // last output root signature
  namespaces: Record<string, UnitCache>
  bees: Record<string, UnitCache>
  layerCache?: Record<string, LayerCacheEntry>
  docCache?: Record<string, DocCacheEntry>
  beeDepCache?: Record<string, BeeDepCacheEntry>
}

const CACHE_FILE = join(PROJECT_ROOT, '.build-cache.json')
const OUTPUT_CACHE_DIR = join(DIST_ROOT, '.cache')

const loadCache = (): BuildCache | null => {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
    if (raw?.version === 4) return raw
  } catch {}
  return null
}

const saveCache = (c: BuildCache): void =>
  writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2), 'utf8')

/**
 * For each file: if mtime matches cache, reuse cached sig.
 * Otherwise read + hash the file (and record new mtime).
 * Returns the per-file leaves and a combined inputSig (Merkle node).
 */
const resolveUnitInputs = async (
  files: string[],
  cachedFiles: Record<string, FileLeaf> | undefined,
  extra?: string
): Promise<{ leaves: Record<string, FileLeaf>; inputSig: string; changed: boolean }> => {
  const sorted = [...files].sort()
  const leaves: Record<string, FileLeaf> = {}
  let changed = false
  const sigParts: string[] = []

  for (const f of sorted) {
    const relKey = f  // absolute path as key
    const st = statSync(f)
    const mtime = st.mtimeMs
    const prev = cachedFiles?.[relKey]

    if (prev && prev.mtime === mtime) {
      // mtime match — trust cached content hash, skip file read
      leaves[relKey] = prev
      sigParts.push(prev.sig)
    } else {
      // mtime changed or no cache — read + hash
      const content = readFileSync(f, 'utf8')
      const sig = await SignatureService.sign(toArrayBuffer(textToBytes(content)))
      leaves[relKey] = { mtime, sig }
      changed = changed || (prev?.sig !== sig)  // content actually changed?
      sigParts.push(sig)
    }
  }

  if (extra) sigParts.push(extra)

  // Merkle node = hash of concatenated child sigs
  const inputSig = await SignatureService.sign(
    toArrayBuffer(textToBytes(sigParts.join(':')))
  )

  // If we had no previous cache at all, it's changed
  if (!cachedFiles) changed = true
  // If the combined sig differs from what we'd compute, mark changed
  // (handles case where mtime changed but content didn't — still need to check inputSig)

  return { leaves, inputSig, changed }
}

/**
 * Compute Merkle root from all unit inputSigs.
 */
const computeRootHash = async (unitSigs: string[]): Promise<string> =>
  SignatureService.sign(toArrayBuffer(textToBytes(unitSigs.sort().join(':'))))

// -------------------------------------------------
// helpers
// -------------------------------------------------

const ensureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true })
}

const deployToAzure = (): void => {
  if (process.argv.includes('--local')) return

  const ps1 = resolve(__dirname, 'deploy-azure.ps1')
  if (!existsSync(ps1)) return

  // PowerShell binary name differs by platform: Windows ships `powershell`
  // (Windows PowerShell 5.1) and may also have `pwsh` (PowerShell 7+);
  // Linux/macOS only have `pwsh`. Pick the one that exists so the same
  // script works in CI (Ubuntu runners) and on developer Windows boxes.
  // `-NonInteractive` suppresses console-title operations that fail when
  // running under npm/tsx without a real TTY.
  const psBinary = process.platform === 'win32' ? 'powershell' : 'pwsh'

  const result = spawnSync(
    psBinary,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
    { stdio: 'inherit' }
  )

  if (result.status !== 0) throw new Error('deployment failed')
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

// exclude test files from artifact pipeline. spec files import vitest;
// when bundled into a namespace dep and loaded in the browser, vitest
// throws "failed to find the runner" at the first beforeEach call,
// crashing every consumer of that namespace. selftest files are NODE
// harnesses (run via tsx) that execute their whole suite at module load
// and may call process.exit — bundling the arkanoid selftest into the
// games/arkanoid namespace dep made the bare `process` throw at import
// time in the browser and took the whole dependency down (the 2026-07-16
// "ReferenceError: process is not defined" dependency-loader failure).
const isSpecFile = (f: string): boolean =>
  f.endsWith('.spec.ts') || f.endsWith('.spec.js') ||
  f.endsWith('.test.ts') || f.endsWith('.test.js') ||
  f.endsWith('selftest.ts') || f.endsWith('selftest.js')

// exclude key-only files from artifact pipeline
const isKeysFile = (f: string): boolean => {
  if (f.endsWith('.keys.ts') || f.endsWith('.keys.js') || f.endsWith('-keys.ts') || f.endsWith('-keys.js')) return true
  const base = f.replace(/\\/g, '/').split('/').pop() ?? ''
  return base === 'essentials-keys.ts' || base === 'essentials-keys.js'
}

const isBee = (f: string): boolean =>
  f.endsWith('.drone.ts') || f.endsWith('.drone.js') || f.endsWith('.worker.ts') || f.endsWith('.worker.js')

const isEntry = (f: string): boolean =>
  f.endsWith('.entry.ts') || f.endsWith('.entry.js')

const isIndexFile = (f: string): boolean => {
  const base = f.replace(/\\/g, '/').split('/').pop() ?? ''
  return base === 'index.ts' || base === 'index.js'
}

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

// -------------------------------------------------
// bee doc extraction (from TypeScript source)
// -------------------------------------------------

interface BeeDocEntry {
  className: string
  kind: 'drone' | 'worker' | 'queen' | 'bee'
  description: string
  effects: string[]
  listens: string[]
  emits: string[]
  deps: Record<string, string>
  grammar: { example: string; meaning?: string }[]
  links: { label: string; url: string; purpose?: string }[]
  command: string | null
  aliases: string[]
}

const extractBeeDoc = (sourceText: string): BeeDocEntry | null => {
  // class name + kind from extends clause
  const classMatch = sourceText.match(
    /export\s+class\s+(\w+)\s+extends\s+(QueenBee|Worker|Drone|Bee)\b/
  )
  if (!classMatch) return null

  const className = classMatch[1]
  const extendsName = classMatch[2]
  const kind: BeeDocEntry['kind'] =
    extendsName === 'QueenBee' ? 'queen'
    : extendsName === 'Drone' ? 'drone'
    : extendsName === 'Worker' ? 'worker'
    : 'bee'

  // description — single-line or multi-line string literal
  const descMatch = sourceText.match(
    /(?:override\s+)?description\s*=\s*\n?\s*['"`]([^'"`]+)['"`]/
  )

  // effects array
  const effectsMatch = sourceText.match(
    /(?:override\s+)?effects\s*=\s*\[([^\]]*)\]/
  )
  const effects = effectsMatch
    ? [...effectsMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
    : []

  // listens array (may span multiple lines)
  const listensMatch = sourceText.match(
    /(?:override\s+)?listens\s*=\s*\[([\s\S]*?)\]/
  )
  const listens = listensMatch
    ? [...listensMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
    : []

  // emits array (may span multiple lines)
  const emitsMatch = sourceText.match(
    /(?:override\s+)?emits\s*=\s*\[([\s\S]*?)\]/
  )
  const emits = emitsMatch
    ? [...emitsMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
    : []

  // deps object (may span multiple lines)
  const depsMatch = sourceText.match(
    /(?:override\s+)?deps\s*=\s*\{([\s\S]*?)\}/
  )
  const deps: Record<string, string> = {}
  if (depsMatch) {
    for (const m of depsMatch[1].matchAll(/(\w+)\s*:\s*['"]([^'"]+)['"]/g)) {
      deps[m[1]] = m[2]
    }
  }

  // queen: command
  const cmdMatch = sourceText.match(
    /(?:readonly\s+)?command\s*=\s*['"]([^'"]+)['"]/
  )

  // queen: aliases
  const aliasMatch = sourceText.match(
    /(?:override\s+)?(?:readonly\s+)?aliases\s*=\s*\[([^\]]*)\]/
  )
  const aliases = aliasMatch
    ? [...aliasMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
    : []

  return {
    className,
    kind,
    description: descMatch?.[1]?.trim() ?? '',
    effects,
    listens,
    emits,
    deps,
    grammar: [],
    links: [],
    command: cmdMatch?.[1] ?? null,
    aliases,
  }
}

// `.js`-suffixed refs INSIDE layer JSON (bees/dependencies fields) are a
// wire-format legacy consumers already normalise away (`bare()` below and in
// every fetcher). Kept so layer sigs don't churn; on-disk names are bare.
const jsFileName = (sig: string): string => `${sig}.js`

// Flat emission: every content file is a BARE sig-named file at the dist
// root — no extension, no typed dir. Kind travels in the manifest.
const writeSigFile = (dir: string, sig: string, bytes: Uint8Array | string): void => {
  if (!isSig(sig)) throw new Error(`invalid signature: ${sig}`)
  writeFileSync(join(dir, sig), bytes)
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
    .filter(f => !isSpecFile(f))
    .filter(f => !isKeysFile(f))
    .filter(f => !isIndexFile(f))
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

const signJson = async (value: unknown) => {
  const json = JSON.stringify(value)
  const sig = await SignatureService.sign(toArrayBuffer(textToBytes(json)))
  return { sig, json }
}

// beeline caches populated during build, persisted at end
const newLayerCache: Record<string, LayerCacheEntry> = {}
const newDocCache: Record<string, DocCacheEntry> = {}
const newBeeDepCache: Record<string, BeeDepCacheEntry> = {}
let layerCacheHits = 0
let layerCacheMisses = 0

const buildLayersFromTree = async (
  node: DirNode,
  resourcesByDir: Map<string, { bees: string[]; deps: string[] }>,
  out: Map<string, string>,
  rootDependencies: string[],
  docsByDir: Map<string, Record<string, BeeDocEntry>>,
  prevLayerCache?: Record<string, LayerCacheEntry>
): Promise<string | null> => {
  const layers: string[] = []
  for (const c of node.children) {
    const childSig = await buildLayersFromTree(c, resourcesByDir, out, rootDependencies, docsByDir, prevLayerCache)
    if (childSig) layers.push(childSig)
  }

  const entry = resourcesByDir.get(node.rel) ?? { bees: [], deps: [] }

  if (!entry.bees.length && !entry.deps.length && !layers.length && node.rel) return null

  // beeline: compute layer input signature from all components
  const beeSigs = uniqSorted(entry.bees)
  const depSigs = node.rel ? [] : rootDependencies
  const docsKey = docsByDir.has(node.rel) ? JSON.stringify(docsByDir.get(node.rel)) : ''
  let folderDocSig = ''
  if (node.rel) {
    const docFile = join(SRC_ROOT, node.rel, '_doc.txt')
    if (existsSync(docFile)) {
      folderDocSig = readFileSync(docFile, 'utf8').trim()
    }
  }

  // shapeDescriptor: enumerates the field names this build emits in
  // the layer JSON. When a writer renames or adds/removes a field,
  // change this string so every cached layer's inputSig differs from
  // prior runs and the cache misses. Without this, a field rename
  // (e.g. `layers` → `cells`) is invisible to the input hash and the
  // cache happily returns the OLD JSON under the OLD sig.
  const shapeDescriptor = 'cells:name:bees:dependencies'

  const layerInputParts = [
    shapeDescriptor,
    node.rel,
    beeSigs.join(':'),
    depSigs.join(':'),
    layers.join(':'),
    docsKey,
    folderDocSig,
  ]
  const layerInputSig = await SignatureService.sign(
    toArrayBuffer(textToBytes(layerInputParts.join('|')))
  )

  // beeline: check layer cache
  const cached = prevLayerCache?.[node.rel]
  if (cached && cached.inputSig === layerInputSig) {
    out.set(cached.layerSig, cached.layerJson)
    newLayerCache[node.rel] = cached
    layerCacheHits++
    return cached.layerSig
  }

  // cache miss — build the layer
  const beeDocs = docsByDir.get(node.rel)

  const docs = (beeDocs && Object.keys(beeDocs).length > 0) || folderDocSig
    ? {
        ...(folderDocSig ? { description: folderDocSig } : {}),
        ...(beeDocs && Object.keys(beeDocs).length > 0 ? { bees: beeDocs } : {}),
      }
    : undefined

  // Layer = `{name, cells, bees, dependencies}`. `cells` is the array
  // of child layer sigs — same primitive name as the slim hypercomb.io
  // layer's cells (an array of one useful type with a name). No
  // version, no `rel` ceremony — just the meaningful fields.
  const layer: Record<string, unknown> = {
    name: node.rel.split('/').pop() || 'root',
    cells: layers,
    bees: beeSigs,
    dependencies: depSigs,
  }

  if (docs) layer.docs = docs

  const { sig, json } = await signJson(layer)
  out.set(sig, json)
  newLayerCache[node.rel] = { inputSig: layerInputSig, layerSig: sig, layerJson: json }
  layerCacheMisses++
  return sig
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
    sourcemap: false,
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
    sourcemap: false,
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
  const t0 = performance.now()

  const sources = discoverSources()
  if (!sources.length) throw new Error('no sources found')

  // --- Phase 1: Merkle tree mtime scan (cheap: stat only, no file reads) ---

  const cache = loadCache()

  // Classify sources into namespaces and bees
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
  const beeSources = sources.filter(s => s.kind === 'bee')

  // Quick mtime scan: check if ANY file has a changed mtime
  let anyMtimeChanged = !cache
  if (cache && !anyMtimeChanged) {
    // Check namespace files
    for (const ns of allNs) {
      const members = namespaceToMembers.get(ns) ?? []
      const cachedUnit = cache.namespaces[ns]
      if (!cachedUnit) { anyMtimeChanged = true; break }
      for (const m of members) {
        const prev = cachedUnit.files[m.entry]
        if (!prev) { anyMtimeChanged = true; break }
        const mt = statSync(m.entry).mtimeMs
        if (mt !== prev.mtime) { anyMtimeChanged = true; break }
      }
      if (anyMtimeChanged) break
    }
    // Check bee files
    if (!anyMtimeChanged) {
      for (const src of beeSources) {
        const cachedUnit = cache.bees[src.relPath]
        if (!cachedUnit) { anyMtimeChanged = true; break }
        const prev = cachedUnit.files[src.entry]
        if (!prev) { anyMtimeChanged = true; break }
        const mt = statSync(src.entry).mtimeMs
        if (mt !== prev.mtime) { anyMtimeChanged = true; break }
      }
    }
    // Also check file count hasn't changed (files added/removed)
    if (!anyMtimeChanged) {
      const cachedNsCount = Object.keys(cache.namespaces).length
      const cachedBeeCount = Object.keys(cache.bees).length
      if (cachedNsCount !== allNs.length || cachedBeeCount !== beeSources.length) {
        anyMtimeChanged = true
      }
    }
  }

  // --- Early exit: nothing changed at all ---
  if (!anyMtimeChanged && cache) {
    const manifestFile = join(DIST_ROOT, MANIFEST_FILE)
    const skipDeploy = process.argv.includes('--local')

    // Verify output still exists (not wiped externally)
    if (existsSync(manifestFile)) {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(3)
      console.log(`[build-module] Merkle root unchanged — skipping build entirely`)
      console.log(`[build-module] root signature: ${cache.rootLayerSig}`)
      if (skipDeploy) {
        console.log(`[build-module] --local: skipping Azure deploy`)
      } else {
        console.log(`[build-module] deploying cached output to Azure`)
        deployToAzure()
      }
      console.log(`[build-module] completed in ${elapsed}s`)
      return
    }

    // Output missing — need to reconstruct from .cache/ files
    console.log(`[build-module] Merkle root unchanged but output missing — reconstructing`)
  }

  // --- Phase 2: Preserve .cache/ and manifest.json, clean old root sig directories ---
  if (existsSync(DIST_ROOT)) {
    for (const name of readdirSync(DIST_ROOT)) {
      if (name === '.cache' || name === MANIFEST_FILE) continue
      rmSync(join(DIST_ROOT, name), { recursive: true, force: true })
    }
  }
  ensureDir(DIST_ROOT)
  ensureDir(OUTPUT_CACHE_DIR)

  // --- Phase 3: Per-unit builds with mtime-aware Merkle caching ---

  const resourcesByDir = new Map<string, { bees: string[]; deps: string[] }>()
  const dependencyBytes = new Map<string, Uint8Array>()
  const resourceBytes = new Map<string, Uint8Array>()
  const layers = new Map<string, string>()

  const newNamespaces: Record<string, UnitCache> = {}
  const newBees: Record<string, UnitCache> = {}
  const allUnitSigs: string[] = []

  let cacheHits = 0
  let cacheMisses = 0

  for (const ns of allNs) {
    const members = namespaceToMembers.get(ns) ?? []

    // Build the same virtual entry source used by buildNamespaceDependency for hashing
    const namespaceRootFs = join(SRC_ROOT, ns)
    const entrySource = members.length
      ? members.map(f => {
          const relFromNs = relPosix(namespaceRootFs, f.entry)
          const relNoExt = stripExt(relFromNs)
          const spec = relNoExt.startsWith('.') ? relNoExt : `./${relNoExt}`
          return `export * from '${spec}';`
        }).sort().join('\n') + '\n'
      : 'export {};\n'

    const { leaves, inputSig } = await resolveUnitInputs(
      members.map(m => m.entry),
      cache?.namespaces[ns]?.files,
      entrySource
    )

    allUnitSigs.push(inputSig)
    const cachedUnit = cache?.namespaces[ns]
    const cachedFile = cachedUnit ? join(OUTPUT_CACHE_DIR, `${cachedUnit.outputSig}.js`) : null

    if (cachedUnit?.inputSig === inputSig && cachedFile && existsSync(cachedFile)) {
      const bytes = new Uint8Array(readFileSync(cachedFile))
      dependencyBytes.set(cachedUnit.outputSig, bytes)
      addToBucket(resourcesByDir, ns, jsFileName(cachedUnit.outputSig), 'dep')
      for (const f of members) addToBucket(resourcesByDir, f.relDir, jsFileName(cachedUnit.outputSig), 'dep')
      newNamespaces[ns] = { files: leaves, inputSig, outputSig: cachedUnit.outputSig }
      cacheHits++
    } else {
      const built = await buildNamespaceDependency(ns, members, allSpecifiers)
      if (!built) continue
      dependencyBytes.set(built.sig, built.bytes)
      addToBucket(resourcesByDir, ns, jsFileName(built.sig), 'dep')
      for (const f of members) addToBucket(resourcesByDir, f.relDir, jsFileName(built.sig), 'dep')
      writeFileSync(join(OUTPUT_CACHE_DIR, `${built.sig}.js`), built.bytes)
      newNamespaces[ns] = { files: leaves, inputSig, outputSig: built.sig }
      cacheMisses++
    }
  }

  console.log(`[build-module] dependencies: ${cacheHits} cached, ${cacheMisses} built`)

  const rootDependencies = uniqSorted(Array.from(dependencyBytes.keys()).map(jsFileName))
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

  // pre-extract docs from ALL source files that extend Bee/Drone/Worker/QueenBee
  // beeline: cache doc extraction by file content signature
  const prevDocCache = cache?.docCache
  const queenDocsByDir = new Map<string, Record<string, BeeDocEntry>>()
  let docCacheHits = 0
  let docCacheMisses = 0

  for (const src of deps) {
    // beeline: check doc cache by content signature from unit cache
    const unitFiles = newNamespaces[namespaceRelDirFromRelDir(src.relDir)]?.files
    const fileLeaf = unitFiles?.[src.entry]
    const prevDoc = fileLeaf?.sig ? prevDocCache?.[src.entry] : undefined

    let doc: BeeDocEntry | null
    if (prevDoc && fileLeaf && prevDoc.contentSignature === fileLeaf.sig) {
      doc = prevDoc.doc
      newDocCache[src.entry] = prevDoc
      docCacheHits++
    } else {
      const tsSource = readFileSync(src.entry, 'utf8')
      doc = extractBeeDoc(tsSource)
      if (fileLeaf) {
        newDocCache[src.entry] = { contentSignature: fileLeaf.sig, doc }
      }
      docCacheMisses++
    }

    if (doc && doc.kind === 'queen') {
      const dirDocs = queenDocsByDir.get(src.relDir) ?? {}
      dirDocs[`queen:${doc.className}`] = doc
      queenDocsByDir.set(src.relDir, dirDocs)
    }
  }

  // bees — extract deps from compiled output and map to dep sigs
  const beeDepsMap = new Map<string, string[]>()
  const docsByDir = new Map<string, Record<string, BeeDocEntry>>()
  const beeExternals = [...PLATFORM_EXTERNALS, ...allSpecifiers]
  let beeCacheHits = 0
  let beeCacheMisses = 0

  for (const src of beeSources) {
    const { leaves, inputSig } = await resolveUnitInputs(
      [src.entry],
      cache?.bees[src.relPath]?.files
    )

    allUnitSigs.push(inputSig)
    const cachedUnit = cache?.bees[src.relPath]
    const cachedFile = cachedUnit ? join(OUTPUT_CACHE_DIR, `${cachedUnit.outputSig}.js`) : null

    let bytes: Uint8Array
    let sig: string

    if (cachedUnit?.inputSig === inputSig && cachedFile && existsSync(cachedFile)) {
      bytes = new Uint8Array(readFileSync(cachedFile))
      sig = cachedUnit.outputSig
      newBees[src.relPath] = { files: leaves, inputSig, outputSig: cachedUnit.outputSig }
      beeCacheHits++
    } else {
      bytes = await buildBee(src.entry, beeExternals)
      sig = await SignatureService.sign(toArrayBuffer(bytes))
      writeFileSync(join(OUTPUT_CACHE_DIR, `${sig}.js`), bytes)
      newBees[src.relPath] = { files: leaves, inputSig, outputSig: sig }
      beeCacheMisses++
    }

    resourceBytes.set(sig, bytes)
    addToBucket(resourcesByDir, src.relDir, jsFileName(sig), 'bee')

    // beeline: cache bee doc extraction by content signature
    const beeFileLeaf = newBees[src.relPath]?.files[src.entry]
    const prevBeeDoc = beeFileLeaf?.sig ? prevDocCache?.[src.entry] : undefined

    let beeDoc: BeeDocEntry | null
    if (prevBeeDoc && beeFileLeaf && prevBeeDoc.contentSignature === beeFileLeaf.sig) {
      beeDoc = prevBeeDoc.doc
      newDocCache[src.entry] = prevBeeDoc
      docCacheHits++
    } else {
      const tsSource = readFileSync(src.entry, 'utf8')
      beeDoc = extractBeeDoc(tsSource)
      if (beeFileLeaf) {
        newDocCache[src.entry] = { contentSignature: beeFileLeaf.sig, doc: beeDoc }
      }
      docCacheMisses++
    }

    if (beeDoc) {
      const dirDocs = docsByDir.get(src.relDir) ?? {}
      dirDocs[sig] = beeDoc
      docsByDir.set(src.relDir, dirDocs)
    }

    // beeline: cache bee dependency mapping by outputSig.
    // CRITICAL: also verify every cached dep sig still exists as a live
    // dependency in this build. If a dep namespace was rebuilt with new
    // contents (its sig changed), the bee's output sig stays the same
    // (deps are externals during bee compile), but the cached dep sigs
    // are now phantom — they reference files that no longer exist on
    // disk. Re-extract from the compiled output in that case.
    const prevBeeDep = cache?.beeDepCache?.[src.relPath]
    const cachedDepsStillLive = prevBeeDep
      ? prevBeeDep.depSigs.every(s => dependencyBytes.has(s))
      : false
    if (prevBeeDep && prevBeeDep.outputSig === sig && cachedDepsStillLive) {
      // beeline hit: same compiled output AND every dep sig still on disk
      if (prevBeeDep.depSigs.length) {
        beeDepsMap.set(sig, prevBeeDep.depSigs)
      }
      newBeeDepCache[src.relPath] = prevBeeDep
    } else {
      // cache miss: extract deps from compiled output
      const text = new TextDecoder().decode(bytes)
      const resolvedDepSigs = new Set<string>()
      const depsMatch = text.match(/deps\s*=\s*\{([^}]+)\}/)
      if (depsMatch) {
        for (const m of depsMatch[1].matchAll(/@[^"'/]+\/(\w+)/g)) {
          const cls = m[1]
          if (cls && classToDepSig.has(cls)) resolvedDepSigs.add(classToDepSig.get(cls)!)
        }
      }
      const sortedDepSigs = [...resolvedDepSigs].sort()
      if (sortedDepSigs.length) {
        beeDepsMap.set(sig, sortedDepSigs)
        const relName = src.relPath.split('/').pop() ?? src.relPath
        console.log(`[build-module] ${relName} → ${resolvedDepSigs.size} dep(s)`)
      }
      newBeeDepCache[src.relPath] = { outputSig: sig, depSigs: sortedDepSigs }
    }
  }

  console.log(`[build-module] bees: ${beeCacheHits} cached, ${beeCacheMisses} built`)

  // --- Phase 4: layers + manifest (always regenerated, cheap) ---

  // merge queen docs into docsByDir (queens are keyed by className, not sig)
  for (const [dir, queenDocs] of queenDocsByDir) {
    const dirDocs = docsByDir.get(dir) ?? {}
    Object.assign(dirDocs, queenDocs)
    docsByDir.set(dir, dirDocs)
  }

  const tree = readDirTree(SRC_ROOT, '')
  const rootLayerSig = await buildLayersFromTree(tree, resourcesByDir, layers, rootDependencies, docsByDir, cache?.layerCache)
  // The root node (`node.rel === ''`) always builds a layer — the null
  // early-return in buildLayersFromTree is gated on `node.rel`, so only a
  // non-root empty dir returns null. Assert it here so the rest of the
  // pipeline (closure check, manifest key) can treat the root sig as the
  // string it always is.
  if (!rootLayerSig) throw new Error('build-module: root layer produced no signature (empty source tree?)')

  console.log(`[build-module] layers: ${layerCacheHits} cached, ${layerCacheMisses} built`)
  console.log(`[build-module] doc extraction: ${docCacheHits} cached, ${docCacheMisses} parsed`)

  // report doc extraction stats
  let docCount = 0
  for (const dirDocs of docsByDir.values()) docCount += Object.keys(dirDocs).length
  console.log(`[build-module] docs: ${docCount} bee doc(s) extracted across ${docsByDir.size} lineage(s)`)

  // write package — flat bare-sig files at the dist root. No typed dirs:
  // layers, bees and dependencies all land as `dist/<sig>`; the manifest's
  // arrays are what say which sig is which kind.
  for (const [sig, json] of layers) writeSigFile(DIST_ROOT, sig, json)
  for (const [sig, bytes] of dependencyBytes) writeSigFile(DIST_ROOT, sig, bytes)
  for (const [sig, bytes] of resourceBytes) writeSigFile(DIST_ROOT, sig, bytes)

  // Sigbag emission. A bag is a directory named by its content sig; entries
  // are zero-padded index files (0000, 0001, …) whose contents carry the
  // leaf metadata needed to build the importmap directly — no follow-up
  // leaf-file open required.
  //
  // Entry format (two-line text):
  //   line 1: alias (e.g. `@diamondcoreprocessor.com/clipboard`) or empty
  //   line 2: leaf sig
  //
  // Bag sig = SHA-256 of canonical bytestream (entry contents joined by NUL).
  // Format changes propagate to the bag sig automatically — old bags don't
  // collide with new ones.
  //
  // No HEAD pointer file is emitted. Everything written here is content-
  // addressed: the bag dir is named by its sig, entries are named by
  // index, leaves are named by their own sig. Bags live at the DIST ROOT
  // next to the flat sig files, and the receiver discovers them ONLY via
  // the manifest's `dependenciesBag`/`beesBag` fields — never by scanning
  // a dir (under the flat layout a scan can't tell a bag from any other
  // sig-named dir, and scan-and-delete against a shared root is a
  // data-loss trap).
  type BagEntry = { sig: string; content: string }
  const writeBag = async (parentDir: string, entries: BagEntry[]): Promise<string> => {
    const sorted = [...entries].sort((a, b) => a.sig.localeCompare(b.sig))
    const canonical = sorted.map(e => e.content).join('\0')
    const bagSig = await SignatureService.sign(toArrayBuffer(textToBytes(canonical)))
    const bagDir = join(parentDir, bagSig)
    ensureDir(bagDir)
    sorted.forEach((entry, i) => {
      writeFileSync(join(bagDir, String(i).padStart(4, '0')), entry.content, 'utf8')
    })
    return bagSig
  }

  // Build alias → sig index for dependencies. Each namespace's compiled
  // output sig pairs with its `@namespace/path` import specifier.
  const depAliasBySig = new Map<string, string>()
  for (const [ns, unit] of Object.entries(newNamespaces)) {
    depAliasBySig.set(unit.outputSig, specifierFromNamespaceRelDir(ns))
  }

  const depEntries: BagEntry[] = Array.from(dependencyBytes.keys()).map(sig => {
    const alias = depAliasBySig.get(sig) ?? ''
    return { sig, content: `${alias}\n${sig}\n` }
  })
  const beeEntries: BagEntry[] = Array.from(resourceBytes.keys()).map(sig => ({
    sig,
    content: `\n${sig}\n`,   // empty alias line; layout matches dep entries
  }))

  const dependenciesBag = await writeBag(DIST_ROOT, depEntries)
  const beesBag = await writeBag(DIST_ROOT, beeEntries)
  console.log(`[build-module] bags: dependencies=${dependenciesBag.slice(0, 12)} bees=${beesBag.slice(0, 12)}`)

  // content manifest — package entry keyed by root signature.
  // The package's identity is its rootLayerSig (the merkle hash of the layer
  // tree); its meaning is its sig arrays. `label`/`previous` are SIDECAR
  // discovery metadata — a human-readable branch name and the version this
  // supersedes — in the same non-identity category as dependenciesBag/beesBag.
  // They change manifest.json bytes but NOT rootLayerSig, so naming a package
  // never redefines it. (`at`, the deploy timestamp, is intentionally NOT set
  // here — a fresh timestamp every build would churn the local manifest and
  // defeat the skip-write below. deploy-azure.ps1 sets `at` + chains the label
  // against the remote manifest at deploy time.)
  const packageEntry = {
    layers: Array.from(layers.keys()).sort((a, b) => a.localeCompare(b)),
    bees: Array.from(resourceBytes.keys()).sort((a, b) => a.localeCompare(b)),
    dependencies: dependencySigs,
    beeDeps: Object.fromEntries(beeDepsMap),
    dependenciesBag,
    beesBag,
    label: resolveGenesisLabel(),
    previous: null as string | null,
  }

  // ── Closure check ────────────────────────────────────────────────
  // Every signature a layer references (child layers in `cells`, plus
  // `bees` and root `dependencies`) and every dep a bee declares MUST
  // exist on disk AND be listed in the manifest. A dangling reference
  // would publish a manifest that installs "complete" (the receiver only
  // verifies the listed sigs — ensure-install.ts) yet renders BLANK the
  // moment a consumer walks into the missing layer/bee: layer resolution
  // has no host fallback on the render path, so getLayerBySig just returns
  // null and the completeness gate exhausts. Fail the build here, before
  // the manifest is written, so a broken package never ships.
  {
    const onDiskLayers = new Set(layers.keys())
    const onDiskBees = new Set(resourceBytes.keys())
    const onDiskDeps = new Set(dependencyBytes.keys())
    const inManifestLayers = new Set(packageEntry.layers)
    const inManifestBees = new Set(packageEntry.bees)
    const inManifestDeps = new Set(packageEntry.dependencies)
    // Layer JSON stores bees/deps WITH a `.js` suffix (rootDependencies +
    // entry.bees use jsFileName); cells + every on-disk/manifest map use
    // bare sigs. Normalise to bare before comparing.
    const bare = (s: unknown): string => String(s ?? '').replace(/\.js$/i, '')
    const errors: string[] = []

    if (!onDiskLayers.has(rootLayerSig)) errors.push(`root layer ${rootLayerSig.slice(0, 12)} not written to dist`)
    if (!inManifestLayers.has(rootLayerSig)) errors.push(`root layer ${rootLayerSig.slice(0, 12)} missing from manifest.layers`)

    for (const [sig, json] of layers) {
      let parsed: { name?: string; cells?: unknown[]; bees?: unknown[]; dependencies?: unknown[] }
      try { parsed = JSON.parse(json) } catch { errors.push(`layer ${sig.slice(0, 12)} is not valid JSON`); continue }
      const tag = `layer "${parsed.name ?? '?'}" (${sig.slice(0, 12)})`
      for (const child of (Array.isArray(parsed.cells) ? parsed.cells : [])) {
        const c = bare(child)
        if (!onDiskLayers.has(c)) errors.push(`${tag} → child layer ${c.slice(0, 12)} not on disk`)
        else if (!inManifestLayers.has(c)) errors.push(`${tag} → child layer ${c.slice(0, 12)} missing from manifest.layers`)
      }
      for (const beeRef of (Array.isArray(parsed.bees) ? parsed.bees : [])) {
        const b = bare(beeRef)
        if (!onDiskBees.has(b)) errors.push(`${tag} → bee ${b.slice(0, 12)} not on disk`)
        else if (!inManifestBees.has(b)) errors.push(`${tag} → bee ${b.slice(0, 12)} missing from manifest.bees`)
      }
      for (const depRef of (Array.isArray(parsed.dependencies) ? parsed.dependencies : [])) {
        const d = bare(depRef)
        if (!onDiskDeps.has(d)) errors.push(`${tag} → dependency ${d.slice(0, 12)} not on disk`)
        else if (!inManifestDeps.has(d)) errors.push(`${tag} → dependency ${d.slice(0, 12)} missing from manifest.dependencies`)
      }
    }

    for (const [beeSig, depList] of beeDepsMap) {
      for (const depRef of (Array.isArray(depList) ? depList : [])) {
        const d = bare(depRef)
        if (!onDiskDeps.has(d)) errors.push(`bee ${bare(beeSig).slice(0, 12)} declares dependency ${d.slice(0, 12)} not on disk`)
        else if (!inManifestDeps.has(d)) errors.push(`bee ${bare(beeSig).slice(0, 12)} dependency ${d.slice(0, 12)} missing from manifest.dependencies`)
      }
    }

    if (errors.length) {
      console.error(`[build-module] CLOSURE CHECK FAILED — ${errors.length} dangling reference(s); manifest NOT written:`)
      for (const e of errors.slice(0, 50)) console.error(`  - ${e}`)
      if (errors.length > 50) console.error(`  …and ${errors.length - 50} more`)
      throw new Error(`build-module: closure check failed (${errors.length} dangling reference(s))`)
    }
    console.log(`[build-module] closure OK — ${onDiskLayers.size} layers, ${onDiskBees.size} bees, ${onDiskDeps.size} deps, no dangling refs`)
  }

  // Single-package manifest: always write only the current rootLayerSig.
  // Merging with prior manifest entries is a footgun — stale package keys
  // accumulate and the runtime loader picks Object.keys(packages)[0], which
  // is the *first inserted* (chronologically oldest) entry. That stale entry
  // then references signatures that no longer exist on disk, breaking install.
  const manifestPath = join(DIST_ROOT, MANIFEST_FILE)
  const manifest = { packages: { [rootLayerSig]: packageEntry } }
  const nextJson = JSON.stringify(manifest, null, 2) + '\n'
  const prevJson = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : ''
  if (nextJson !== prevJson) {
    writeFileSync(manifestPath, nextJson, 'utf8')
    console.log(`[build-module] manifest updated (root ${rootLayerSig.slice(0, 12)})`)
  } else {
    console.log(`[build-module] manifest unchanged — skipped write`)
  }

  // --- Phase 5: persist Merkle cache + GC ---

  const rootHash = await computeRootHash(allUnitSigs)
  saveCache({
    version: 4,
    rootHash,
    rootLayerSig,
    namespaces: newNamespaces,
    bees: newBees,
    layerCache: newLayerCache,
    docCache: newDocCache,
    beeDepCache: newBeeDepCache,
  })

  const liveSigs = new Set([...dependencyBytes.keys(), ...resourceBytes.keys()])
  for (const name of readdirSync(OUTPUT_CACHE_DIR)) {
    const sig = name.replace(/\.js$/, '')
    if (isSig(sig) && !liveSigs.has(sig)) rmSync(join(OUTPUT_CACHE_DIR, name), { force: true })
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(2)

  // deploy (skip with --local flag)
  const skipDeploy = process.argv.includes('--local')
  if (skipDeploy) {
    console.log(`[build-module] --local: skipping Azure deploy`)
    console.log(`[build-module] root signature: ${rootLayerSig}`)
    console.log(`[build-module] output: ${DIST_ROOT}`)
    console.log(`[build-module] completed in ${elapsed}s`)
  } else {
    deployToAzure()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
