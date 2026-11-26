// pools/offered-pool.ts
//
// A POOL OF MEANING, OFFERED FROM YOUR OWN ROOT DOMAIN AND GATHERED FROM THE
// HOSTS YOU FOLLOW. The two halves of one row of the relational database
// (documentation/pools-as-relational-database.md, T9):
//
//   LEAVING  a participant sends their members to the host they named and
//            stamps ONE key in their own signed index there, `pool:<meaning>`,
//            with the signature of a list document `{ meaning, members }` (the
//            shape sharing/published-pools.ts reads and mail/template-pool.ts
//            writes). The parts go before the head that names them (T1). With
//            no members the key is cleared: a withdrawal, never a delete, so
//            bytes already on a host stay valid (H4, M3).
//   GATHERING a reader learns a followed host's publisher keys from its
//            ledger, reads each key's signed index, takes the key's list and
//            fetches every member from that same host. The table is the union
//            across hosts, one row per signature (M3, P1).
//
// A listing is never proof (M1, M2): the index is trusted by its signature,
// and the list and every member only when the bytes hash to the name they
// were asked by (S3, T2). Whom a hive reads is the caller's choice (T5); this
// file reads exactly the hosts it is handed and writes only to the one named.
// It knows nothing about what a member is. Every read is bounded in time,
// size and count (a body is let go the moment it runs past its size, never
// measured after it was held whole), and nothing here throws: a refusal is
// words, an unreachable host is an empty answer. Nothing registers here.

import { I18N_IOC_KEY, SignatureService, get, registerPoolMeaning, type I18nProvider } from '@hypercomb/core'
import { HOST_CONCURRENCY, fetchWithDeadline, mapBounded } from '../sharing/bounded-fetch.js'
import { clearHiveRoot, fetchHiveIndex, setHiveRoot } from '../sharing/hive-pointer.js'
import { publisherKeyHex } from '../sharing/key-list.client.js'
import { isPublishNode, originOf, zoneDoor } from '../sharing/zone-door.js'
import { readBodyCapped } from './bounded-body.js'

/** As many members as one host offers per meaning (sharing/published-pools.ts). */
export const OFFERED_MAX_MEMBERS = 64

const SIG = /^[a-f0-9]{64}$/
const LIST_MAX_BYTES = 64 * 1024
const MEMBER_MAX_BYTES = 256 * 1024
const LEDGER_MAX_BYTES = 1_000_000
const NAME_MAX = 160
/** Atoms one publish carries beside its members: what the members name. */
const CLOSURE_MAX = 512
/** Publisher keys read on one host, the primary first. */
const KEYS_MAX = 8
/** Hosts one gathering asks. */
const HOSTS_MAX = 16
const HOST_TIMEOUT_MS = 6_000

const STORE_KEY = '@hypercomb.social/Store'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const signatureOf = (bytes: Uint8Array): Promise<string> => SignatureService.sign(exact(bytes))

/** A pool meaning this file will offer or gather: `family:name`, no spaces (P4). */
const isOfferedMeaning = (meaning: unknown): meaning is string =>
  typeof meaning === 'string' && meaning.includes(':') && !/\s/.test(meaning) && meaning.length <= NAME_MAX

/** The key a publisher's signed index names an offered pool under. */
export const offeredRootKey = (meaning: string): string => `pool:${meaning}`

/** The list document's canonical bytes: the meaning, then the members once each in the order given. */
export const offeredListBytes = (meaning: string, members: readonly string[]): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ meaning, members: [...new Set(members)] }))

/** The members a list document names for `meaning`, once each, or null when the bytes are not such a list. */
export const offeredMembersOf = (bytes: Uint8Array, meaning: string): string[] | null => {
  try {
    if (bytes.byteLength > LIST_MAX_BYTES) return null
    const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
    const list = doc as { meaning?: unknown; members?: unknown }
    if (list.meaning !== meaning || !Array.isArray(list.members) || list.members.length > OFFERED_MAX_MEMBERS) return null
    if (!list.members.every(member => typeof member === 'string' && SIG.test(member))) return null
    return [...new Set(list.members as string[])]
  } catch { return null }
}

// ── leaving ─────────────────────────────────────────────────────────────────

