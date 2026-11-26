// pools/open-entries-leader.ts
//
// THE LEADER'S SIDE OF AN OPEN ENTRY POOL (documentation/open-entry-pools.md):
// what the pools bar shows and does with "Open for posts", and what the
// catalogue reads as one more source. The flows themselves (open, close,
// recycle, hide, post) are open-entries-flows.ts; this file chooses what to run
// them with and says what happened in one plain sentence, with whose it is to
// fix when something failed.
//
// A PAGE HAS ONE POOL. Opening where the page already has one says how many of
// its entries were not brought home, offers to bring them, and recycles the
// old pool in the same index write that opens the new one. Recycling by hand
// says the same first. The hive also tends what its own index names each time
// the leader's controls read it: a pool this device closed that the index names
// open again (a stale write from another tab) is closed again, and a pool more
// than 30 days past its end is recycled; both are said.
//
// WHAT AN ENTRY IS stays the feature's: a feature hands in an entry form
// (open-entries-forms.ts: its meaning, the templates a poster may fill, and how
// its rows are brought home). This file knows no recipe.
//
// It draws nothing but the code (sharing/room-qr.view.ts, its live default):
// the row that shows the rest is open-entries-panel.ts. A dependency: it
// registers nothing.

import { ENTRY_NONCE_STORE_IOC_KEY, I18N_IOC_KEY, SignatureService, entryNonceStore, get, type I18nProvider } from '@hypercomb/core'
import { fetchHiveIndex, type HiveIndexResult, type HiveManifest } from '../sharing/hive-pointer.js'
import { publisherKeyHex } from '../sharing/key-list.client.js'
import { doorsOfIndex } from '../sharing/publish-results.js'
import { showRoomQr } from '../sharing/room-qr.view.js'
import { originOf, zoneDoor } from '../sharing/zone-door.js'
import {
  ENTRY_LIMITS,
  entryPageUrl,
  entryPoolAddress,
  entryPoolName,
  isEntryLine,
  isOfferablePage,
  latestEntryUntil,
  parseEntryRecord,
  readEntryAtom,
  readEntryPool,
  type EntryPoolPath,
  type EntryPoolRead,
  type EntryPoolState,
  type EntryRow,
} from './open-entries.js'
import {
  closeEntryPool,
  entryCodeFor,
  liveOpenedRecord,
  openEntryPool,
  ownEntryPools,
  recycleEntryPool,
  type EntryFixer,
  type EntryNonceIo,
  type EntryRefused,
  type OpenEntriesDeps,
  type OpenedEntryPool,
  type OwnEntryPool,
} from './open-entries-flows.js'
import { liveOfferedPublishDeps } from './offered-pool.js'
import { entryForms, type EntryForm, type EntryFormTemplate } from './open-entries-forms.js'

const SIG = /^[0-9a-f]{64}$/
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const STORE_KEY = '@hypercomb.social/Store'
const DAY = 86_400

/** The ends the leader picks from, in days. The first is the default; the last is the most a pool may run. */
export const ENTRY_END_DAYS: readonly number[] = Object.freeze([1, 2, 3, 7, 14, 31])

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

const utf8 = new TextEncoder()
const signatureOf = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

// ── what the leader picks ───────────────────────────────────────────────────

/** A pool's end, `days` from `nowSeconds`: at least one day, and never past the 31 a pool may run, less the ten
 *  minutes a leader's clock may run ahead of the host's (latestEntryUntil: the cap is computed there and only there). */
export const entryUntilFor = (days: number, nowSeconds: number): number => {
  const whole = Number.isFinite(days) ? Math.floor(days) : 1
  const most = Math.floor(ENTRY_LIMITS.untilMaxSeconds / DAY)
  return Math.min(Math.floor(nowSeconds) + Math.min(Math.max(1, whole), most) * DAY, latestEntryUntil(nowSeconds))
}

/**
 * The pages a code may be shown for: the addresses the leader's own index
 * gives (the domain's bare address included when the site opens there), once
 * each, in the index's order. A `host.` or `try-` address refuses every write
 * and is never offered.
 */
