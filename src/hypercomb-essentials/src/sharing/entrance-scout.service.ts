// sharing/entrance-scout.service.ts
//
// THE PAGE YOUR DOMAIN RUNS HAS A NEWER VERSION — a notice, never a swap
// (documentation/using-a-creation.md, "Powers are off by default, and the
// participant turns them on"). Copied from the shape of update-scout.service:
// once per boot, off the critical path, it reads the participant's own signed
// index and, for every powered entrance that follows a publisher (`from`),
// asks that publisher's index where the followed lineage's head stands and
// which card page that head wears (pageAtHead). A page that is not the one the
// domain runs, and that the participant has not skipped, is announced as
// `entrance:update-available { zone, current, offered }`.
//
// It TAKES NOTHING AND WRITES NOTHING. There is no counterpart to
// `takeIfAllowed`: a new page changes the domain only when the participant
// previews it and turns it on (setZoneEntrance). It does not reuse
// `update:available`, which means a package update.
//
// SKIPPING is putting a version away, the held-item rule (current on top; a
// skip leaves the next version in line; delete is a local forget): the Publish
// panel conceals the offered page under ENTRANCE_SKIP_SCOPE in the
// `hidden:items` pool (concealment/concealment.ts — hide first, delete
// second), and this scout reads that set back. Nothing here keeps a list of
// its own.
//
// Trust: both indexes are schnorr-verified against the pinned key
// (fetchHiveManifestFromAny), and every byte read on the way to a page is
// checked against its signature (readFromHost).

import { EffectBus, SignatureService, get } from '@hypercomb/core'
import { fetchHiveIndex, fetchHiveManifestFromAny } from './hive-pointer.js'
import { PUBLIC_CONTENT_HOSTS } from './hive-link.js'
import { listCommunityHosts } from './community-hosts.js'
import { readFromHost } from './published-address.js'
import { isPoweredEntrance, readDoorsOf, zoneDoor } from './zone-door.js'
import { pageAtHead } from '../commands/card-read.js'
import { listConcealed } from '../concealment/concealment.js'

/** The notice. Its own effect — `update:available` means a package. */
export const ENTRANCE_UPDATE_EFFECT = 'entrance:update-available'
/** The concealment scope a skipped page is put away under. */
export const ENTRANCE_SKIP_SCOPE = 'entrance-version'

const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
/** The same delay as the update scout: after first paint and the bees. */
const BOOT_CHECK_DELAY_MS = 12_000
const SIG_RE = /^[a-f0-9]{64}$/

export interface EntranceUpdate {
  zone: string
  /** The page the domain runs now (H). */
  current: string
  /** The newer page the followed publisher's head wears. */
  offered: string
  /** The followed index's stamp (seconds) — what Turn on records as `from.at`. */
  at: number
  /** The followed lineage's head — what Turn on records as `from.head`. */
  head: string
}

export type EntranceScoutDeps = {
  /** Where indexes and bytes are read: the standing host, then the community. */
  hosts?: () => Promise<string[]>
  ownPubkey?: () => Promise<string | null>
  fetchManifest?: typeof fetchHiveManifestFromAny
  /** The card page a head wears, read from these hosts. */
  pageAt?: (head: string, hosts: readonly string[]) => Promise<string | null>
  /** Pages the participant put away. */
  skipped?: () => Promise<ReadonlySet<string>>
  emit?: (update: EntranceUpdate) => void
}

/** The hosts this hive reads from: its standing public host, every host it
 *  carries, and the public default — zone roots, deduplicated. */
export async function entranceHosts(): Promise<string[]> {
  const sync = get<{ publicHostDomain?: () => string }>(HOST_SYNC_KEY)
  let community: string[] = []
  try { community = await listCommunityHosts() } catch { /* none carried */ }
  return [...new Set([sync?.publicHostDomain?.() ?? '', ...community, ...PUBLIC_CONTENT_HOSTS].map(zoneDoor).filter(Boolean))]
}

/** Bytes by signature from the first host that serves them, hash-checked. */
const bytesFrom = (hosts: readonly string[]) => async (sig: string): Promise<Uint8Array | null> => {
  for (const host of readDoorsOf(hosts)) {
    const bytes = await readFromHost(host, sig).catch(() => null)
    if (bytes) return bytes
  }
  return null
}

