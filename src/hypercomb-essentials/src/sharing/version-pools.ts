// sharing/version-pools.ts
//
// THE VERSION POOLS, HELD IN THE BROWSER. The minimal build's code lives only
// through replication: every revision of the host and of the package — the
// install, the source as tiles, the workspace a rebuild reads, and the
// participants' signatures on each — sits in two pools of meaning,
// `host:builds` and `host:build-signatures` (hypercomb-shim/host/builds.mjs).
// A host serves them at `/<sign(meaning)>/`, one file per signature.
//
// This brings them into the browser: a device that pulls them holds the whole
// history in its own storage, with no disk outside the browser, and is a
// backup like any follower. Every file is taken by its name and kept only if
// it hashes to that name; a signature event counts only if it verifies. The
// browser asks for persistent storage first, so the pools are not cleared
// when the browser needs room. Flushing is moving what matters to hosts
// (their `pull` from wherever this device is served), then deleting here.
//
// The same addresses Node uses (sha256 of the meaning, the same file names),
// so the browser's pools and a host's are one set: what one holds, the other
// can take.

import { SignatureService } from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools/pure'

export const BUILDS_MEANING = 'host:builds'
export const SIGNATURES_MEANING = 'host:build-signatures'
export const BUILD_SIGNATURE_KIND = 30567
// `builder`: someone who built another's draft — vouching for the build,
// never for the work (hypercomb-shim host/builds.mjs ROLES, the same).
export const ROLES = ['author', 'reviewer', 'witness', 'builder'] as const
/** A draft's channel (builds.mjs DRAFTS_SUFFIX): seen, never taken as the
 *  channel's next until reviewed and adopted. */
export const DRAFTS_SUFFIX = '-drafts'
export type Role = typeof ROLES[number]

const SIG = /^[a-f0-9]{64}$/
const STORE_KEY = '@hypercomb.social/Store'
/** Files fetched at once from one host. */
const AT_ONCE = 8

/** Where pools are kept. The browser's is OPFS (the Store's pool
 *  directories); a spec gives a map. */
export interface PoolIo {
  names(meaning: string): Promise<string[]>
  read(meaning: string, name: string): Promise<Uint8Array | null>
  write(meaning: string, name: string, bytes: Uint8Array): Promise<void>
}

type StoreLike = {
  getPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
  openPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
  /** Keep a verified atom in a pool by its name (runtime store.ts). */
  keepPoolAtom?(meaning: string, signature: string, bytes: Uint8Array): Promise<boolean>
}
const store = (): StoreLike | undefined =>
  (globalThis as { ioc?: { get?: <T>(key: string) => T | undefined } }).ioc?.get?.<StoreLike>(STORE_KEY)

/** A pool's directory, once found: a pool not made yet is looked for again,
 *  and so is one whose directory stopped answering (removed, then made anew). */
const dirs = new Map<string, FileSystemDirectoryHandle>()
const poolDir = async (meaning: string, again = false): Promise<FileSystemDirectoryHandle | null> => {
  const held = again ? undefined : dirs.get(meaning)
  if (held) return held
  const dir = await (store()?.openPool ?? store()?.getPool)?.call(store(), meaning).catch(() => null) ?? null
  if (dir) dirs.set(meaning, dir)
  else dirs.delete(meaning)
  return dir
}
/** `use` on the pool's directory; once more on a fresh one if the one held
 *  stopped answering. */
const inPool = async <T>(meaning: string, use: (dir: FileSystemDirectoryHandle) => Promise<T>, none: T): Promise<T> => {
  for (const again of [false, true]) {
    const dir = await poolDir(meaning, again)
    if (!dir) return none
    try { return await use(dir) } catch { if (again) return none }
  }
  return none
}
let shared: PoolIo | null = null

/** The Store's pool directories: read without creating; written through
 *  the Store, which keeps an atom only under its own name. One for the page,
 *  so what a scan learns of its files (poolHeads) is learned once. */
