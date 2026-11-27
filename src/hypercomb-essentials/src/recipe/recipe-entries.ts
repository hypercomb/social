// recipe/recipe-entries.ts
//
// A LIT RECIPE TILE IS A ROW SOMEONE OFFERS. This file makes the row, leaves
// it where it belongs, and gathers everyone's rows back, the same way whether
// the source is a domain the reader follows or a classmate in the room they
// joined (documentation/pools-as-relational-database.md, T9).
//
//   THE ROW  an entry (recipe-template.ts): the tile's name, its recipe by
//            signature, its cover. One atom, one signature (I1, A1). What a
//            reader needs beside it is its closure: the recipe document, the
//            template it names and its pictures, each named by signature (I2)
//            and each offered only when this device holds it. What is offered
//            is what is here: a host is never asked for bytes this hive is
//            about to send.
//   LEAVING  two places, one row. On the cook's own root domain it is a member
//            of the pool `recipe:entry`, left by Publish through the
//            contribution below (pools/pool-contributions.ts). In a room it is
//            an entry on the room's host, signed by the participant who made
//            it (pools/room-entries.ts). A room's address carries its secret
//            and is never derived here. The parts go before the head that
//            names them (T1). Taking a row back hides it, never deletes (H4).
//   THE PAGE a room member says in the clear what its entry is OF, so a newer
//            entry of the same tile replaces the older. That name must not
//            give the tile's route away: it is the signature of the route
//            AND the participant's own public key (the signer's
//            knownPublicKeyHex, threaded through deps), stable for one tile
//            and one person and different for each person, so nobody can test
//            a guessed route against it. Only a device with no key yet signs
//            the route alone.
//   GATHERING the union across the sources the reader chose (T5, M3): one
//            offer per signature, and every node it came from beside it
//            (pools/pool-node.ts). Nothing downstream asks what kind a node
//            is.
//
// A listing is never proof (M1, M2). An entry, a recipe, a template and a
// picture are each trusted only when their bytes hash to the name they were
// asked by (S3, T2), and every read is bounded in time, size and count.
//
// A TILE THAT COULD NOT BE READ IS NOT A TILE WITH NOTHING TO OFFER. One whose
// layer is known but not readable yet answers `unread`, and the contribution
// then answers no members at all: a list without that tile would be published
// as the whole pool, and its recipe withdrawn on the word of a failed read.
//
// OPENING IS NOT KEEPING (T4, T5). `openRecipeEntry` fetches and verifies and
// writes nothing. `takeRecipeHome` is the press that keeps: the publisher's own
// bytes become resources under their own signatures (A6: another spelling
// would be another signature), and a tile is made for them, a forward commit
// like any other (H2, L1).
//
// A VISITOR HIVE ONLY READS (T5): one opened read-only neither shares with a
// room nor takes a recipe home, and says so in words.
//
// Nothing here throws: a refusal is words. Nothing registers here: a behaviour
// file hands the contribution in.

import { I18N_IOC_KEY, SignatureService, get, isReservedPoolWord, lineageKey, normalizeCell, type I18nProvider } from '@hypercomb/core'
import { replaceDecoration } from '../commands/decoration-manifest.js'
import { isBareLayer } from '../history/child-sig-guard.js'
import { childNamesOfStrict, resolveCurrentLayer, type PlacementHistory } from '../history/layer-placement.js'
import { readBodyCapped } from '../pools/bounded-body.js'
import { readOfferedPools, type OfferedReadIo } from '../pools/offered-pool.js'
import { entryRowNode, readEntryMember, type EntryRow } from '../pools/open-entries.js'
import type { PoolContribution } from '../pools/pool-contributions.js'
import { poolNodeTitle, uniquePoolNodes, type PoolNode } from '../pools/pool-node.js'
import {
  readRoomEntries,
  roomAtom,
  roomEntryNode,
  roomStanding,
  shareRoomEntry,
  type RoomEntriesDeps,
  type RoomEntriesSigner,
  type RoomEntryShared,
} from '../pools/room-entries.js'
import { fetchWithDeadline, mapBounded } from '../sharing/bounded-fetch.js'
import { originOf, zoneDoor } from '../sharing/zone-door.js'
import { RECIPE_KIND, RECIPE_SLOT } from './recipe-slot.js'
import { loadRecipeAt, type RecipeStoreDeps } from './recipe-store.js'
import {
  RECIPE_LIMITS,
  isEmptyRecipeValue,
  parseRecipe,
  parseRecipeEntry,
  parseRecipeTemplate,
  recipeCover,
  recipeEntryBytes,
  recipeSignatures,
  type Recipe,
  type RecipeEntry,
  type RecipeTemplate,
} from './recipe-template.js'

/** The pool's meaning. Its address is derived by the store, never spelled here. */
export const RECIPE_ENTRY_MEANING = 'recipe:entry'

const SIG = /^[a-f0-9]{64}$/
/** One picture of a recipe someone else offers, in bytes. */
const PICTURE_MAX_BYTES = 2 * 1024 * 1024
/** Lit tiles read at once when the contribution is asked for its members. */
const ROUTES_AT_ONCE = 8
/** Pieces of one recipe read at once. */
const PIECES_AT_ONCE = 4
/** How long one opening goes on asking for pictures. One whose turn comes after that is left out. */
const PICTURES_BUDGET_MS = 20_000
/** Sources one opening asks for a piece before it is called absent. */
const SOURCES_MAX = 4
/** Numbers tried after a name that is taken. */
const NAME_TRIES = 99
const HOST_TIMEOUT_MS = 6_000

const STORE_KEY = '@hypercomb.social/Store'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const CURSOR_KEY = '@diamondcoreprocessor.com/HistoryCursorService'
const SAVED_ROOTS_KEY = '@diamondcoreprocessor.com/SavedRoots'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