const defaultPageAt = (head: string, hosts: readonly string[]): Promise<string | null> => {
  const bytes = bytesFrom(hosts)
  return pageAtHead(head, { layer: bytes, resource: bytes })
}

/** Every page the participant skipped (hidden or deleted alike). */
export async function skippedEntrancePages(): Promise<ReadonlySet<string>> {
  try {
    return new Set((await listConcealed()).filter(item => item.scope === ENTRANCE_SKIP_SCOPE).map(item => item.sig))
  } catch { return new Set() }
}

export class EntranceScoutService {

  /** What this session already announced, `<zone> <offered>` — one notice each. */
  readonly #announced = new Set<string>()

  /** One demand-driven look. Returns the updates it announced. */
  public readonly check = async (deps: EntranceScoutDeps = {}): Promise<EntranceUpdate[]> => {
    const hosts = await (deps.hosts ?? entranceHosts)()
    if (hosts.length === 0) return []
    const ownPubkey = deps.ownPubkey ?? (() => get<{ getPublicKeyHex?: () => Promise<string | null> }>(NOSTR_SIGNER_KEY)?.getPublicKeyHex?.() ?? Promise.resolve(null))
    const pubkey = String((await ownPubkey().catch(() => null)) ?? '').toLowerCase()
    if (!SIG_RE.test(pubkey)) return []
    const fetchManifest = deps.fetchManifest ?? fetchHiveManifestFromAny
    const own = await fetchManifest(hosts, pubkey)
    const followed = Object.entries(own?.entrances ?? {}).filter(([, e]) => isPoweredEntrance(e) && !!e.from)
    if (followed.length === 0) return []

    const skipped = await (deps.skipped ?? skippedEntrancePages)()
    const pageAt = deps.pageAt ?? defaultPageAt
    const emit = deps.emit ?? ((update: EntranceUpdate) => EffectBus.emit(ENTRANCE_UPDATE_EFFECT, update))
    const announced: EntranceUpdate[] = []
    for (const [zone, entrance] of followed) {
      const from = entrance.from!
      const publisher = from.pubkey === pubkey ? own : await fetchManifest(hosts, from.pubkey)
      // ONLY A LATER INDEX CAN OFFER AN UPDATE. A page that merely differs
      // may be older than the one turned on (a downgrade), so the followed
      // index must be stamped after the turn-on recorded it (`from.at`). An
      // entry that never recorded one offers nothing.
      if (!publisher || !Number.isSafeInteger(from.at) || publisher.createdAt <= from.at!) continue
      const head = String(publisher.roots[from.lineage] ?? '').toLowerCase()
      if (!SIG_RE.test(head)) continue
      // AND THE FOLLOWED HEAD MOVED. The index is re-stamped by every write,
      // not only by this lineage's: publishing anything else re-stamps it while
      // the head, and the page it wears, stays the one already passed over. An
      // entry that never recorded its head keeps the stamp rule alone.
      if (from.head && head === from.head) continue
      const offered = await pageAt(head, hosts).catch(() => null)
      if (!offered || offered === entrance.page || skipped.has(offered)) continue
      const said = `${zone} ${offered}`
      if (this.#announced.has(said)) continue
      this.#announced.add(said)
      const update = { zone, current: entrance.page!, offered, at: publisher.createdAt, head }
      emit(update)
      announced.push(update)
    }
    return announced
  }
}

// ── the page's own bytes, for a preview ────────────────────────────────────

/** A card page with its reader bundle inlined is larger than a card record:
 *  the same cap the host applies when it serves a card door. */
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const STORE_KEY = '@hypercomb.social/Store'

export type PageBytesDeps = {
  local?: (sig: string) => Promise<Uint8Array | null>
  fetch?: typeof fetch
}

/** The bytes named `page`, held here or read from these hosts — and only if
 *  they hash to that name. What a preview shows is exactly what the domain
 *  would serve. */
export async function readPageBytes(page: string, hosts: readonly string[], deps: PageBytesDeps = {}): Promise<Uint8Array | null> {
  const sig = String(page ?? '').toLowerCase()
  if (!SIG_RE.test(sig)) return null
  const exact = async (bytes: Uint8Array | null): Promise<Uint8Array | null> =>
    bytes && bytes.byteLength <= MAX_PAGE_BYTES
      && await SignatureService.sign(bytes.slice().buffer as ArrayBuffer) === sig ? bytes : null
  const local = deps.local ?? (async (s: string) => {
    const blob = await get<{ getResource?: (sig: string) => Promise<Blob | null> }>(STORE_KEY)?.getResource?.(s)
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  })
  const held = await exact(await local(sig).catch(() => null))
  if (held) return held
  const get_ = deps.fetch ?? fetch
  for (const host of readDoorsOf(hosts)) {
    const origin = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(?::\d+)?$/i.test(host) ? `http://${host}` : `https://${host}`
    try {
      const res = await get_(`${origin}/${sig}`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_PAGE_BYTES) continue
      const bytes = await exact(new Uint8Array(await res.arrayBuffer()))
      if (bytes) return bytes
    } catch { /* the next host */ }
  }
  return null
}

// ── scents ─────────────────────────────────────────────────────────────────

export type EntranceScentVerdict = 'accept' | 'refuse' | 'unclear'

export interface EntranceScent {
  pubkey: string
  verdict: EntranceScentVerdict
  at: number
}

export type EntranceScentDeps = {
  fetchText?: (url: string) => Promise<string | null>
  fetchIndex?: typeof fetchHiveIndex
  bytes?: (host: string, sig: string) => Promise<Uint8Array | null>
}

const SCENTS_READ = 24
const VERDICTS: readonly EntranceScentVerdict[] = ['accept', 'refuse', 'unclear']

const defaultFetchText = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null
    return await res.text()
  } catch { return null }
}

