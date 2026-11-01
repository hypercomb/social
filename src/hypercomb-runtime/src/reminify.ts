// hypercomb-runtime/src/reminify.ts
//
// A package registration changed. A commit appended a root to host:packages,
// or a pick on the hosts window composed which behaviors run. The readable
// trunk stays what the hive runs. This derives the minified tree of that
// registration with this shell's transpiler and holds the bytes, so the
// derivation is a member of `derived:<that registration>`.
//
// The same package in the same page is not walked twice. A later activation
// of a package whose record is already in that pool is not walked either.

import { deriveMinifiedLayer, derivedMeaning, minifyModuleBody, ownedMinifyTool, SignatureService } from '@hypercomb/core'
import { isOff, parentOf } from './package-tree.js'

const SIG_RE = /^[a-f0-9]{64}$/

export type ReminifyIo = {
  read(sig: string): Promise<Uint8Array | null>
  write?(sig: string, bytes: Uint8Array): Promise<void>
  /** Name `sig` as a member of the pool `meaning`. Empty file, bytes live at the signature. */
  member?(meaning: string, sig: string): Promise<void>
  /** A derivation record already held for this package and tool, or null. */
  recall?(rootSig: string, tool: string): Promise<string | null>
}

export type Reminified = {
  readonly root: string
  readonly derivation: string
  readonly pool: string
  /** True when a record for this package and tool was already held. */
  readonly skipped: boolean
}

const remembered = new Map<string, Reminified>()

/** The registration a host pick composed: the trunk, the behaviors chosen at
 *  a path, and the paths left off. */
