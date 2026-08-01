// ActiveGenomeService — keeps the derived live-hive census coherent.

import { EffectBus } from '@hypercomb/core'
import {
  collectActiveGenome,
  formatGenomeBytes,
  type ActiveGenomeContent,
  type ActiveGenomeRecord,
  type ActiveGenomeSource,
} from './active-genome.js'

export const ACTIVE_GENOME_KEY = '@diamondcoreprocessor.com/ActiveGenomeService'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const STORE_KEY = '@hypercomb.social/Store'
/** Scoped, never bare. A bare `'computed'` hashes to the same OPFS directory
 *  as the lineage bag of a root tile called `computed` — sign(meaning) and
 *  sign(lineageKey(segments)) share one flat namespace, and /flatten would
 *  hard-delete the pool's members as strays. The colon is unreachable from
 *  any location, so it is collision-proof by construction.
 *
 *  RENAMED FROM `'computed'` — sign() of the new spelling is a DIFFERENT
 *  address, so anything already written under sign('computed') is stranded.
 *  No drain is needed and none is planned: this pool holds only the two
 *  DERIVED docs below. `active-genome` is a census recomputed from the tree
 *  on every head change (#refresh re-collects and re-persists within a
 *  debounce of boot), and `active-genome-queue` is its retry marker, which
 *  #hydrate already treats as absent-or-corrupt → repaired by the boot
 *  census. A live hive rebuilds both into the new address without noticing;
 *  the old dir is unreferenced and collected like any other stray. */
const COMPUTED_MEANING = 'computed:genome'
const COMPUTED_SUBKEY = 'active-genome'
const QUEUE_SUBKEY = 'active-genome-queue'
const DEBOUNCE_MS = 500
const RETRY_MS = 5_000
const SIG_RE = /^[0-9a-f]{64}$/
const INDICATOR_KEY = 'genome-weight'

