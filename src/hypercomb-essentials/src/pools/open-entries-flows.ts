// pools/open-entries-flows.ts
//
// WHAT A LEADER, AND A POSTER, DO WITH AN OPEN ENTRY POOL (documentation/
// open-entry-pools.md): open, close, recycle, hide and show again, post, and
// "what does my own index say". Each is a function over injected dependencies
// that answers a plain result, with a reason in words on refusal and, where
// the fix is someone's to make, whose it is (the design's "Who ships what").
// Nothing here throws. The names, the shapes and the reader are in
// open-entries.ts.
//
// THE LEADER'S RECORD. The pool `entries:opened` holds one current document:
// for each pool this device opened, O, H, the host, the page, the title and
// the end, never the nonce. The nonce is the capability (with the public
// record it is the pool's address), and a pool is copied off the device by the
// folder backup, so it is kept with the hive's other secrets (core
// EntryNonceStore, keyed by H). The store refuses a document that carries a
// held nonce, so a slip here is refused, not kept.
//
// EVERY INDEX CHANGE IS ONE WRITE (sharing/hive-pointer.ts changeHiveRoots):
// closing names `entries-closed:<H>` and drops `entries:<H>` together, and a
// page's next pool recycles its last one in the same write that opens it.
// The host answers an index write 200 whether or not it opened anything, so
// opening and closing are proved by asking the listing, which carries the
// pool's state, and the host may answer from a copy up to five seconds old:
// the listing is asked fresh, for about ten seconds, before the hive gives up.

import { ENTRY_NONCE_STORE_IOC_KEY, I18N_IOC_KEY, POST_CODE_EFFECT, SignatureService, entryNonceStore, get, shellTakesPostCode, type I18nProvider } from '@hypercomb/core'
import { generateSecretKey } from 'nostr-tools/pure'
import { fetchWithDeadline, mapBounded } from '../sharing/bounded-fetch.js'
import { ROOT_MOVED, changeHiveRoots, fetchHiveIndex, type ChangeHiveRootsResult, type HiveIndexResult, type HiveRootsChange } from '../sharing/hive-pointer.js'
import { publisherKeyHex } from '../sharing/key-list.client.js'
import { PARTICIPANT_FEATURES_POINTER } from '../sharing/participant-features.js'
import { originOf } from '../sharing/zone-door.js'
import { readBodyCapped } from './bounded-body.js'
import { liveOfferedPublishDeps } from './offered-pool.js'
import {
  ENTRY_LIMITS,
  emptyHiddenList,
  entryCodeLink,
  entryIndexKeys,
  entryKeyOf,
  entryMemberUrl,
  entryPageUrl,
  entryPoolAddress,
  entryPoolName,
  entryRecordBytes,
  hiddenListBytes,
  hostOffsetOf,
  isEntryLine,
  isEntryMeaning,
  isOfferablePage,
  latestEntryUntil,
  newEntryNonce,
  newEntryPage,
  parseEntryRecord,
  parseHiddenList,
  readEntryAtom,
  readEntryListing,
  signEntryMember,
  withHiddenLine,
  type EntryEvent,
  type EntryHiddenLine,
  type EntryHiddenList,
  type EntryListing,
  type EntryOpeningRecord,
  type EntryPoolPath,
} from './open-entries.js'
import { sourcesStore, type SourcesStore } from './pool-sources.js'

/** The leader's record of the pools this device opened. Its address is `sign('entries:opened')`, derived by the store. */
export const OPENED_ENTRIES_MEANING = 'entries:opened'

const SIG = /^[0-9a-f]{64}$/
/** Pools one record keeps: far more than a page ever holds, since a page has one pool. */
const OPENED_MAX = 64
const RECORD_DOC_MAX_BYTES = 64 * 1024
/** What a template a pool names may weigh, read back as a stranger would. */
const TEMPLATE_READ_BYTES = 64 * 1024
/** The visitor page the page check reads: the shell is small, its carried index and door records are not large. */
const PAGE_READ_BYTES = 512 * 1024
/** About ten seconds of asking, a second apart: the host's copy of an index may be five seconds old. */
const PROOF_TRIES = 10
const PROOF_PAUSE_MS = 1_000
/** A hidden list's change, tried again this often when another place moved the list first. */
const HIDE_TRIES = 3
const HOST_TIMEOUT_MS = 8_000
/** The layer the post form's bee is built in (essentials src/recipe): a leader who keeps it from visitors keeps the form. */
const POST_FORM_LAYERS: readonly string[] = Object.freeze(['recipe'])
/** The layers the package check reads, at most: a package of today is about a hundred. */
const PACKAGE_LAYERS_MAX = 512
/** What one layer may weigh: today's largest is under 100 KB. */
const PACKAGE_LAYER_BYTES = 1024 * 1024
const PACKAGE_LAYERS_AT_ONCE = 6

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const signatureOf = (bytes: Uint8Array): Promise<string> => SignatureService.sign(exact(bytes))
const isSig = (value: unknown): value is string => typeof value === 'string' && SIG.test(value)
const sameText = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((byte, at) => byte === b[at])
const oneLine = (value: unknown, max = 160): string => String(value ?? '').replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)

// ── the leader's record ─────────────────────────────────────────────────────

/** One pool this device opened. Never the nonce. */
export interface OpenedEntryPool {
  /** O: the opening record's signature. */
  readonly record: string
  /** H: what the leader's index names. */
  readonly pool: string
  /** The host the leader's index is kept on. */
  readonly host: string
  /** The page the code opens. */
  readonly page: string
  readonly title: string
  /** The pool's end, whole seconds. */
  readonly until: number
  /** Seconds: when this device closed it. A pool the index names open again is closed again (a stale write). */
  readonly closed?: number
}

const pooled = (raw: unknown): OpenedEntryPool | null => {
  const one = raw as Partial<OpenedEntryPool> | null
  if (!one || typeof one !== 'object' || !isSig(one.record) || !isSig(one.pool)) return null
  if (typeof one.host !== 'string' || !originOf(one.host) || typeof one.page !== 'string' || !originOf(one.page)) return null
  if (!isEntryLine(one.title, ENTRY_LIMITS.title) || !Number.isSafeInteger(one.until) || (one.until as number) <= 0) return null
  return {
    record: one.record, pool: one.pool, host: one.host, page: one.page, title: one.title, until: one.until as number,
    ...(Number.isSafeInteger(one.closed) && (one.closed as number) > 0 ? { closed: one.closed as number } : {}),
  }
}