export function entryPagesOf(manifest: Pick<HiveManifest, 'roots' | 'doors' | 'addresses' | 'createdAt'>, readZone: string): string[] {
  const pages: string[] = []
  for (const door of doorsOfIndex(manifest, readZone)) {
    if (isOfferablePage(door.address) && !pages.includes(door.address)) pages.push(door.address)
  }
  return pages
}

/** Whose a refusal is to fix, in words: '' when it is nobody's in particular. */
export const entryWhoseWords = (whose?: EntryFixer): string =>
  whose === 'leader'
    ? t('pools.posts.whose.leader', 'This one is yours to fix.')
    : whose === 'operator'
      ? t('pools.posts.whose.operator', 'This one is for the operator who runs the host.')
      : ''

/** When a pool ends, as this device's clock and language say a date and time. */
export const entryEndWords = (until: number): string => {
  try {
    return new Date(until * 1000).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return new Date(until * 1000).toISOString() }
}

/**
 * How many of a pool's entries this hive has not brought home: an entry is
 * home once its words are kept here as an atom, by the hash of those words
 * (the design's "Bring it to my hive"). Each entry once, however many readers
 * posted it.
 */
export async function entriesNotHome(rows: readonly EntryRow[], held: (sig: string) => Promise<boolean>): Promise<number> {
  const seen = new Set<string>()
  let missing = 0
  for (const row of rows) {
    const sig = await signatureOf(utf8.encode(String(row?.content ?? '')))
    if (seen.has(sig)) continue
    seen.add(sig)
    if (!await held(sig).catch(() => false)) missing++
  }
  return missing
}

// ── reading the leader's pools ──────────────────────────────────────────────

/** Every external the leader's side touches, beyond the flows' own. Each optional: the live one stands in. */
export interface EntryLeaderDeps extends OpenEntriesDeps {
  /** The host the leader's index is kept on. */
  host?(): string
  /** Does this hive hold these bytes? Never asks a host. */
  held?(sig: string): Promise<boolean>
  /** A pool as a reader draws it. */
  readPool?(path: EntryPoolPath, pool: string): Promise<EntryPoolRead>
  /** The entry forms features handed in. */
  forms?(): readonly EntryForm[]
  /** Show a code to point a phone at; false when it could not be drawn. `open`: the pool still takes posts. */
  showCode?(link: string, title: string, until: number, open: boolean): boolean
}

/** One pool the leader's index names, as the bar shows it. */
export interface LeaderPool {
  readonly pool: string
  /** O. */
  readonly record: string
  /** What the index says: closed wins. */
  readonly state: 'open' | 'closed'
  /** This device's record, or null: opened on another device. */
  readonly known: OpenedEntryPool | null
  /** The page the pool is for: this device's record, else the page its public opening record carries; '' unknown. */
  readonly page: string
  /** Its end, whole seconds, from the same: 0 unknown. */
  readonly until: number
  /** Its title, from the same: '' unknown. */
  readonly title: string
  /** The code, '' when this device does not hold the pool's nonce. */
  readonly code: string
  /** What the host said when the pool was read. Undefined when it was not read. */
  readonly hostState?: EntryPoolState
  /** The entries a reader draws, null when the pool could not be read. */
  readonly entries: number | null
  /** Of those, how many this hive has not brought home. */
  readonly notHome: number | null
  /** The rows as read: what Bring them brings. */
  readonly rows: readonly EntryRow[]
}

export type LeaderPostsResult =
  | {
    readonly ok: true
    readonly host: string
    /** The pages a code may be shown for. */
    readonly pages: readonly string[]
    readonly pools: readonly LeaderPool[]
    /** What the hive did on its own while reading: a pool closed again, one recycled. */
    readonly told: readonly string[]
  }
  | EntryRefused

const refused = (why: string, reason: string, whose?: EntryFixer): EntryRefused => ({ ok: false, why, reason, ...(whose ? { whose } : {}) })

const liveHost = (): string => {
  try {
    const sync = get<{ publicHostDomain?(): string; ownHostDomain?(): string }>(HOST_SYNC_KEY)
    return zoneDoor(sync?.publicHostDomain?.() || sync?.ownHostDomain?.() || '')
  } catch { return '' }
}

const liveHeld = async (sig: string): Promise<boolean> => {
  try {
    const store = get<{ getResourceLocal?(sig: string): Promise<Blob | null> }>(STORE_KEY)
    return !!(await store?.getResourceLocal?.(sig))
  } catch { return false }
}

