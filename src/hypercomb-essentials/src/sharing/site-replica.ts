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
//
// HOME, HELD (jwize, 2026-11-20): a card the owner published with drafts
// (site-drafts.ts) carries them in one `module:drafts` decoration. When it
// arrives here — a first adopt, or a newer card taken — and this browser is
// the owner's (the publish port's read-only `ownsThisCard`), each draft is put
// back HELD in the brood until a hand here accepts it (restoreDrafts). The
// receipt remembers which drafts were settled here, so one dropped on this
// device stays dropped.

import { isSandboxDoor, type DraftRestoreOutcome, type ModuleDraftsProvider } from '@hypercomb/core'
import { tileConvoId } from '../assistant/chat-thread.js'
import { flattenLayerTree, type PlacementHistory } from '../history/layer-placement.js'
import { isPublishedVisitorShell } from './behavior-enablement.js'

export const SITE_REPLICA_POOL = 'sites:replicas'
/** SwarmAdopt's own receipt: adopted-root path → the publisher head folded
 *  from (swarm-adopt.drone.ts SYNC_RECEIPTS_KEY). Read only, as a baseline for
 *  a replica that was taken before this page kept receipts of its own. */
const SWARM_RECEIPTS_KEY = 'hc:synced-publisher-roots'
const SIG_RE = /^[0-9a-f]{64}$/
/** The decoration a card's Publish carries the owner's drafts in (site-drafts.ts). */
export const DRAFTS_KIND = 'module:drafts'

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
export const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'

export type ReplicaLayer = { readonly name?: string; readonly [slot: string]: unknown }

export type HistoryLike = {
  sign(lineage: unknown): Promise<string>
  currentLayerAt(locationSig: string): Promise<ReplicaLayer | null>
  warmHeadSigFor?(locationSig: string): string | null
  headMarkerOf?(locationSig: string): string | null
  latestMarkerSigFor?(locationSig: string, name: string): Promise<string>
  commitLayer(locationSig: string, layer: ReplicaLayer, base?: { marker?: string | null }): Promise<string>
  getLayerBySig?(sig: string): Promise<ReplicaLayer | null>
}
export type CommitterLike = {
  importTree(
    updates: { segments: readonly string[]; layer: { name?: string } & { [slot: string]: unknown } }[],
    nameSlots?: ReadonlySet<string>,
    opts?: { replace?: boolean },
  ): Promise<void>
  settled?(): Promise<void>
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
  /** Bytes by signature, hashed to it before they are returned (content-broker fetchBySig). */
  fetchBySig?(sig: string, type: 'layer' | 'resource', timeoutMs?: number): Promise<Uint8Array | null>
  adopt?(rootSig: string, opts?: { deepResources?: boolean; layersOnly?: boolean; quiet?: boolean }): Promise<unknown>
}
export type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
  /** This device's own copy only: never a host or network fetch. */
  getResourceLocal?(sig: string): Promise<Blob | null>
  getPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
  /** The pool without creating it (a reader never makes a directory). */
  openPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
  getPoolDoc?(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
  putPoolDoc?(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }): Promise<string | null>
}
export type ManagedPublishLike = {
  publishRoot(lineage: string, layerSig: string): Promise<{ ok: boolean; error?: string; head?: string }>
  /** Is this browser the card's owner's, and does his signed index name `layerSig` for `lineage`?
   *  Reads only; false on anything unknown (hypercomb-shim managed-publish.ts). Absent: never. */
  ownsThisCard?(lineage: string, layerSig: string): Promise<boolean>
}

