// sharing/site-replica.ts
//
// THE CARD ON A MANAGED SITE DOOR IS A REAL TILE (jwize, 2026-11-13: "The
// whole idea is we are upgrading something that we replicated"). The owner's
// visit to <name>.<zone>/@hypercomb is the participant action: the published
// head the worker names in the page record comes into this page's hive as the
// tile at /<lineage> — through the ordinary adopt (SwarmAdoptDrone
// adoptResolvedBranch, the ExampleHivesWorker #adopt pattern), never a second
// mechanism — and from then on the card, the chat and the publish all stand on
// that one tile.
//
// A REPLICA FOLLOWS ITS PUBLISHER, AND NEVER DROPS YOUR EDITS. A receipt says
// which published head the replica came from and which local layer taking it
// left. On a later visit:
//
//   the page names the receipt's head        → nothing to do
//   a newer head, and the replica is as taken → take the newer one: commit the
//                                               published layer at the
//                                               location (the old one stays a
//                                               step back in history)
//   a newer head, and the replica was edited → the owner chooses (the bar's
//                                               "Use it"); nothing is lost
//
// The receipt is participant-local intent in the `sites:replicas` pool, one
// current record per lineage (`keep: 'current'`): the software writes it, no
// person saves it, and it is never replicated.
//
// Services arrive through window.ioc (a module may not import the shell);
// every function here takes them as arguments so a spec hands in its own.

import { tileConvoId } from '../assistant/chat-thread.js'

export const SITE_REPLICA_POOL = 'sites:replicas'
/** SwarmAdopt's own receipt: adopted-root path → the publisher head folded
 *  from (swarm-adopt.drone.ts SYNC_RECEIPTS_KEY). Read only, as a baseline for
 *  a replica that was taken before this page kept receipts of its own. */
const SWARM_RECEIPTS_KEY = 'hc:synced-publisher-roots'
const SIG_RE = /^[0-9a-f]{64}$/

export const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
export const SWARM_ADOPT_KEY = '@diamondcoreprocessor.com/SwarmAdoptDrone'
export const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
export const STORE_KEY = '@hypercomb.social/Store'
export const LINEAGE_KEY = '@hypercomb.social/Lineage'
export const CHAT_THREADS_KEY = '@diamondcoreprocessor.com/ChatThreads'
/** Part C's port: publishes one root of the owner's signed index with this
 *  origin's own listed key. Absent until that port is installed. */
export const MANAGED_PUBLISH_KEY = '@hypercomb.social/ManagedPublish'
const CURSOR_KEY = '@diamondcoreprocessor.com/HistoryCursorService'

export type ReplicaLayer = { readonly name?: string; readonly [slot: string]: unknown }

export type HistoryLike = {
  sign(lineage: unknown): Promise<string>
  currentLayerAt(locationSig: string): Promise<ReplicaLayer | null>
  warmHeadSigFor?(locationSig: string): string | null
  headMarkerOf?(locationSig: string): string | null
  latestMarkerSigFor?(locationSig: string, name: string): Promise<string>
  commitLayer(locationSig: string, layer: ReplicaLayer, base?: { marker?: string | null }): Promise<string>
}
export type AdoptStatus = 'committed' | 'exists' | 'rewound' | 'unavailable' | 'declined' | 'uninspectable'
export type AdoptLike = {
  adoptResolvedBranch(
    branch: { layerSig: string; at: string[]; domain?: string; label: string },
    opts?: { silent?: boolean },
  ): Promise<AdoptStatus>
}
export type BrokerLike = {
  noteDomainsForSig?(sig: string, domains: string[]): void
  adopt?(rootSig: string, opts?: { deepResources?: boolean; quiet?: boolean }): Promise<unknown>
}
export type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
  getPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
  getPoolDoc?(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
  putPoolDoc?(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }): Promise<string | null>
}
export type ManagedPublishLike = {
  publishRoot(lineage: string, layerSig: string): Promise<{ ok: boolean; error?: string; head?: string }>
}

export type ReplicaServices = {
  readonly history: HistoryLike
  readonly store: StoreLike
  readonly adopt?: AdoptLike
  readonly broker?: BrokerLike
}

/** What the page record says (site-manage.view.ts siteManageRecord). */
export type ReplicaSite = { readonly lineage: string; readonly head: string | null }