/** The leader's deps with every live default this side adds. */
const leaderLive = (deps: EntryLeaderDeps = {}) => ({
  host: deps.host ?? liveHost,
  held: deps.held ?? liveHeld,
  readPool: deps.readPool ?? ((path: EntryPoolPath, pool: string) => readEntryPool(path, pool)),
  forms: deps.forms ?? entryForms,
  publisherKey: deps.publisherKey ?? (() => publisherKeyHex()),
  index: deps.index ?? ((host: string, pubkey: string) => fetchHiveIndex(host, pubkey, undefined, { fresh: true })),
  records: deps.records ?? liveOpenedRecord(),
  now: deps.now ?? Date.now,
  showCode: deps.showCode ?? ((link: string, title: string, until: number, open: boolean) => showRoomQr(link, {
    title: t('pools.posts.code.title', 'Post to {title}', { title }),
    // A closed pool's code still opens the page, which shows what was posted: it never says it takes posts.
    note: open
      ? t('pools.posts.code.note', 'Point a phone at this, or open {link}. It takes posts until {end}.', { link, end: entryEndWords(until) })
      : t('pools.posts.code.note-closed', 'Point a phone at this, or open {link}. It takes no more posts: it shows what was posted.', { link }),
    copy: t('pools.posts.code.copy', 'Copy the link'),
    copied: t('pools.posts.code.copied', 'Copied'),
    close: t('pools.posts.code.close', 'Close'),
  }, () => navigator.clipboard?.writeText(link))),
})

/** The nonce store, as handed in or the hive's own (core EntryNonceStore). */
const noncesOf = (deps: EntryLeaderDeps): EntryNonceIo => {
  if (deps.nonces) return deps.nonces
  let held: EntryNonceIo | undefined
  try { held = get<EntryNonceIo>(ENTRY_NONCE_STORE_IOC_KEY) } catch { held = undefined }
  return held ?? entryNonceStore
}

/** A pool's path for a listing, when this device holds its nonce and the nonce names this pool. */
async function pathFor(known: OpenedEntryPool, by: string, nonces: EntryNonceIo): Promise<EntryPoolPath | null> {
  const nonce = nonces.get(known.pool)
  const address = nonce ? await entryPoolAddress(known.record, nonce) : ''
  if (!address || await entryPoolName(address, by, known.until) !== known.pool) return null
  return { page: known.page, address, by, until: known.until }
}

/**
 * The leader's pools on their host, read fresh: the pages a code may be shown
 * for, every pool the index names (with this device's record of it, or none:
 * opened on another device), and for each pool this device holds the code of,
 * how many entries a reader draws and how many are not brought home. On the
 * way it closes again what the index reopened behind this device's back and
 * recycles what is more than 30 days past its end, and says so. Never throws.
 */
export async function readLeaderPosts(deps: EntryLeaderDeps = {}): Promise<LeaderPostsResult> {
  let host = ''
  try {
    const live = leaderLive(deps)
    host = String(live.host() ?? '').trim()
    if (!originOf(host)) return refused('no-host', t('pools.posts.refuse.no-host', 'Name the host your index is kept on first.'), 'leader')
    const by = String(await live.publisherKey().catch(() => '') ?? '').toLowerCase()
    if (!SIG.test(by)) return refused('no-signer', t('pools.posts.refuse.no-signer', 'This device has no key to sign your index with.'), 'leader')
    const read = await live.index(host, by).catch((): HiveIndexResult => ({ ok: false, reason: 'unreachable' }))
    const absent = !read.ok && read.reason === 'http' && read.status === 404
    if (!read.ok && !absent) return refused('index-unsafe', t('pools.posts.refuse.index-unread', 'Your signed index on {host} could not be read.', { host }))
    const manifest = read.ok ? read.manifest : { roots: {}, createdAt: 0 }
    const pages = entryPagesOf(manifest, zoneDoor(host))
    const once = { ...deps, index: async () => read } satisfies OpenEntriesDeps

    let own = await ownEntryPools(host, once)
    if (!own.ok) return own
    const told: string[] = []
    let tended = false
    for (const one of own.pools) {
      const title = one.known?.title ?? one.opening?.title ?? ''
      const placed = placeOf(one)
      if (one.pastKeeping) {
        const done = await recycleEntryPool({ pool: one.pool, record: one.record, host, ...placed }, deps)
        tended = true
        told.push(done.ok
          ? t('pools.posts.tend.recycled', '"{title}" ended more than 30 days ago, so it was recycled.', { title })
          : done.reason)
      } else if (one.reopened) {
        const done = await closeEntryPool({ pool: one.pool, record: one.record, host, ...placed }, deps)
        tended = true
        told.push(done.ok
          ? t('pools.posts.tend.reclosed', '"{title}" was opened again by an older write from another tab, so it was closed again.', { title })
          : done.reason)
      }
    }
    // What the hive changed on its own is read back: the index is the truth, not what was meant.
    if (tended) {
      own = await ownEntryPools(host, deps)
      if (!own.ok) return own
    }

    const nonces = noncesOf(deps)
    const pools: LeaderPool[] = []
    for (const one of own.pools) pools.push(await leaderPoolOf(one, by, nonces, live))
    return { ok: true, host, pages, pools, told }
  } catch {
    return host
      ? refused('failed', t('pools.posts.refuse.index-unread', 'Your signed index on {host} could not be read.', { host }))
      : refused('failed', t('pools.posts.refuse.pools-unread', 'Your pools could not be read.'))
  }
}