/** The record's canonical bytes: its pools once each by H, in the order given, and nothing else. */
export const openedRecordBytes = (pools: readonly OpenedEntryPool[]): Uint8Array => {
  const seen = new Set<string>()
  const kept: OpenedEntryPool[] = []
  for (const raw of pools) {
    const one = pooled(raw)
    if (!one || seen.has(one.pool)) continue
    seen.add(one.pool)
    kept.push(one)
  }
  return new TextEncoder().encode(JSON.stringify({
    'entries:opened': 1,
    pools: kept.slice(-OPENED_MAX).map(one => ({
      record: one.record, pool: one.pool, host: one.host, page: one.page, title: one.title, until: one.until,
      ...(one.closed ? { closed: one.closed } : {}),
    })),
  }))
}

/** The pools a record holds, or [] for bytes that are not one. */
export const openedPoolsOf = (bytes: Uint8Array | null): OpenedEntryPool[] => {
  try {
    if (!bytes || bytes.byteLength > RECORD_DOC_MAX_BYTES) return []
    const doc = JSON.parse(new TextDecoder().decode(bytes)) as { 'entries:opened'?: unknown; pools?: unknown } | null
    if (doc?.['entries:opened'] !== 1 || !Array.isArray(doc.pools)) return []
    const out = new Map<string, OpenedEntryPool>()
    for (const raw of doc.pools.slice(0, OPENED_MAX)) {
      const one = pooled(raw)
      if (one && !out.has(one.pool)) out.set(one.pool, one)
    }
    return [...out.values()]
  } catch { return [] }
}

/** Where the record is read and written. Injectable, so a spec needs no store. */
export interface OpenedRecordIo {
  read(): Promise<OpenedEntryPool[]>
  /** False when it could not be kept (the store refuses a document that carries a held nonce). */
  write(pools: readonly OpenedEntryPool[]): Promise<boolean>
}

/** The record through the hive's store: one current document, the version before it not kept. */
export const liveOpenedRecord = (store: SourcesStore | undefined = sourcesStore()): OpenedRecordIo => ({
  read: async () => {
    try {
      if (!store?.openPool || !store.getPoolDoc) return []
      await store.initialize?.()
      const pool = await store.openPool(OPENED_ENTRIES_MEANING)
      const bytes = pool ? await store.getPoolDoc(pool) : null
      return openedPoolsOf(bytes ? new Uint8Array(bytes) : null)
    } catch { return [] }
  },
  write: async (pools) => {
    try {
      if (!store?.getPool || !store.putPoolDoc) return false
      await store.initialize?.()
      const pool = await store.getPool(OPENED_ENTRIES_MEANING)
      if (!pool) return false
      const doc = exact(openedRecordBytes(pools))
      return !!(await store.putPoolDoc(pool, doc, undefined, { keep: 'current' }))
    } catch { return false }
  },
})

/** Is a pool more than 30 days past its end, so the hive recycles it on its next index write? */
export const isPastKeeping = (pool: Pick<OpenedEntryPool, 'until'>, nowSeconds: number): boolean =>
  nowSeconds > pool.until + ENTRY_LIMITS.keptSeconds

// ── what the flows work with ────────────────────────────────────────────────

/** The nonces this device holds, by H (core EntryNonceStore). */
export interface EntryNonceIo {
  get(pool: string): string
  set(pool: string, nonce: string): boolean
  drop(pool: string): void
}

/** What a page serves a visitor: its status and HTML, or null when it did not answer. */
export type EntryPageAnswer = { readonly status: number; readonly html: string } | null

/** Does the package a page runs carry the post bee? `unknown`: this hive could not tell. */
export type EntryPostBeeAnswer = 'has' | 'lacks' | 'unknown'

/** Every external the flows touch. Each optional: the live one stands in for any left out. */
export interface OpenEntriesDeps {
  /** P: the key the leader's index is kept under on the host. */
  publisherKey?(): Promise<string>
  /** Milliseconds on this device's clock. */
  now?(): number
  sleep?(ms: number): Promise<void>
  newNonce?(): string
  newSecretKey?(): Uint8Array
  /** Is this a visitor page, which writes nothing of the leader's? */
  readonly?(): boolean
  /** Keep bytes in this hive's store; answers their signature. */
  keep?(bytes: Uint8Array): Promise<string>
  /** The bytes this hive holds under a signature, or null. */
  bytesOf?(sig: string): Promise<Uint8Array | null>
  /** Send atoms to the host, in order, each read through `bytesOf`. */
  publish?(host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>): Promise<{ ok: true } | { ok: false; error: string }>
  /** One atom at a page's or host's origin, unsigned, as a stranger reads it; kept only when it hashes to its name. */
  atom?(page: string, sig: string, limit: number): Promise<Uint8Array | null>
  /** The leader's own index on the host, read fresh. */
  index?(host: string, pubkey: string): Promise<HiveIndexResult>
  /** One signed index write that changes several keys (sharing/hive-pointer.ts changeHiveRoots). */
  changeRoots?(host: string, change: HiveRootsChange): Promise<ChangeHiveRootsResult>
  /** A pool's listing, asked fresh at the page's origin. */
  listing?(path: EntryPoolPath): Promise<EntryListing>
  /** PUT a member's bytes; the host's status and its own words, or no status when it never answered. */
  putMember?(url: string, bytes: Uint8Array): Promise<{ status?: number; said: string }>
  /** The page as a visitor's browser asks for it. */
  page?(page: string): Promise<EntryPageAnswer>
  /** Does the package the page runs carry the post bee? */
  postBee?(page: string, packageSig: string): Promise<EntryPostBeeAnswer>
  /** The layer names the leader keeps from visitors (`features:participant`), as their index names them on `host`. */
  keptLayers?(host: string, roots: Readonly<Record<string, string>>): Promise<readonly string[]>
  records?: OpenedRecordIo
  nonces?: EntryNonceIo
}

/** Who is to fix a refusal: the leader, or the operator who runs the host. */
export type EntryFixer = 'leader' | 'operator'

/** A flow's refusal: a code a surface may switch on, the sentence to show, and whose it is to fix when someone's. */
export type EntryRefused = { readonly ok: false; readonly why: string; readonly reason: string; readonly whose?: EntryFixer }

const refused = (why: string, reason: string, whose?: EntryFixer): EntryRefused => ({ ok: false, why, reason, ...(whose ? { whose } : {}) })

const liveNonces = (): EntryNonceIo => {
  let held: EntryNonceIo | undefined
  try { held = get<EntryNonceIo>(ENTRY_NONCE_STORE_IOC_KEY) } catch { held = undefined }
  return held ?? entryNonceStore
}

/** The picked page as a visitor's browser asks for it: its own path at its origin, never the origin's `/` (a page
 *  that opens at a path may be another door than the origin's root). Null when it did not answer. */
export const readEntryPage = async (page: string): Promise<EntryPageAnswer> => {
  const url = entryPageUrl(page)
  if (!url) return null
  try {
    const response = await fetchWithDeadline(url, { cache: 'no-store', credentials: 'omit' }, { timeoutMs: HOST_TIMEOUT_MS })
    const bytes = await readBodyCapped(response, PAGE_READ_BYTES)
    return { status: response.status, html: bytes ? new TextDecoder().decode(bytes) : '' }
  } catch { return null }
}