export type ReplicaReceipt = {
  readonly kind: 'site:replica'
  readonly v: 1
  readonly lineage: string
  /** The published head the replica was taken from (or last published as). */
  readonly published: string
  /** The local layer signature that taking it left; null when unknown. */
  readonly local: string | null
  /** Heads this replica has moved on from, newest last. A page that still
   *  names one of them is lagging behind a publish, never offering a newer
   *  card: taking it would undo that publish. */
  readonly past: readonly string[]
}

/** How many heads a receipt remembers moving on from. */
const PAST_KEPT = 32

/** Where the site stands in this hive: the tile at /<lineage>. */
export const replicaRoute = (lineage: string): string[] => [String(lineage ?? '').trim()].filter(Boolean)

/** The card tile's own conversation — the chat opens on the card. */
export const replicaConvoId = (lineage: string, threads?: { tileConvoId?(segments: readonly string[]): string }): string => {
  const route = replicaRoute(lineage)
  try {
    const id = threads?.tileConvoId?.(route)
    if (typeof id === 'string' && id) return id
  } catch { /* the derivation below is the same */ }
  return tileConvoId(route)
}

/** The location bag of the site's tile — the same signing every writer uses. */
export const replicaLocation = (history: Pick<HistoryLike, 'sign'>, lineage: string): Promise<string> => {
  const route = replicaRoute(lineage)
  return history.sign({ explorerSegments: () => route })
}

/** A layer with nothing in it: absent, or only its name (the empty `{name}`
 *  marker the history cursor mints at any location it stands on). */
export function isHusk(layer: ReplicaLayer | null | undefined): boolean {
  if (!layer || typeof layer !== 'object') return true
  for (const [key, value] of Object.entries(layer)) {
    if (key === 'name' || value === undefined || value === null) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) continue
    return false
  }
  return true
}