/** Where a pool of the leader's index is, as far as this device can tell: its own record, else the public opening
 *  record's page and end. Empty when neither says. */
const placeOf = (one: OwnEntryPool): { page?: string; until?: number } => {
  if (one.known) return { page: one.known.page, until: one.known.until }
  return one.opening ? { ...(one.opening.page ? { page: one.opening.page } : {}), until: one.opening.until } : {}
}

async function leaderPoolOf(
  one: OwnEntryPool,
  by: string,
  nonces: EntryNonceIo,
  live: ReturnType<typeof leaderLive>,
): Promise<LeaderPool> {
  const base = {
    pool: one.pool, record: one.record, state: one.state, known: one.known,
    page: one.known?.page ?? one.opening?.page ?? '',
    until: one.known?.until ?? one.opening?.until ?? 0,
    title: one.known?.title ?? one.opening?.title ?? '',
  }
  const path = one.known ? await pathFor(one.known, by, nonces) : null
  if (!one.known || !path) return { ...base, code: '', entries: null, notHome: null, rows: [] }
  const code = entryCodeFor(one.known, { nonces })
  const read = await live.readPool(path, one.pool).catch(() => null)
  if (!read?.reached || read.why || (read.state !== 'open' && read.state !== 'closed')) {
    return { ...base, code, ...(read ? { hostState: read.state } : {}), entries: null, notHome: null, rows: [] }
  }
  const notHome = await entriesNotHome(read.rows, live.held)
  return { ...base, code, hostState: read.state, entries: read.rows.length, notHome, rows: read.rows }
}

/** The pool a page already has, as the leader's index names it, opened on this device or another: a page has one
 *  pool. Another device's pool is placed by the page its public opening record carries. */
export const leaderPoolOfPage = (pools: readonly LeaderPool[], page: string): LeaderPool | null => {
  const wanted = entryPageUrl(page)
  return wanted ? pools.find(one => entryPageUrl(one.known?.page ?? one.page) === wanted) ?? null : null
}

// ── opening, closing, recycling, bringing home ──────────────────────────────

/** What the leader asks to open. */
export interface LeaderOpenInput {
  readonly host: string
  readonly page: string
  readonly title: string
  readonly days: number
  readonly meaning: string
  readonly template: EntryFormTemplate
  /** The page's last pool: recycled in the same write. */
  readonly replaces?: LeaderPool | null
}

export type LeaderOpened =
  | { readonly ok: true; readonly pool: OpenedEntryPool; readonly link: string; readonly said: string; readonly shown: boolean }
  | EntryRefused

/**
 * Open a pool for posts with the client's open flow, the template's bytes
 * handed to it, and show the code. A page's last pool goes in the same write.
 * Never throws.
 */