export const opfsPools = (): PoolIo => shared ??= {
  names: meaning => inPool(meaning, async dir => {
    const out: string[] = []
    for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind === 'file' && SIG.test(name)) out.push(name)
    }
    return out
  }, [] as string[]),
  read: (meaning, name) => inPool(meaning, async dir => new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer()), null),
  async write(meaning, name, bytes) {
    const keep = store()?.keepPoolAtom
    if (!keep) throw new Error('this browser holds no pools (no storage)')
    if (!await keep.call(store(), meaning, name, bytes)) throw new Error(`${name.slice(0, 12)} was not kept: not what it is named`)
  },
}

/** Files read at once from this browser's own pools: OPFS answers many
 *  reads at once far faster than one after another. */
const READ_AT_ONCE = 32
/** Enough of a file's start to tell a revision or a draft record by. */
export const HEAD_BYTES = 16
/** What each pool file begins with, per pools, by pool and name. */
const headsSeen = new WeakMap<PoolIo, Map<string, string>>()

/**
 * What each file of a pool begins with, by name. A file is named by its
 * bytes, so its start never changes: a scan reads only the files it has not
 * seen, and the next — every /agent turn, every /versions — lists the pool and
 * reads nothing more. The start of a revision or a draft record is its kind.
 */
export const poolHeads = async (io: PoolIo, meaning: string): Promise<Map<string, string>> => {
  let seen = headsSeen.get(io)
  if (!seen) headsSeen.set(io, seen = new Map())
  const names = await io.names(meaning)
  const fresh = names.filter(name => !seen.has(`${meaning}\n${name}`))
  for (let i = 0; i < fresh.length; i += READ_AT_ONCE) {
    await Promise.all(fresh.slice(i, i + READ_AT_ONCE).map(async name => {
      const bytes = await io.read(meaning, name)
      if (bytes) seen.set(`${meaning}\n${name}`, new TextDecoder().decode(bytes.subarray(0, HEAD_BYTES)))
    }))
  }
  return new Map(names.map(name => [name, seen.get(`${meaning}\n${name}`) ?? '']))
}

const signOf = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

/** Where a host serves its pools: at its root, or under `/content`. */
const basesOf = (host: string): string[] => {
  const base = /^https?:\/\//.test(host) ? host.replace(/\/+$/, '') : `https://${host}`
  return [base, `${base}/content`]
}

/** Ask the browser not to clear these when it needs room. True when granted
 *  (or already granted); false when refused or not offered. */
export const keepPools = async (): Promise<boolean> => {
  try {
    const storage = (globalThis.navigator as Navigator | undefined)?.storage
    if (await storage?.persisted?.()) return true
    return (await storage?.persist?.()) === true
  } catch { return false }
}

export type PullReport = { host: string; answered: boolean; taken: number; refused: number; held: number }

/** Take what `host` serves of both pools that this browser does not hold.
 *  A file that does not hash to its name is refused, never kept. */
export const pullVersionPools = async (
  host: string,
  io: PoolIo = opfsPools(),
  get: typeof fetch = (input, init) => fetch(input, init),
): Promise<PullReport> => {
  const report: PullReport = { host, answered: false, taken: 0, refused: 0, held: 0 }
  for (const base of basesOf(host)) {
    for (const meaning of [BUILDS_MEANING, SIGNATURES_MEANING]) {
      const pool = await SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer)
      const listing = await get(`${base}/${pool}/`, { cache: 'no-store' }).catch(() => null)
      if (!listing?.ok) continue
      report.answered = true
      const names = (await listing.text()).split(/\r?\n/).map(name => name.trim()).filter(name => SIG.test(name))
      const held = new Set(await io.names(meaning))
      const wanted = names.filter(name => !held.has(name))
      report.held += names.length - wanted.length
      for (let i = 0; i < wanted.length; i += AT_ONCE) {
        await Promise.all(wanted.slice(i, i + AT_ONCE).map(async name => {
          const response = await get(`${base}/${pool}/${name}`).catch(() => null)
          if (!response?.ok) return
          const bytes = new Uint8Array(await response.arrayBuffer())
          if (await signOf(bytes) !== name) { report.refused++; return }
          await io.write(meaning, name, bytes)
          report.taken++
        }))
      }
    }
    if (report.answered) break
  }
  return report
}

/** A record read while walking: its JSON, or null when it is not one or is
 *  not to be had. */
export type RecordReader = (sig: string) => Promise<unknown>