export type RegistrationSelection = {
  readonly picks: Readonly<Record<string, { readonly layer: string }>>
  readonly off: ReadonlySet<string>
  /** The dependency signatures the selection runs, when they were composed. */
  readonly dependencies?: readonly string[]
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const signOf = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

const bareSig = (entry: unknown): string => {
  const raw = typeof entry === 'string'
    ? entry
    : entry && typeof entry === 'object'
      ? String((entry as { sig?: unknown }).sig ?? '')
      : ''
  const bare = raw.replace(/\.js$/i, '').trim().toLowerCase()
  return SIG_RE.test(bare) ? bare : ''
}

const sigList = (list: unknown): string[] =>
  (Array.isArray(list) ? list : []).map(bareSig).filter(sig => SIG_RE.test(sig))

const spell = (entry: unknown, sig: string): unknown => {
  if (typeof entry === 'string') return `${sig}${entry.trim().toLowerCase().endsWith('.js') ? '.js' : ''}`
  if (entry && typeof entry === 'object') return { ...(entry as Record<string, unknown>), sig }
  return sig
}

/** The readable root of what this selection runs. Unchanged layers keep their
 *  signatures. The bytes are the projection only — nothing here installs them. */
export const projectRegistration = async (
  trunk: string,
  read: (sig: string) => Promise<Uint8Array | null>,
  selection: RegistrationSelection,
): Promise<{ root: string; files: Map<string, Uint8Array> } | null> => {
  const from = trunk.trim().toLowerCase()
  if (!SIG_RE.test(from)) return null
  const picks = selection.picks
  const off = selection.off
  const marks = [...Object.keys(picks), ...off]
  if (!marks.length && !selection.dependencies) return { root: from, files: new Map() }
  const touches = (path: string): boolean => marks.some(mark => mark === path || mark.startsWith(`${path}/`))
  const files = new Map<string, Uint8Array>()
  const reachable = new Set<string>()
  const layerOf = async (sig: string): Promise<Record<string, unknown> | null> => {
    const bytes = await read(sig)
    if (!bytes) return null
    try {
      const record = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
      return record && typeof record === 'object' ? record : null
    } catch { return null }
  }
  const collectBees = async (sig: string, trail: ReadonlySet<string>): Promise<void> => {
    if (trail.has(sig)) return
    const record = await layerOf(sig)
    if (!record) return
    for (const bee of sigList(record['bees'])) reachable.add(bee)
    const next = new Set(trail).add(sig)
    for (const entry of Array.isArray(record['cells']) ? record['cells'] as unknown[] : []) {
      const child = bareSig(entry)
      if (child) await collectBees(child, next)
    }
  }
  const mint = async (sig: string, path: string): Promise<string> => {
    const record = await layerOf(sig)
    if (!record) throw new Error(`the layer ${sig.slice(0, 12)} is not held here`)
    const cells: unknown[] = []
    const named = new Set<string>()
    let changed = false
    for (const entry of Array.isArray(record['cells']) ? record['cells'] as unknown[] : []) {
      const child = bareSig(entry)
      if (!child) { cells.push(entry); continue }
      const childRecord = await layerOf(child)
      const name = String(childRecord?.['name'] ?? '').trim()
      const at = name ? (path ? `${path}/${name}` : name) : ''
      if (at) named.add(name)
      if (at && isOff(at, off)) { changed = true; continue }
      const picked = at ? picks[at]?.layer.trim().toLowerCase() : ''
      let next = child
      if (picked && SIG_RE.test(picked)) next = await mint(picked, at)
      else if (at && touches(at)) next = await mint(child, at)
      if (next !== child) changed = true
      else await collectBees(child, new Set())
      cells.push(next === child ? entry : spell(entry, next))
    }
    for (const [pickPath, pick] of Object.entries(picks)) {
      const layer = pick.layer.trim().toLowerCase()
      if (parentOf(pickPath) !== path || !SIG_RE.test(layer) || isOff(pickPath, off)) continue
      const name = pickPath.slice(pickPath.lastIndexOf('/') + 1)
      if (named.has(name)) continue
      named.add(name)
      cells.push(await mint(layer, pickPath))
      changed = true
    }
    for (const bee of sigList(record['bees'])) reachable.add(bee)
    const written: Record<string, unknown> = { ...record, ...(changed ? { cells } : {}) }
    if (!path) {
      for (const field of ['criticalBees', 'bootBees'] as const) {
        if (!Array.isArray(record[field])) continue
        const kept = (record[field] as unknown[]).filter(entry => reachable.has(bareSig(entry)))
        if (JSON.stringify(kept) !== JSON.stringify(record[field])) {
          written[field] = kept
          changed = true
        }
      }
      if (selection.dependencies) {
        const listed = Array.isArray(record['dependencies']) ? record['dependencies'] as unknown[] : []
        const suffix = typeof listed[0] === 'string' && listed[0].toLowerCase().endsWith('.js') ? '.js' : ''
        const have = sigList(listed).sort()
        const want = [...new Set(selection.dependencies.map(item => item.trim().toLowerCase().replace(/\.js$/i, '')).filter(item => SIG_RE.test(item)))].sort()
        if (JSON.stringify(have) !== JSON.stringify(want)) {
          written['dependencies'] = want.map(item => `${item}${suffix}`)
          changed = true
        }
      }
    }
    if (!changed) return sig
    const bytes = encode(JSON.stringify(written))
    const next = await signOf(bytes)
    files.set(next, bytes)
    return next
  }
  try {
    return { root: await mint(from, ''), files }
  } catch {
    return null
  }
}

/** Derive `rootSig` with this shell's transpiler. Null when it cannot be read. */
export const reminifyRegistered = async (rootSig: string, io: ReminifyIo): Promise<Reminified | null> => {
  const from = rootSig.trim().toLowerCase()
  if (!SIG_RE.test(from)) return null
  const pool = derivedMeaning(from)
  if (!pool) return null
  try {
    const held = remembered.get(from)
    if (held?.skipped) return held
    if (held?.root && await io.read(held.root)) return held
    const tool = await ownedMinifyTool()
    const prior = await io.recall?.(from, tool.name) ?? null
    if (prior && SIG_RE.test(prior)) {
      const skipped: Reminified = { root: '', derivation: prior, pool, skipped: true }
      remembered.set(from, skipped)
      return skipped
    }
    const tree = await deriveMinifiedLayer(from, io.read, async body => minifyModuleBody(body), tool)
    if (io.write) {
      for (const [sig, bytes] of tree.files) await io.write(sig, bytes)
      await io.write(tree.membership.dialect, tree.membership.dialectBytes)
    }
    if (io.member) {
      await io.member(tree.membership.pool, tree.membership.member)
      await io.member(tree.membership.dialects, tree.membership.dialect)
    }
    const made: Reminified = { root: tree.root, derivation: tree.derivation.sig, pool, skipped: false }
    remembered.set(from, made)
    return made
  } catch {
    return null
  }
}

/** Reminify the registration a pick composed. The readable trunk stays what
 *  runs. Null when the projection cannot be read; the pick still stands. */
export const reminifyRegistration = async (
  trunk: string,
  selection: RegistrationSelection,
  io: ReminifyIo,
): Promise<Reminified | null> => {
  const projected = await projectRegistration(trunk, io.read, selection)
  if (!projected) return null
  return reminifyRegistered(projected.root, {
    ...io,
    read: async sig => projected.files.get(sig) ?? await io.read(sig),
  })
}

type PoolHandle = { getFileHandle(name: string, options: { create: boolean }): Promise<unknown>; entries(): AsyncIterable<[string, unknown]> }
type LiveStore = {
  hypercombRoot?: { getFileHandle(name: string): Promise<{ getFile(): Promise<Blob> }> }
  bees?: { getFileHandle(name: string): Promise<{ getFile(): Promise<Blob> }> }
  dependencies?: { getFileHandle(name: string): Promise<{ getFile(): Promise<Blob> }> }
  putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
  getPool?: (meaning: string) => Promise<PoolHandle | null>
  openPool?: (meaning: string) => Promise<PoolHandle | null>
}

const bytesOf = async (file: { getFile(): Promise<Blob> }): Promise<Uint8Array> =>
  new Uint8Array(await (await file.getFile()).arrayBuffer())

const readNamed = async (
  dir: { getFileHandle(name: string): Promise<{ getFile(): Promise<Blob> }> } | undefined,
  names: readonly string[],
): Promise<Uint8Array | null> => {
  if (!dir) return null
  for (const name of names) {
    try { return await bytesOf(await dir.getFileHandle(name)) } catch { /* the next spelling */ }
  }
  return null
}

const liveIo = (): ReminifyIo | null => {
  const store = (globalThis as { ioc?: { get?: (key: string) => LiveStore | undefined } }).ioc
    ?.get?.('@hypercomb.social/Store')
  if (!store?.putResource) return null
  const read = async (sig: string): Promise<Uint8Array | null> =>
    await readNamed(store.hypercombRoot, [sig])
    ?? await readNamed(store.bees, [`${sig}.js`, sig])
    ?? await readNamed(store.dependencies, [`${sig}.js`, sig])
  return {
    read,
    write: async (sig, bytes) => {
      const landed = await store.putResource!(new Blob([new Uint8Array(bytes)]), { emit: false })
      if (landed !== sig) throw new Error('minified bytes did not land at their signature')
    },
    member: async (meaning, sig) => {
      const pool = await store.getPool?.(meaning)
      if (pool) await pool.getFileHandle(sig, { create: true })
    },
    recall: async (from, tool) => {
      const meaning = derivedMeaning(from)
      const pool = meaning ? await store.openPool?.(meaning) : null
      if (!pool) return null
      for await (const [name] of pool.entries()) {
        if (!SIG_RE.test(name)) continue
        const bytes = await read(name)
        if (!bytes) continue
        try {
          const record = JSON.parse(new TextDecoder().decode(bytes)) as { kind?: unknown; from?: unknown; tool?: unknown }
          if (record.kind === 'minify' && record.from === from && record.tool === tool) return name
        } catch { /* not this record */ }
      }
      return null
    },
  }
}

/** One readable root, reminified into this origin's store. */
export const reminifyLive = async (rootSig: string): Promise<Reminified | null> => {
  const io = liveIo()
  if (!io) return null
  return reminifyRegistered(rootSig, io)
}

/** The behaviors picked from the hosts, reminified as the registration they
 *  compose. The readable trunk stays what this origin runs. */
export const reminifyLiveRegistration = async (
  trunk: string,
  selection: RegistrationSelection,
): Promise<Reminified | null> => {
  const io = liveIo()
  if (!io) return null
  return reminifyRegistration(trunk, selection, io)
}