export type ReplicaServices = {
  readonly history: HistoryLike
  readonly store: StoreLike
  readonly adopt?: AdoptLike
  readonly broker?: BrokerLike
  readonly committer?: CommitterLike
  /** Asked only whether this browser owns the card: the page's publish port,
   *  or on the hive its own signed index (hive-take.ts). */
  readonly publish?: Pick<ManagedPublishLike, 'ownsThisCard'>
  /** The runtime's module drafts: carries a card's drafts and puts them back held. */
  readonly drafts?: Pick<ModuleDraftsProvider, 'carry' | 'restore'>
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
   *  names one of them SOON AFTER is lagging behind a publish (taking it would
   *  undo that publish); long after, it is a real re-publish of that head. */
  readonly past: readonly string[]
  /** When the receipt was written (ms) — bounds how long `past` means "lagging". */
  readonly at: number
  /** The carried draft roots settled on this device (put back, already here,
   *  or refused here): never put back again, so a draft dropped here stays
   *  dropped. Absent on a receipt written before drafts travelled. */
  readonly drafts?: readonly string[]
  /** Carried draft roots read as over a build this device moved past: said
   *  once, and never counted as known here, so a Publish from this device
   *  keeps them on the card for the others. They are still tried again (a
   *  build's layers held here never prove it ran here: an Update refused on
   *  the shell's core keeps them), and one that comes home leaves this list. */
  readonly behind?: readonly string[]
}

/** How many heads a receipt remembers moving on from. */
const PAST_KEPT = 32
/** How many settled draft roots a receipt remembers. */
const DRAFTS_KEPT = 256
/** How long a head the replica moved past still reads as the page record
 *  lagging behind (the worker's edge cache holds an index for seconds; a
 *  reload comes within minutes). After this, the same head named again is a
 *  real re-publish of it, and is followed. */
export const LAG_WINDOW_MS = 10 * 60 * 1000

/** What the door asks of the chat's threads to choose a conversation. */
export type ReplicaThreads = {
  tileConvoId?(segments: readonly string[]): string
  newTileConvoId?(segments: readonly string[]): string
  tilePathOf?(convoId: string): string
  listConversations?(): Promise<readonly ReplicaConvo[]>
}

/** What the door reads of a conversation to choose one. */
export type ReplicaConvo = { readonly convoId: string; readonly archived?: boolean; readonly lastAt?: number; readonly startedAt?: number }

/** Where the site stands in this hive: the tile at /<lineage>, one segment per
 *  name — a nested site (`revolucion/meetup`) is the tile meetup under
 *  revolucion, exactly as the worker's index names it (index.roots[lineage]). */
export const replicaRoute = (lineage: string): string[] =>
  String(lineage ?? '').split('/').map(segment => segment.trim()).filter(Boolean)

/** The tile's own name: the last segment of its route. */
const leafOf = (lineage: string): string => replicaRoute(lineage).at(-1) ?? ''

/** The card tile's own conversation — the chat opens on the card. */
export const replicaConvoId = (lineage: string, threads?: { tileConvoId?(segments: readonly string[]): string }): string => {
  const route = replicaRoute(lineage)
  try {
    const id = threads?.tileConvoId?.(route)
    if (typeof id === 'string' && id) return id
  } catch { /* the derivation below is the same */ }
  return tileConvoId(route)
}

/**
 * THE CONVERSATION THE DOOR'S CHAT OPENS. The card tile's own, while it is
 * live. The door named that one conversation on every press, so an owner who
 * archived it was put straight back into it by the Chat button, and again
 * after a reload: the archive had landed and looked as if it had not
 * (jwize, 2026-11-16: "archive doesn't seem to work on the subdomain ai
 * chat"). Put away is put away: when the card's own conversation is filed,
 * the door opens the card's most recent live conversation, and with none, a
 * fresh one on the card. The filed one stays in the list under Archived.
 * A list that cannot be read opens the card's own, as before.
 *
 * A CONVERSATION OF ANOTHER REVISION IS NOT THE ONE IT OPENS EITHER
 * (assistant/chat-revisions.ts). `inRevision` says whether a conversation
 * belongs to the revision in hand; one that does not is passed over exactly
 * as a filed one is, so opening a revision opens its own conversations.
 * Given only once the card has revisions. With it, the card's own
 * conversation is opened when it has been spoken in during this revision;
 * one nobody has spoken in yields to the revision's most recent live
 * conversation, because opening a revision should bring back the
 * conversation that built it, not an empty one (seen on
 * business-card.jwize.com, 2026-11-16).
 */
