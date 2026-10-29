// hypercomb-shim/src/bootstrap/branch-files.ts
//
// A PACKAGE, READ AS FILES. The host page opens a signature and shows the
// branch as folders. A folder is not a directory on disk: each file carries
// its path, and that path is what a later reader rebuilds the folders from.
//
// A changed file is a new signature. Every layer that names it is rewritten
// too, up to a new root. Unchanged branches keep their signatures. That is
// the whole merkle move, and it happens here — the hive chat organizes
// tiles, it does not mint builds.
//
// The AI module stays dormant until loadAi. It then loads from a mission
// subdomain (`try-<mission>.<zone>`), whose origin is its own store.

import { SignatureService, canonicalLayerJson, isSandboxLabel, type CanonicalLayerContent } from '@hypercomb/core'
import { isPath, parentOf } from '@hypercomb/runtime/package-tree'
import { hostBases } from '@hypercomb/runtime/host-packages'
import { decodeTransferPack, encodeTransferPack, gunzipBytes, gzipBytes } from '@hypercomb/runtime/transfer-pack'

const SIG_RE = /^[a-f0-9]{64}$/
const SEGMENT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export type BranchRead = (sig: string) => Promise<Uint8Array | null>

export type BranchFile = {
  /** Folder the file sits in. `''` is the root. */
  path: string
  name: string
  kind: 'layer' | 'bee' | 'dependency'
  sig: string
}

export type LayerNode = {
  path: string
  name: string
  sig: string
  bees: readonly string[]
  dependencies: readonly string[]
  children: readonly string[]
  description: string
  /** Slots this layer already carried, apart from the lists the mint rewrites. */
  extra: Readonly<Record<string, unknown>>
  docs: Readonly<Record<string, unknown>> | null
}

export type Branch = {
  root: string
  complete: boolean
  nodes: readonly LayerNode[]
  files: readonly BranchFile[]
}

export type BranchEdits = {
  /** Folders left out of the new root. A folder off takes everything under it. */
  offPaths?: readonly string[]
  /** Single files left out, while their folder stays. */
  offSigs?: readonly string[]
  /** An unfinished requirement, spoken as one word at a folder. */
  traits?: readonly { path: string; word: string }[]
  /** A folder taken from another domain's signature. */
  choices?: readonly { path: string; sig: string; source: string }[]
}

export type MintedBranch = {
  ok: true
  rootSig: string
  /** New layer bytes. An unchanged layer is absent and keeps its signature. */
  layers: ReadonlyMap<string, Uint8Array>
  /** Old signature to the signature that replaced it, along the merkle path. */
  moved: ReadonlyMap<string, string>
  files: readonly BranchFile[]
  /** The public-facing set: every file the new root still names. */
  face: readonly string[]
  complete: boolean
}

export type MintFailure = { ok: false; reason: string }

type Parsed = {
  name: string
  bees: string[]
  dependencies: string[]
  cells: string[]
  description: string
  extra: Record<string, unknown>
  docs: Record<string, unknown> | null
}

const OWN_KEYS = new Set(['name', 'cells', 'bees', 'dependencies', 'docs', 'edits', 'face'])

const bare = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase().replace(/\.(?:js|json)$/, '')

const sigsOf = (list: unknown): string[] =>
  (Array.isArray(list) ? list : [])
    .map(entry => bare(typeof entry === 'string' ? entry : (entry as { sig?: unknown })?.sig))
    .filter(sig => SIG_RE.test(sig))

const parseLayer = (bytes: Uint8Array): Parsed | null => {
  try {
    const record = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> & {
      name?: unknown
      cells?: unknown
      bees?: unknown
      dependencies?: unknown
      docs?: { description?: unknown }
    }
    if (!record || typeof record !== 'object') return null
    const extra: Record<string, unknown> = {}
    for (const key of Object.keys(record)) if (!OWN_KEYS.has(key)) extra[key] = record[key]
    const docs = record.docs && typeof record.docs === 'object' ? { ...record.docs } : null
    return {
      name: String(record.name ?? '').trim(),
      bees: sigsOf(record.bees),
      dependencies: sigsOf(record.dependencies),
      cells: sigsOf(record.cells),
      description: String(record.docs?.description ?? '').trim(),
      extra,
      docs,
    }
  } catch { return null }
}

const signOf = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

const encodeLayer = async (layer: CanonicalLayerContent): Promise<{ sig: string; bytes: Uint8Array<ArrayBuffer> }> => {
  const bytes = new TextEncoder().encode(canonicalLayerJson(layer))
  const owned = bytes.buffer.byteLength === bytes.byteLength ? bytes as Uint8Array<ArrayBuffer> : bytes.slice()
  return { sig: await signOf(owned), bytes: owned }
}