const livePutMember = async (url: string, bytes: Uint8Array): Promise<{ status?: number; said: string }> => {
  try {
    const response = await fetchWithDeadline(url, { method: 'PUT', body: exact(bytes), credentials: 'omit' }, { timeoutMs: HOST_TIMEOUT_MS })
    const said = response.headers.get('X-Reason') ?? await response.text().catch(() => '')
    return { status: response.status, said: oneLine(said) }
  } catch { return { said: '' } }
}

/** The layers the leader's `features:participant` snapshot names, from their own index on the host. */
const liveKeptLayers = async (host: string, roots: Readonly<Record<string, string>>): Promise<readonly string[]> => {
  const sig = String(roots[PARTICIPANT_FEATURES_POINTER] ?? '')
  if (!isSig(sig)) return []
  const bytes = await readEntryAtom(host, sig, 64 * 1024)
  try {
    const doc = bytes ? JSON.parse(new TextDecoder().decode(bytes)) as { features?: unknown } : null
    return Array.isArray(doc?.features) ? doc.features.filter((name): name is string => typeof name === 'string') : []
  } catch { return [] }
}

const stripJs = (ref: unknown): string => String(ref ?? '').trim().toLowerCase().replace(/\.js$/, '')

/**
 * Does the package a page runs carry the post form's bee? Its layers are read
 * from the page's own origin as a visitor's shell reads them, each kept only
 * when it hashes to its name, walking down from the package. A bee carries the
 * form when its layer's docs say it wakes on the code's announcement
 * (POST_CODE_EFFECT) and the package lists that bee. `has`: one does. `lacks`:
 * every layer was read and none does. `unknown`: a layer could not be read or
 * did not parse, or the package is larger than a package is, so nothing is
 * claimed either way. Never throws.
 */
export async function packageHasPostBee(
  page: string,
  packageSig: string,
  atom: (page: string, sig: string, limit: number) => Promise<Uint8Array | null>,
): Promise<EntryPostBeeAnswer> {
  try {
    const root = stripJs(packageSig)
    if (!isSig(root)) return 'unknown'
    const seen = new Set<string>([root])
    const bees = new Set<string>()
    const waking = new Set<string>()
    let wave = [root]
    while (wave.length) {
      const read = await mapBounded(wave, PACKAGE_LAYERS_AT_ONCE, sig => atom(page, sig, PACKAGE_LAYER_BYTES).catch(() => null))
      const next: string[] = []
      for (const bytes of read) {
        if (!bytes) return 'unknown'
        let layer: { bees?: unknown; cells?: unknown; layers?: unknown; docs?: { bees?: unknown } } | null
        try { layer = JSON.parse(new TextDecoder().decode(bytes)) } catch { return 'unknown' }
        if (!layer || typeof layer !== 'object') return 'unknown'
        for (const bee of Array.isArray(layer.bees) ? layer.bees : []) bees.add(stripJs(bee))
        const docs = layer.docs?.bees
        if (docs && typeof docs === 'object') {
          for (const [ref, doc] of Object.entries(docs as Record<string, unknown>)) {
            const wakesOn = (doc as { wakesOn?: unknown } | null)?.wakesOn
            if (Array.isArray(wakesOn) && wakesOn.includes(POST_CODE_EFFECT)) waking.add(stripJs(ref))
          }
        }
        // `cells` is today's shape; `layers` is what packages emitted before the rename carry.
        const children = Array.isArray(layer.cells) ? layer.cells : Array.isArray(layer.layers) ? layer.layers : []
        for (const child of children) {
          const sig = stripJs(child)
          if (!isSig(sig) || seen.has(sig)) continue
          seen.add(sig)
          next.push(sig)
        }
      }
      if (seen.size > PACKAGE_LAYERS_MAX) return 'unknown'
      wave = next
    }
    return [...waking].some(sig => bees.has(sig)) ? 'has' : 'lacks'
  } catch { return 'unknown' }
}

/** The deps as the flows run them: what the caller gave, the live one for the rest, resolved when called. */
const withLive = (deps: OpenEntriesDeps = {}): Required<OpenEntriesDeps> => {
  const publishing = (): ReturnType<typeof liveOfferedPublishDeps> => liveOfferedPublishDeps()
  const atom = deps.atom ?? ((page: string, sig: string, limit: number) => readEntryAtom(page, sig, limit))
  return {
    publisherKey: deps.publisherKey ?? (() => publisherKeyHex()),
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))),
    newNonce: deps.newNonce ?? newEntryNonce,
    newSecretKey: deps.newSecretKey ?? generateSecretKey,
    readonly: deps.readonly ?? (() => (globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ === true),
    keep: deps.keep ?? (async bytes => {
      const live = publishing()
      if (!live) throw new Error('no store')
      return live.put(bytes)
    }),
    bytesOf: deps.bytesOf ?? (async sig => publishing()?.bytesOf(sig) ?? null),
    publish: deps.publish ?? (async (host, sigs, bytesOf) => publishing()?.publish(host, sigs, bytesOf) ?? { ok: false, error: '' }),
    atom,
    index: deps.index ?? ((host, pubkey) => fetchHiveIndex(host, pubkey, undefined, { fresh: true })),
    changeRoots: deps.changeRoots ?? ((host, change) => changeHiveRoots(host, change)),
    listing: deps.listing ?? (path => readEntryListing(path)),
    putMember: deps.putMember ?? livePutMember,
    page: deps.page ?? readEntryPage,
    // The page's own package, read layer by layer the way its shell reads it.
    postBee: deps.postBee ?? ((page, packageSig) => packageHasPostBee(page, packageSig, atom)),
    keptLayers: deps.keptLayers ?? liveKeptLayers,
    records: deps.records ?? liveOpenedRecord(),
    nonces: deps.nonces ?? liveNonces(),
  }
}

const nowSecondsOf = (live: Required<OpenEntriesDeps>): number => Math.floor(live.now() / 1000)

/** The leader's own index roots on `host`: a verified read, or {} for a host that holds none yet; null when unsafe. */
const rootsOf = async (live: Required<OpenEntriesDeps>, host: string, pubkey: string): Promise<Record<string, string> | null> => {
  const read = await live.index(host, pubkey).catch((): HiveIndexResult => ({ ok: false, reason: 'unreachable' }))
  if (read.ok) return read.manifest.roots
  return read.reason === 'http' && read.status === 404 ? {} : null
}

/** What a host said, as one line, or the words for no answer at all. */
const saidOrNone = (said: unknown): string => oneLine(said) || t('pools.posts.refuse.no-answer', 'no answer')

