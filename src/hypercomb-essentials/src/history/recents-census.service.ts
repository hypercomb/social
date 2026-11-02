// history/recents-census.service.ts
//
// THE READER HALF of the recents census, split from the minting bee the way
// the molecule index is: the reader must be testable with an EMPTY POOL, and
// `census()` NEVER DERIVES — a deriving reader would put a subtree walk plus
// a bag enumeration per node on a path a keystroke can reach.
//
//   census()      the root record, or null. A miss is "not yet", never a walk.
//   rootSig()     the head layer sig of the root, which keys the record.
//   readRecord()  memo, then the pool, then null.
//
// `derive` and `writeRecord` stay on the class the bee constructs for itself;
// `recentsCensusReader()` is what goes into IoC. Minting is unreachable from a
// render or keystroke path by construction.
//
// THE DATE READ. `firstMarkerAt(segments)` signs the location and lists its
// lineage bag (`HistoryService.listLayers`, one directory enumeration, warm
// when the bag was touched this session) and takes the earliest marker's
// file date. That enumeration is the cost of the census — the same cost
// `preloadAllBags` pays once per boot for the LATEST marker — which is why
// it is budgeted per pass and never repeated for a sig that has a record.

import { isMetaEnvelope, isPoolAddress, metaPayloadOf } from '@hypercomb/core'
import {
  MAX_CENSUS_DEPTH, RECENTS_CENSUS_MEANING, composeCensus, gatherAtoms, readableCensus,
  type CensusEntry, type CensusRecord, type RecentAtom,
} from './recents-census.js'
import { noteDerivedMint, noteDerivedUse } from './optimization-use.js'
import { sessionHideStore } from '../presentation/tiles/session-hide.store.js'

const ioc = <T>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

type LayerLike = { name?: string; [k: string]: unknown }
type ManifestEntry = { sig: string; layer: LayerLike; [k: string]: unknown }

type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  headLayer(locationSig: string): Promise<{ layerSig: string } | null>
  listLayers(locationSig: string): Promise<ReadonlyArray<{ at?: number }>>
  childrenManifestFor?(layer: LayerLike): Promise<ManifestEntry[] | null>
  /** Every lineage with a known head. No I/O, never a scan. */
  knownHeads?(): ReadonlyMap<string, string>
}

type StoreLike = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  /** THE STORE WRITES, never this file (doctrine ratchet: raw storage writes
   *  only shrink). A record is the CURRENT document of the `sign(layerSig)`
   *  sub-bucket — content-addressed, one kept, nothing removed. */
  putPoolDoc?(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }): Promise<string | null>
  getPoolDoc?(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
  readChildrenManifest?(parentLayerSig: string): Promise<ManifestEntry[] | null>
  /** The LOCAL read of a layer's bytes — OPFS only, never a host. */
  getLayerLocalBytes?(signature: string): Promise<Uint8Array | null>
  /** A layer's bytes on this device with meta envelopes followed — never a host. */
  getLayerBytes?(signature: string): Promise<Uint8Array | null>
}

export interface CensusBudget {
  /** Nodes the pass may still visit — one manifest read and one bag listing each. */
  nodes: number
}

export const RECENTS_CENSUS_KEY = '@diamondcoreprocessor.com/RecentsCensus'

/** The earliest dated marker, or null when none has a date. */
const earliestOf = (markers: ReadonlyArray<{ at?: number }>): number | null => {
  let earliest = Number.POSITIVE_INFINITY
  for (const marker of markers) {
    const at = Number(marker?.at)
    if (Number.isFinite(at) && at > 0 && at < earliest) earliest = at
  }
  return Number.isFinite(earliest) ? earliest : null
}

/** The session's hides as `a/b/c` paths — the list show-cell reads for the
 *  same question, written by every hide gesture (tile-actions.drone.ts). */