/** Records read at once while walking a tree. */
const WALK_AT_ONCE = 32
/** What a tree node names that is never walked into (source-tree.mjs). */
const TREE_LEAVES = ['dependency', 'cell', 'namespace', 'package', 'output', 'host', 'library', 'hostPackage']

const sigOf = (value: unknown): string | null => typeof value === 'string' && SIG.test(value) ? value : null
const objectOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const listOf = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : []

/** Every signature a source tree reaches — records, envelopes, resources, the
 *  package's atoms (hypercomb-shim host/source-tree.mjs walkTree, the same
 *  rule), walked a level at a time. What is walked is kept apart from what
 *  is reached, so a signature named as a leaf somewhere and as a record
 *  elsewhere is walked all the same, whatever the order. */
const treeReach = async (roots: readonly string[], read: RecordReader): Promise<Set<string>> => {
  const reach = new Set<string>()
  const walked = new Set<string>()
  const leaf = (value: unknown): void => { const sig = sigOf(value); if (sig) reach.add(sig) }
  const visit = (value: unknown, into: string[]): void => {
    const sig = sigOf(value)
    if (sig && !walked.has(sig)) { walked.add(sig); reach.add(sig); into.push(sig) }
  }
  let frontier: string[] = []
  for (const root of roots) visit(root, frontier)
  while (frontier.length) {
    const next: string[] = []
    for (let i = 0; i < frontier.length; i += WALK_AT_ONCE) {
      await Promise.all(frontier.slice(i, i + WALK_AT_ONCE).map(async sig => {
        const node = objectOf(await read(sig))
        if (!node) return
        if (node['meta'] === 1) {
          // An envelope: its target is a record to walk, or a leaf.
          leaf(node['resource'])
          leaf(node['bee'])
          visit(node['layer'], next)
          return
        }
        for (const key of TREE_LEAVES) leaf(node[key])
        for (const dependency of listOf(node['dependencies'])) leaf(dependency)
        visit(node['content'], next)
        visit(node['bee'], next)
        for (const child of listOf(node['children'])) visit(child, next)
      }))
    }
    frontier = next
  }
  return reach
}

/**
 * EVERYTHING A REVISION NEEDS TO STAND ON ITS OWN, by the same walk Node
 * takes (hypercomb-shim host/builds.mjs closureOf), so what a builder carries
 * and what a browser takes are one set: each revision; its install, source
 * and workspace layers and their files; its atoms and conversations; every
 * record, envelope and resource of its tree; and the draft it was built from,
 * with that draft's files.
 */
export const revisionClosure = async (sigs: readonly string[], read: RecordReader): Promise<Set<string>> => {
  const reach = new Set<string>()
  const filesOf = async (layer: string): Promise<string[]> =>
    Object.values(objectOf(objectOf(await read(layer))?.['files']) ?? {}).map(sigOf).filter((sig): sig is string => !!sig)
  const trees: string[] = []
  for (const sig of sigs) {
    reach.add(sig)
    const record = objectOf(await read(sig))
    if (!record) continue
    for (const part of ['install', 'source', 'workspace']) {
      const layer = sigOf(record[part])
      if (!layer) continue
      reach.add(layer)
      for (const file of await filesOf(layer)) reach.add(file)
    }
    for (const atom of [...listOf(record['atoms']), ...listOf(record['conversations'])]) { const s = sigOf(atom); if (s) reach.add(s) }
    const tree = sigOf(record['tree'])
    if (tree) trees.push(tree)
    const draft = sigOf(record['draft'])
    const draftFiles = draft ? sigOf(objectOf(await read(draft))?.['files']) : null
    if (draft && draftFiles) {
      reach.add(draft)
      reach.add(draftFiles)
      for (const file of await filesOf(draftFiles)) reach.add(file)
    }
  }
  for (const sig of await treeReach(trees, read)) reach.add(sig)
  return reach
}

export type Revision = {
  sig: string
  label: string
  version: string
  parent: string | null
  /** What the revision carries, by part: install, tree, workspace, package… */
  parts: string[]
  signers: { role: string; pubkey: string; ok: boolean }[]
  /** Built from a participant's draft (sharing/version-drafts.ts): its author,
   *  by the signed ask that names it — null when the ask does not verify. */
  from: { draft: string; ask: string; author: string | null } | null
  /** Built from a draft and not yet adopted into its channel. */
  awaitingReview: boolean
  /** Adopted from the reviewed draft revision this names. */
  reviewed: string | null
}