/** What a publish does its work with. Injectable, so a spec needs no network and no IoC. */
export interface OfferedPublishDeps {
  /** Keep bytes in this hive's store; answers the signature they were kept under. */
  put(bytes: Uint8Array): Promise<string>
  /** The bytes this hive holds under a signature, or null. */
  bytesOf(sig: string): Promise<Uint8Array | null>
  /** Send these atoms to the host, in order, each read through `bytesOf`. */
  publish(host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>): Promise<{ ok: true } | { ok: false; error: string }>
  /** Name a signature under a key in the participant's own signed index on the host. */
  stamp(host: string, key: string, sig: string): Promise<{ ok: boolean; reason?: string }>
  /** Take a key out of the participant's own signed index on the host. */
  clear(host: string, key: string): Promise<{ ok: boolean; reason?: string }>
}

export type OfferedPublishResult =
  | { ok: true; host: string; meaning: string; count: number }
  | { ok: false; reason: string }

type PublishStore = {
  putResource?(blob: Blob, options?: { emit?: boolean }): Promise<string>
  getResourceLocal?(sig: string): Promise<Blob | null>
  getResource?(sig: string): Promise<Blob | null>
}
type PublishSync = {
  publishAtoms?(host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>):
    Promise<{ ok: true } | { ok: false; error: string }>
  publicHostDomain?(): string
  ownHostDomain?(): string
}

/** This hive's own services as publish deps: its store, its host service, its key. Null when either is not loaded. */
export const liveOfferedPublishDeps = (): OfferedPublishDeps | null => {
  const store = get<PublishStore>(STORE_KEY)
  const sync = get<PublishSync>(HOST_SYNC_KEY)
  const putResource = store?.putResource?.bind(store)
  const publishAtoms = sync?.publishAtoms?.bind(sync)
  if (!store || !putResource || !publishAtoms) return null
  return {
    put: bytes => putResource(new Blob([exact(bytes)], { type: 'application/json' }), { emit: false }),
    bytesOf: async sig => {
      const blob = await store.getResourceLocal?.(sig).catch(() => null) ?? await store.getResource?.(sig).catch(() => null) ?? null
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null
    },
    publish: (host, sigs, bytesOf) => publishAtoms(host, sigs, bytesOf),
    stamp: (host, key, sig) => setHiveRoot(host, key, sig),
    clear: (host, key) => clearHiveRoot(host, key),
  }
}

const sigsIn = (values: readonly string[]): string[] | null => {
  const out = new Set<string>()
  for (const value of values) {
    const sig = String(value ?? '').trim().toLowerCase()
    if (!SIG.test(sig)) return null
    out.add(sig)
  }
  return [...out]
}

/**
 * Leave `members` in the pool `meaning` on `host`: every closure atom, every
 * member and the list document are sent, and only then is the root key stamped
 * with the list's signature. With no members the key is cleared and nothing is
 * sent. Never throws.
 */
