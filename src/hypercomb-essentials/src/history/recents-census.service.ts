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

import {
  MAX_CENSUS_DEPTH, RECENTS_CENSUS_MEANING, composeCensus, readableCensus,
  type CensusRecord,
} from './recents-census.js'
import { noteDerivedMint, noteDerivedUse } from './optimization-use.js'

const ioc = <T>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

type LayerLike = { name?: string; [k: string]: unknown }
type ManifestEntry = { sig: string; layer: LayerLike; [k: string]: unknown }

type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  headLayer(locationSig: string): Promise<{ layerSig: string } | null>
  listLayers(locationSig: string): Promise<ReadonlyArray<{ at?: number }>>
  childrenManifestFor?(layer: LayerLike): Promise<ManifestEntry[] | null>
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
}

export interface CensusBudget {
  /** Nodes the pass may still visit — one manifest read and one bag listing each. */
  nodes: number
}

export const RECENTS_CENSUS_KEY = '@diamondcoreprocessor.com/RecentsCensus'

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
      let earliest = Number.POSITIVE_INFINITY
      for (const marker of await history.listLayers(location)) {
        const at = Number(marker?.at)
        if (Number.isFinite(at) && at > 0 && at < earliest) earliest = at
      }
      return Number.isFinite(earliest) ? earliest : null
    } catch { return null }
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

  async #layerLocal(layerSig: string): Promise<LayerLike | null> {
    const bytes = await this.store?.getLayerLocalBytes?.(layerSig).catch(() => null)
    if (!bytes?.byteLength) return null
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      return parsed && typeof parsed === 'object' ? parsed as LayerLike : null
    } catch { return null }
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
    const manifest = await this.#manifestOf(layerSig)
    if (!manifest) return null
    const layer = await this.#layerLocal(layerSig)
    const label = typeof layer?.name === 'string' ? layer.name : (segments[segments.length - 1] ?? '/')
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
    return composeCensus({ sig: layerSig, label, at }, children)
  }
}

/** THE REGISTERED SURFACE — the read half, and nothing else. */
export interface RecentsCensusReader {
  census(): Promise<CensusRecord | null>
  readRecord(layerSig: string): Promise<CensusRecord | null>
  rootSig(): Promise<string | null>
}

export const recentsCensusReader = (service: RecentsCensusService): RecentsCensusReader =>
  Object.freeze({
    census: service.census,
    readRecord: service.readRecord,
    rootSig: () => service.rootSig(),
  })

// history/recents-census.drone.ts registers this (atomic-modules-plan.md): a dependency registers nothing.
