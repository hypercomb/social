// scripts/build-module.ts
// production build
// - dist/<rootLayerSig>/__layers__ contains json only
// - dist/__resources__ contains only drone js bytes (with first-line comment preserved)
// - no manifests, no payload json
// - sourcemaps enabled
// - guarantees arraybuffer (never sharedarraybuffer) for signing
//
// dev mirror export (optional)
// - emits <DEV_PUBLIC_ROOT> as a flat folder containing:
//   - drones.runtime-map.json
//   - dependencies.runtime-map.json (import-map shape: { "imports": { ... } })
//   - <signature> files (drones + dependencies mixed)
// - designed for native esm imports from the same root during dev

import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { build } from 'esbuild'
import { SignatureService } from '@hypercomb/core'
import { HostedDependencies } from './dependencies'

// -------------------------------------------------
// esm globals
// -------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// -------------------------------------------------
// config
// -------------------------------------------------

const SRC_ROOT = resolve('./src')
const DIST_ROOT = resolve('./dist')
const TARGET = 'es2022'

// dev export root (mirror output for local dev server)
// note: use forward slashes in json output, but filesystem paths can be platform-specific
const DEV_PUBLIC_ROOT = resolve(
  process.env.HYPERCOMB_DEV_PUBLIC_ROOT ??
  resolve(__dirname, '../../hypercomb-web/public/dev/drones')
)

const DEV_PUBLIC_BASE_URL =
  process.env.HYPERCOMB_DEV_PUBLIC_BASE_URL ?? '/dev/drones'

// set to "0" to disable dev export
const DEV_EXPORT_ENABLED = (process.env.HYPERCOMB_DEV_EXPORT ?? '1') !== '0'

// -------------------------------------------------
// helpers
// -------------------------------------------------

const relPosix = (from: string, to: string): string => {
  const rel = relative(from, to).replace(/\\/g, '/')
  return rel === '.' ? '' : rel
}

const sortUnique = (items: readonly string[]): string[] =>
  [...new Set(items)].sort((a, b) => a.localeCompare(b))

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

const baseNameFromRel = (rel: string): string => {
  if (!rel) return 'hypercomb'
  const parts = rel.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? 'hypercomb'
}

const droneIdFromEntry = (entry: string): string => {
  const file = entry.replace(/\\/g, '/').split('/').pop() ?? ''
  return file.replace(/\.drone\.(ts|js)$/, '')
}

const textToBytes = (text: string): Uint8Array =>
  new TextEncoder().encode(text)

// critical: always materialize a real arraybuffer
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

const isSig = (value: string): boolean => /^[a-f0-9]{64}$/i.test(value)

const ensureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true })
}

const writeSigFile = (dir: string, sig: string, bytes: Uint8Array): void => {
  if (!isSig(sig)) throw new Error(`invalid signature: ${sig}`)
  writeFileSync(join(dir, sig), bytes)
}

const writeJsonFile = (dir: string, name: string, value: unknown): void => {
  const json = JSON.stringify(value, null, 2)
  writeFileSync(join(dir, name), json + '\n', 'utf8')
}

const toDevUrl = (sig: string): string => {
  // keep url posix
  return `${DEV_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${sig}`
}

// -------------------------------------------------
// discovery (filesystem only)
// -------------------------------------------------

type SourceFile = { entry: string; dirRel: string }

const discoverDroneSources = (): SourceFile[] => {
  const files = walkFiles(SRC_ROOT)
  const out: SourceFile[] = []

  for (const file of files) {
    if (!file.endsWith('.drone.ts') && !file.endsWith('.drone.js')) continue
    out.push({
      entry: file,
      dirRel: relPosix(SRC_ROOT, dirname(file))
    })
  }

  return out
}

// -------------------------------------------------
// compile
// -------------------------------------------------

// drone payloads are expected to be small and may reference platform/global libs
const compileDrone = async (entry: string): Promise<string> => {
  const result = await build({
    entryPoints: [resolve(entry)],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: TARGET,
    tsconfig: resolve('./tsconfig.json'),
    external: ['@hypercomb/core', 'pixi.js', '@essentials/*'],
    sourcemap: true
  })

  if (!result.outputFiles?.length) throw new Error(`no output emitted for: ${entry}`)
  return result.outputFiles[0].text
}

// dependencies are expected to be atomic, shareable, signed js payloads
// for third-party libs like pixi.js, bundling is required to collapse internal module graph
const compileDependency = async (entry: string): Promise<string> => {
  const result = await build({
    entryPoints: [resolve(entry)],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: TARGET,
    tsconfig: resolve('./tsconfig.json'),
    external: [],
    sourcemap: true
  })

  if (!result.outputFiles?.length) throw new Error(`no output emitted for: ${entry}`)
  return result.outputFiles[0].text
}

// -------------------------------------------------
// layers
// -------------------------------------------------

type DirNode = { rel: string; children: DirNode[] }

const readDirTreeFiltered = (srcRoot: string, relDir: string, included: Set<string>): DirNode | null => {
  const full = join(srcRoot, relDir)
  if (!existsSync(full) || !statSync(full).isDirectory()) return null

  const children: DirNode[] = []

  for (const name of readdirSync(full)) {
    const childFull = join(full, name)
    if (!statSync(childFull).isDirectory()) continue

    const childRel = relDir ? `${relDir}/${name}` : name
    const child = readDirTreeFiltered(srcRoot, childRel, included)
    if (child) children.push(child)
  }

  children.sort((a, b) => a.rel.localeCompare(b.rel))

  if (!included.has(relDir) && children.length === 0) return null
  return { rel: relDir, children }
}