/**
 * WHAT THE COMMUNITY SAYS ABOUT A PAGE — read only. The assessors of `page`
 * are the members of sign('assess:<page>') on the host (the worker adds one
 * whenever a verified index names `assess:<page>`); each one's own signed
 * index is read and re-verified, and the record it names is read by hash.
 * `also` adds keys to ask whether or not the host lists them (your own).
 * Scents inform the choice; they never turn anything on.
 */
export async function readEntranceScents(
  host: string, page: string, also: readonly string[] = [], deps: EntranceScentDeps = {},
): Promise<EntranceScent[]> {
  const h = zoneDoor(host)
  const p = String(page ?? '').toLowerCase()
  if (!h || !SIG_RE.test(p)) return []
  const fetchText = deps.fetchText ?? defaultFetchText
  const fetchIndex = deps.fetchIndex ?? fetchHiveIndex
  const bytesOf = deps.bytes ?? ((at: string, sig: string) => readFromHost(at, sig))
  const key = `assess:${p}`
  const pool = await SignatureService.sign(new TextEncoder().encode(key).buffer as ArrayBuffer)
  const origin = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(?::\d+)?$/i.test(h) ? `http://${h}` : `https://${h}`
  const listed = ((await fetchText(`${origin}/${pool}/`)) ?? '').split(/\r?\n/).map(s => s.trim().toLowerCase())
  const keys = [...new Set([...also.map(k => String(k ?? '').toLowerCase()), ...listed])].filter(k => SIG_RE.test(k)).slice(0, SCENTS_READ)
  const scents: EntranceScent[] = []
  for (const pubkey of keys) {
    const read = await fetchIndex(h, pubkey).catch(() => null)
    const record = read?.ok ? String(read.manifest.roots[key] ?? '').toLowerCase() : ''
    if (!SIG_RE.test(record)) continue
    const bytes = await bytesOf(h, record).catch(() => null)
    if (!bytes) continue
    try {
      const body = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
      if (body?.['kind'] !== 'module-assessment' || body['root'] !== p) continue
      const verdict = VERDICTS.includes(body['verdict'] as EntranceScentVerdict) ? body['verdict'] as EntranceScentVerdict : 'unclear'
      scents.push({ pubkey, verdict, at: Number(body['at'] ?? 0) || 0 })
    } catch { /* not a record — no scent */ }
  }
  return scents
}

const scout = new EntranceScoutService()
/** The one scout; publish-status.drone.ts registers it and shows its notices. */
export const entranceScout = scout
// One look per boot, on the update scout's delay.
if (typeof window !== 'undefined') {
  setTimeout(() => { void scout.check().catch(() => []) }, BOOT_CHECK_DELAY_MS)
}