export const replicaChatConvoId = async (
  lineage: string,
  threads?: ReplicaThreads,
  inRevision?: (convo: ReplicaConvo) => boolean,
): Promise<string> => {
  const own = replicaConvoId(lineage, threads)
  if (!threads?.listConversations) return own
  let listed: readonly ReplicaConvo[]
  try { listed = await threads.listConversations() } catch { return own }
  const ownListed = listed.find(convo => convo.convoId === own)
  const belongs = inRevision ?? (() => true)
  if (inRevision ? !!ownListed && !ownListed.archived && belongs(ownListed) : !ownListed?.archived) return own
  const route = replicaRoute(lineage)
  const at = route.join('/')
  const onCard = (convoId: string): boolean => {
    try { return String(threads.tilePathOf?.(convoId) ?? '').split('/').filter(Boolean).join('/') === at } catch { return false }
  }
  const live = listed
    .filter(convo => !convo.archived && onCard(convo.convoId) && belongs(convo))
    .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0]
  if (live) return live.convoId
  // The card's own, never spoken in: it begins in the revision in hand.
  if (inRevision && !ownListed) return own
  try {
    const fresh = threads.newTileConvoId?.(route)
    if (typeof fresh === 'string' && fresh) return fresh
  } catch { /* the card's own, below */ }
  return own
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
    // A reader opens, never creates: a page that never replicates leaves no directory.
    const pool = store.openPool ? await store.openPool(SITE_REPLICA_POOL) : await store.getPool?.(SITE_REPLICA_POOL)
    const bytes = pool ? await store.getPoolDoc?.(pool, lineage) : null
    if (!bytes) return null
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ReplicaReceipt>
    if (value?.kind !== 'site:replica' || value.v !== 1 || value.lineage !== lineage) return null
    if (typeof value.published !== 'string' || !SIG_RE.test(value.published)) return null
    const local = typeof value.local === 'string' && SIG_RE.test(value.local) ? value.local : null
    const past = Array.isArray(value.past) ? value.past.filter((s): s is string => typeof s === 'string' && SIG_RE.test(s)).slice(-PAST_KEPT) : []
    const at = typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : 0
    const sigList = (list: unknown): string[] => Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && SIG_RE.test(s)).slice(-DRAFTS_KEPT) : []
    const drafts = sigList(value.drafts), behind = sigList(value.behind)
    return { kind: 'site:replica', v: 1, lineage, published: value.published, local, past, at, ...(drafts.length ? { drafts } : {}), ...(behind.length ? { behind } : {}) }
  } catch { return null }
}

/** Write the receipt: `published` is now what the replica stands on, and every
 *  head named in `left` (with the prior receipt's own) is one it moved past.
 *  The drafts settled here are kept from the receipt already written unless
 *  `drafts` names them: they are this device's, not the head's. `at` is when
 *  the replica last moved (bounds `past`); a write that only settles drafts
 *  keeps the prior receipt's, so it never reopens the lag window. */