type EntryStore = {
  getResource?(sig: string): Promise<Blob | null>
  /** Bytes this device holds, read through a meta envelope when the signature names one. Never asks a host. */
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
  /** Bytes this device holds, exactly as named. Never asks a host. */
  getResourceLocal?(sig: string): Promise<Blob | null>
  putResource?(blob: Blob): Promise<string>
}

type EntryCommitter = {
  importTree?(updates: { segments: readonly string[]; layer: { name?: string; [slot: string]: unknown } }[]): Promise<void>
}

/** What this file does its work with. Every part optional: the hive's own stands in for any left out. */
export interface RecipeEntriesDeps {
  /** Where a route's current layer is read. */
  history?: RecipeStoreDeps['history']
  /** The content store: bytes by signature. */
  store?: EntryStore
  /** The layer committer, for the one act that makes a tile with its recipe. */
  committer?: EntryCommitter
  /** Put the recipe decoration on a tile, so the view's mark lights on it. */
  decorate?: (segments: readonly string[]) => Promise<unknown>
  /** Whether a tile already answers at this route: listed on its page, or put away with its layer kept. Throws where the page could not be read. */
  takenAt?: (route: readonly string[]) => Promise<boolean>
  /** How a followed domain is read. */
  io?: OfferedReadIo
  /** The participant's own named host, '' for none. */
  ownHost?: () => string
  /** How the room this tab is joined to is read and written. Its signer is also whose key an entry's page is made with. */
  room?: RoomEntriesDeps
  /** Told each domain that was asked and did not answer, so a reader hears it was not reached rather than empty. */
  unanswered?: (node: PoolNode) => void
  /** Whether a host answers at all: asked only of a domain that offered nothing. The live one asks the host's root,
   *  and is used only where the reads are the live ones too. */
  answers?: (zone: string) => Promise<boolean>
}

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

const live = <T>(key: string): T | undefined => {
  try { return get<T>(key) } catch { return undefined }
}

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const signatureOf = (bytes: Uint8Array): Promise<string> => SignatureService.sign(exact(bytes))

const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