export async function openForPosts(input: LeaderOpenInput, deps: EntryLeaderDeps = {}): Promise<LeaderOpened> {
  try {
    const live = leaderLive(deps)
    const title = String(input?.title ?? '').trim()
    if (!isEntryLine(title, ENTRY_LIMITS.title)) {
      return refused('title', t('pools.posts.refuse.title', 'The title is one line of 1 to {max} characters.', { max: ENTRY_LIMITS.title }), 'leader')
    }
    const template = input.template
    const until = entryUntilFor(input.days, Math.floor(live.now() / 1000))
    const ownBytes = deps.bytesOf ?? (async (sig: string) => liveOfferedPublishDeps()?.bytesOf(sig) ?? null)
    const bytesOf = (sig: string): Promise<Uint8Array | null> => sig === template?.sig ? Promise.resolve(template.bytes) : ownBytes(sig)
    // The page's last pool, as this device's record has it or as its public record places it (another device's).
    const last = input.replaces
    const replaces: OpenedEntryPool | undefined = last?.known
      ?? (last && last.page && last.until ? { record: last.record, pool: last.pool, host: input.host, page: last.page, title: last.title, until: last.until } : undefined)
    const opened = await openEntryPool({
      host: input.host, page: input.page, title, meaning: input.meaning, template: template?.sig ?? '', until,
      ...(replaces ? { replaces } : {}),
    }, { ...deps, bytesOf })
    if (!opened.ok) return opened
    const shown = live.showCode(opened.link, title, opened.pool.until, true)
    return {
      ok: true, pool: opened.pool, link: opened.link, shown,
      said: t('pools.posts.opened', '"{title}" takes posts at {page} until {end}.', { title, page: input.page, end: entryEndWords(opened.pool.until) }),
    }
  } catch {
    return refused('failed', t('pools.posts.refuse.failed', 'The pool could not be opened.'))
  }
}

/** Show a pool's code again; false when this device does not hold it. A closed or ended pool's code says it takes no posts. */
export function showPostsCode(pool: LeaderPool, deps: EntryLeaderDeps = {}): boolean {
  if (!pool.code || !pool.known) return false
  const live = leaderLive(deps)
  const open = pool.state === 'open' && pool.hostState !== 'closed' && pool.hostState !== 'expired'
    && pool.known.until > Math.floor(live.now() / 1000)
  return live.showCode(pool.code, pool.known.title, pool.known.until, open)
}

/** Close a pool sooner, from this device or another: one sentence either way. */
export async function closeForPosts(host: string, pool: LeaderPool, deps: EntryLeaderDeps = {}): Promise<{ readonly ok: boolean; readonly said: string; readonly whose?: EntryFixer }> {
  const done = await closeEntryPool({
    pool: pool.pool, record: pool.record, host,
    ...(pool.known ? { page: pool.known.page, until: pool.known.until, title: pool.known.title } : {}),
  }, deps)
  if (!done.ok) return { ok: false, said: done.reason, ...(done.whose ? { whose: done.whose } : {}) }
  const title = pool.known?.title ?? pool.title ?? ''
  if (done.proved) {
    return { ok: true, said: title ? t('pools.posts.closed.proved', '"{title}" is closed. The host says so.', { title }) : t('pools.posts.closed.proved-other', 'The pool is closed. The host says so.') }
  }
  return { ok: true, said: done.reason ?? t('pools.posts.closed.unanswered', 'Closed in your index. The host did not answer, so it is not yet confirmed.') }
}

/**
 * Recycle a pool by hand: its keys leave the index, its members go once the
 * host has kept them 30 days. A pool this device has no code for (opened on
 * another device) is recycled all the same: its keys are dropped, but the host
 * cannot be asked for its listing without the nonce, so its members wait for
 * the next reader past 30 days, or the operator's sweep. That is fine, and it
 * is said.
 */
export async function recycleForPosts(host: string, pool: LeaderPool, deps: EntryLeaderDeps = {}): Promise<{ readonly ok: boolean; readonly said: string; readonly whose?: EntryFixer }> {
  const page = pool.known?.page ?? pool.page
  const until = pool.known?.until ?? pool.until
  const done = await recycleEntryPool({
    pool: pool.pool, record: pool.record, host,
    ...(page ? { page } : {}), ...(until ? { until } : {}),
  }, deps)
  if (!done.ok) return { ok: false, said: done.reason, ...(done.whose ? { whose: done.whose } : {}) }
  const title = pool.known?.title ?? pool.title ?? ''
  const said = title ? t('pools.posts.recycled', '"{title}" was recycled.', { title }) : t('pools.posts.recycled-other', 'The pool was recycled.')
  if (done.asked) return { ok: true, said }
  return { ok: true, said: `${said} ${t('pools.posts.recycled-unasked', 'This device does not hold its code, so the host could not be asked to let its entries go now: it drops them once they are 30 days past the end.')}` }
}