const encode = (value: unknown): ArrayBuffer => {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export async function readReceipt(store: StoreLike, lineage: string): Promise<ReplicaReceipt | null> {
  try {
    const pool = await store.getPool?.(SITE_REPLICA_POOL)
    const bytes = pool ? await store.getPoolDoc?.(pool, lineage) : null
    if (!bytes) return null
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ReplicaReceipt>
    if (value?.kind !== 'site:replica' || value.v !== 1 || value.lineage !== lineage) return null
    if (typeof value.published !== 'string' || !SIG_RE.test(value.published)) return null
    const local = typeof value.local === 'string' && SIG_RE.test(value.local) ? value.local : null
    const past = Array.isArray(value.past) ? value.past.filter((s): s is string => typeof s === 'string' && SIG_RE.test(s)).slice(-PAST_KEPT) : []
    return { kind: 'site:replica', v: 1, lineage, published: value.published, local, past }
  } catch { return null }
}

/** Write the receipt: `published` is now what the replica stands on, and every
 *  head named in `left` (with the prior receipt's own) is one it moved past. */
export async function writeReceipt(
  store: StoreLike,
  lineage: string,
  published: string,
  local: string | null,
  prior: ReplicaReceipt | null = null,
  left: readonly (string | null | undefined)[] = [],
): Promise<ReplicaReceipt | null> {
  const moved = [...(prior?.past ?? []), prior?.published, ...left]
    .filter((s): s is string => typeof s === 'string' && SIG_RE.test(s) && s !== published)
  const past = [...new Set(moved.reverse())].reverse().slice(-PAST_KEPT)
  const receipt: ReplicaReceipt = { kind: 'site:replica', v: 1, lineage, published, local, past }
  try {
    const pool = await store.getPool?.(SITE_REPLICA_POOL)
    if (!pool || !store.putPoolDoc) return null
    // The software's own record, never a person's save: one current member.
    return (await store.putPoolDoc(pool, encode(receipt), lineage, { keep: 'current' })) ? receipt : null
  } catch { return null }
}

/** The publisher head SwarmAdopt last folded at /<lineage>, if it kept one. */
export function swarmReceipt(lineage: string, storage: Pick<Storage, 'getItem'> | null = safeStorage()): string | null {
  try {
    const raw = storage?.getItem(SWARM_RECEIPTS_KEY)
    const value = raw ? JSON.parse(raw) as Record<string, unknown> : null
    const sig = value?.[replicaRoute(lineage).join('/')]
    return typeof sig === 'string' && SIG_RE.test(sig) ? sig : null
  } catch { return null }
}
const safeStorage = (): Storage | null => { try { return localStorage } catch { return null } }

export type ReplicaState = {
  readonly loc: string
  /** The replica's layer, or null while the location holds nothing. */
  readonly layer: ReplicaLayer | null
  /** The replica's current head layer signature, or null while it holds nothing. */
  readonly sig: string | null
  readonly receipt: ReplicaReceipt | null
  /** The page names a published head the replica was not taken from. */
  readonly newer: boolean
  /** The replica is no longer what taking the receipt's head left. */
  readonly edited: boolean
  /** The replica holds changes the published head does not. */
  readonly unpublished: boolean
}

/** Read where the replica stands, without changing anything. */
export async function readState(services: ReplicaServices, site: ReplicaSite, loc?: string): Promise<ReplicaState> {
  const where = loc ?? await replicaLocation(services.history, site.lineage)
  let layer: ReplicaLayer | null = null
  try { layer = await services.history.currentLayerAt(where) } catch { layer = null }
  if (isHusk(layer)) layer = null
  let sig: string | null = null
  if (layer) {
    sig = services.history.warmHeadSigFor?.(where) ?? null
    if (!sig) { try { sig = (await services.history.latestMarkerSigFor?.(where, site.lineage)) || null } catch { sig = null } }
  }
  const receipt = await readReceipt(services.store, site.lineage)
  const newer = !!site.head && !!layer && !lagging(receipt, site.head) && (!receipt || receipt.published !== site.head)
  const edited = !!layer && (!receipt || !receipt.local || receipt.local !== sig)
  const unpublished = !!layer && !!sig && sig !== site.head && edited
  return { loc: where, layer, sig, receipt, newer, edited, unpublished }
}

/** The page names a head this replica already moved past (a publish the page
 *  record has not caught up with yet). */
export const lagging = (receipt: ReplicaReceipt | null, head: string | null): boolean =>
  !!receipt && !!head && receipt.published !== head && receipt.past.includes(head)

/** The sources a site's bytes are asked from: the door itself, then the
 *  update sources (its zone and the followed hosts). */
const sourcesFor = (host: string, sources: readonly string[]): string[] => {
  const bare = String(host || '').toLowerCase().replace(/:\d+$/, '')
  return [...new Set([bare, ...sources].filter(Boolean))]
}

export type ReplicateOutcome =
  | { readonly kind: 'replicated'; readonly receipt: ReplicaReceipt | null }
  | { readonly kind: 'refused'; readonly status: AdoptStatus | 'no-adopt' | 'failed'; readonly pending: boolean }

/** Bring the published head in as the tile at /<lineage>: the ordinary adopt,
 *  silently (the visit is the gesture), then the whole closure held. */
export async function replicate(
  services: ReplicaServices,
  site: ReplicaSite & { head: string },
  where: { host: string; zone: string; sources: readonly string[] },
): Promise<ReplicateOutcome> {
  const { adopt, broker } = services
  const domains = sourcesFor(where.host, where.sources)
  broker?.noteDomainsForSig?.(site.head, domains)
  if (!adopt) return { kind: 'refused', status: 'no-adopt', pending: false }
  let status: AdoptStatus
  try {
    status = await adopt.adoptResolvedBranch(
      { layerSig: site.head, at: [], domain: where.zone, label: site.lineage },
      { silent: true },
    )
  } catch {
    return { kind: 'refused', status: 'failed', pending: false }
  }
  if (status !== 'committed' && status !== 'exists') {
    // 'unavailable' may still land: the adopt keeps a retry ladder for a cold
    // closure. The caller writes the receipt when the tile appears.
    return { kind: 'refused', status, pending: status === 'unavailable' }
  }
  holdClosure(broker, site.head)
  const state = await readState(services, site)
  const receipt = state.layer ? await writeReceipt(services.store, site.lineage, site.head, state.sig) : null
  return { kind: 'replicated', receipt }
}

/** Hold the head's whole closure on this device (page html, card data, theme,
 *  pictures), in the background — the fold itself pulls only layers. */
function holdClosure(broker: BrokerLike | undefined, head: string): void {
  try { void broker?.adopt?.(head, { deepResources: true, quiet: true })?.catch?.(() => { /* streams on demand */ }) } catch { /* streams on demand */ }
}

export type TakeOutcome = { readonly ok: true; readonly sig: string; readonly receipt: ReplicaReceipt | null } | { readonly ok: false; readonly error: string }

/** Replace the replica with the published head: commit the published layer at
 *  the location, guarded on the head this was read from (another tab's newer
 *  marker refuses the write instead of being dropped). The old layer stays one
 *  step back in history. */
export async function takePublished(
  services: ReplicaServices,
  site: ReplicaSite & { head: string },
  where: { host: string; sources: readonly string[] },
): Promise<TakeOutcome> {
  const { history, store, broker } = services
  broker?.noteDomainsForSig?.(site.head, sourcesFor(where.host, where.sources))
  let layer: ReplicaLayer | null = null
  try {
    const blob = await store.getResource(site.head)
    layer = blob ? JSON.parse(new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))) as ReplicaLayer : null
  } catch { layer = null }
  if (!layer || typeof layer !== 'object' || Array.isArray(layer)) return { ok: false, error: 'cold' }
  const loc = await replicaLocation(history, site.lineage)
  // Read the head first, so the guard below names the marker this replace
  // was decided on.
  try { await history.currentLayerAt(loc) } catch { /* the guard still holds */ }
  const marker = history.headMarkerOf?.(loc) ?? null
  let sig: string
  try {
    sig = await history.commitLayer(loc, { ...layer, name: layer.name ?? site.lineage }, { marker })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error ?? '') }
  }
  holdClosure(broker, site.head)
  // The grid under the card reads the new head too.
  try { void (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc?.get?.<{ onNewLayer?: () => Promise<void> }>(CURSOR_KEY)?.onNewLayer?.() } catch { /* best-effort */ }
  const prior = await readReceipt(store, site.lineage)
  const receipt = await writeReceipt(store, site.lineage, site.head, sig, prior)
  return { ok: true, sig, receipt }
}