/** One signature, verified against the bytes a base serves. A mismatch is a miss. */
export const readVerified = async (
  base: string,
  sig: string,
  get: (url: string) => Promise<Response> = url => fetch(url, { cache: 'no-store' }),
): Promise<Uint8Array | null> => {
  if (!SIG_RE.test(sig)) return null
  try {
    const response = await get(`${base.replace(/\/$/, '')}/${sig}`)
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    return (await signOf(bytes)) === sig ? bytes : null
  } catch { return null }
}

/** The same signature, asked of every base a zone answers on. */
export const readFromZone = async (zone: string, sig: string): Promise<Uint8Array | null> => {
  for (const base of hostBases(zone)) {
    const bytes = await readVerified(base, sig)
    if (bytes) return bytes
  }
  return null
}

const cached = (read: BranchRead): BranchRead => {
  const box = new Map<string, Promise<Uint8Array | null>>()
  return sig => {
    let pending = box.get(sig)
    if (!pending) {
      pending = read(sig).catch(() => null)
      box.set(sig, pending)
    }
    return pending
  }
}

/** The branch behind one root: a folder per layer, a file per bee and dependency. */
export const readBranch = async (rootSig: string, read: BranchRead): Promise<Branch> => {
  if (!SIG_RE.test(rootSig)) return { root: rootSig, complete: false, nodes: [], files: [] }
  const load = cached(read)
  const nodes: LayerNode[] = []
  const files: BranchFile[] = []
  let complete = true

  const visit = async (sig: string, path: string): Promise<void> => {
    const parsed = parseLayer((await load(sig)) ?? new Uint8Array())
    if (!parsed) { complete = false; return }
    const node: LayerNode = {
      path,
      name: parsed.name,
      sig,
      bees: parsed.bees,
      dependencies: parsed.dependencies,
      children: [],
      description: parsed.description,
      extra: parsed.extra,
      docs: parsed.docs,
    }
    nodes.push(node)
    files.push({ path: parentOf(path), name: parsed.name || 'root', kind: 'layer', sig })
    for (const bee of parsed.bees) files.push({ path, name: bee, kind: 'bee', sig: bee })
    for (const dep of parsed.dependencies) files.push({ path, name: dep, kind: 'dependency', sig: dep })

    const seen = new Set<string>()
    const next: { sig: string; path: string }[] = []
    for (const childSig of parsed.cells) {
      const child = parseLayer((await load(childSig)) ?? new Uint8Array())
      if (!child) { complete = false; continue }
      const name = child.name.trim()
      if (!SEGMENT_RE.test(name) || seen.has(name)) { complete = false; continue }
      seen.add(name)
      next.push({ sig: childSig, path: path ? `${path}/${name}` : name })
    }
    node.children = next.map(child => child.path)
    await Promise.all(next.map(child => visit(child.sig, child.path)))
  }

  await visit(rootSig, '')
  return { root: rootSig, complete, nodes, files }
}

/** Folders, in path order, each with the files that sit directly in it. */
export const foldersOf = (files: readonly BranchFile[]): { path: string; files: BranchFile[] }[] => {
  const groups = new Map<string, BranchFile[]>()
  for (const file of files) {
    if (file.kind === 'layer') continue
    const group = groups.get(file.path) ?? []
    group.push(file)
    groups.set(file.path, group)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, rows]) => ({ path, files: rows }))
}