const readHiddenPaths = (): ReadonlySet<string> => {
  try {
    const list = JSON.parse(sessionHideStore.getItem('hc:hidden-lineages') ?? '[]') as unknown
    return new Set(Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [])
  } catch { return new Set() }
}

export class RecentsCensusService {
  /** Records read this session, by layer sig — a sig's record never goes stale. */
  #memo = new Map<string, CensusRecord>()
  #pool: FileSystemDirectoryHandle | null | undefined

  get history(): HistoryLike | undefined {
    return ioc<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  }

  get store(): StoreLike | undefined {
    return ioc<StoreLike>('@hypercomb.social/Store')
  }

  /** The head layer sig of the root — the record the census lives at. */
  async rootSig(): Promise<string | null> {
    const history = this.history
    if (!history) return null
    try {
      const location = await history.sign({ explorerSegments: () => [] })
      return (await history.headLayer(location))?.layerSig ?? null
    } catch { return null }
  }

  /** THE CENSUS. Null on a miss, never a walk: the phase owes the root a
   *  record and the view renders empty until it lands. */
  census = async (): Promise<CensusRecord | null> => {
    const rootSig = await this.rootSig()
    if (!rootSig) return null
    return this.readRecord(rootSig)
  }

  readRecord = async (layerSig: string): Promise<CensusRecord | null> => {
    const memo = this.#memo.get(layerSig)
    if (memo) {
      noteDerivedUse(this.store, RECENTS_CENSUS_MEANING, layerSig)
      return memo
    }
    const store = this.store
    if (this.#pool === undefined) this.#pool = (await store?.getPool(RECENTS_CENSUS_MEANING)) ?? null
    if (!this.#pool || !store?.getPoolDoc) return null
    try {
      const bytes = await store.getPoolDoc(this.#pool, layerSig)
      if (!bytes) return null
      const record = readableCensus(JSON.parse(new TextDecoder().decode(bytes)))
      if (!record) return null
      if (this.#memo.size > 64) this.#memo.clear()
      this.#memo.set(layerSig, record)
      noteDerivedUse(this.store, RECENTS_CENSUS_MEANING, layerSig)
      return record
    } catch { return null }
  }

  /** Write a COMPLETE record keyed by the sig it derives from. Best-effort. */
  writeRecord = async (layerSig: string, record: CensusRecord): Promise<void> => {
    if (record.truncated) return
    const store = this.store
    if (this.#pool === undefined) this.#pool = (await store?.getPool(RECENTS_CENSUS_MEANING)) ?? null
    if (!this.#pool || !store?.putPoolDoc) return
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(record))
      const sig = await store.putPoolDoc(this.#pool, bytes.buffer as ArrayBuffer, layerSig, { keep: 'current' })
      if (!sig) return
      this.#memo.set(layerSig, record)
      noteDerivedMint(this.store, RECENTS_CENSUS_MEANING, layerSig)
    } catch { /* derived cache — a miss next time is the only cost */ }
  }

  /** The earliest marker's date at a location — when the atom there came to
   *  be. Null when the bag cannot say (cold, absent, or every marker undated). */
  firstMarkerAt = async (segments: readonly string[]): Promise<number | null> => {
    const history = this.history
    if (!history) return null
    try {
      const location = await history.sign({ explorerSegments: () => segments })
      return earliestOf(await history.listLayers(location))
    } catch { return null }
  }

  // ── the bag census ─────────────────────────────────────────────────────
  //
  // THE TREE NEVER MEETS AN ATOM NO PAGE LISTS. A cut tile's bag survives with
  // its head, because nothing is deleted (H2), so the atom is found from the
  // other side: every lineage with a known head, minus what the root reaches.
  //
  // REACHED IS TESTED TWICE, BY SIG AND BY LOCATION. A live tile's head can
  // differ from the sig its parent lists (the route's head outranks the listed
  // sig), so a sig test alone would report a live tile as unlisted. A tile
  // that moved leaves its old bag behind at the same sig, so a location test
  // alone would report that one. Either match means it is reached.
  //
  // This is session memory and is never written. A record keyed by the root
  // sig would have to name every head the root does NOT reach, and those heads
  // are not inputs of the root's bytes, so it would not be a pure derivation
  // of its key (D1). It is cheap to recount: heads are in memory, and each
  // candidate's result is memoised by its head.

  #bagResults = new Map<string, { head: string; entry: CensusEntry | null }>()
  #reachedLocations: { root: string; set: Set<string> } | null = null
  #unlisted: readonly CensusEntry[] = []

  /** One pass of the bag census. True when every known head was judged, false
   *  when the budget ran out; each result is kept, so a later pass only does
   *  what is left. `budget.nodes` is one bag listing plus one layer read each. */
  unlistedPass = async (rootSig: string, record: CensusRecord, budget: CensusBudget): Promise<boolean> => {
    const heads = this.history?.knownHeads?.()
    if (!heads) return true
    const reachedSigs = new Set(record.entries.map(entry => entry.sig))
    const reachedLocations = await this.#locationsOf(rootSig, record)
    const found = new Map<string, CensusEntry>()
    let complete = true
    for (const [lineage, head] of heads) {
      if (reachedSigs.has(head) || reachedLocations.has(lineage)) continue
      if (await isPoolAddress(lineage)) continue
      let result = this.#bagResults.get(lineage)
      if (result?.head !== head) {
        if (budget.nodes <= 0) { complete = false; continue }
        budget.nodes--
        result = { head, entry: await this.#unlistedAt(lineage, head) }
        this.#bagResults.set(lineage, result)
      }
      const entry = result.entry
      if (!entry) continue
      const held = found.get(entry.sig)
      if (!held || (entry.at > 0 && (held.at === 0 || entry.at < held.at))) found.set(entry.sig, entry)
    }
    this.#unlisted = [...found.values()]
    return complete
  }

  async #locationsOf(rootSig: string, record: CensusRecord): Promise<Set<string>> {
    if (this.#reachedLocations?.root === rootSig) return this.#reachedLocations.set
    const set = new Set<string>()
    for (const entry of record.entries) {
      const location = await this.history?.sign({ explorerSegments: () => entry.path }).catch(() => '')
      if (location) set.add(location)
    }
    this.#reachedLocations = { root: rootSig, set }
    return set
  }

  /** The atom a bag's head is, or null when it is not here or has no name.
   *  A bare `{ name }` on one marker is NOT skipped. An auto-minted husk has
   *  that shape, but so does a blank tile someone made and cut, and a name
   *  shown by mistake costs less than a tile gone missing (H7). */
  async #unlistedAt(lineage: string, head: string): Promise<CensusEntry | null> {
    try {
      const store = this.store
      const bytes = await (store?.getLayerBytes ?? store?.getLayerLocalBytes)?.call(store, head)
      if (!bytes?.byteLength) return null
      const layer = JSON.parse(new TextDecoder().decode(bytes)) as LayerLike
      const label = typeof layer?.name === 'string' ? layer.name.trim() : ''
      if (!label) return null
      const markers = (await this.history?.listLayers(lineage)) ?? []
      return { sig: head, label, path: [], at: earliestOf(markers) ?? 0 }
    } catch { return null }
  }

  /** Everything the view shows, newest first, hides read fresh. Empty until
   *  the census lands: this never derives. */
  atoms = async (): Promise<RecentAtom[]> => {
    const record = await this.census()
    return record ? gatherAtoms(record, this.#unlisted, readHiddenPaths()) : []
  }

  /** The children manifest of a layer — the render's own cache, one pool
   *  read; the cold read stays on this device (never a host fetch). */
  async #manifestOf(layerSig: string): Promise<ManifestEntry[] | null> {
    const direct = await this.store?.readChildrenManifest?.(layerSig).catch(() => null)
    if (direct?.length) return direct
    const layer = await this.#layerLocal(layerSig)
    if (!layer) return null
    return (await this.history?.childrenManifestFor?.(layer).catch(() => null)) ?? null
  }

  /** A layer as this device holds it. Child slots hold META ENVELOPES (codex
   *  L2), so a slot's sig is followed to the layer it wraps; never a host fetch. */
  async #layerLocal(layerSig: string): Promise<LayerLike | null> {
    const store = this.store
    const read = store?.getLayerBytes ?? store?.getLayerLocalBytes
    const bytes = await read?.call(store, layerSig).catch(() => null)
    if (!bytes?.byteLength) return null
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      return parsed && typeof parsed === 'object' ? parsed as LayerLike : null
    } catch { return null }
  }

  /** The layer sig a slot names: the envelope's payload, or the sig itself.
   *  Atoms are compared with bag heads, and a head is always a layer sig, so
   *  an envelope sig in the census would never match one. */
  async #atomSigOf(slotSig: string): Promise<string> {
    try {
      const bytes = await this.store?.getLayerLocalBytes?.(slotSig)
      if (!bytes?.byteLength) return slotSig
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      const payload = isMetaEnvelope(parsed) ? metaPayloadOf(parsed) : null
      return payload?.kind === 'layer' ? payload.sig : slotSig
    } catch { return slotSig }
  }

  /**
   * Derive the record for a layer sig at a location — the optimize phase's
   * worker, and the only thing here that reads more than one file.
   *
   * A child that already HAS a record is spliced in whole and never descended
   * into. Only a COMPLETE child is written; a null child (depth cap, budget,
   * a manifest that blinked) truncates the parent (recents-census.ts). Nothing
   * is written for the sig ASKED FOR; the caller writes that.
   */
  derive = async (
    layerSig: string,
    segments: readonly string[],
    budget: CensusBudget,
    depth = 0,
  ): Promise<CensusRecord | null> => {
    if (depth >= MAX_CENSUS_DEPTH) return null
    if (budget.nodes <= 0) return null
    budget.nodes--
    const layer = await this.#layerLocal(layerSig)
    if (!layer) return null
    // A leaf is complete with nothing under it. Asking for its manifest would
    // answer null, and a null here means "could not see", which truncates
    // every ancestor: one leaf would keep the root from ever being written.
    const slots = layer['children']
    const hasChildren = Array.isArray(slots) && slots.length > 0
    const manifest = hasChildren ? await this.#manifestOf(layerSig) : []
    if (!manifest) return null
    const label = typeof layer.name === 'string' ? layer.name : (segments[segments.length - 1] ?? '/')
    const at = (await this.firstMarkerAt(segments)) ?? 0

    const children: Array<{ name: string; record: CensusRecord | null }> = []
    for (const entry of manifest) {
      const name = typeof entry.layer?.name === 'string' ? entry.layer.name : ''
      if (!name) { children.push({ name: '', record: null }); continue }
      const cached = await this.readRecord(entry.sig)
      const child = cached ?? await this.derive(entry.sig, [...segments, name], budget, depth + 1)
      children.push({ name, record: child })
      if (child && !cached && !child.truncated) await this.writeRecord(entry.sig, child)
    }
    return composeCensus({ sig: await this.#atomSigOf(layerSig), label, at }, children)
  }
}

/** THE REGISTERED SURFACE — the read half, and nothing else. */
export interface RecentsCensusReader {
  census(): Promise<CensusRecord | null>
  atoms(): Promise<RecentAtom[]>
  readRecord(layerSig: string): Promise<CensusRecord | null>
  rootSig(): Promise<string | null>
}

export const recentsCensusReader = (service: RecentsCensusService): RecentsCensusReader =>
  Object.freeze({
    census: service.census,
    atoms: service.atoms,
    readRecord: service.readRecord,
    rootSig: () => service.rootSig(),
  })

// history/recents-census.drone.ts registers this (atomic-modules-plan.md): a dependency registers nothing.