/** A hive opened read-only: a visitor's. It reads what is offered and writes nothing anywhere. */
const visitorHive = (): boolean => (globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ === true

const storeOf = (deps: RecipeEntriesDeps): EntryStore | undefined => deps.store ?? live<EntryStore>(STORE_KEY)

/** The route as given, or null when it names no tile. Never mended: dropping a name would name another tile. */
const routeOf = (segments: readonly string[]): string[] | null =>
  Array.isArray(segments) && segments.length && segments.every(part => typeof part === 'string' && part.trim())
    ? [...segments]
    : null

/**
 * What this device holds under a signature. A host is never asked. A tile's
 * slot names its recipe through a meta envelope (L2), so the read follows that
 * one hop where the store can: the raw local read would answer the envelope.
 */
const localBlob = async (deps: RecipeEntriesDeps, sig: string): Promise<Blob | null> => {
  const store = storeOf(deps)
  try {
    if (store?.getResourceResolvedLocal) return await store.getResourceResolvedLocal(sig) ?? null
    return await (store?.getResourceLocal ? store.getResourceLocal(sig) : store?.getResource?.(sig)) ?? null
  } catch { return null }
}

const localBytes = async (deps: RecipeEntriesDeps, sig: string): Promise<Uint8Array | null> => {
  const blob = await localBlob(deps, sig)
  if (!blob) return null
  try { return new Uint8Array(await blob.arrayBuffer()) } catch { return null }
}

/** The room as this file asks it: an entry's pieces come from this hive's own store. */
const roomDepsOf = (deps: RecipeEntriesDeps): RoomEntriesDeps => ({
  ...deps.room,
  bytesOf: deps.room?.bytesOf ?? (sig => localBytes(deps, sig)),
})

/** The participant's own public key when this device already holds one, '' otherwise. Never mints one, never asks for one. */
const ownKeyOf = async (deps: RecipeEntriesDeps): Promise<string> => {
  try {
    const signer = deps.room?.signer ? deps.room.signer() : live<RoomEntriesSigner>(SIGNER_KEY)
    const key = String(await signer?.knownPublicKeyHex?.() ?? '').trim().toLowerCase()
    return SIG.test(key) ? key : ''
  } catch { return '' }
}

/**
 * What an entry is OF. The route is folded the way a lineage is signed (core
 * lineageKey), so one tile is one page however its names were spelled and a
 * newer entry of the tile replaces the older. A room member carries this in
 * the clear, so the participant's own key is signed with the route: the page
 * is then theirs alone, and a guessed route cannot be tested against it. The
 * route alone is signed only when no key is known.
 */
const pageOf = async (route: readonly string[], deps: RecipeEntriesDeps): Promise<string> => {
  const key = await ownKeyOf(deps)
  return signatureOf(new TextEncoder().encode(key ? `${lineageKey(route)}\u0000${key}` : lineageKey(route)))
}

// ── the row ─────────────────────────────────────────────────────────────────

export type RecipeEntryMade =
  | {
    readonly ok: true
    readonly sig: string
    readonly bytes: Uint8Array
    readonly entry: RecipeEntry
    /** Every atom a reader needs beside the entry: the recipe, then the template and pictures held here. */
    readonly closure: string[]
    /** What the entry is of: the tile's route signed with the participant's own key, the route alone when no key is known. */
    readonly page: string
  }
  | {
    readonly ok: false
    readonly reason: string
    /** The tile could not be read, so whether it holds a recipe to offer is not known. Never set for a tile that holds none. */
    readonly unread?: true
  }

/** The entry of the tile at `segments`, worked out and written nowhere. */
async function deriveEntry(segments: readonly string[], deps: RecipeEntriesDeps): Promise<RecipeEntryMade> {
  const route = routeOf(segments)
  if (!route) return refuse(t('recipe.entry.refuse.noTile', 'No tile is named.'))
  const tile = await loadRecipeAt(route, {
    ...(deps.history ? { history: deps.history } : {}),
    store: { getResource: sig => localBlob(deps, sig) },
  })
  const recipe = tile.recipe
  if (!recipe) {
    if (!tile.reason) return refuse(t('recipe.entry.refuse.none', 'This tile holds no recipe yet.'))
    const refused = refuse(t('recipe.entry.refuse.unread', 'The recipe on this tile could not be read: {reason}.', { reason: tile.reason }))
    // The tile itself was not read: that is carried, so a caller never takes it for a tile with nothing to offer.
    return tile.unread ? { ...refused, unread: true } : refused
  }
  if (Object.values(recipe.values).every(isEmptyRecipeValue)) {
    return refuse(t('recipe.entry.refuse.empty', 'This recipe is empty. Write something in it before you offer it.'))
  }
  const named = recipeSignatures(recipe)
  const held = (await mapBounded(named, PIECES_AT_ONCE, async sig => (await localBlob(deps, sig)) ? sig : ''))
    .filter((sig): sig is string => !!sig)
  const cover = recipeCover(recipe)
  const bytes = recipeEntryBytes({
    name: tile.name.trim(),
    recipe: recipe.sig,
    ...(cover && held.includes(cover) ? { cover } : {}),
  })
  // Never offer what would not read: a row is only what every reader accepts.
  const parsed = await parseRecipeEntry(bytes)
  if (!parsed.ok) {
    return refuse(t('recipe.entry.refuse.shape', 'This recipe could not be made into an entry: {reason}.', { reason: parsed.reason }))
  }
  return { ok: true, sig: parsed.sig, bytes, entry: parsed.entry, closure: [recipe.sig, ...held], page: await pageOf(route, deps) }
}

/** The entry's bytes as a resource. True only when the store answers the entry's own signature (S3). */
const holdEntry = async (deps: RecipeEntriesDeps, sig: string, bytes: Uint8Array): Promise<boolean> => {
  const store = storeOf(deps)
  if (!store?.putResource) return false
  return await store.putResource(new Blob([exact(bytes)], { type: 'application/json' })).catch(() => '') === sig
}

/**
 * The row the tile at `segments` offers: its current recipe as an entry, held
 * as a resource, with the closure a reader needs and the page it is of. A tile
 * with no recipe, or an empty one, is refused with words. Reads this device
 * only. Never throws.
 */
export async function recipeEntryOf(segments: readonly string[], deps: RecipeEntriesDeps = {}): Promise<RecipeEntryMade> {
  try {
    const made = await deriveEntry(segments, deps)
    if (!made.ok) return made
    if (!storeOf(deps)?.putResource) return refuse(t('recipe.entry.refuse.noStore', 'The store is not available here.'))
    return await holdEntry(deps, made.sig, made.bytes)
      ? made
      : refuse(t('recipe.entry.refuse.notKept', 'The store did not keep the entry it was given.'))
  } catch {
    return refuse(t('recipe.entry.refuse.failed', 'The recipe could not be offered.'))
  }
}

// ── what a lit recipe tile leaves in the pool, at the cook's own root domain ─

/**
 * The rows the lit tiles offer in `recipe:entry`: one entry for each lit route
 * that holds a recipe. Asking for the members only works them out, so a
 * preview writes nothing; the entries become resources when their closure is
 * asked for, which is when a publish is about to send them. When a lit tile
 * could not be read the members are not answered (it throws): the pool is
 * then left as it is published, never rewritten as a shorter one.
 */
export function recipeEntryContribution(deps: RecipeEntriesDeps = {}): PoolContribution {
  let worked = new Map<string, { bytes: Uint8Array; closure: readonly string[] }>()
  return {
    meaning: RECIPE_ENTRY_MEANING,
    label: { key: 'recipe.entry.count', one: '1 recipe', other: '{count} recipes' },
    membersOf: async routes => {
      const made = await mapBounded(routes, ROUTES_AT_ONCE, route => deriveEntry(route, deps))
      // A tile that holds no recipe is left out. One that could not be read is not: its row may be in the pool now.
      if (made.some(entry => !entry || (!entry.ok && entry.unread))) throw new Error('a lit tile could not be read')
      const next = new Map<string, { bytes: Uint8Array; closure: readonly string[] }>()
      for (const entry of made) if (entry?.ok) next.set(entry.sig, { bytes: entry.bytes, closure: entry.closure })
      worked = next
      return [...next.keys()]
    },
    closureOf: async members => {
      const closure = new Set<string>()
      for (const sig of members) {
        const entry = worked.get(sig)
        if (!entry || !(await holdEntry(deps, sig, entry.bytes))) continue
        for (const piece of entry.closure) closure.add(piece)
      }
      return [...closure]
    },
  }
}

// ── the classroom: an entry in the room this tab is joined to ───────────────

/** `live`: the room's host does not keep this key's entries, so the recipe is shared only while its cook is in the room. */
export type RecipeEntryShared =
  | { readonly ok: true; readonly host: string }
  | { readonly ok: false; readonly reason: string; readonly live?: true }

const sharedAs = (shared: RoomEntryShared): RecipeEntryShared =>
  shared.ok ? { ok: true, host: shared.host } : { ok: false, reason: shared.reason, ...(shared.live ? { live: true as const } : {}) }

const refuseVisitorShare = (): RecipeEntryShared =>
  refuse(t('recipe.entry.refuse.readonly', 'This visitor hive cannot share with a room.'))

/**
 * Share the recipe on the tile at `segments` with the room: its entry, signed
 * by the participant's own key and named for them, with everything it names
 * sent before it. Sharing the same tile again replaces its earlier entry. A
 * visitor hive is refused. Never throws.
 */
export async function shareRecipeWithRoom(segments: readonly string[], deps: RecipeEntriesDeps = {}): Promise<RecipeEntryShared> {
  try {
    if (visitorHive()) return refuseVisitorShare()
    const made = await recipeEntryOf(segments, deps)
    if (!made.ok) return made
    return sharedAs(await shareRoomEntry(RECIPE_ENTRY_MEANING, { head: made.sig, page: made.page, closure: made.closure }, roomDepsOf(deps)))
  } catch {
    return refuse(t('recipe.entry.refuse.failed', 'The recipe could not be offered.'))
  }
}

/**
 * Take the tile's recipe back from the room: a newer member for its page that
 * says gone. Nothing is deleted on the host (H4). It works for a tile whose
 * recipe is no longer there: the page alone says which entry is gone, and then
 * stands in for the head. A visitor hive is refused. Never throws.
 */
export async function retractRecipeFromRoom(segments: readonly string[], deps: RecipeEntriesDeps = {}): Promise<RecipeEntryShared> {
  try {
    if (visitorHive()) return refuseVisitorShare()
    const route = routeOf(segments)
    if (!route) return refuse(t('recipe.entry.refuse.noTile', 'No tile is named.'))
    const page = await pageOf(route, deps)
    const made = await deriveEntry(route, deps).catch(() => null)
    return sharedAs(await shareRoomEntry(RECIPE_ENTRY_MEANING, { head: made?.ok ? made.sig : page, page, gone: true }, roomDepsOf(deps)))
  } catch {
    return refuse(t('recipe.entry.retract.failed', 'The recipe could not be taken back.'))
  }
}

// ── gathering ───────────────────────────────────────────────────────────────

/** One recipe someone offers: read and verified, held in the answer, kept nowhere. */
export interface RecipeEntryOffer {
  /** The entry's own signature: the row's key. */
  readonly sig: string
  readonly entry: RecipeEntry
  /** The first node that offered it. */
  readonly node: PoolNode
  /** Every node that offered it, once each. */
  readonly nodes: readonly PoolNode[]
  /** Where the first node's entry was read from: a domain's zone, or the room's host. */
  readonly host: string
  /** Seconds: when its newest room entry was signed. Absent for a row only domains offer. */
  readonly at?: number
  /** Set for a row read from an open entry pool: the member carries the recipe's words itself. */
  readonly posted?: RecipeEntryPosted
}

/** Where a posted row came from: the member that carries it, and the pool it was read from. */
export interface RecipeEntryPosted {
  /** The member's name: the hash of its bytes. */
  readonly member: string
  /** The member's own bytes. The recipe is answered from them, never asked of anyone. */
  readonly bytes: Uint8Array
  /** H: the pool the member is for. */
  readonly pool: string
  /** The pool's host (the leader's page): where the template is read when this device does not hold it. */
  readonly host: string
  /** The pool's template: the one signature a posted recipe may name. */
  readonly template: string
  /** Every poster's own entry page this offer stands for, by the key that signed it: what the leader hides one
   *  entry by (the hidden list's `<key>:<page>` line). One a poster, the first they posted it under. */
  readonly lines?: readonly RecipeEntryPostedLine[]
}

/** One poster's entry page, as the member they signed names it. */
export interface RecipeEntryPostedLine {
  readonly signer: string
  readonly page: string
}

/** A host that answers anything at its root, within the deadline, answered: only a host never reached did not. */
const liveAnswers = async (zone: string): Promise<boolean> => {
  try {
    await fetchWithDeadline(`${originOf(zone)}/`, { method: 'HEAD', cache: 'no-store' }, { timeoutMs: HOST_TIMEOUT_MS })
    return true
  } catch { return false }
}

/** The caller's read parts, each telling `failed` the host it threw for. The parts left to the live reader are left
 *  as they are: a live read that fails says nothing, so the host is asked whether it answers at all. */
const listening = (io: OfferedReadIo | undefined, failed: Set<string>): OfferedReadIo | undefined => {
  if (!io) return undefined
  const heard = async <T>(host: string, read: () => Promise<T>): Promise<T> => {
    try { return await read() } catch (error) { failed.add(zoneDoor(host)); throw error }
  }
  const keysOf = io.keysOf
  const indexOf = io.indexOf
  const atom = io.atom
  return {
    ...io,
    ...(keysOf ? { keysOf: (host: string) => heard(host, () => keysOf(host)) } : {}),
    ...(indexOf ? { indexOf: (host: string, pubkey: string) => heard(host, () => indexOf(host, pubkey)) } : {}),
    ...(atom ? { atom: (host: string, sig: string, limit: number) => heard(host, () => atom(host, sig, limit)) } : {}),
  }
}

/** Tell the caller each zone asked that offered nothing and did not answer. Never throws. */
const tellUnanswered = async (
  zones: readonly string[],
  offered: ReadonlySet<string>,
  failed: ReadonlySet<string>,
  deps: RecipeEntriesDeps,
  own: string,
): Promise<void> => {
  const tell = deps.unanswered
  if (!tell) return
  const answers = deps.answers ?? (deps.io ? null : liveAnswers)
  const quiet = [...new Set(zones.map(zone => zoneDoor(zone)).filter(Boolean))].filter(zone => !offered.has(zone))
  await mapBounded(quiet, 4, async zone => {
    const silent = failed.has(zone) || (answers ? !(await answers(zone).catch(() => false)) : false)
    if (!silent) return
    try { tell({ kind: 'domain', id: zone, ...(own && zone === own ? { you: true } : {}) }) } catch { /* the caller's ear */ }
  })
}

const ownHostOf = (deps: RecipeEntriesDeps): string => {
  try {
    if (deps.ownHost) return zoneDoor(deps.ownHost())
    const sync = get<{ publicHostDomain?(): string; ownHostDomain?(): string }>(HOST_SYNC_KEY)
    return zoneDoor(sync?.publicHostDomain?.() || sync?.ownHostDomain?.() || '')
  } catch { return '' }
}

/**
 * The recipes these sources offer, as one table: the `recipe:entry` pool of
 * each zone, and, when `room` is true and this tab is joined, the room's
 * entries. One offer per entry signature with every node that offers it, the
 * first one named; a member that does not read as an entry is left out. The
 * reader's own rows stay, marked `you` on their node. Newest first where a
 * time is known, then by name. Nothing is kept. Never throws. A domain that
 * offered nothing and did not answer is told to `deps.unanswered`, so it is
 * never mistaken for one with nothing published.
 */
export async function findRecipeEntries(
  sources: { zones: readonly string[]; room?: boolean },
  deps: RecipeEntriesDeps = {},
): Promise<readonly RecipeEntryOffer[]> {
  try {
    const found = new Map<string, { entry: RecipeEntry; nodes: PoolNode[]; host: string; at?: number }>()
    const zones = Array.isArray(sources?.zones) ? sources.zones : []
    if (zones.length) {
      const own = ownHostOf(deps)
      const failed = new Set<string>()
      const io = deps.unanswered ? listening(deps.io, failed) : deps.io
      const members = await readOfferedPools(zones, RECIPE_ENTRY_MEANING, {
        ...(io ? { io } : {}),
        maxMemberBytes: RECIPE_LIMITS.entryBytes,
      }).catch(() => [])
      await tellUnanswered(zones, new Set(members.flatMap(member => member.hosts)), failed, deps, own)
      for (const member of members) {
        const parsed = await parseRecipeEntry(member.bytes, member.sig)
        if (!parsed.ok) continue
        const nodes = member.hosts.map((host): PoolNode => ({ kind: 'domain', id: host, ...(own && host === own ? { you: true } : {}) }))
        found.set(member.sig, { entry: parsed.entry, nodes, host: member.host })
      }
    }
    if (sources?.room === true) {
      const room = roomDepsOf(deps)
      const host = roomStanding(room).host
      const reads = await readRoomEntries(RECIPE_ENTRY_MEANING, room, { maxHeadBytes: RECIPE_LIMITS.entryBytes }).catch(() => [])
      for (const read of reads) {
        const parsed = await parseRecipeEntry(read.bytes, read.head)
        if (!parsed.ok) continue
        const held = found.get(read.head)
        if (held) {
          held.nodes.push(roomEntryNode(read))
          held.at = Math.max(held.at ?? 0, read.at)
        } else {
          found.set(read.head, { entry: parsed.entry, nodes: [roomEntryNode(read)], host, at: read.at })
        }
      }
    }
    const offers: RecipeEntryOffer[] = []
    for (const [sig, row] of found) {
      const nodes = uniquePoolNodes(row.nodes)
      const node = nodes[0]
      if (node) offers.push({ sig, entry: row.entry, node, nodes, host: row.host, ...(row.at !== undefined ? { at: row.at } : {}) })
    }
    return offers.sort(byNewest)
  } catch { return [] }
}

/** Newest first where a time is known, then by name, then by signature: one order for every reader. */
const byNewest = (a: RecipeEntryOffer, b: RecipeEntryOffer): number =>
  (b.at ?? 0) - (a.at ?? 0) || a.entry.name.localeCompare(b.entry.name) || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0)