type Directory = FileSystemDirectoryHandle | undefined
type HistoryLike = {
  treeEpoch(): number
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  getLayerBySig(sig: string): Promise<{ name?: string; [slot: string]: unknown } | null>
  headLayer(lineage: string): Promise<{ filename: string; layerSig: string } | null>
  readMarker(lineage: string, filename: string): Promise<{ bytes: ArrayBuffer; layerSig: string } | null>
}
type StoreLike = {
  getLayerPoolBytes(sig: string): Promise<Uint8Array | null>
  getResourceLocal(sig: string): Promise<Blob | null>
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  putPoolDoc(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string): Promise<string | null>
  getPoolDoc(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
  bees?: Directory
  dependencies?: Directory
  legacyBees?: Directory
  legacyDependencies?: Directory
}

const iocGet = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(key) as T | undefined

const poolFileSize = async (
  signature: string,
  ...sources: Directory[]
): Promise<number | null> => {
  for (const source of sources) {
    if (!source) continue
    try {
      return (await (await source.getFileHandle(signature)).getFile()).size
    } catch { /* miss — try the legacy drain */ }
  }
  return null
}

const expandable = async (blob: Blob): Promise<unknown | undefined> => {
  try {
    const prefix = (await blob.slice(0, 256).text()).trimStart()
    if (!prefix.startsWith('{') && !prefix.startsWith('[')) return undefined
    return JSON.parse(await blob.text()) as unknown
  } catch {
    return undefined
  }
}

export class ActiveGenomeService {
  #record: ActiveGenomeRecord | null = null
  #recordSig: string | null = null
  #dirty = true
  #generation = 0
  #timer: ReturnType<typeof setTimeout> | null = null
  #refreshing: Promise<ActiveGenomeRecord | null> | null = null
  #computedPool: Promise<FileSystemDirectoryHandle | null> | null = null
  #hydrating: Promise<void> | null = null
  #hydrated = false
  #queueWrites: Promise<void> = Promise.resolve()
  #pendingQueueSig: string | null = null

  constructor() {
    EffectBus.on<{ to?: unknown; from?: unknown }>('history:head-changed',
      p => this.invalidate(this.#signature(p?.to) ?? this.#signature(p?.from)))
    EffectBus.on<{ bytes?: ArrayBuffer }>('history:marker-wrote',
      p => this.invalidate(this.#markerSignature(p?.bytes)))
    EffectBus.on<{ sig?: unknown }>('content:wrote',
      p => this.invalidate(this.#signature(p?.sig)))
    EffectBus.on<{ sig?: unknown }>('content:arrived',
      p => this.invalidate(this.#signature(p?.sig)))

    const ioc = (window as { ioc?: { whenReady?: <T>(key: string, cb: (value: T) => void) => void } }).ioc
    ioc?.whenReady?.(HISTORY_KEY, () => this.invalidate())
    ioc?.whenReady?.<StoreLike>(STORE_KEY, store => { void this.initialize(store) })
    this.#publishState()
    this.#schedule()
  }

  get record(): ActiveGenomeRecord | null { return this.#record }
  get recordSig(): string | null { return this.#recordSig }
  get dirty(): boolean { return this.#dirty }

  invalidate(signature?: string | null): void {
    this.#dirty = true
    this.#generation++
    if (signature && SIG_RE.test(signature)) this.#enqueueSignature(signature)
    EffectBus.emit('genome:dirty', { previous: this.#record })
    this.#publishState()
    this.#schedule()
  }

  /** Load the last coherent census and durable queue before recomputing. */
  async initialize(knownStore?: StoreLike): Promise<void> {
    const store = knownStore ?? iocGet<StoreLike>(STORE_KEY)
    if (!store || this.#hydrated) return
    if (this.#hydrating) return this.#hydrating
    this.#hydrating = this.#hydrate(store).finally(() => { this.#hydrating = null })
    return this.#hydrating
  }

  async current(force = false): Promise<ActiveGenomeRecord | null> {
    if (force) return this.refresh()
    await this.initialize()
    if (this.#record) {
      if (this.#dirty) this.#schedule()
      return this.#record
    }
    return this.refresh()
  }

  refresh(): Promise<ActiveGenomeRecord | null> {
    if (this.#refreshing) return this.#refreshing
    const run = this.#refresh()
    this.#refreshing = run.finally(() => { this.#refreshing = null })
    return this.#refreshing
  }

  #schedule(delay = DEBOUNCE_MS): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.refresh()
    }, delay)
  }

  async #refresh(): Promise<ActiveGenomeRecord | null> {
    const history = iocGet<HistoryLike>(HISTORY_KEY)
    const store = iocGet<StoreLike>(STORE_KEY)
    if (!history?.headLayer || !history?.readMarker || !history?.getLayerBySig || !store?.getResourceLocal) {
      // IoC's whenReady callbacks above will re-arm the census. Do not poll
      // forever in shells/tests that intentionally omit either service.
      return this.#record
    }
    await this.initialize(store)

    const generation = this.#generation
    const source = this.#source(history, store)
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await collectActiveGenome(source)
      if (!result.stable) continue
      if (!result.record) {
        this.#dirty = true
        this.#publishState()
        this.#schedule(RETRY_MS)
        return this.#record
      }
      this.#record = result.record
      this.#recordSig = await this.#persist(store, result.record)
      const persisted = this.#recordSig !== null
      const settled = persisted && result.record.complete && this.#generation === generation
        ? await this.#settleQueue(store, generation, this.#recordSig!)
        : false
      this.#dirty = !result.record.complete || !settled || this.#generation !== generation
      EffectBus.emit('genome:updated', {
        record: result.record,
        signature: this.#recordSig,
        dirty: this.#dirty,
      })
      this.#publishState()
      if (this.#dirty) this.#schedule()
      return result.record
    }
    this.#dirty = true
    this.#publishState()
    this.#schedule()
    return this.#record
  }

  #source(history: HistoryLike, store: StoreLike): ActiveGenomeSource {
    return {
      epoch: () => history.treeEpoch(),
      root: async () => {
        const lineage = await history.sign({ explorerSegments: () => [] })
        // A cold/brand-new root still gets a partial, retrying census keyed
        // by its lineage address. This keeps `/weight` informative without
        // materializing 00000000 merely to measure it.
        return (await history.headLayer(lineage))?.layerSig ?? lineage
      },
      lineage: path => history.sign({ explorerSegments: () => [...path] }),
      layer: async signature => {
        const [bytes, value] = await Promise.all([
          store.getLayerPoolBytes(signature),
          history.getLayerBySig(signature),
        ])
        return bytes && value ? { bytes: bytes.byteLength, value } : null
      },
      head: async lineage => {
        const head = await history.headLayer(lineage)
        if (!head) return null
        const marker = await history.readMarker(lineage, head.filename)
        return marker ? {
          marker: head.filename,
          layer: marker.layerSig,
          bytes: marker.bytes.byteLength,
        } : null
      },
      resource: async signature => {
        const blob = await store.getResourceLocal(signature)
        if (!blob) return null
        const value = await expandable(blob)
        return {
          bytes: blob.size,
          ...(value === undefined ? {} : { value }),
        } satisfies ActiveGenomeContent
      },
      beeBytes: signature => poolFileSize(signature, store.bees, store.legacyBees),
      dependencyBytes: signature => poolFileSize(signature, store.dependencies, store.legacyDependencies),
    }
  }

  async #persist(store: StoreLike, record: ActiveGenomeRecord): Promise<string | null> {
    try {
      const pool = await this.#pool(store)
      if (!pool) return null
      return await this.#writeDoc(store, pool, COMPUTED_SUBKEY, record)
    } catch {
      return null
    }
  }

  async #hydrate(store: StoreLike): Promise<void> {
    const pool = await this.#pool(store)
    if (!pool) return
    try {
      const bytes = await store.getPoolDoc(pool, COMPUTED_SUBKEY)
      if (bytes) {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as ActiveGenomeRecord
        if (parsed?.version === 1 && typeof parsed?.seal === 'string' && parsed?.totals) {
          this.#record = parsed
        }
      }
    } catch { /* absent/corrupt derived cache — recompute */ }
    try {
      const bytes = await store.getPoolDoc(pool, QUEUE_SUBKEY)
      if (bytes) {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { queued?: unknown }
        const queued = this.#signature(parsed?.queued)
        if (queued) this.#pendingQueueSig = queued
      }
    } catch { /* absent/corrupt queue — boot census repairs it */ }
    this.#hydrated = true
    const pending = this.#pendingQueueSig
    if (pending) this.#enqueueSignature(pending)
    this.#publishState()
    this.#schedule()
  }

  #pool(store: StoreLike): Promise<FileSystemDirectoryHandle | null> {
    return this.#computedPool ??= store.getPool(COMPUTED_MEANING)
  }

  #enqueueSignature(signature: string): void {
    this.#pendingQueueSig = signature
    this.#queueWrites = this.#queueWrites.then(async () => {
      const store = iocGet<StoreLike>(STORE_KEY)
      if (!store) return
      const pool = await this.#pool(store)
      if (!pool) return
      await this.#writeDoc(store, pool, QUEUE_SUBKEY, { queued: signature })
    }).catch(() => { /* leave dirty; the next change/boot retries */ })
  }

  async #settleQueue(store: StoreLike, generation: number, recordSig: string): Promise<boolean> {
    let settled = false
    this.#queueWrites = this.#queueWrites.then(async () => {
      if (this.#generation !== generation) return
      const pool = await this.#pool(store)
      if (!pool) return
      const sig = await this.#writeDoc(store, pool, QUEUE_SUBKEY, {
        queued: null,
        completed: recordSig,
      })
      if (sig && this.#generation === generation) {
        this.#pendingQueueSig = null
        settled = true
      }
    }).catch(() => { /* queue remains pending */ })
    await this.#queueWrites
    return settled
  }

  async #writeDoc(
    store: StoreLike,
    pool: FileSystemDirectoryHandle,
    subKey: string,
    value: unknown,
  ): Promise<string | null> {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    return store.putPoolDoc(
      pool,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      subKey,
    )
  }

  #signature(value: unknown): string | null {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
    return SIG_RE.test(text) ? text : null
  }

  #markerSignature(bytes: ArrayBuffer | undefined): string | null {
    if (!bytes) return null
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { layer?: unknown }
      return this.#signature(parsed?.layer)
    } catch {
      return null
    }
  }

  #publishState(): void {
    const record = this.#record
    const bytes = record?.totals.activeBytes ?? record?.totals.knownBytes
    const label = bytes === undefined
      ? 'Genome measuring…'
      : `${formatGenomeBytes(bytes)} genome${
          this.#dirty
            ? ' · updating'
            : record?.complete
              ? ''
              : ` · ${record?.missing.length ?? 0} unresolved`
        }`
    const state = { record, signature: this.#recordSig, dirty: this.#dirty, label }
    EffectBus.emit('genome:state', state)
    EffectBus.emit('indicator:set', {
      key: INDICATOR_KEY,
      icon: 'genetics',
      label,
      dismissable: false,
    })
  }
}

const _activeGenome = new ActiveGenomeService()
window.ioc.register(ACTIVE_GENOME_KEY, _activeGenome)