/** An index write's refusal in words: another place moved it, or the host's own reason. */
const indexRefusal = (result: ChangeHiveRootsResult): EntryRefused =>
  result.reason === ROOT_MOVED
    ? refused('moved', t('pools.posts.refuse.moved', 'Another of your tabs or devices changed this at the same time. Try again.'))
    : refused('index', t('pools.posts.refuse.index', 'Your signed index on the host did not take the change ({said}).', { said: saidOrNone(result.reason) }))

/** A pool's opening record O, from this hive or as the host serves it, read strictly; null when it does not read. */
const openingOf = async (live: Required<OpenEntriesDeps>, host: string, record: string): Promise<EntryOpeningRecord | null> => {
  if (!isSig(record)) return null
  const bytes = await live.bytesOf(record).catch(() => null) ?? await live.atom(host, record, ENTRY_LIMITS.recordBytes).catch(() => null)
  const parsed = bytes ? await parseEntryRecord(bytes, record) : null
  return parsed?.ok ? parsed.record : null
}

/** Are two pages the same page: the same origin and path, however each was spelled. */
const samePage = (a: string, b: string): boolean => !!entryPageUrl(a) && entryPageUrl(a) === entryPageUrl(b)

/** Ask the listing, fresh, about ten seconds, until it says one of `wanted`. The last answer either way. */
const askUntil = async (live: Required<OpenEntriesDeps>, path: EntryPoolPath, wanted: readonly string[]): Promise<{ proved: boolean; listing: EntryListing }> => {
  let listing = await live.listing(path).catch(() => null)
  for (let tried = 1; !(listing?.state && wanted.includes(listing.state)) && tried < PROOF_TRIES; tried++) {
    await live.sleep(PROOF_PAUSE_MS)
    listing = await live.listing(path).catch(() => null)
  }
  const last = listing ?? { reached: false, state: null, names: [], over: false, hidden: null, hostTime: null, said: '' }
  return { proved: !!last.state && wanted.includes(last.state), listing: last }
}

// ── the page check ──────────────────────────────────────────────────────────