// ── a posted row: an open entry pool's member (documentation/open-entry-pools.md) ─

/** The pool a posted row was read from, as the reader knows it. */
export interface RecipePostedSource {
  /** H: the pool the rows are for. */
  readonly pool: string
  /** The pool's host: the leader's page, where its template is served. */
  readonly host: string
  /** The pool's template, from its opening record. */
  readonly template: string
  /** The reader's own key, when it posts here: its rows are marked `you`. */
  readonly own?: string
}

/**
 * A posted recipe names nothing but the pool's template. A poster the host
 * does not admit cannot upload a picture, and must not be able to make every
 * reader's browser ask for one the host already holds. Words, and only words.
 */
const namesOnlyTemplate = (recipe: Recipe, template: string): boolean =>
  recipeSignatures(recipe).every(sig => sig === template)

/**
 * One reader row of an open entry pool as an offer, the same shape every other
 * source gives. Its recipe is the member's `content`, read by the same strict
 * reader as any other and named by the hash of those bytes; its entry is the
 * document every row has, `{ name: <title>, recipe: <that signature> }`, so the
 * row is keyed by that entry's signature. A recipe that names any signature
 * but the pool's template is refused. The offer carries the member's own bytes
 * and the pool's host: opening it asks nobody for the recipe. Never throws.
 */
