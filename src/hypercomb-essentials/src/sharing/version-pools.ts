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
export const ROLES = ['author', 'reviewer', 'witness'] as const
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

type StoreLike = { getPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>; openPool?(meaning: string): Promise<FileSystemDirectoryHandle | null> }
const store = (): StoreLike | undefined =>
  (globalThis as { ioc?: { get?: <T>(key: string) => T | undefined } }).ioc?.get?.<StoreLike>(STORE_KEY)

/** The Store's pool directories: read without creating, write creating. */
export const opfsPools = (): PoolIo => ({
  async names(meaning) {
    const dir = await (store()?.openPool ?? store()?.getPool)?.(meaning).catch(() => null)
    if (!dir) return []
    const out: string[] = []
    for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind === 'file' && SIG.test(name)) out.push(name)
    }
    return out
  },
  async read(meaning, name) {
    try {
      const dir = await (store()?.openPool ?? store()?.getPool)?.(meaning)
      if (!dir) return null
      return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer())
    } catch { return null }
  },
  async write(meaning, name, bytes) {
    const dir = await store()?.getPool?.(meaning)
    if (!dir) throw new Error('this browser holds no pools (no storage)')
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
    try { await writable.write(bytes as unknown as ArrayBuffer) } finally { await writable.close() }
  },
})

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
}

/** The ask a draft was sent with (version-drafts.ts, the same constants). */
const ASK_KIND = 30568
const askPreimage = (draftSig: string): string => `hc:ask:v1\n${draftSig}`

const order = (version: string): number =>
  version.split('.').map(Number).reduce((n, part, i) => n + part * ([1e8, 1e6, 1e4, 1][i] ?? 0), 0)
const PARTS = ['install', 'host', 'library', 'hostPackage', 'source', 'package', 'tree', 'workspace']
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const BUILD_HEAD = '{"name":"build",'

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
  for (const name of await io.names(BUILDS_MEANING)) {
    const bytes = await io.read(BUILDS_MEANING, name)
    if (!bytes || bytes.length < BUILD_HEAD.length || decode(bytes.subarray(0, BUILD_HEAD.length)) !== BUILD_HEAD) continue
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
    })
  }
  return out.sort((a, b) => order(b.version) - order(a.version) || (a.sig < b.sig ? -1 : 1))
}