/** Layer signatures that differ at the same folder. */
export const diffBranches = (left: Branch, right: Branch): { path: string; left: string; right: string }[] => {
  const other = new Map(right.nodes.map(node => [node.path, node.sig]))
  return left.nodes
    .filter(node => other.has(node.path) && other.get(node.path) !== node.sig)
    .map(node => ({ path: node.path || 'root', left: node.sig, right: other.get(node.path)! }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

const underOff = (path: string, off: readonly string[]): boolean =>
  off.some(folder => path === folder || path.startsWith(`${folder}/`))

const wordOk = (word: string): boolean => SEGMENT_RE.test(word)
const pathOk = (path: string): boolean => path === '' || isPath(path)

const editRecord = (edits: BranchEdits): Record<string, unknown> | null => {
  const record: Record<string, unknown> = {}
  const choices = (edits.choices ?? [])
    .filter(choice => pathOk(choice.path) && choice.path !== '' && SIG_RE.test(choice.sig) && choice.source.trim())
    .map(choice => ({ path: choice.path, sig: choice.sig, source: choice.source.trim() }))
    .sort((a, b) => a.path.localeCompare(b.path))
  const off = [...new Set(edits.offPaths ?? [])].filter(isPath).sort()
  const offFiles = [...new Set(edits.offSigs ?? [])].filter(sig => SIG_RE.test(sig)).sort()
  const traits = (edits.traits ?? [])
    .filter(trait => pathOk(trait.path) && wordOk(trait.word))
    .map(trait => ({ path: trait.path, word: trait.word }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.word.localeCompare(b.word))
  if (choices.length) record['choices'] = choices
  if (off.length) record['off'] = off
  if (offFiles.length) record['offFiles'] = offFiles
  if (traits.length) record['traits'] = traits
  return Object.keys(record).length ? record : null
}

const hasEdits = (edits: BranchEdits): boolean => editRecord(edits) !== null

/**
 * Mint the root the edits describe. A file turned off, a trait added, or a
 * folder taken from another signature rewrites that layer and every layer
 * above it. The new bytes carry each file's path, so the folders can be
 * rebuilt from the history alone.
 */
export const mintBranch = async (branch: Branch, edits: BranchEdits = {}): Promise<MintedBranch | MintFailure> => {
  if (!branch.complete) return { ok: false, reason: 'The branch is missing files, so it cannot become a new root.' }
  const root = branch.nodes.find(node => node.path === '')
  if (!root) return { ok: false, reason: 'The signature did not open as a layer.' }
  for (const trait of edits.traits ?? []) {
    if (!pathOk(trait.path) || !wordOk(trait.word)) return { ok: false, reason: 'A trait is one word, on a folder.' }
  }
  for (const choice of edits.choices ?? []) {
    if (!isPath(choice.path) || !SIG_RE.test(choice.sig)) return { ok: false, reason: 'A choice names a folder and a signature.' }
    if (!branch.nodes.some(node => node.path === choice.path)) return { ok: false, reason: `No folder ${choice.path} to choose.` }
  }

  const offPaths = [...new Set(edits.offPaths ?? [])].filter(isPath)
  const offSigs = new Set((edits.offSigs ?? []).filter(sig => SIG_RE.test(sig)))
  const dropped = new Set<string>(offSigs)
  for (const file of branch.files) {
    if (file.kind !== 'layer' && (offSigs.has(file.sig) || underOff(file.path, offPaths))) dropped.add(file.sig)
  }
  const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.flatMap(item => {
        if (typeof item === 'string' && dropped.has(bare(item))) return []
        if (item && typeof item === 'object') return [scrub(item)]
        return [item]
      })
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = scrub(item)
      return out
    }
    return value
  }
  const choices = new Map((edits.choices ?? []).filter(choice => isPath(choice.path) && SIG_RE.test(choice.sig)).map(choice => [choice.path, choice.sig]))
  const byPath = new Map(branch.nodes.map(node => [node.path, node]))
  const layers = new Map<string, Uint8Array>()
  const moved = new Map<string, string>()
  const face = new Set<string>()
  const files: BranchFile[] = []

  const rebuild = async (node: LayerNode): Promise<{ sig: string; path: string; name: string } | null> => {
    if (node.path && underOff(node.path, offPaths)) return null
    const chosen = node.path ? choices.get(node.path) : undefined
    if (chosen && chosen !== node.sig) {
      face.add(chosen)
      files.push({ path: parentOf(node.path), name: node.name || node.path, kind: 'layer', sig: chosen })
      return { sig: chosen, path: node.path, name: node.name }
    }

    const children: { sig: string; path: string; name: string }[] = []
    for (const childPath of node.children) {
      const child = byPath.get(childPath)
      if (!child) return null
      const next = await rebuild(child)
      if (next) children.push(next)
    }
    const bees = node.bees.filter(sig => !offSigs.has(sig))
    const dependencies = node.dependencies.filter(sig => !offSigs.has(sig))
    const sameChildren = children.length === node.children.length
      && children.every((child, index) => child.sig === byPath.get(node.children[index]!)?.sig)
    const sameFiles = bees.length === node.bees.length && dependencies.length === node.dependencies.length
    if (sameChildren && sameFiles && !(node.path === '' && hasEdits(edits))) {
      face.add(node.sig)
      for (const sig of bees) face.add(sig)
      for (const sig of dependencies) face.add(sig)
      files.push({ path: parentOf(node.path), name: node.name || 'root', kind: 'layer', sig: node.sig })
      for (const sig of bees) files.push({ path: node.path, name: sig, kind: 'bee', sig })
      for (const sig of dependencies) files.push({ path: node.path, name: sig, kind: 'dependency', sig })
      return { sig: node.sig, path: node.path, name: node.name }
    }

    for (const sig of bees) face.add(sig)
    for (const sig of dependencies) face.add(sig)
    const layer: CanonicalLayerContent = { name: node.name, ...scrub(node.extra) as Record<string, unknown> }
    if (children.length) layer['cells'] = children.map(child => ({ path: child.path, sig: child.sig }))
    if (bees.length) layer['bees'] = bees.map(sig => ({ path: node.path, sig }))
    if (dependencies.length) layer['dependencies'] = dependencies.map(sig => ({ path: node.path, sig }))
    if (node.docs && Object.keys(node.docs).length) layer['docs'] = scrub(node.docs)
    if (node.path === '') {
      const record = editRecord(edits)
      if (record) layer['edits'] = record
      // The public list is every file still named, including those nested in
      // unchanged layers. It cannot name this new root: that signature is the
      // hash of these bytes.
      const listed = [...face].sort()
      if (listed.length) layer['face'] = listed
    }
    const minted = await encodeLayer(layer)
    layers.set(minted.sig, minted.bytes)
    if (minted.sig !== node.sig) moved.set(node.sig, minted.sig)
    face.add(minted.sig)
    files.push({ path: parentOf(node.path), name: node.name || 'root', kind: 'layer', sig: minted.sig })
    for (const sig of bees) files.push({ path: node.path, name: sig, kind: 'bee', sig })
    for (const sig of dependencies) files.push({ path: node.path, name: sig, kind: 'dependency', sig })
    return { sig: minted.sig, path: node.path, name: node.name }
  }

  const mintedRoot = await rebuild(root)
  if (!mintedRoot) return { ok: false, reason: 'The root was turned off.' }
  return {
    ok: true,
    rootSig: mintedRoot.sig,
    layers,
    moved,
    files,
    face: [...face].sort(),
    complete: true,
  }
}

/** The new merkle layers, in one gzip pack. Kept bees stay the verified files they already are. */
export const packFiles = (files: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array<ArrayBuffer>> =>
  gzipBytes(encodeTransferPack([...files].map(([sig, bytes]) => [sig, bytes] as const)))

export const packMint = (minted: MintedBranch): Promise<Uint8Array<ArrayBuffer>> =>
  packFiles(minted.layers)

/** Unpack a local build back into signature-named layers. */
export const unpackMint = async (pack: Uint8Array): Promise<Array<[string, Uint8Array<ArrayBuffer>]> | null> => {
  try { return decodeTransferPack(await gunzipBytes(pack)) } catch { return null }
}

/** Where a mission's AI runs. Empty when the name cannot be a sandbox door. */
export const missionOrigin = (zone: string, mission: string): string => {
  const raw = mission.trim().toLowerCase()
  const label = raw.startsWith('try-') ? raw : raw ? `try-${raw}` : ''
  if (!isSandboxLabel(label)) return ''
  const host = zone.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0] ?? ''
  if (!host) return ''
  const loopback = /^(localhost|127(?:\.\d+){3})(:\d{1,5})?$/.test(host) || /(^|\.)localhost(:\d{1,5})?$/.test(host)
  if (!loopback && !host.includes('.')) return ''
  return `${loopback ? 'http:' : 'https:'}//${label}.${host}/`
}

export type AiMount = {
  loaded: boolean
  origin: string
  release: () => void
}

/**
 * Load the AI module from a mission subdomain. Until this runs, nothing is
 * fetched. The frame's origin is its own store: saves land there.
 */
export const loadAi = (origin: string, into: HTMLElement): AiMount => {
  if (!origin) return { loaded: false, origin: '', release: () => {} }
  const frame = document.createElement('iframe')
  frame.className = 'mission-ai'
  frame.title = 'Mission'
  frame.referrerPolicy = 'no-referrer'
  frame.src = origin
  into.append(frame)
  return { loaded: true, origin, release: () => { frame.remove() } }
}

export const PUBLIC_FACE = 'hc:public-face'

/** Tell any mission listening on this device which files the build still names. */
export const broadcastFace = (face: readonly string[]): boolean => {
  if (typeof BroadcastChannel === 'undefined') return false
  const channel = new BroadcastChannel(PUBLIC_FACE)
  try { channel.postMessage({ face: [...face] }) } finally { channel.close() }
  return true
}