export async function postedRecipeOf(
  row: EntryRow,
  source: RecipePostedSource,
): Promise<{ readonly ok: true; readonly offer: RecipeEntryOffer; readonly recipe: Recipe } | { readonly ok: false; readonly reason: string }> {
  try {
    if (!SIG.test(String(source?.pool ?? '')) || !SIG.test(String(source.template ?? ''))) {
      return refuse(t('recipe.post.posted.no-pool', 'This entry names no pool to be read from.'))
    }
    const read = await parseRecipe(new TextEncoder().encode(String(row?.content ?? '')))
    if (!read.ok) return refuse(t('recipe.post.posted.unread', 'This entry is not a recipe that can be read: {reason}.', { reason: read.reason }))
    if (!namesOnlyTemplate(read.recipe, source.template)) {
      return refuse(t('recipe.post.posted.names', 'This entry names something other than the form it was posted to, so it is not shown.'))
    }
    const entry = await parseRecipeEntry(recipeEntryBytes({ name: row.title, recipe: read.recipe.sig }))
    if (!entry.ok) return refuse(t('recipe.post.posted.unread', 'This entry is not a recipe that can be read: {reason}.', { reason: entry.reason }))
    const node = entryRowNode(row, source.own ?? '')
    return {
      ok: true,
      recipe: read.recipe,
      offer: {
        sig: entry.sig, entry: entry.entry, node, nodes: [node], host: source.host, at: row.at,
        posted: {
          member: row.member, bytes: row.bytes, pool: source.pool, host: source.host, template: source.template,
          lines: [{ signer: row.signer, page: row.page }],
        },
      },
    }
  } catch {
    return refuse(t('recipe.post.posted.failed', 'This entry could not be read.'))
  }
}