export async function writeReceipt(
  store: StoreLike,
  lineage: string,
  published: string,
  local: string | null,
  prior: ReplicaReceipt | null = null,
  left: readonly (string | null | undefined)[] = [],
  drafts?: readonly string[],
  behind?: readonly string[],
  at: number = Date.now(),
): Promise<ReplicaReceipt | null> {
  const moved = [...(prior?.past ?? []), prior?.published, ...left]
    .filter((s): s is string => typeof s === 'string' && SIG_RE.test(s) && s !== published)
  const past = [...new Set(moved.reverse())].reverse().slice(-PAST_KEPT)
  const written = (drafts === undefined || behind === undefined) && !prior ? await readReceipt(store, lineage) : null
  const kept = (list: readonly string[]): string[] => [...new Set(list.filter(s => SIG_RE.test(s)))].slice(-DRAFTS_KEPT)
  const keptDrafts = kept(drafts ?? prior?.drafts ?? written?.drafts ?? [])
  const keptBehind = kept(behind ?? prior?.behind ?? written?.behind ?? [])
  const receipt: ReplicaReceipt = {
    kind: 'site:replica', v: 1, lineage, published, local, past, at,
    ...(keptDrafts.length ? { drafts: keptDrafts } : {}),
    ...(keptBehind.length ? { behind: keptBehind } : {}),
  }
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
  /** The head marker the state was read at — a take is guarded on it. */
  readonly marker: string | null
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
  const marker = services.history.headMarkerOf?.(where) ?? null
  let sig: string | null = null
  if (layer) {
    sig = services.history.warmHeadSigFor?.(where) ?? null
    if (!sig) { try { sig = (await services.history.latestMarkerSigFor?.(where, leafOf(site.lineage))) || null } catch { sig = null } }
  }
  const receipt = await readReceipt(services.store, site.lineage)
  const newer = !!site.head && !!layer && !lagging(receipt, site.head) && (!receipt || receipt.published !== site.head)
  const edited = !!layer && (!receipt || !receipt.local || receipt.local !== sig)
  const unpublished = !!layer && !!sig && sig !== site.head && edited
  return { loc: where, marker, layer, sig, receipt, newer, edited, unpublished }
}

/** The page names a head this replica moved past MOMENTS AGO (a publish the
 *  page record has not caught up with yet). Long after, the same head named
 *  again is a real re-publish of it — never ignored forever. */
export const lagging = (receipt: ReplicaReceipt | null, head: string | null, now: number = Date.now()): boolean =>
  !!receipt && !!head && receipt.published !== head && receipt.past.includes(head) && now - receipt.at < LAG_WINDOW_MS

/** The sources a site's bytes are asked from: the door itself, then the
 *  update sources (its zone and the followed hosts). */
const sourcesFor = (host: string, sources: readonly string[]): string[] => {
  const bare = String(host || '').toLowerCase().replace(/:\d+$/, '')
  return [...new Set([bare, ...sources].filter(Boolean))]
}

export type ReplicateOutcome =
  | { readonly kind: 'replicated'; readonly receipt: ReplicaReceipt | null; readonly drafts?: DraftsHome }
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
    // A nested site lands under its parent route, named by its last segment —
    // the same place the worker's index and the publish name it.
    const route = replicaRoute(site.lineage)
    status = await adopt.adoptResolvedBranch(
      { layerSig: site.head, at: route.slice(0, -1), domain: where.zone, label: route.at(-1) ?? site.lineage },
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
  if (!state.layer) return { kind: 'replicated', receipt: null }
  return { kind: 'replicated', ...(await landed(services, site, state.sig)) }
}

/**
 * THE CARD IS HERE: write the receipt of the head it was taken from, then
 * bring its drafts home (restoreDrafts) — after the receipt, so the card is
 * here whatever its drafts do. An immediate adopt (replicate) and a deferred
 * one that landed later (the managed page's #refresh, when replicate said
 * `pending`) both arrive through here, so neither leaves the drafts behind.
 */
export async function landed(
  services: ReplicaServices,
  site: ReplicaSite & { head: string },
  local: string | null,
): Promise<{ receipt: ReplicaReceipt | null; drafts?: DraftsHome }> {
  const receipt = await writeReceipt(services.store, site.lineage, site.head, local)
  const drafts = receipt ? await restoreDrafts(services, site, await headLayer(services.store, site.head), receipt) : undefined
  return { receipt, ...(drafts ? { drafts } : {}) }
}

