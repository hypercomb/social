// scripts/build-module.ts
// production build
// - __resources__ contains ONLY raw js bytes (with first-line comment preserved)
// - __layers__ contains json only
// - no manifests, no payload json
// - sourcemaps enabled
// - guarantees ArrayBuffer (never SharedArrayBuffer) for signing

import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { resolve, join, dirname, relative } from 'path'
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

const SRC_ROOT = resolve('./src')
const DIST_ROOT = resolve('./dist')
const TARGET = 'es2022'

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

// critical: always materialize a real ArrayBuffer
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

// -------------------------------------------------
// discovery (filesystem only)
// -------------------------------------------------

type SourceFile = {
  entry: string
  dirRel: string
}

const discoverSources = (): SourceFile[] => {
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
// compile (leave runtime imports unresolved)
// -------------------------------------------------

const compileSource = async (entry: string): Promise<string> => {
  const result = await build({
    entryPoints: [resolve(entry)],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: TARGET,
    tsconfig: resolve('./tsconfig.json'),
    external: [
      '@hypercomb/core',
      'pixi.js',
      '@essentials/*'
    ],
    sourcemap: true
  })

  if (!result.outputFiles?.length) {
    throw new Error(`no output emitted for: ${entry}`)
  }

  return result.outputFiles[0].text
}

// -------------------------------------------------
// layers
// -------------------------------------------------

type DirNode = {
  rel: string
  children: DirNode[]
}

const readDirTreeFiltered = (
  srcRoot: string,
  relDir: string,
  included: Set<string>
): DirNode | null => {
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

const signJson = async (
  value: unknown
): Promise<{ signature: string; json: string }> => {
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
// main
// -------------------------------------------------

const main = async (): Promise<void> => {
  rmSync(DIST_ROOT, { recursive: true, force: true })
  mkdirSync(DIST_ROOT, { recursive: true })

  const sources = discoverSources()
  if (!sources.length) throw new Error('no drone sources found')

  const dirToResources = new Map<string, string[]>()
  const resourceBytes = new Map<string, Uint8Array>()
  const layerMap = new Map<string, string>()

  for (const src of sources) {
    const compiled = await compileSource(src.entry)

    const meta =
      `// @hypercomb ${JSON.stringify({
        label: droneIdFromEntry(src.entry),
        kind: 'drone',
        lang: 'js'
      })}\n`

    const finalSource = meta + compiled
    const bytes = textToBytes(finalSource)
    const signature = await SignatureService.sign(toArrayBuffer(bytes))

    resourceBytes.set(signature, bytes)

    const list = dirToResources.get(src.dirRel) ?? []
    list.push(signature)
    dirToResources.set(src.dirRel, list)
  }

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

  const rootLayerSig = await buildLayersBottomUp(
    tree,
    dirToResources,
    (sig, json) => layerMap.set(sig, json)
  )

  const packageDir = join(DIST_ROOT, rootLayerSig)
  const layersDir = join(packageDir, '__layers__')
  const resourcesDir = join(DIST_ROOT, '__resources__')

  mkdirSync(layersDir, { recursive: true })
  mkdirSync(resourcesDir, { recursive: true })

  for (const [sig, json] of layerMap) {
    writeFileSync(join(layersDir, sig), json, 'utf8')
  }

  for (const [sig, bytes] of resourceBytes) {
    writeFileSync(join(resourcesDir, sig), bytes)
  }

  writeFileSync(join(packageDir, 'root.txt'), `${rootLayerSig}\n`, 'utf8')

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