/**
 * The rows a reader drew from an open entry pool (pools/open-entries.ts
 * readEntryPool), as offers: one per entry signature with every node that
 * posted it, newest first. A row that is not a recipe, or names anything but
 * the template, is left out. Never throws.
 */
export async function postedRecipeOffers(rows: readonly EntryRow[], source: RecipePostedSource): Promise<readonly RecipeEntryOffer[]> {
  try {
    const found = new Map<string, RecipeEntryOffer>()
    for (const row of Array.isArray(rows) ? rows : []) {
      const made = await postedRecipeOf(row, source)
      if (!made.ok) continue
      const held = found.get(made.offer.sig)
      if (!held) { found.set(made.offer.sig, made.offer); continue }
      const nodes = uniquePoolNodes([...held.nodes, ...made.offer.nodes])
      const lines = [...(held.posted?.lines ?? [])]
      for (const line of made.offer.posted?.lines ?? []) if (!lines.some(one => one.signer === line.signer)) lines.push(line)
      found.set(made.offer.sig, {
        ...held, nodes, at: Math.max(held.at ?? 0, made.offer.at ?? 0),
        ...(held.posted ? { posted: { ...held.posted, lines } } : {}),
      })
    }
    return [...found.values()].sort(byNewest)
  } catch { return [] }
}

// ── opening one to read it ──────────────────────────────────────────────────

/** A recipe as it was opened: read, verified, and held only in this answer. */
export interface RecipeEntryOpened {
  readonly recipe: Recipe
  /** The template the recipe names. Null when it names none, or it did not arrive or read: the caller shows a default. */
  readonly template: RecipeTemplate | null
  /** The pictures that arrived, by signature. One that did not arrive is simply absent. */
  readonly pictures: ReadonlyMap<string, Uint8Array>
  /** The publisher's own bytes of the recipe and of its template: what keeping it stores. */
  readonly bytes: { readonly recipe: Uint8Array; readonly template?: Uint8Array }
}

/** `/<sig>`, then the legacy `/content/<sig>`: the first that serves bytes hashing to the name. */
const liveDomainAtom = async (host: string, sig: string, limit: number): Promise<Uint8Array | null> => {
  const origin = originOf(host)
  if (!origin) return null
  for (const path of [`/${sig}`, `/content/${sig}`]) {
    try {
      const response = await fetchWithDeadline(`${origin}${path}`, {}, { timeoutMs: HOST_TIMEOUT_MS })
      if (!response.ok) continue
      const bytes = await readBodyCapped(response, limit)
      if (bytes?.byteLength && await signatureOf(bytes) === sig) return bytes
    } catch { /* the other spelling, then nothing */ }
  }
  return null
}

/**
 * How one offer's pieces are read: from the nodes that offered it, in order (a
 * domain's own host, the room's host for a participant), the first that serves
 * bytes no larger than the limit and hashing to the name (S3).
 */
const pieceReader = (offer: RecipeEntryOffer, deps: RecipeEntriesDeps): ((sig: string, limit: number) => Promise<Uint8Array | null>) => {
  const domainAtom = deps.io?.atom ?? liveDomainAtom
  const sources: ((sig: string, limit: number) => Promise<Uint8Array | null>)[] = []
  let room = false
  for (const node of uniquePoolNodes([offer.node, ...(offer.nodes ?? [])])) {
    if (node.kind === 'domain') {
      const zone = zoneDoor(node.id)
      if (zone) sources.push((sig, limit) => domainAtom(zone, sig, limit))
    } else if (!room) {
      room = true
      sources.push((sig, limit) => roomAtom(sig, limit, roomDepsOf(deps)))
    }
  }
  return async (sig, limit) => {
    if (!SIG.test(sig)) return null
    for (const source of sources.slice(0, SOURCES_MAX)) {
      const bytes = await source(sig, limit).catch(() => null)
      if (bytes && bytes.byteLength > 0 && bytes.byteLength <= limit && await signatureOf(bytes) === sig) return bytes
    }
    return null
  }
}