const signJson = async (value: unknown): Promise<{ signature: string; json: string }> => {
  const json = JSON.stringify(value)
  const bytes = textToBytes(json)
  const signature = await SignatureService.sign(toArrayBuffer(bytes))
  return { signature, json }
}

const buildLayersBottomUp = async (
  node: DirNode,
  dirToResources: Map<string, string[]>,
  writeLayer: (sig: string, json: string) => void
): Promise<string> => {
  const childLayerSigs: string[] = []

  for (const child of node.children) {
    const sig = await buildLayersBottomUp(child, dirToResources, writeLayer)
    childLayerSigs.push(sig)
  }

  const layer = {
    version: 1,
    name: baseNameFromRel(node.rel),
    rel: node.rel,
    drones: sortUnique(dirToResources.get(node.rel) ?? []),
    children: sortUnique(childLayerSigs)
  }

  const signed = await signJson(layer)
  writeLayer(signed.signature, signed.json)
  return signed.signature
}

// -------------------------------------------------
// dev mirror shapes
// -------------------------------------------------

type DevDronesRuntimeMap = {
  version: 1
  root: string
  drones: Record<string, string>
}

type DevImportMap = {
  imports: Record<string, string>
}

// -------------------------------------------------
// main
// -------------------------------------------------

const main = async (): Promise<void> => {
  rmSync(DIST_ROOT, { recursive: true, force: true })
  ensureDir(DIST_ROOT)

  if (DEV_EXPORT_ENABLED) {
    rmSync(DEV_PUBLIC_ROOT, { recursive: true, force: true })
    ensureDir(DEV_PUBLIC_ROOT)
  }

  // -----------------------------
  // compile drones (production + dev)
  // -----------------------------

  const sources = discoverDroneSources()
  if (!sources.length) throw new Error('no drone sources found')

  const dirToResources = new Map<string, string[]>()
  const droneBytes = new Map<string, Uint8Array>()
  const droneNameToSig: Record<string, string> = {}

  for (const src of sources) {
    const compiled = await compileDrone(src.entry)

    const label = droneIdFromEntry(src.entry)

    const meta =
      `// @hypercomb ${JSON.stringify({
        label,
        kind: 'drone',
        lang: 'js'
      })}\n`

    const finalSource = meta + compiled
    const bytes = textToBytes(finalSource)
    const signature = await SignatureService.sign(toArrayBuffer(bytes))

    droneBytes.set(signature, bytes)
    droneNameToSig[label] = signature

    const list = dirToResources.get(src.dirRel) ?? []
    list.push(signature)
    dirToResources.set(src.dirRel, list)
  }

  // -----------------------------
  // compile hosted dependencies (dev mirror only)
  // -----------------------------

  const depBytes = new Map<string, Uint8Array>()
  const depAliasToSig: Record<string, string> = {}

  for (const dep of HostedDependencies) {
    const compiled = await compileDependency(dep.entry)

    const meta =
      `// @hypercomb ${JSON.stringify({
        label: dep.name,
        kind: 'dependency',
        alias: dep.alias,
        lang: 'js'
      })}\n`

    const finalSource = meta + compiled
    const bytes = textToBytes(finalSource)
    const signature = await SignatureService.sign(toArrayBuffer(bytes))

    depBytes.set(signature, bytes)
    depAliasToSig[dep.alias] = signature
  }

  // -----------------------------
  // build layers (production)
  // -----------------------------

  const included = new Set<string>([''])
  for (const rel of dirToResources.keys()) {
    let cur = rel
    included.add(cur)
    while (cur.includes('/')) {
      cur = cur.split('/').slice(0, -1).join('/')
      included.add(cur)
    }
  }

  const tree = readDirTreeFiltered(SRC_ROOT, '', included)
  if (!tree) throw new Error('no layer tree')

  const layerMap = new Map<string, string>()
  const rootLayerSig = await buildLayersBottomUp(tree, dirToResources, (sig, json) => layerMap.set(sig, json))

  const packageDir = join(DIST_ROOT, rootLayerSig)
  const layersDir = join(packageDir, '__layers__')
  const resourcesDir = join(DIST_ROOT, '__resources__')

  ensureDir(layersDir)
  ensureDir(resourcesDir)

  for (const [sig, json] of layerMap) {
    writeFileSync(join(layersDir, sig), json, 'utf8')
  }

  // production: __resources__ contains ONLY drone payloads
  for (const [sig, bytes] of droneBytes) {
    writeSigFile(resourcesDir, sig, bytes)
  }

  writeFileSync(join(packageDir, 'root.txt'), `${rootLayerSig}\n`, 'utf8')

  // -----------------------------
  // dev mirror export (mixed pool)
  // -----------------------------

  if (DEV_EXPORT_ENABLED) {
    // write mixed signature pool (drones + deps) into public/dev
    for (const [sig, bytes] of droneBytes) {
      writeSigFile(DEV_PUBLIC_ROOT, sig, bytes)
    }
    for (const [sig, bytes] of depBytes) {
      writeSigFile(DEV_PUBLIC_ROOT, sig, bytes)
    }

    // drones map: label -> signature
    const dronesMap: DevDronesRuntimeMap = {
      version: 1,
      root: DEV_PUBLIC_BASE_URL,
      drones: droneNameToSig
    }

    // dependencies map: alias -> fetchable url (import-map shape)
    const imports: Record<string, string> = {}
    for (const [alias, sig] of Object.entries(depAliasToSig)) {
      imports[alias] = toDevUrl(sig)
    }

    const depsMap: DevImportMap = { imports }

    writeJsonFile(DEV_PUBLIC_ROOT, 'drones.runtime-map.json', dronesMap)
    writeJsonFile(DEV_PUBLIC_ROOT, 'dependencies.runtime-map.json', depsMap)
  }

  // -----------------------------
  // optional deployment
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
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
