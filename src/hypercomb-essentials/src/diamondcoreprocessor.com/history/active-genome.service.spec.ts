import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import type { ActiveGenomeRecord } from './active-genome.js'

vi.useFakeTimers()

const registrations = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => registrations.set(key, value),
  get: (key: string) => registrations.get(key),
  whenReady: () => void 0,
}

let ActiveGenomeService: typeof import('./active-genome.service.js').ActiveGenomeService
let ACTIVE_GENOME_KEY: typeof import('./active-genome.service.js').ACTIVE_GENOME_KEY

beforeAll(async () => {
  ;({ ActiveGenomeService, ACTIVE_GENOME_KEY } = await import('./active-genome.service.js'))
})

beforeEach(() => {
  EffectBus.clear()
  registrations.clear()
})

afterEach(() => vi.clearAllTimers())

const root = 'a'.repeat(64)
const trigger = 'b'.repeat(64)
const lineage = 'd'.repeat(64)
const layerBytes = new TextEncoder().encode(JSON.stringify({ name: '/' }))
const markerBytes = new TextEncoder().encode(JSON.stringify({ layer: root }))

const priorRecord = (): ActiveGenomeRecord => ({
  version: 1,
  seal: root,
  complete: true,
  heads: [{ lineage: 'lineage', path: [], marker: '00000000', layer: root, bytes: markerBytes.byteLength }],
  objects: [{ kind: 'layer', sig: root, bytes: layerBytes.byteLength }],
  missing: [],
  totals: {
    lineages: 1,
    virtualHeads: 0,
    objects: 1,
    markerBytes: markerBytes.byteLength,
    contentBytes: layerBytes.byteLength,
    knownBytes: markerBytes.byteLength + layerBytes.byteLength,
    activeBytes: markerBytes.byteLength + layerBytes.byteLength,
  },
})

class MemoryComputedStore {
  readonly pool = {} as FileSystemDirectoryHandle
  readonly docs = new Map<string, ArrayBuffer>()
  onQueue?: (value: { queued?: string | null }) => void

  async getPool(): Promise<FileSystemDirectoryHandle> { return this.pool }
  async putPoolDoc(
    _pool: FileSystemDirectoryHandle,
    bytes: ArrayBuffer,
    subKey = '',
  ): Promise<string> {
    this.docs.set(subKey, bytes.slice(0))
    if (subKey === 'active-genome-queue') {
      this.onQueue?.(JSON.parse(new TextDecoder().decode(bytes)) as { queued?: string | null })
    }
    return 'f'.repeat(64)
  }
  async getPoolDoc(_pool: FileSystemDirectoryHandle, subKey = ''): Promise<ArrayBuffer | null> {
    return this.docs.get(subKey)?.slice(0) ?? null
  }
  async getLayerPoolBytes(signature: string): Promise<Uint8Array | null> {
    return signature === root ? layerBytes : null
  }
  async getResourceLocal(): Promise<Blob | null> { return null }
}

const history = (head: string | null = root) => ({
  treeEpoch: () => 1,
  sign: async () => lineage,
  getLayerBySig: async (signature: string) => signature === root ? { name: '/' } : null,
  headLayer: async () => head ? { filename: '00000000', layerSig: head } : null,
  readMarker: async () => ({
    bytes: markerBytes.buffer.slice(
      markerBytes.byteOffset,
      markerBytes.byteOffset + markerBytes.byteLength,
    ) as ArrayBuffer,
    layerSig: root,
  }),
})

describe('passive active-genome queue', () => {
  it('persists a queued signature, computes, then clears the queue only after the record lands', async () => {
    const store = new MemoryComputedStore()
    const sealSubtree = vi.fn(async () => null)
    registrations.set('@hypercomb.social/Store', store)
    registrations.set('@diamondcoreprocessor.com/HistoryService', {
      ...history(),
      sealSubtree,
    })
    const service = new ActiveGenomeService()
    registrations.set(ACTIVE_GENOME_KEY, service)

    service.invalidate(trigger)
    const record = await service.refresh()

    expect(record?.seal).toBe(root)
    expect(sealSubtree).not.toHaveBeenCalled()
    expect(service.dirty).toBe(false)
    expect(JSON.parse(new TextDecoder().decode(store.docs.get('active-genome')!))).toMatchObject({ seal: root })
    expect(JSON.parse(new TextDecoder().decode(store.docs.get('active-genome-queue')!))).toEqual({
      queued: null,
      completed: 'f'.repeat(64),
    })
  })

  it('hydrates the last coherent weight from computed data before a new walk', async () => {
    const store = new MemoryComputedStore()
    const bytes = new TextEncoder().encode(JSON.stringify(priorRecord()))
    store.docs.set('active-genome', bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer)
    registrations.set('@hypercomb.social/Store', store)
    const labels: string[] = []
    const indicators: Array<{ key: string; label: string; dismissable?: boolean }> = []
    const cleared: Array<{ key: string }> = []
    EffectBus.on<{ label: string }>('genome:state', state => labels.push(state.label))
    EffectBus.on<{ key: string; label: string; dismissable?: boolean }>(
      'indicator:set',
      indicator => indicators.push(indicator),
    )
    EffectBus.on<{ key: string }>('indicator:clear', indicator => cleared.push(indicator))
    const service = new ActiveGenomeService()

    await service.initialize(store as never)

    expect(service.record?.seal).toBe(root)
    expect(labels.at(-1)).toContain('genome')
    const liveHistory = history()
    const sealSubtree = vi.fn(async () => root)
    registrations.set('@diamondcoreprocessor.com/HistoryService', {
      ...liveHistory,
      sealSubtree,
    })
    service.invalidate(trigger)
    expect(labels.at(-1)).toContain('· updating')
    expect(await service.current()).toBe(service.record)
    expect(sealSubtree).not.toHaveBeenCalled()
    // The census no longer keeps a standing header pill: the label rides
    // `genome:state` (asserted above), and any pill a prior session raised is
    // actively CLEARED — EffectBus replays the last `indicator:set`, so
    // merely not sending one would leave a stale pill standing.
    expect(indicators).toEqual([])
    expect(cleared.at(-1)).toEqual({ key: 'genome-weight' })
  })

  it('leaves the signature queued when no coherent seal can be produced', async () => {
    const store = new MemoryComputedStore()
    registrations.set('@hypercomb.social/Store', store)
    registrations.set('@diamondcoreprocessor.com/HistoryService', history(null))
    const queued = new Promise<void>(resolve => {
      store.onQueue = value => { if (value.queued === trigger) resolve() }
    })
    const service = new ActiveGenomeService()

    service.invalidate(trigger)
    await queued
    await service.refresh()

    expect(service.dirty).toBe(true)
    expect(service.record).toMatchObject({
      complete: false,
      totals: { knownBytes: 0, activeBytes: null },
    })
    expect(JSON.parse(new TextDecoder().decode(store.docs.get('active-genome-queue')!))).toEqual({
      queued: trigger,
    })

    // A later session sees the durable cue and completes it without another
    // change event having to occur.
    registrations.set('@diamondcoreprocessor.com/HistoryService', history())
    const resumed = new ActiveGenomeService()
    await resumed.initialize(store as never)
    await resumed.refresh()
    expect(resumed.dirty).toBe(false)
    expect(JSON.parse(new TextDecoder().decode(store.docs.get('active-genome-queue')!))).toEqual({
      queued: null,
      completed: 'f'.repeat(64),
    })
  })
})
