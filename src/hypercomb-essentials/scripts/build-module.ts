// scripts/build-module.ts
// production build: emits dist/<rootLayerSig>/__layers__ + __resources__
// layers are the install surface (folder structure)
// no imports, no drone execution, no dependency bundling

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
import { PayloadCanonical, SignatureService } from '@hypercomb/core'

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

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

const toBase64 = (text: string): string =>
  Buffer.from(text, 'utf8').toString('base64')

const relPosix = (from: string, to: string): string => {
  const rel = relative(from, to).replace(/\\/g, '/')
  return rel === '.' ? '' : rel
}

const sortUnique = (items: readonly string[]): string[] => {
  const set = new Set(items)
  return [...set].sort((a, b) => a.localeCompare(b))
}

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
  if (!rel) return 'hypercomb-essentials'
  const parts = rel.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? 'hypercomb-essentials'
}

const droneIdFromEntry = (entry: string): string => {
  const file = entry.replace(/\\/g, '/').split('/').pop() ?? ''
  return file.replace(/\.drone\.(ts|js)$/, '')
}

const signJson = async (
  value: unknown
): Promise<{ signature: string; json: string }> => {
  const json = JSON.stringify(value)
  const bytes = new TextEncoder().encode(json)
  const signature = await SignatureService.sign(toArrayBuffer(bytes))
  return { signature, json }
}

// -------------------------------------------------
// discovery (no imports, no execution)
// -------------------------------------------------

type DroneSource = {
  entry: string
  dirRel: string
}

const discoverDrones = (): DroneSource[] => {
  const files = walkFiles(SRC_ROOT)
  const drones: DroneSource[] = []

  for (const file of files) {
    if (!file.endsWith('.drone.ts') && !file.endsWith('.drone.js')) continue

    drones.push({
      entry: file,
      dirRel: relPosix(SRC_ROOT, dirname(file))
    })
  }

  return drones
}

// -------------------------------------------------
// compile (no bundling; allow runtime-only imports to remain)
// -------------------------------------------------

const compileDroneSource = async (entry: string): Promise<string> => {
  const result = await build({
    entryPoints: [resolve(entry)],
    bundle: false,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: TARGET,
    tsconfig: resolve('./tsconfig.json')
  })

  if (!result.outputFiles || result.outputFiles.length === 0) {
    throw new Error(`no output emitted for: ${entry}`)
  }

  return result.outputFiles[0].text
}

// -------------------------------------------------
// layers (directory tree from src)
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

const buildLayersBottomUp = async (
  node: DirNode,
  dirToDrones: Map<string, string[]>,
  writeLayer: (sig: string, json: string) => void
): Promise<string> => {
  const childLayerSigs: string[] = []

  for (const child of node.children) {
    const sig = await buildLayersBottomUp(child, dirToDrones, writeLayer)
    childLayerSigs.push(sig)
  }

  const layer = {
    version: 1,
    name: baseNameFromRel(node.rel),
    rel: node.rel,
    drones: sortUnique(dirToDrones.get(node.rel) ?? []),
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

  const drones = discoverDrones()
  if (drones.length === 0) {
    throw new Error('no drone sources found')
  }

  const built: { droneSig: string; dirRel: string }[] = []

  const resourceMap = new Map<string, string>()
  const layerMap = new Map<string, string>()

  for (const drone of drones) {
    const source = await compileDroneSource(drone.entry)
    const inferredId = droneIdFromEntry(drone.entry)

    const draft = PayloadCanonical.createEmpty()
    draft.source.entry = 'bundle.js'
    draft.source.files = { 'bundle.js': toBase64(source) }

    // inferred name only (resource metadata)
    draft.drone.name = inferredId

    const { signature: droneSig } = await PayloadCanonical.compute(draft)
    resourceMap.set(droneSig, JSON.stringify(draft))

    built.push({ droneSig, dirRel: drone.dirRel })
  }

  const dirToDrones = new Map<string, string[]>()
  for (const d of built) {
    const list = dirToDrones.get(d.dirRel) ?? []
    list.push(d.droneSig)
    dirToDrones.set(d.dirRel, list)
  }

  const included = new Set<string>([''])
  for (const d of built) {
    let rel = d.dirRel
    included.add(rel)
    while (rel.includes('/')) {
      rel = rel.split('/').slice(0, -1).join('/')
      included.add(rel)
    }
  }

  const tree = readDirTreeFiltered(SRC_ROOT, '', included)
  if (!tree) throw new Error('no layer tree could be constructed')

  const writeLayer = (sig: string, json: string): void => {
    layerMap.set(sig, json)
  }

  const rootLayerSig = await buildLayersBottomUp(tree, dirToDrones, writeLayer)

  const packageDir = join(DIST_ROOT, rootLayerSig)
  const layersDir = join(packageDir, '__layers__')
  const resourcesDir = join(packageDir, '__resources__')

  mkdirSync(packageDir, { recursive: true })
  mkdirSync(layersDir, { recursive: true })
  mkdirSync(resourcesDir, { recursive: true })

  for (const [sig, json] of layerMap.entries()) {
    writeFileSync(join(layersDir, sig), json, 'utf8')
  }

  for (const [sig, json] of resourceMap.entries()) {
    writeFileSync(join(resourcesDir, sig), json, 'utf8')
  }

  writeFileSync(join(packageDir, 'root.txt'), `${rootLayerSig}\n`, 'utf8')

  const ps1 = resolve(__dirname, 'deploy-azure.ps1')
  if (existsSync(ps1)) {
    const result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ps1,
        '-Signature', rootLayerSig
      ],
      { stdio: 'inherit' }
    )

    if (result.status !== 0) {
      throw new Error('deployment failed')
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