/** The package a visitor page carries (`#hc-install`): its first line is the package signature. '' for none. */
export const carriedPackageOf = (html: string): string => {
  const m = /<script\b[^>]*\bid\s*=\s*["']hc-install["'][^>]*>([\s\S]*?)<\/script>/i.exec(String(html ?? ''))
  if (!m) return ''
  try {
    const carried = JSON.parse(m[1]) as { text?: unknown } | null
    const first = typeof carried?.text === 'string' ? (carried.text.split('\n')[0] ?? '').trim().toLowerCase() : ''
    return SIG.test(first) ? first : ''
  } catch { return '' }
}

/**
 * Can the picked page show the form? It is read as a visitor would, and it
 * must be the visitor shell carrying a package (a card door is not), the
 * shell must say it takes `#post=`, the package must carry the post bee, and
 * the leader must not keep the bee's layer from visitors. Each failure is its
 * own sentence, with whose it is to fix. Never throws.
 */
export async function checkEntryPage(
  input: { readonly page: string; readonly host: string; readonly roots: Readonly<Record<string, string>> },
  deps?: OpenEntriesDeps,
): Promise<{ ok: true; packageSig: string } | EntryRefused> {
  try {
    const live = withLive(deps)
    const answer = await live.page(input.page).catch(() => null)
    if (!answer) return refused('page-unreachable', t('pools.posts.refuse.page-unreachable', '{page} did not answer, so the hive could not check it can show the form.', { page: input.page }))
    const packageSig = answer.status === 200 ? carriedPackageOf(answer.html) : ''
    if (!packageSig) {
      return refused('page-not-visitor', t('pools.posts.refuse.page-not-visitor', '{page} does not open your published site (it may be a card). Pick another page.', { page: input.page }), 'leader')
    }
    if (!shellTakesPostCode(answer.html)) {
      return refused('page-old-shell', t('pools.posts.refuse.page-old-shell', 'The site shell on this host does not take posts yet. That is the operator\'s to ship.'), 'operator')
    }
    const kept = await live.keptLayers(input.host, input.roots).catch(() => [] as readonly string[])
    if (POST_FORM_LAYERS.some(layer => kept.includes(layer))) {
      return refused('page-bee-kept', t('pools.posts.refuse.page-bee-kept', 'You keep the recipe features from visitors, so the form cannot show. Turn them on for visitors first.'), 'leader')
    }
    const bee = await live.postBee(input.page, packageSig).catch((): EntryPostBeeAnswer => 'unknown')
    if (bee === 'lacks') {
      return refused('page-no-bee', t('pools.posts.refuse.page-no-bee', 'The package this page runs has no post form. The operator ships one, or, if your site runs a package you promoted, promote one that has it.'), 'operator')
    }
    if (bee !== 'has') {
      return refused('page-package-unknown', t('pools.posts.refuse.page-package-unknown', 'The hive could not tell whether the package this page runs has the post form, so no code is shown.'), 'operator')
    }
    return { ok: true, packageSig }
  } catch {
    return refused('page-unreachable', t('pools.posts.refuse.page-unreachable', '{page} did not answer, so the hive could not check it can show the form.', { page: input.page }))
  }
}

// ── opening ─────────────────────────────────────────────────────────────────

export interface OpenEntryPoolInput {
  /** The host the leader's index is kept on. */
  readonly host: string
  /** The page the code opens: one of the addresses the leader's index gives (doorsOfIndex). */
  readonly page: string
  readonly title: string
  /** What an entry is: `recipe:entry`. */
  readonly meaning: string
  /** The signature of what a poster fills in, held in this hive. */
  readonly template: string
  /** The pool's end, whole seconds: a day from now when left out, 31 days at most. */
  readonly until?: number
  /** The page's last pool: recycled in the same index write that opens this one. */
  readonly replaces?: OpenedEntryPool
}

export type OpenEntryPoolResult =
  | { readonly ok: true; readonly pool: OpenedEntryPool; readonly link: string }
  | EntryRefused

/** The first `max` UTF-16 units of a line, never cutting a character in two. */
const clip = (text: string, max: number): string => {
  let out = ''
  for (const ch of Array.from(text)) { if (out.length + ch.length > max) break; out += ch }
  return out.trim()
}

/** The pool's three parts for a listing, when this device holds the nonce: the path, or null. */
const pathOf = async (live: Required<OpenEntriesDeps>, pool: Pick<OpenedEntryPool, 'record' | 'pool' | 'page' | 'until'>, by: string): Promise<EntryPoolPath | null> => {
  const nonce = live.nonces.get(pool.pool)
  const address = nonce ? await entryPoolAddress(pool.record, nonce) : ''
  // A held nonce that does not name this H is another pool's: never asked with.
  if (!address || await entryPoolName(address, by, pool.until) !== pool.pool) return null
  return { page: pool.page, address, by, until: pool.until }
}

/**
 * Open a pool, in the design's order, and give the code only after the last
 * step: (1) the page and the end, (2) the page can show the form, (3) the
 * record and the template on the host, read back as a stranger would, (4)
 * `entries:<H>` named in one index write (recycling the page's last pool in
 * the same write), (5) the host says open, asked fresh for about ten seconds,
 * (6) the pool's first member, a taken-back page, posted by the hive itself,
 * (7) remembered. The record is written just BEFORE (4), so every pool the index
 * names is one this device can close and recycle, and a record that cannot be
 * kept names nothing. A page with a pool already (from any of the leader's
 * devices) is refused unless that pool is the one being replaced. Never throws.
 */
export async function openEntryPool(input: OpenEntryPoolInput, deps?: OpenEntriesDeps): Promise<OpenEntryPoolResult> {
  try {
    const live = withLive(deps)
    if (live.readonly()) return refused('readonly', t('pools.posts.refuse.readonly', 'A visitor page cannot open a pool.'))

    // 1. The page and the end.
    const page = String(input?.page ?? '').trim()
    const host = String(input?.host ?? '').trim()
    if (!page || !originOf(page)) return refused('no-page', t('pools.posts.refuse.no-page', 'You have no published page to show a code for. Publish a site first.'), 'leader')
    if (!isOfferablePage(page)) return refused('page-not-offered', t('pools.posts.refuse.page-not-offered', '{page} takes no posts. Pick one of your published pages.', { page }), 'leader')
    if (!originOf(host)) return refused('no-host', t('pools.posts.refuse.no-host', 'Name the host your index is kept on first.'), 'leader')
    if (!isEntryLine(input.title, ENTRY_LIMITS.title)) {
      return refused('title', t('pools.posts.refuse.title', 'The title is one line of 1 to {max} characters.', { max: ENTRY_LIMITS.title }), 'leader')
    }
    if (!isEntryMeaning(input.meaning) || !isSig(input.template)) return refused('template', t('pools.posts.refuse.template', 'Pick what people will fill in first.'), 'leader')
    const now = nowSecondsOf(live)
    const asked = input.until ?? now + ENTRY_LIMITS.defaultSeconds
    if (!Number.isSafeInteger(asked) || asked <= now || asked - now > ENTRY_LIMITS.untilMaxSeconds) {
      return refused('until', t('pools.posts.refuse.until', 'A pool ends between now and 31 days from now.'), 'leader')
    }
    // Kept inside the host's 31 days by the margin a leader's clock may run ahead (latestEntryUntil, the one place).
    const until = Math.min(asked, latestEntryUntil(now))
    const by = String(await live.publisherKey().catch(() => '') ?? '').toLowerCase()
    if (!isSig(by)) return refused('no-signer', t('pools.posts.refuse.no-signer', 'This device has no key to sign your index with.'), 'leader')
    const roots = await rootsOf(live, host, by)
    if (!roots) return refused('index-unsafe', t('pools.posts.refuse.index-unsafe', 'Your signed index on {host} could not be read, so nothing was changed.', { host }))
    // A page has one pool, whichever of the leader's devices opened it: another device's pool is placed by the page
    // its public record carries. Only the pool named to be replaced may stand on this page.
    const records = await live.records.read().catch(() => [] as OpenedEntryPool[])
    const looked = new Set<string>()
    for (const [key, sig] of Object.entries(roots)) {
      const named = entryKeyOf(key)
      if (!named || named.as === 'hidden' || !isSig(sig) || named.pool === input.replaces?.pool || looked.has(named.pool)) continue
      looked.add(named.pool)
      const placed = records.find(one => one.pool === named.pool)?.page ?? (await openingOf(live, host, sig))?.page
      if (placed && samePage(placed, page)) {
        return refused('page-has-pool', t('pools.posts.refuse.page-has-pool', '{page} already has a pool, and a page has one. Recycle it first, or open from the pools bar to replace it.', { page }), 'leader')
      }
    }

    // 2. The page can show the form.
    const checked = await checkEntryPage({ page, host, roots }, deps)
    if (!checked.ok) return checked

    // 3. The record and the template, on the host and read back as a stranger would.
    // The record carries the page, so another of the leader's devices can place the pool: the code shows the page anyway.
    const recordBytes = entryRecordBytes({ meaning: input.meaning, title: input.title, template: input.template, by, until, page })
    const record = await signatureOf(recordBytes)
    if (await live.keep(recordBytes).catch(() => '') !== record) {
      return refused('record', t('pools.posts.refuse.kept', 'The pool could not be kept in this hive.'))
    }
    const template = await live.bytesOf(input.template).catch(() => null)
    if (!template || await signatureOf(template) !== input.template) {
      return refused('template', t('pools.posts.refuse.template-missing', 'What people will fill in is not held in this hive.'), 'leader')
    }
    const bytesOf = (sig: string): Promise<Uint8Array | null> =>
      sig === record ? Promise.resolve(recordBytes) : sig === input.template ? Promise.resolve(template) : live.bytesOf(sig)
    const sent = await live.publish(host, [input.template, record], bytesOf).catch(() => ({ ok: false as const, error: '' }))
    if (!sent.ok) return refused('publish', t('pools.posts.refuse.publish', '{host} did not take the pool\'s record ({said}).', { host, said: saidOrNone(sent.error) }))
    for (const [sig, limit] of [[record, ENTRY_LIMITS.recordBytes], [input.template, TEMPLATE_READ_BYTES]] as const) {
      if (!await live.atom(page, sig, limit).catch(() => null)) {
        return refused('read-back', t('pools.posts.refuse.read-back', '{page} does not serve the pool\'s record yet, so a phone could not read it.', { page }), 'operator')
      }
    }

    // 4. Named in the index: the nonce is held first, so a pool the index names can always show its code again.
    const nonce = live.newNonce()
    const address = await entryPoolAddress(record, nonce)
    const pool = address ? await entryPoolName(address, by, until) : ''
    if (!pool || !live.nonces.set(pool, nonce)) return refused('nonce', t('pools.posts.refuse.nonce', 'This page cannot keep a pool\'s code. Open it from your own hive.'))
    const keys = entryIndexKeys(pool)
    const old = input.replaces ? entryIndexKeys(input.replaces.pool) : null
    const oldPath = input.replaces ? await pathOf(live, input.replaces, by) : null
    // Remembered BEFORE the index names it (step 7 of the design is what the hive keeps; it is written first): a pool
    // the index names is always one this device can close and recycle. A record that cannot be kept stops here,
    // with nothing named; an index write that fails puts the record back as it was.
    const opened: OpenedEntryPool = { record, pool, host, page, title: input.title, until }
    const before = await live.records.read().catch(() => [] as OpenedEntryPool[])
    const kept = await live.records.write([...before.filter(one => one.pool !== pool && one.pool !== input.replaces?.pool), opened]).catch(() => false)
    if (!kept) {
      live.nonces.drop(pool)
      return refused('record', t('pools.posts.refuse.kept', 'The pool could not be kept in this hive.'))
    }
    const written = await live.changeRoots(host, {
      set: { [keys.open]: record },
      ...(old ? { drop: [old.open, old.closed, old.hidden] } : {}),
      expect: { [keys.open]: null },
    }).catch((): ChangeHiveRootsResult => ({ ok: false, host, pubkey: '', createdAt: 0, dropped: {}, set: {}, reason: '' }))
    if (!written.ok) {
      // A write can land and still lose its answer (a bounded PUT that times out
      // after the host took it): seen live, "host unreachable" with the key named.
      // So the index is asked again before the nonce is let go. Named: the pool is
      // open and this device carries on. Read and not named: the write did not
      // land, so the nonce and the record go. Unread: nobody knows, so both stay
      // and the pool is in the bar to close; dropping the nonce here would leave a
      // pool the index names that can never show its code.
      const after = await rootsOf(live, host, by)
      if (after?.[keys.open] !== record) {
        if (!after) {
          return refused('index-unknown', t('pools.posts.refuse.index-unknown', 'Your signed index on {host} did not answer, so the pool may be open. It is in the pools bar, where you can close it.', { host }))
        }
        await live.records.write(before).catch(() => false)
        live.nonces.drop(pool)
        return indexRefusal(written)
      }
    }
    if (input.replaces) {
      // The recycled pool's members go once the host has kept them 30 days: one listing asks.
      if (oldPath) await live.listing(oldPath).catch(() => null)
      live.nonces.drop(input.replaces.pool)
    }

    // 5. The host says open: the only proof an index write opened anything.
    const path: EntryPoolPath = { page, address, by, until }
    const proof = await askUntil(live, path, ['open'])
    if (!proof.proved) {
      return proof.listing.reached
        ? refused('not-open', t('pools.posts.refuse.not-open', '{host} did not say the pool is open. It may not take posts yet: that is the operator\'s to ship. You can close it from the pools bar.', { host: page }), 'operator')
        : refused('unreachable', t('pools.posts.refuse.unreachable', '{host} did not answer. The pool may be open: you can close it from the pools bar.', { host: page }))
    }

    // 6. The first member, a taken-back page: from now on the address holds entry members and nobody takes it first.
    const first = await postEntryMember({
      path, pool, secretKey: live.newSecretKey(), offset: hostOffsetOf(proof.listing, live.now()),
      entry: { page: newEntryPage(), name: clip(input.title, ENTRY_LIMITS.name), title: input.title, content: '', gone: true },
    }, deps)
    if (!first.ok) return refused('first-member', t('pools.posts.refuse.first-member', 'The pool opened, but its first entry was not taken ({said}). Close it and open another.', { said: first.reason }), 'operator')

    // 7. Remembered: the record was kept before the index named the pool, without the nonce.
    return { ok: true, pool: opened, link: entryCodeLink(page, record, nonce) }
  } catch {
    return refused('failed', t('pools.posts.refuse.failed', 'The pool could not be opened.'))
  }
}

/** The code of a pool this device opened, or '' when it does not hold the pool's nonce. */
export function entryCodeFor(pool: Pick<OpenedEntryPool, 'pool' | 'record' | 'page'>, deps?: Pick<OpenEntriesDeps, 'nonces'>): string {
  try {
    const nonce = (deps?.nonces ?? liveNonces()).get(pool.pool)
    return nonce ? entryCodeLink(pool.page, pool.record, nonce) : ''
  } catch { return '' }
}

// ── closing ─────────────────────────────────────────────────────────────────

/** A pool to close: from the index alone (H and O) any of the leader's devices can. */
export type EntryPoolHandle = Pick<OpenedEntryPool, 'pool' | 'record' | 'host'> & Partial<Pick<OpenedEntryPool, 'page' | 'until' | 'title'>>

export type CloseEntryPoolResult =
  | { readonly ok: true; readonly proved: boolean; readonly reason?: string }
  | EntryRefused

/**
 * Close a pool sooner than its end: ONE index write that drops
 * `entries:<H>` and names `entries-closed:<H>` -> O, then the host is asked
 * until it says closed (about ten seconds). A device that does not hold the
 * pool's nonce cannot ask the host, and answers `proved: false`. The record
 * marks the pool closed, so a stale write that opens it again is closed again.
 * Never throws.
 */
export async function closeEntryPool(handle: EntryPoolHandle, deps?: OpenEntriesDeps): Promise<CloseEntryPoolResult> {
  try {
    const live = withLive(deps)
    if (live.readonly()) return refused('readonly', t('pools.posts.refuse.readonly-close', 'A visitor page cannot close a pool.'))
    if (!isSig(handle?.pool) || !isSig(handle.record) || !originOf(handle.host)) return refused('pool', t('pools.posts.refuse.pool', 'That is not a pool of yours.'))
    const keys = entryIndexKeys(handle.pool)
    const written = await live.changeRoots(handle.host, { drop: [keys.open], set: { [keys.closed]: handle.record } })
      .catch((): ChangeHiveRootsResult => ({ ok: false, host: handle.host, pubkey: '', createdAt: 0, dropped: {}, set: {}, reason: '' }))
    if (!written.ok) return indexRefusal(written)

    const records = await live.records.read().catch(() => [] as OpenedEntryPool[])
    const known = records.find(one => one.pool === handle.pool)
    if (known) await live.records.write(records.map(one => one.pool === handle.pool ? { ...one, closed: nowSecondsOf(live) } : one)).catch(() => false)

    const by = String(await live.publisherKey().catch(() => '') ?? '').toLowerCase()
    const page = handle.page ?? known?.page
    const until = handle.until ?? known?.until
    const path = isSig(by) && page && until ? await pathOf(live, { record: handle.record, pool: handle.pool, page, until }, by) : null
    if (!path) return { ok: true, proved: false, reason: t('pools.posts.closed.unproved', 'Closed in your index. This device did not open it, so it cannot ask the host.') }
    const proof = await askUntil(live, path, ['closed', 'expired'])
    if (proof.proved) return { ok: true, proved: true }
    if (proof.listing.state === 'open') return refused('not-closed', t('pools.posts.refuse.not-closed', 'The host still says this pool is open. Try closing it again.'))
    return { ok: true, proved: false, reason: t('pools.posts.closed.unanswered', 'Closed in your index. The host did not answer, so it is not yet confirmed.') }
  } catch {
    return refused('failed', t('pools.posts.refuse.close-failed', 'The pool could not be closed.'))
  }
}

// ── recycling ───────────────────────────────────────────────────────────────

export type RecycleEntryPoolResult =
  | { readonly ok: true; readonly asked: boolean }
  | EntryRefused

/**
 * Recycle a pool: ONE index write dropping its three keys, then one listing
 * request, so a host that has kept its members 30 days past the end drops
 * them (asked only when this device holds the nonce), and the pool leaves the
 * record and the nonce store. The record and template atoms are left to the
 * host's reach rule: other things may name them. Never throws.
 */
export async function recycleEntryPool(handle: EntryPoolHandle, deps?: OpenEntriesDeps): Promise<RecycleEntryPoolResult> {
  try {
    const live = withLive(deps)
    if (live.readonly()) return refused('readonly', t('pools.posts.refuse.readonly-recycle', 'A visitor page cannot recycle a pool.'))
    if (!isSig(handle?.pool) || !originOf(handle.host)) return refused('pool', t('pools.posts.refuse.pool', 'That is not a pool of yours.'))
    const keys = entryIndexKeys(handle.pool)
    const written = await live.changeRoots(handle.host, { drop: [keys.open, keys.closed, keys.hidden] })
      .catch((): ChangeHiveRootsResult => ({ ok: false, host: handle.host, pubkey: '', createdAt: 0, dropped: {}, set: {}, reason: '' }))
    if (!written.ok) return indexRefusal(written)

    const records = await live.records.read().catch(() => [] as OpenedEntryPool[])
    const known = records.find(one => one.pool === handle.pool)
    const by = String(await live.publisherKey().catch(() => '') ?? '').toLowerCase()
    const page = handle.page ?? known?.page
    const until = handle.until ?? known?.until
    const path = isSig(by) && isSig(handle.record) && page && until ? await pathOf(live, { record: handle.record, pool: handle.pool, page, until }, by) : null
    if (path) await live.listing(path).catch(() => null)
    if (known) await live.records.write(records.filter(one => one.pool !== handle.pool)).catch(() => false)
    live.nonces.drop(handle.pool)
    return { ok: true, asked: !!path }
  } catch {
    return refused('failed', t('pools.posts.refuse.recycle-failed', 'The pool could not be recycled.'))
  }
}

// ── hiding ──────────────────────────────────────────────────────────────────

export type HideEntryResult =
  | { readonly ok: true; readonly list: EntryHiddenList; readonly sig: string | null; readonly unchanged?: true }
  | EntryRefused

/**
 * Hide a poster's key, or one page of it (`hide`), or show it again. The list
 * the index names now is read and verified, the line changed, the new list
 * sent to the host and read back through the page's own origin (a reader that
 * cannot read a named list draws nothing, so an unserved list is never named),
 * and the index written expecting that list still to be the one named; when another tab or device moved it first, all of it is done
 * again from the newer list, a few times. A list left empty is no longer
 * named. It is the leader's own index write, so it works on a full pool and a
 * closed one. Never throws.
 */
export async function setEntryHidden(
  input: {
    readonly host: string
    readonly pool: string
    readonly line: EntryHiddenLine
    readonly hide: boolean
    /** The page the pool's code opens: where readers read the list. This device's record says it when left out. */
    readonly page?: string
  },
  deps?: OpenEntriesDeps,
): Promise<HideEntryResult> {
  try {
    const live = withLive(deps)
    if (live.readonly()) return refused('readonly', t('pools.posts.refuse.readonly-hide', 'A visitor page cannot hide an entry.'))
    if (!isSig(input?.pool) || !originOf(input.host)) return refused('pool', t('pools.posts.refuse.pool', 'That is not a pool of yours.'))
    const key = entryIndexKeys(input.pool).hidden
    const by = String(await live.publisherKey().catch(() => '') ?? '').toLowerCase()
    if (!isSig(by)) return refused('no-signer', t('pools.posts.refuse.no-signer', 'This device has no key to sign your index with.'), 'leader')

    let last: EntryRefused = refused('moved', t('pools.posts.refuse.moved', 'Another of your tabs or devices changed this at the same time. Try again.'))
    for (let tried = 0; tried < HIDE_TRIES; tried++) {
      const roots = await rootsOf(live, input.host, by)
      if (!roots) return refused('index-unsafe', t('pools.posts.refuse.index-unsafe', 'Your signed index on {host} could not be read, so nothing was changed.', { host: input.host }))
      const named = isSig(roots[key]) ? roots[key] : null
      let list = emptyHiddenList()
      if (named) {
        const bytes = await live.bytesOf(named).catch(() => null) ?? await live.atom(input.host, named, ENTRY_LIMITS.hiddenBytes).catch(() => null)
        const read = bytes ? await parseHiddenList(bytes, named) : null
        if (!read) return refused('hidden-unread', t('pools.posts.refuse.hidden-unread', 'Your list of hidden entries could not be read, so it was not changed.'))
        list = read
      }
      const next = withHiddenLine(list, input.line, input.hide)
      const nextBytes = hiddenListBytes(next)
      // The line already as asked: nothing to write, whatever order the named list was spelled in.
      if (sameText(hiddenListBytes(list), nextBytes)) {
        return { ok: true, list: next, sig: named, unchanged: true }
      }
      const nextSig = next.keys.length + next.pages.length ? await signatureOf(nextBytes) : null
      if (nextSig) {
        if (await live.keep(nextBytes).catch(() => '') !== nextSig) return refused('record', t('pools.posts.refuse.kept-hidden', 'The list of hidden entries could not be kept in this hive.'))
        const sent = await live.publish(input.host, [nextSig], sig => sig === nextSig ? Promise.resolve(nextBytes) : live.bytesOf(sig))
          .catch(() => ({ ok: false as const, error: '' }))
        if (!sent.ok) return refused('publish', t('pools.posts.refuse.publish-hidden', '{host} did not take the list of hidden entries ({said}).', { host: input.host, said: saidOrNone(sent.error) }))
        // Readers that cannot read a named list draw nothing, so a list is named only once the page serves it.
        const page = input.page ?? (await live.records.read().catch(() => [] as OpenedEntryPool[])).find(one => one.pool === input.pool)?.page ?? input.host
        const back = await live.atom(page, nextSig, ENTRY_LIMITS.hiddenBytes).catch(() => null)
        if (!back || !sameText(back, nextBytes)) {
          return refused('hidden-read-back', t('pools.posts.refuse.hidden-read-back', '{page} does not serve the new list of hidden entries yet, so it was not named: readers would draw nothing from the pool. Try again in a moment.', { page }), 'operator')
        }
      }
      const change: HiveRootsChange = nextSig
        ? { set: { [key]: nextSig }, expect: { [key]: named } }
        : { drop: [key], expect: { [key]: named } }
      const written = await live.changeRoots(input.host, change)
        .catch((): ChangeHiveRootsResult => ({ ok: false, host: input.host, pubkey: '', createdAt: 0, dropped: {}, set: {}, reason: '' }))
      if (written.ok) return { ok: true, list: next, sig: nextSig }
      last = indexRefusal(written)
      if (written.reason !== ROOT_MOVED) return last
    }
    return last
  } catch {
    return refused('failed', t('pools.posts.refuse.hide-failed', 'The list of hidden entries could not be changed.'))
  }
}

// ── posting ─────────────────────────────────────────────────────────────────

export interface PostEntryInput {
  /** Where the pool is read and posted: the page's origin, A, P and until. */
  readonly path: EntryPoolPath
  /** H. */
  readonly pool: string
  /** A key made in memory for this page load. Never the shell's signer, never stored. */
  readonly secretKey: Uint8Array
  /** host - this device, whole seconds, as the listing last gave it (hostOffsetOf). */
  readonly offset: number
  readonly entry: { readonly page: string; readonly name: string; readonly title: string; readonly content: string; readonly gone?: boolean }
}

export type PostEntryResult =
  | {
    readonly ok: true
    /** The member's name and its bytes: a change or a take-back names the same page again. */
    readonly name: string
    readonly bytes: Uint8Array
    readonly event: EntryEvent
    /** The host already held it: nothing was written. */
    readonly held: boolean
    /** The offset the post was stamped with: keep it for the next. */
    readonly offset: number
  }
  | (EntryRefused & { readonly status?: number })

/** The stamp each entry was last posted with, this page load only: `<pool>/<page>`. */
const lastPosted = new Map<string, number>()

/** Forget the stamps posted on this page: a spec's reset between cases. */
export const forgetEntryPosts = (): void => { lastPosted.clear() }

/**
 * Post one member to the pool, at the page's own origin: stamped with the
 * host's time (this device's clock plus the offset the listing gave), signed
 * with the page's own key, spelled the one way, PUT with by and until. When
 * the host refuses the stamp, the listing is asked once more for its time and
 * the member signed and sent again. The host's refusal is answered in its own
 * words. Never throws.
 */
export async function postEntryMember(input: PostEntryInput, deps?: OpenEntriesDeps): Promise<PostEntryResult> {
  try {
    const live = withLive(deps)
    let offset = Number.isSafeInteger(input?.offset) ? input.offset : 0
    // A change or a take-back made within the second of the one before it would
    // tie on its stamp, and a tie is broken by the member's name: about half the
    // time the older one would win. Each post of one entry moves past the last.
    const entryOf = `${input.pool}/${input.entry.page}`
    for (let tried = 0; tried < 2; tried++) {
      const createdAt = Math.max(nowSecondsOf(live) + offset, (lastPosted.get(entryOf) ?? 0) + 1)
      const signed = await signEntryMember({ ...input.entry, pool: input.pool, createdAt }, input.secretKey)
      if (!signed.ok) return refused('sign', signed.reason)
      const url = entryMemberUrl(input.path, signed.name)
      if (!url) return refused('path', t('pools.posts.refuse.path', 'This code does not name a pool.'))
      const answer = await live.putMember(url, signed.body).catch(() => ({ said: '' }) as { status?: number; said: string })
      if (answer.status === 200 || answer.status === 201) {
        lastPosted.set(entryOf, createdAt)
        return { ok: true, name: signed.name, bytes: signed.body, event: signed.event, held: answer.status === 200, offset }
      }
      if (answer.status === 409 && tried === 0) {
        const listing = await live.listing(input.path).catch(() => null)
        if (listing?.hostTime !== null && listing?.hostTime !== undefined) { offset = hostOffsetOf(listing, live.now()); continue }
      }
      if (answer.status === undefined) return refused('unreachable', t('pools.posts.refuse.post-unreachable', 'The host did not answer. Your entry was not posted.'))
      return { ...refused('host', answer.said || t('pools.posts.refuse.post-host', 'The host did not take the entry ({status}).', { status: answer.status })), status: answer.status }
    }
    return refused('stamp', t('pools.posts.refuse.stamp', 'The host did not take the entry\'s time. Try again.'))
  } catch {
    return refused('failed', t('pools.posts.refuse.post-failed', 'The entry could not be posted.'))
  }
}

// ── what my own index says ──────────────────────────────────────────────────

/** A pool the leader's own index names, joined to this device's record of it. */
export interface OwnEntryPool {
  readonly pool: string
  /** O, as the index names it. */
  readonly record: string
  /** What the index says: closed wins when both keys are named. */
  readonly state: 'open' | 'closed'
  /** The hidden list's signature, when the index names one. */
  readonly hidden: string | null
  /** This device's record, or null: "opened on another device". */
  readonly known: OpenedEntryPool | null
  /** For a pool this device has no record of: its public opening record O, read strictly, or null when it did not
   *  read. Its page (when it carries one) places the pool, and its end tells when it is past keeping. */
  readonly opening: EntryOpeningRecord | null
  /** This device closed it, and the index names it open again (a stale write from another tab): close it again. */
  readonly reopened: boolean
  /** More than 30 days past its end: the hive recycles it on its next index write. */
  readonly pastKeeping: boolean
}

export type OwnEntryPoolsResult =
  | { readonly ok: true; readonly pools: OwnEntryPool[] }
  | EntryRefused

/**
 * The open and closed pools the leader's own index on `host` names, including
 * ones this device has no record of, each joined to the record when there is
 * one, and else to its public opening record (its page and its end). Read
 * fresh and verified; an index that cannot be read is a refusal, never an
 * empty answer. Never throws.
 */
export async function ownEntryPools(host: string, deps?: OpenEntriesDeps): Promise<OwnEntryPoolsResult> {
  try {
    const live = withLive(deps)
    const by = String(await live.publisherKey().catch(() => '') ?? '').toLowerCase()
    if (!isSig(by)) return refused('no-signer', t('pools.posts.refuse.no-signer', 'This device has no key to sign your index with.'), 'leader')
    const roots = await rootsOf(live, host, by)
    if (!roots) return refused('index-unsafe', t('pools.posts.refuse.index-unread', 'Your signed index on {host} could not be read.', { host }))
    const found = new Map<string, { open?: string; closed?: string; hidden?: string }>()
    for (const [key, sig] of Object.entries(roots)) {
      const named = entryKeyOf(key)
      if (!named || !isSig(sig)) continue
      found.set(named.pool, { ...found.get(named.pool), [named.as]: sig })
    }
    const records = await live.records.read().catch(() => [] as OpenedEntryPool[])
    const now = nowSecondsOf(live)
    const pools: OwnEntryPool[] = []
    for (const [pool, keys] of found) {
      const record = keys.closed ?? keys.open
      if (!record) continue
      const known = records.find(one => one.pool === pool) ?? null
      const opening = known ? null : await openingOf(live, host, record)
      const state = keys.closed ? 'closed' : 'open'
      const ends = known ?? opening
      pools.push({
        pool, record, state, hidden: keys.hidden ?? null, known, opening,
        reopened: state === 'open' && !!known?.closed,
        pastKeeping: !!ends && isPastKeeping(ends, now),
      })
    }
    return { ok: true, pools }
  } catch {
    return refused('failed', t('pools.posts.refuse.index-unread', 'Your signed index on {host} could not be read.', { host }))
  }
}