/** The picture type these bytes are, by how they begin: PNG, JPEG, GIF or WebP. '' for anything else. */
const pictureType = (bytes: Uint8Array): string => {
  const begins = (at: number, ...values: number[]): boolean => values.every((value, index) => bytes[at + index] === value)
  if (begins(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (begins(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (begins(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (begins(0, 0x52, 0x49, 0x46, 0x46) && begins(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return ''
}

/** The pictures a recipe names, at most as many as one section holds. */
const picturesOf = (recipe: Recipe): string[] =>
  recipeSignatures(recipe).filter(sig => sig !== recipe.template).slice(0, RECIPE_LIMITS.pictures)

/**
 * Open a posted row. The recipe is answered from the member's own bytes, read
 * again as a member of its pool (M1: the offer is trusted by its bytes, not by
 * whoever built it), and must hash to the recipe the entry names. The template
 * is read from this device's own store, then from the pool's host; never from
 * the room. It names no picture, so none is asked for.
 */
async function openPostedEntry(
  offer: RecipeEntryOffer,
  posted: RecipeEntryPosted,
  deps: RecipeEntriesDeps,
): Promise<({ readonly ok: true } & RecipeEntryOpened) | { readonly ok: false; readonly reason: string }> {
  const from = poolNodeTitle(offer.node)
  const member = await readEntryMember(posted.bytes, posted.pool, posted.member)
  if (!member) return refuse(t('recipe.post.posted.member', 'The entry from {from} is not the member it says it is.', { from }))
  const document = new TextEncoder().encode(member.content)
  const read = await parseRecipe(document, offer.entry.recipe)
  if (!read.ok) return refuse(t('recipe.entry.open.unread', 'The recipe from {from} could not be read: {reason}.', { from, reason: read.reason }))
  if (!namesOnlyTemplate(read.recipe, posted.template)) {
    return refuse(t('recipe.post.posted.names', 'This entry names something other than the form it was posted to, so it is not shown.'))
  }
  let template: RecipeTemplate | null = null
  let templateBytes: Uint8Array | undefined
  const named = read.recipe.template
  if (named) {
    const layout = await localBytes(deps, named)
      ?? await (deps.io?.atom ?? liveDomainAtom)(posted.host, named, RECIPE_LIMITS.templateBytes).catch(() => null)
    const parsed = layout ? await parseRecipeTemplate(layout, named) : null
    if (layout && parsed?.ok) { template = parsed.template; templateBytes = layout }
  }
  return { ok: true, recipe: read.recipe, template, pictures: new Map(), bytes: { recipe: document, ...(templateBytes ? { template: templateBytes } : {}) } }
}

/**
 * Open an offered recipe to read it: its document, the template it names and
 * its pictures, fetched from the nodes that offered it, each verified by its
 * signature and capped in size (a picture: 2 MB, and only a PNG, JPEG, GIF or
 * WebP). The recipe must arrive and read; a template or picture that does not
 * is left out. NOTHING is written or kept: opening is not keeping. Never
 * throws.
 */
export async function openRecipeEntry(
  offer: RecipeEntryOffer,
  deps: RecipeEntriesDeps = {},
): Promise<({ readonly ok: true } & RecipeEntryOpened) | { readonly ok: false; readonly reason: string }> {
  try {
    const wanted = String(offer?.entry?.recipe ?? '')
    if (!offer?.node || !SIG.test(wanted)) return refuse(t('recipe.entry.open.notEntry', 'This is not an offered recipe.'))
    // A posted row's recipe is in the member it came with: never asked of the room or a domain.
    if (offer.posted) return await openPostedEntry(offer, offer.posted, deps)
    const from = poolNodeTitle(offer.node)
    const piece = pieceReader(offer, deps)

    const document = await piece(wanted, RECIPE_LIMITS.recipeBytes)
    if (!document) return refuse(t('recipe.entry.open.absent', 'The recipe did not arrive from {from}.', { from }))
    const read = await parseRecipe(document, wanted)
    if (!read.ok) return refuse(t('recipe.entry.open.unread', 'The recipe from {from} could not be read: {reason}.', { from, reason: read.reason }))
    const recipe = read.recipe

    let template: RecipeTemplate | null = null
    let templateBytes: Uint8Array | undefined
    if (recipe.template) {
      const layout = await piece(recipe.template, RECIPE_LIMITS.templateBytes)
      const parsed = layout ? await parseRecipeTemplate(layout, recipe.template) : null
      if (layout && parsed?.ok) { template = parsed.template; templateBytes = layout }
    }

    const named = picturesOf(recipe)
    // A host that stops answering part way costs one budget, never a deadline for every picture.
    const until = Date.now() + PICTURES_BUDGET_MS
    const arrived = await mapBounded(named, PIECES_AT_ONCE, async sig => Date.now() < until ? piece(sig, PICTURE_MAX_BYTES) : null)
    const pictures = new Map<string, Uint8Array>()
    named.forEach((sig, at) => {
      const bytes = arrived[at]
      if (bytes && pictureType(bytes)) pictures.set(sig, bytes)
    })
    return { ok: true, recipe, template, pictures, bytes: { recipe: document, ...(templateBytes ? { template: templateBytes } : {}) } }
  } catch {
    return refuse(t('recipe.entry.open.failed', 'The recipe could not be opened.'))
  }
}

// ── the press that keeps it ─────────────────────────────────────────────────

type CursorLike = { currentLayerSig?: string }
type LineageLike = { explorerSegments?(): readonly string[]; readonly domain?: unknown }

/** One tile name, however it was spelled. */
const sameTile = (a: string, b: string): boolean => (normalizeCell(a) || a.trim()) === (normalizeCell(b) || b.trim())

/**
 * Whether a tile already answers at `route`, asked of the hive: a saved root's
 * name, a name its page lists, or a layer kept there from a tile put away
 * (importing over one would reveal it, and its own recipe would stand).
 * Throws where the page cannot be read.
 */
const liveTakenAt = async (route: readonly string[]): Promise<boolean> => {
  const history = get<PlacementHistory>(HISTORY_KEY)
  if (!history) throw new Error('no history')
  const name = route[route.length - 1] ?? ''
  if (get<{ isSaved?(name: string): boolean }>(SAVED_ROOTS_KEY)?.isSaved?.(name) === true) return true
  const lineage = get<LineageLike>(LINEAGE_KEY)
  const page = route.slice(0, -1)
  const viewing = lineageKey(lineage?.explorerSegments?.() ?? []) === lineageKey(page)
  const cursor = viewing ? get<CursorLike>(CURSOR_KEY)?.currentLayerSig : null
  const listed = await childNamesOfStrict(history, await resolveCurrentLayer(history, lineage?.domain, page, cursor))
  if (listed.coldMiss) throw new Error('a tile on the page is not readable yet')
  if (listed.names.some(tile => sameTile(tile, name))) return true
  return !isBareLayer(await history.currentLayerAt(await history.sign({ domain: lineage?.domain, explorerSegments: () => route })))
}

/** The decoration a tile with a recipe wears: no payload, the kind is the whole statement. */
const liveDecorate = (segments: readonly string[]): Promise<unknown> =>
  replaceDecoration({ kind: RECIPE_KIND, appliesTo: segments, segments, payload: {}, mark: 'persistent' })

// One keeping at a time, each choosing its name after the one before it landed,
// so two presses never take the same free name.
let keeping: Promise<unknown> = Promise.resolve()
const inTurn = <T>(act: () => Promise<T>): Promise<T> => {
  const next = keeping.then(act, act)
  keeping = next.catch(() => undefined)
  return next
}

export type RecipeEntryTaken =
  | { readonly ok: true; readonly segments: string[] }
  | { readonly ok: false; readonly reason: string }

/**
 * Keep an opened recipe: its pictures, its template and its document become
 * resources under their own signatures (the publisher's bytes as they came,
 * each checked again against its name, and the store must answer that same
 * signature or nothing more is done), then ONE commit makes a tile named for
 * the entry on the page `target`, holding the recipe in its slot and linked
 * into the page (LayerCommitter.importTree, the path a create takes). A name
 * already taken there gets a number after it. A visitor hive is refused
 * before anything is kept. Never throws.
 */
export function takeRecipeHome(
  offer: RecipeEntryOffer,
  opened: RecipeEntryOpened,
  target: readonly string[],
  deps: RecipeEntriesDeps = {},
): Promise<RecipeEntryTaken> {
  return inTurn(async (): Promise<RecipeEntryTaken> => {
    try {
      if (visitorHive()) return refuse(t('recipe.entry.take.readonly', 'This visitor hive cannot keep a recipe.'))
      if (!Array.isArray(target) || !target.every(part => typeof part === 'string' && part.trim())) {
        return refuse(t('recipe.entry.take.noPage', 'There is no page to put the recipe on.'))
      }
      const store = storeOf(deps)
      const committer = deps.committer ?? live<EntryCommitter>(COMMITTER_KEY)
      if (!store?.putResource || !committer?.importTree) {
        return refuse(t('recipe.entry.take.notReady', 'The hive is not ready to keep a recipe here yet.'))
      }

      // Keeping is the gate (S3): what was opened is checked again, by its own bytes.
      const wanted = String(offer?.entry?.recipe ?? '')
      const read = opened?.bytes?.recipe && SIG.test(wanted) ? await parseRecipe(opened.bytes.recipe, wanted) : null
      if (!read?.ok) return refuse(t('recipe.entry.take.mismatch', 'What was opened is not the recipe this entry names.'))
      const recipe = read.recipe

      const pieces: { sig: string; bytes: Uint8Array; type: string }[] = []
      const named = new Set(picturesOf(recipe))
      for (const [sig, bytes] of opened.pictures ?? []) {
        const type = named.has(sig) && bytes.byteLength <= PICTURE_MAX_BYTES ? pictureType(bytes) : ''
        if (type && await signatureOf(bytes) === sig) pieces.push({ sig, bytes, type })
      }
      const layout = opened.bytes.template
      if (recipe.template && layout && (await parseRecipeTemplate(layout, recipe.template)).ok) {
        pieces.push({ sig: recipe.template, bytes: layout, type: 'application/json' })
      }
      pieces.push({ sig: recipe.sig, bytes: opened.bytes.recipe, type: 'application/json' })
      // The parts, then the document that names them, then the tile that names the document.
      for (const part of pieces) {
        const written = await store.putResource(new Blob([exact(part.bytes)], { type: part.type })).catch(() => '')
        if (written !== part.sig) return refuse(t('recipe.entry.take.notKept', 'The store did not keep the bytes it was given, so no tile was made.'))
      }

      const base = normalizeCell(offer.entry.name) || normalizeCell(t('recipe.entry.take.name', 'recipe')) || 'recipe'
      const takenAt = deps.takenAt ?? liveTakenAt
      let name = ''
      try {
        for (let n = 1; n <= NAME_TRIES && !name; n++) {
          const candidate = n === 1 ? base : normalizeCell(`${base.slice(0, 60)}-${n}`)
          if (!isReservedPoolWord(candidate) && !(await takenAt([...target, candidate]))) name = candidate
        }
      } catch {
        return refuse(t('recipe.entry.take.unreadPage', 'This page could not be read, so no tile was made.'))
      }
      if (!name) return refuse(t('recipe.entry.take.noName', 'No free name was found for the tile.'))

      const route = [...target, name]
      // The committer refuses by throwing (a hive viewing its past, a page not readable yet), answers
      // nothing, and says nothing when it did not write: the tile is read back either way.
      await committer.importTree([{ segments: route, layer: { name, [RECIPE_SLOT]: [recipe.sig] } }]).catch(() => undefined)
      const landed = await loadRecipeAt(route, { ...(deps.history ? { history: deps.history } : {}), store })
      if (landed.recipe?.sig !== recipe.sig) {
        return refuse(t('recipe.entry.take.unlanded', 'The recipe is kept, but its tile could not be made here.'))
      }
      // The recipe is kept whether or not the mark lands: the slot is what opens it.
      try { await (deps.decorate ?? liveDecorate)(route) } catch { /* kept without its mark */ }
      return { ok: true, segments: route }
    } catch {
      return refuse(t('recipe.entry.take.failed', 'The recipe could not be kept.'))
    }
  })
}