export async function publishOfferedPool(
  host: string,
  meaning: string,
  members: readonly string[],
  options: { closure?: readonly string[]; deps?: OfferedPublishDeps } = {},
): Promise<OfferedPublishResult> {
  try {
    if ((globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ === true) {
      return { ok: false, reason: t('offered.refuse.readonly', 'This visitor hive cannot publish.') }
    }
    if (!isOfferedMeaning(meaning)) {
      return { ok: false, reason: t('offered.refuse.meaning', 'A pool is named family:name, with a colon and no spaces.') }
    }
    const zone = zoneDoor(host)
    if (!zone || !isPublishNode(zone)) {
      return { ok: false, reason: t('offered.refuse.host', 'Name the host to publish to first.') }
    }
    const wanted = sigsIn(members)
    const closure = sigsIn(options.closure ?? [])
    if (!wanted || !closure) {
      return { ok: false, reason: t('offered.refuse.signature', 'A member of the pool is not a signature.') }
    }
    if (wanted.length > OFFERED_MAX_MEMBERS) {
      return { ok: false, reason: t('offered.refuse.members', 'A pool offers at most {max} members from one host.', { max: OFFERED_MAX_MEMBERS }) }
    }
    if (closure.length > CLOSURE_MAX) {
      return { ok: false, reason: t('offered.refuse.closure', 'These members name more than {max} other pieces.', { max: CLOSURE_MAX }) }
    }
    const deps = options.deps ?? liveOfferedPublishDeps()
    if (!deps) return { ok: false, reason: t('offered.refuse.unavailable', 'Host sync is unavailable.') }
    const key = offeredRootKey(meaning)

    if (wanted.length === 0) {
      const cleared = await deps.clear(zone, key)
      return cleared.ok
        ? { ok: true, host: zone, meaning, count: 0 }
        : { ok: false, reason: cleared.reason ?? t('offered.refuse.index', 'The signed index refused the change.') }
    }

    const list = offeredListBytes(meaning, wanted)
    const listSig = await signatureOf(list)
    // The store signs what it kept; another answer is not this list (S3).
    if (await deps.put(list) !== listSig) {
      return { ok: false, reason: t('offered.refuse.kept', 'The list of members could not be kept here.') }
    }
    // The parts before the head that names them: what the members name, the members, then the list.
    const atoms = [...new Set([...closure, ...wanted])].filter(sig => sig !== listSig)
    const sent = await deps.publish(zone, [...atoms, listSig], sig => sig === listSig ? Promise.resolve(list) : deps.bytesOf(sig))
    if (!sent.ok) return { ok: false, reason: sent.error }
    const stamped = await deps.stamp(zone, key, listSig)
    return stamped.ok
      ? { ok: true, host: zone, meaning, count: wanted.length }
      : { ok: false, reason: stamped.reason ?? t('offered.refuse.index', 'The signed index refused the change.') }
  } catch {
    return { ok: false, reason: t('offered.refuse.failed', 'The pool could not be published.') }
  }
}

// ── gathering ───────────────────────────────────────────────────────────────

/** One member a host offered: where, under whose key, and its verified bytes. */
export interface OfferedMember {
  host: string
  pubkey: string
  sig: string
  bytes: Uint8Array
}

/** A member of the union across hosts: `host` is the first that offered it, `hosts` every one that did. */
export type OfferedMemberUnion = OfferedMember & { hosts: string[] }

/** What a read does its work with. Every part optional: the live one stands in for any left out. */
export interface OfferedReadIo {
  /** The publisher keys a host's ledger names for it, the primary first. */
  keysOf?(host: string): Promise<readonly string[]>
  /** One key's verified roots on a host, or null for none or not verified. */
  indexOf?(host: string, pubkey: string): Promise<Record<string, string> | null>
  /** The bytes a host serves under a signature, no larger than `limit`, or null. */
  atom?(host: string, sig: string, limit: number): Promise<Uint8Array | null>
  /** The participant's own named host and the key they publish under, or null. */
  own?(): Promise<{ host: string; pubkey: string } | null>
}

/** The publishers of the site that answers at `zone`, as its ledger names them: primary first. */
const ledgerKeys = (text: string, zone: string): string[] => {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return [] }
  const rows = Array.isArray(raw) ? raw : Array.isArray((raw as { sites?: unknown } | null)?.sites) ? (raw as { sites: unknown[] }).sites : []
  const keys: string[] = []
  for (const row of rows.slice(0, 500)) {
    if (!row || typeof row !== 'object') continue
    const site = row as Record<string, unknown>
    const doors = Array.isArray(site['hosts']) ? (site['hosts'] as unknown[]).slice(0, 24) : []
    const hosts = [site['host'], ...doors.map(door => (door as { host?: unknown } | null)?.host)]
      .map(host => typeof host === 'string' ? host.trim().toLowerCase() : '')
    if (!hosts.includes(zone)) continue
    const publishers = (Array.isArray(site['publishers']) ? site['publishers'] as unknown[] : []).slice(0, 16)
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .sort((a, b) => Number(b['primary'] === true) - Number(a['primary'] === true))
    for (const publisher of publishers) {
      const key = String(publisher['pubkey'] ?? '').toLowerCase()
      if (SIG.test(key) && !keys.includes(key)) keys.push(key)
    }
  }
  return keys
}

const liveKeysOf = async (host: string): Promise<readonly string[]> => {
  try {
    const ledger = await registerPoolMeaning('host:publications')
    const response = await fetchWithDeadline(`${originOf(host)}/${ledger}?held`, { cache: 'no-store' }, { timeoutMs: HOST_TIMEOUT_MS })
    if (!response.ok || response.status === 204) return []
    const bytes = await readBodyCapped(response, LEDGER_MAX_BYTES)
    return bytes ? ledgerKeys(new TextDecoder().decode(bytes), host) : []
  } catch { return [] }
}

const liveIndexOf = async (host: string, pubkey: string): Promise<Record<string, string> | null> => {
  const read = await fetchHiveIndex(host, pubkey).catch(() => null)
  return read?.ok ? read.manifest.roots : null
}