/** The ask a draft was sent with (version-drafts.ts, the same constants). */
const ASK_KIND = 30568
const askPreimage = (draftSig: string): string => `hc:ask:v1\n${draftSig}`

const order = (version: string): number =>
  version.split('.').map(Number).reduce((n, part, i) => n + part * ([1e8, 1e6, 1e4, 1][i] ?? 0), 0)
const PARTS = ['install', 'host', 'library', 'hostPackage', 'source', 'package', 'tree', 'workspace']
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
/** How a revision record begins (builds.mjs writes `name` first). */
export const BUILD_HEAD = '{"name":"build",'

/** The preimage a participant signs for a revision (builds.mjs, the same). */
export const signaturePreimage = (buildSig: string, version: string, role: string): string =>
  `hc:build:v1\n${buildSig}\n${version}\n${role}`

type SignatureEvent = { kind?: number; pubkey?: string; content?: string; tags?: string[][]; id?: string; sig?: string; created_at?: number }
const tag = (event: SignatureEvent, name: string): string | undefined => event.tags?.find(t => t[0] === name)?.[1]

/** Every promoted revision this browser holds, newest first, each with its
 *  signatures checked. A stage is a device's own and never travels. */
export const versionRevisions = async (io: PoolIo = opfsPools()): Promise<Revision[]> => {
  const events: SignatureEvent[] = []
  for (const name of await io.names(SIGNATURES_MEANING)) {
    const bytes = await io.read(SIGNATURES_MEANING, name)
    try { if (bytes) events.push(JSON.parse(decode(bytes)) as SignatureEvent) } catch { /* not an event */ }
  }
  const out: Revision[] = []
  for (const [name, head] of await poolHeads(io, BUILDS_MEANING)) {
    if (head !== BUILD_HEAD) continue
    const bytes = await io.read(BUILDS_MEANING, name)
    if (!bytes) continue
    let record: Record<string, unknown>
    try { record = JSON.parse(decode(bytes)) as Record<string, unknown> } catch { continue }
    const version = record['version'], label = record['label']
    if (typeof version !== 'string' || typeof label !== 'string' || version === 'staged') continue
    const seen = new Map<string, { role: string; pubkey: string; ok: boolean }>()
    for (const event of events) {
      if (tag(event, 'b') !== name) continue
      const role = tag(event, 'r') ?? ''
      let ok = false
      try {
        ok = (ROLES as readonly string[]).includes(role) && event.kind === BUILD_SIGNATURE_KIND
          && event.content === signaturePreimage(name, version, role) && verifyEvent(event as never)
      } catch { ok = false }
      const key = `${role}\n${event.pubkey}`
      seen.set(key, { role, pubkey: String(event.pubkey ?? ''), ok: ok || seen.get(key)?.ok === true })
    }
    let from: Revision['from'] = null
    const draft = record['draft'], ask = record['ask']
    if (typeof draft === 'string' && typeof ask === 'string') {
      let author: string | null = null
      const bytes = await io.read(SIGNATURES_MEANING, ask)
      try {
        const event = bytes ? JSON.parse(decode(bytes)) as SignatureEvent : null
        if (event && event.kind === ASK_KIND && tag(event, 'd') === draft && event.content === askPreimage(draft) && verifyEvent(event as never)) author = String(event.pubkey)
      } catch { author = null }
      from = { draft, ask, author }
    }
    out.push({
      sig: name, label, version,
      parent: typeof record['parent'] === 'string' ? record['parent'] : null,
      parts: PARTS.filter(part => record[part] !== undefined && record[part] !== null),
      signers: [...seen.values()],
      from,
      awaitingReview: label.endsWith(DRAFTS_SUFFIX),
      reviewed: typeof record['reviewed'] === 'string' ? record['reviewed'] : null,
    })
  }
  return out.sort((a, b) => order(b.version) - order(a.version) || (a.sig < b.sig ? -1 : 1))
}