/** The head's own layer as published, or null. */
async function headLayer(store: StoreLike, head: string): Promise<ReplicaLayer | null> {
  try {
    const blob = await store.getResource(head)
    const layer = blob ? JSON.parse(new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))) as unknown : null
    return layer && typeof layer === 'object' && !Array.isArray(layer) ? layer as ReplicaLayer : null
  } catch { return null }
}

/** What bringing a card's drafts home did here: how many are held here now
 *  (put back, or already here), how many wait for the same build, how many
 *  did not come home yet and are tried again (`waiting`: a part not fetched,
 *  a hold that did not land, a gate, a busy path), and how many failed the
 *  checks here (`tampered`: settled, said once, never tried again). */
export type DraftsHome = { readonly home: number; readonly otherBuild: number; readonly olderBuild?: number; readonly waiting?: number; readonly tampered?: number }

/** How many drafts one card may carry; a record naming more is not read, so
 *  the writer (site-drafts.ts recordOf) never names more. */
export const DRAFTS_MAX = 64

/** May drafts come home on this page? Fail closed: never on a sandbox door,
 *  the published visitor shell, a read-only page or a visitor install; and
 *  only when the publish port says this browser is the owner's and his signed
 *  index names this head. Where the page stands (its door, its position) never
 *  counts. */
export async function draftsMayComeHome(services: ReplicaServices, site: ReplicaSite & { head: string }): Promise<boolean> {
  try {
    if (!pageMayHoldDrafts(services)) return false
    return (await services.publish!.ownsThisCard!(site.lineage, site.head)) === true
  } catch { return false }
}

/** The half of draftsMayComeHome that reads nothing: the page itself. Asked
 *  before a card's decorations are fetched, so a visitor, a read-only page or
 *  a page with no owner check never pays for the scan. */
function pageMayHoldDrafts(services: ReplicaServices): boolean {
  try {
    if (isSandboxDoor() || isPublishedVisitorShell()) return false
    const g = globalThis as { __HC_READONLY__?: unknown; __hcInstallIndex?: unknown }
    if (g.__HC_READONLY__ === true || g.__hcInstallIndex) return false
    return typeof services.publish?.ownsThisCard === 'function'
  } catch { return false }
}

/** How many of a card's decorations are asked for at once while its drafts
 *  record is looked for: the scan waits on a few rounds, never on one round
 *  trip per decoration. */
const DRAFTS_SCAN_LANE = 8

type CarriedRecord = { refs: string[]; drafts: { root: string; layer: string }[] }

/** A `module:drafts` record that holds together, or null. */
const carriedRecord = (value: unknown): CarriedRecord | null => {
  if (!value || typeof value !== 'object') return null
  const record = value as { kind?: unknown; refs?: unknown; payload?: { drafts?: unknown } }
  if (record.kind !== DRAFTS_KIND || !Array.isArray(record.refs)) return null
  const refs = record.refs.map(s => String(s ?? ''))
  if (refs.some(s => !SIG_RE.test(s))) return null
  const listed = record.payload?.drafts
  if (!Array.isArray(listed) || listed.length > DRAFTS_MAX) return null
  const known = new Set(refs)
  const drafts: { root: string; layer: string }[] = []
  for (const entry of listed) {
    const root = String((entry as { root?: unknown })?.root ?? ''), layer = String((entry as { layer?: unknown })?.layer ?? '')
    if (!known.has(root) || !known.has(layer)) return null
    drafts.push({ root, layer })
  }
  return { refs, drafts }
}

/**
 * BRING THE CARD'S DRAFTS HOME, HELD. Only on the owner's own page
 * (draftsMayComeHome); only drafts this device has not settled already (the
 * receipt's `drafts`). Every byte is asked for by its signature and hashed to
 * it (the broker's fetchBySig); the runtime then holds each draft in the brood
 * before its bytes are written or its pick is made (module-drafts.ts
 * restoreDraft). A draft that was put back, is already here, or a hand here
 * refused is written into the receipt (one read as over a build this device
 * moved past is noted as `behind`, and said once); every other one (over
 * another build, `behind`, on a busy path, refused by a gate or not held) is
 * tried again: on the next arrival, and on every load of the card while it is
 * current (reconcile). Settling never moves the receipt's `at`. Never throws;
 * undefined when nothing was tried.
 */