/**
 * Bring a pool's entries home through the feature its record names: the
 * record is read (from this hive, else from the page) for its meaning and
 * template, and the feature keeps each row its own way. One sentence.
 */
export async function bringPostsHome(pool: LeaderPool, deps: EntryLeaderDeps = {}): Promise<{ readonly ok: boolean; readonly said: string }> {
  try {
    const live = leaderLive(deps)
    const known = pool.known
    if (!known || !pool.rows.length) return { ok: true, said: t('pools.posts.bring.nothing', 'There is nothing in this pool to bring home.') }
    const held = await (deps.bytesOf ?? (async (sig: string) => liveOfferedPublishDeps()?.bytesOf(sig) ?? null))(pool.record).catch(() => null)
    const bytes = held ?? await (deps.atom ?? readEntryAtom)(known.page, pool.record, ENTRY_LIMITS.recordBytes).catch(() => null)
    const record = bytes ? await parseEntryRecord(bytes, pool.record) : null
    if (!record?.ok) return { ok: false, said: t('pools.posts.bring.unread', 'The pool\'s record could not be read, so nothing was brought home.') }
    const form = live.forms().find(one => one.meaning === record.record.meaning)
    if (!form?.bring) return { ok: false, said: t('pools.posts.bring.no-form', 'Nothing in this hive knows how to bring these entries home.') }
    const done = await form.bring(pool.rows, { pool: pool.pool, page: known.page, template: record.record.template, title: known.title })
    if (done.reason && done.brought < pool.rows.length) {
      return { ok: false, said: t('pools.posts.bring.partly', 'Brought {count} home. The rest were not: {reason}', { count: done.brought, reason: done.reason }) }
    }
    return { ok: true, said: t('pools.posts.bring.done', 'Brought {count} home.', { count: done.brought }) }
  } catch {
    return { ok: false, said: t('pools.posts.bring.failed', 'The entries could not be brought home.') }
  }
}

// ── the catalogue's source ──────────────────────────────────────────────────

/** One pool this device opened, read as the catalogue reads it. */
export interface OpenedSource {
  readonly pool: string
  readonly record: string
  readonly host: string
  readonly page: string
  readonly title: string
  readonly meaning: string
  readonly template: string
  readonly read: EntryPoolRead
}

/**
 * Every pool this device opened and still holds the code of, read as a
 * reader reads it, with its meaning and template from its own record. A pool
 * past keeping, or whose record does not read, is left out. Never throws.
 */
export async function readOpenedSources(deps: EntryLeaderDeps = {}): Promise<OpenedSource[]> {
  try {
    const live = leaderLive(deps)
    const by = String(await live.publisherKey().catch(() => '') ?? '').toLowerCase()
    if (!SIG.test(by)) return []
    const now = Math.floor(live.now() / 1000)
    const records = await live.records.read().catch(() => [] as OpenedEntryPool[])
    const ownBytes = deps.bytesOf ?? (async (sig: string) => liveOfferedPublishDeps()?.bytesOf(sig) ?? null)
    const out: OpenedSource[] = []
    for (const known of records) {
      if (now > known.until + ENTRY_LIMITS.keptSeconds) continue
      const path = await pathFor(known, by, noncesOf(deps))
      if (!path) continue
      const bytes = await ownBytes(known.record).catch(() => null)
        ?? await (deps.atom ?? readEntryAtom)(known.page, known.record, ENTRY_LIMITS.recordBytes).catch(() => null)
      const record = bytes ? await parseEntryRecord(bytes, known.record) : null
      if (!record?.ok) continue
      const read = await live.readPool(path, known.pool).catch(() => null)
      if (!read) continue
      out.push({
        pool: known.pool, record: known.record, host: known.host, page: known.page, title: known.title,
        meaning: record.record.meaning, template: record.record.template, read,
      })
    }
    return out
  } catch { return [] }
}