/** `/<sig>`, then the legacy `/content/<sig>`: the first that serves bytes hashing to the name. */
const liveAtom = async (host: string, sig: string, limit: number): Promise<Uint8Array | null> => {
  for (const path of [`/${sig}`, `/content/${sig}`]) {
    try {
      const response = await fetchWithDeadline(`${originOf(host)}${path}`, {}, { timeoutMs: HOST_TIMEOUT_MS })
      if (!response.ok) continue
      const bytes = await readBodyCapped(response, limit)
      if (bytes?.byteLength && await signatureOf(bytes) === sig) return bytes
    } catch { /* the other spelling, then nothing */ }
  }
  return null
}

const liveOwn = async (): Promise<{ host: string; pubkey: string } | null> => {
  // The public host when one is named, else the home domain the hosts window names.
  const sync = get<PublishSync>(HOST_SYNC_KEY)
  const host = zoneDoor(sync?.publicHostDomain?.() || sync?.ownHostDomain?.() || '')
  const pubkey = host ? await publisherKeyHex({ known: true }).catch(() => '') : ''
  return host && SIG.test(pubkey) ? { host, pubkey } : null
}

/**
 * The members one host offers of the pool `meaning`: its ledger's publisher
 * keys (and the participant's own key on their own host, so their offer reads
 * back before the ledger lists them), each key's list, each member fetched and
 * kept only when its bytes hash to its name. At most OFFERED_MAX_MEMBERS, once
 * each, the first key that offered one named beside it. Never throws.
 */
export async function readOfferedPool(
  host: string,
  meaning: string,
  options: { io?: OfferedReadIo; maxMemberBytes?: number } = {},
): Promise<OfferedMember[]> {
  try {
    const zone = zoneDoor(host)
    if (!zone || !isOfferedMeaning(meaning)) return []
    const io = options.io ?? {}
    const atom = io.atom ?? liveAtom
    const indexOf = io.indexOf ?? liveIndexOf
    const limit = Math.max(1, Math.floor(options.maxMemberBytes ?? MEMBER_MAX_BYTES))
    const verified = async (sig: string, max: number): Promise<Uint8Array | null> => {
      const bytes = await atom(zone, sig, max).catch(() => null)
      return bytes && bytes.byteLength <= max && await signatureOf(bytes) === sig ? bytes : null
    }

    const listed = (await (io.keysOf ?? liveKeysOf)(zone).catch(() => [] as readonly string[])).slice(0, KEYS_MAX)
    const own = await (io.own ?? liveOwn)().catch(() => null)
    const keys = [...new Set([...listed, ...(own && zoneDoor(own.host) === zone ? [own.pubkey] : [])]
      .map(key => String(key ?? '').trim().toLowerCase()).filter(key => SIG.test(key)))]

    const key = offeredRootKey(meaning)
    const found = new Map<string, OfferedMember>()
    for (const pubkey of keys) {
      if (found.size >= OFFERED_MAX_MEMBERS) break
      const roots = await indexOf(zone, pubkey).catch(() => null)
      const listSig = String(roots?.[key] ?? '').toLowerCase()
      if (!SIG.test(listSig)) continue
      const list = await verified(listSig, LIST_MAX_BYTES)
      const members = list ? offeredMembersOf(list, meaning) : null
      if (!members) continue
      const wanted = members.filter(sig => !found.has(sig)).slice(0, OFFERED_MAX_MEMBERS - found.size)
      const fetched = await mapBounded(wanted, HOST_CONCURRENCY, sig => verified(sig, limit))
      wanted.forEach((sig, at) => {
        const bytes = fetched[at]
        if (bytes) found.set(sig, { host: zone, pubkey, sig, bytes })
      })
    }
    return [...found.values()]
  } catch { return [] }
}

/**
 * The pool `meaning` as the union of what these hosts offer: at most sixteen
 * hosts, a few at once, one row per signature. A member keeps the first host
 * that offered it, in the order the hosts were given, and names them all.
 */
export async function readOfferedPools(
  hosts: readonly string[],
  meaning: string,
  options: { io?: OfferedReadIo; maxMemberBytes?: number } = {},
): Promise<OfferedMemberUnion[]> {
  const zones = [...new Set(hosts.map(host => zoneDoor(host)).filter(Boolean))].slice(0, HOSTS_MAX)
  const answers = await mapBounded(zones, HOST_CONCURRENCY, zone => readOfferedPool(zone, meaning, options), { hostOf: zone => zone })
  const union = new Map<string, OfferedMemberUnion>()
  for (const members of answers) {
    for (const member of members ?? []) {
      const held = union.get(member.sig)
      if (held) { if (!held.hosts.includes(member.host)) held.hosts.push(member.host) }
      else union.set(member.sig, { ...member, hosts: [member.host] })
    }
  }
  return [...union.values()]
}