export async function restoreDrafts(
  services: ReplicaServices,
  site: ReplicaSite & { head: string },
  layer: ReplicaLayer | null,
  receipt: ReplicaReceipt,
  options: { readonly local?: boolean } = {},
): Promise<DraftsHome | undefined> {
  try {
    const slot = layer?.['decorations']
    // Newest first: the drafts record is written at the END of the slot (it is
    // taken off and appended again on every change, decoration-manifest.ts
    // writeDecoration), so it is read first, however many the root wears.
    const sigs = Array.isArray(slot) ? slot.map(s => String(s ?? '')).filter(s => SIG_RE.test(s)).reverse() : []
    if (!sigs.length) return undefined
    const drafts = services.drafts
    const broker = services.broker
    if (typeof drafts?.restore !== 'function' || typeof broker?.fetchBySig !== 'function') return undefined
    // A page that may never hold drafts fetches none of the card to find out.
    if (!pageMayHoldDrafts(services)) return undefined
    const bytes = async (sig: string): Promise<Uint8Array | null> => {
      try { return (await broker.fetchBySig!(sig, 'resource')) ?? null } catch { return null }
    }
    // On a load of a card already here (`local`), its decorations are read
    // from this device only: a load never waits on the network to learn the
    // card carries no drafts. What is not here yet is read on a later load.
    const store = services.store
    const decoration = options.local && typeof store.getResourceLocal === 'function'
      ? async (sig: string): Promise<Uint8Array | null> => {
        try {
          const blob = await store.getResourceLocal!(sig)
          return blob ? new Uint8Array(await blob.arrayBuffer()) : null
        } catch { return null }
      }
      : bytes
    const read = async (sig: string): Promise<{ drafts: boolean; carried: CarriedRecord | null }> => {
      const held = await decoration(sig)
      if (!held) return { drafts: false, carried: null }
      let parsed: unknown
      try { parsed = JSON.parse(new TextDecoder().decode(held)) } catch { return { drafts: false, carried: null } }
      if ((parsed as { kind?: unknown })?.kind !== DRAFTS_KIND) return { drafts: false, carried: null }
      return { drafts: true, carried: carriedRecord(parsed) }
    }
    // A few at a time, newest first within each round: the newest drafts
    // record found is the one read, as one at a time would read it.
    let carried: CarriedRecord | null = null
    for (let at = 0; at < sigs.length; at += DRAFTS_SCAN_LANE) {
      const found = (await Promise.all(sigs.slice(at, at + DRAFTS_SCAN_LANE).map(read))).find(entry => entry.drafts)
      if (found) { carried = found.carried; break }
    }
    if (!carried) return undefined
    const settled = new Set(receipt.drafts ?? [])
    const behind = receipt.behind ?? []
    const owed = carried.drafts.filter(draft => !settled.has(draft.root))
    if (!owed.length) return undefined
    // Asked only once something is owed: the record itself is the card's
    // content, fetched as any part of it is; nothing is written before this.
    if (!(await draftsMayComeHome(services, site))) return undefined
    const outcomes = await drafts.restore({ refs: carried.refs, drafts: owed }, bytes, site.lineage)
    // A draft that fails the checks here (`tampered`) fails them the same way
    // on every try, for this build: it settles, so it is said once and never
    // fetched or owner-checked again.
    const settles = (outcome: DraftRestoreOutcome): boolean => outcome === 'applied' || outcome === 'present' || outcome === 'refused-here' || outcome === 'tampered'
    const now = outcomes.filter(o => settles(o.outcome)).map(o => o.root)
    // Said once: a root already noted behind is not told again.
    const passed = outcomes.filter(o => o.outcome === 'older-build' && !behind.includes(o.root)).map(o => o.root)
    if (now.length || passed.length) {
      // Read again: the restore waited on the network, and a Publish here or
      // another tab may have moved the receipt since. Only the drafts are
      // added to what is written now; where the replica stands is never put back.
      const latest = await readReceipt(services.store, site.lineage) ?? receipt
      const latestBehind = latest.behind ?? []
      const settledNow = [...(latest.drafts ?? []), ...now]
      await writeReceipt(services.store, site.lineage, latest.published, latest.local, latest, [],
        settledNow, [...latestBehind.filter(root => !settledNow.includes(root)), ...passed.filter(root => !latestBehind.includes(root))], latest.at)
    }
    const waiting = outcomes.filter(o => o.outcome === 'incomplete' || o.outcome === 'unheld' || o.outcome === 'gate' || o.outcome === 'path-busy').length
    const tampered = outcomes.filter(o => o.outcome === 'tampered').length
    return {
      home: outcomes.filter(o => o.outcome === 'applied' || o.outcome === 'present').length,
      otherBuild: outcomes.filter(o => o.outcome === 'other-build').length,
      ...(passed.length ? { olderBuild: passed.length } : {}),
      ...(waiting ? { waiting } : {}),
      ...(tampered ? { tampered } : {}),
    }
  } catch { return undefined }
}