export type ReconcileOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'current' }
  | { readonly kind: 'replicated' }
  | { readonly kind: 'refused'; readonly status: string; readonly pending: boolean }
  | { readonly kind: 'taken' }
  | { readonly kind: 'take-failed'; readonly error: string }
  | { readonly kind: 'choice' }

/** The one decision made on every load (see the table at the top). */
export async function reconcile(
  services: ReplicaServices,
  site: ReplicaSite,
  where: { host: string; zone: string; sources: readonly string[] },
): Promise<ReconcileOutcome> {
  const head = site.head
  if (!head) return { kind: 'none' }
  const state = await readState(services, site)
  if (!state.layer) {
    const done = await replicate(services, { ...site, head }, where)
    return done.kind === 'replicated' ? { kind: 'replicated' } : { kind: 'refused', status: done.status, pending: done.pending }
  }
  const receipt = state.receipt
  if (!receipt) {
    // Taken before this page kept receipts: SwarmAdopt's receipt says which
    // head it came from. The same head → the replica is that head's, as it is
    // now. Anything else → edits cannot be ruled out: the owner chooses.
    if (swarmReceipt(site.lineage) === head) {
      await writeReceipt(services.store, site.lineage, head, state.sig)
      return { kind: 'current' }
    }
    return { kind: 'choice' }
  }
  if (receipt.published === head || lagging(receipt, head)) return { kind: 'current' }
  if (receipt.local && receipt.local === state.sig) {
    const taken = await takePublished(services, { ...site, head }, where)
    return taken.ok ? { kind: 'taken' } : { kind: 'take-failed', error: taken.error }
  }
  return { kind: 'choice' }
}

/** A publish from this page went live: the replica now stands on `published`
 *  as it is (`local`), and the head the page record still names is one it
 *  moved past — so a reload whose record lags never takes the old card back. */
export async function notePublished(
  store: StoreLike,
  site: ReplicaSite,
  published: string,
  local: string,
): Promise<ReplicaReceipt | null> {
  const prior = await readReceipt(store, site.lineage)
  return writeReceipt(store, site.lineage, published, local, prior, [site.head])
}