/** Hold the head's whole closure on this device (page html, card data, theme,
 *  pictures), in the background — the fold itself pulls only layers. */
function holdClosure(broker: BrokerLike | undefined, head: string): void {
  try { void broker?.adopt?.(head, { deepResources: true, quiet: true })?.catch?.(() => { /* streams on demand */ }) } catch { /* streams on demand */ }
}

export type TakeOutcome = { readonly ok: true; readonly sig: string; readonly receipt: ReplicaReceipt | null; readonly drafts?: DraftsHome } | { readonly ok: false; readonly error: string }

/** Replace the replica with the published head — the whole tree, the card and
 *  every page under it, re-homed at the site's route the way the first adopt
 *  placed it (flattenLayerTree) and committed in one queued step with the
 *  committer's deliberate `replace` (jwize, 2026-11-13: take the newer one;
 *  the replaced heads stay one marker back). `expected` is the head marker the
 *  decision was made on: an edit that landed since (the AI's, another tab's)
 *  refuses the take, and the owner is offered the choice instead. */
export async function takePublished(
  services: ReplicaServices,
  site: ReplicaSite & { head: string },
  where: { host: string; sources: readonly string[] },
  expected?: { marker: string | null } | null,
): Promise<TakeOutcome> {
  const { history, store, broker, committer } = services
  broker?.noteDomainsForSig?.(site.head, sourcesFor(where.host, where.sources))
  let layer: ReplicaLayer | null = null
  try {
    const blob = await store.getResource(site.head)
    layer = blob ? JSON.parse(new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))) as ReplicaLayer : null
  } catch { layer = null }
  if (!layer || typeof layer !== 'object' || Array.isArray(layer)) return { ok: false, error: 'cold' }
  const route = replicaRoute(site.lineage)
  const loc = await replicaLocation(history, site.lineage)
  try { await history.currentLayerAt(loc) } catch { /* the guard below still holds */ }
  const marker = history.headMarkerOf?.(loc) ?? null
  if (expected && expected.marker !== marker) return { ok: false, error: 'edited' }
  let sig: string
  try {
    if (committer && history.getLayerBySig) {
      const tree = await flattenLayerTree(history as unknown as PlacementHistory, { ...layer, name: leafOf(site.lineage) }, route)
      await committer.importTree(tree, undefined, { replace: true })
      await committer.settled?.()
      try { await history.currentLayerAt(loc) } catch { /* read below */ }
      sig = history.warmHeadSigFor?.(loc) ?? (await history.latestMarkerSigFor?.(loc, leafOf(site.lineage))) ?? ''
      if (!SIG_RE.test(sig)) return { ok: false, error: 'the newer card did not land' }
    } else {
      // No committer on this page: the card's own layer, guarded on its marker.
      sig = await history.commitLayer(loc, { ...layer, name: leafOf(site.lineage) }, { marker })
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error ?? '') }
  }
  holdClosure(broker, site.head)
  // The grid under the card reads the new head too.
  try { void (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc?.get?.<{ onNewLayer?: () => Promise<void> }>(CURSOR_KEY)?.onNewLayer?.() } catch { /* best-effort */ }
  const prior = await readReceipt(store, site.lineage)
  const receipt = await writeReceipt(store, site.lineage, site.head, sig, prior)
  // After the receipt: the newer card is taken whatever its drafts do.
  const drafts = receipt ? await restoreDrafts(services, site, layer, receipt) : undefined
  return { ok: true, sig, receipt, ...(drafts ? { drafts } : {}) }
}

export type ReconcileOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'current'; readonly drafts?: DraftsHome }
  | { readonly kind: 'replicated'; readonly drafts?: DraftsHome }
  | { readonly kind: 'refused'; readonly status: string; readonly pending: boolean }
  | { readonly kind: 'taken'; readonly drafts?: DraftsHome }
  | { readonly kind: 'take-failed'; readonly error: string }
  | { readonly kind: 'choice' }

const current = (drafts: DraftsHome | undefined): ReconcileOutcome => ({ kind: 'current', ...(drafts ? { drafts } : {}) })

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
    return done.kind === 'replicated' ? { kind: 'replicated', ...(done.drafts ? { drafts: done.drafts } : {}) } : { kind: 'refused', status: done.status, pending: done.pending }
  }
  const receipt = state.receipt
  if (!receipt) {
    // Taken before this page kept receipts: SwarmAdopt's receipt says which
    // head it came from. The same head → the replica is that head's, as it is
    // now. Anything else → edits cannot be ruled out: the owner chooses.
    if (swarmReceipt(site.lineage) === head) {
      const written = await writeReceipt(services.store, site.lineage, head, state.sig)
      return current(written ? await restoreDrafts(services, { ...site, head }, await headLayer(services.store, head), written, { local: true }) : undefined)
    }
    return { kind: 'choice' }
  }
  // The card is current: drafts it carries that did not settle here (another
  // build until Update all, a fetch that failed, a hold that did not land)
  // are tried again now, not only when a newer card arrives.
  if (receipt.published === head) return current(await restoreDrafts(services, { ...site, head }, await headLayer(services.store, head), receipt, { local: true }))
  if (lagging(receipt, head)) return { kind: 'current' }
  if (receipt.local && receipt.local === state.sig) {
    const taken = await takePublished(services, { ...site, head }, where, { marker: state.marker })
    // An edit landed while the newer card was fetched: never over it; the owner chooses.
    if (!taken.ok && taken.error === 'edited') return { kind: 'choice' }
    return taken.ok ? { kind: 'taken', ...(taken.drafts ? { drafts: taken.drafts } : {}) } : { kind: 'take-failed', error: taken.error }
  }
  return { kind: 'choice' }
}

/** A publish from this page went live: the replica now stands on `published`
 *  as it is (`local`), and the head the page record still names is one it
 *  moved past — so a reload whose record lags never takes the old card back.
 *  The drafts this device's own Publish carried (`carried`: their roots) are
 *  settled here, so one dropped here after the publish stays dropped. */
export async function notePublished(
  store: StoreLike,
  site: ReplicaSite,
  published: string,
  local: string,
  carried: readonly string[] = [],
): Promise<ReplicaReceipt | null> {
  const prior = await readReceipt(store, site.lineage)
  return writeReceipt(store, site.lineage, published, local, prior, [site.head], [...(prior?.drafts ?? []), ...carried])
}
