// @vitest-environment jsdom
//
// history/two-tab-commit.spec.ts — TWO TABS, ONE HIVE (CC-1, owner decision D10).
//
// A meeting link opens a second tab beside the hive that is already open. Both
// share one OPFS; each keeps its own in-memory heads. Reproduced live
// (critic/two-tab-commit.cjs): tab A adds tt-a1, tab B adds tt-b1, then A's
// tt-a2 and tt-a3 failed with "Location marker 00000002 already exists" —
// logged to the console only — and every later add at that page failed the
// same way until a reload; a fresh tab showed [tt-a1, tt-b1].
//
// These drive the REAL HistoryService and LayerCommitter over an in-memory
// OPFS. Tab A is the committer under test; tab B is a second HistoryService on
// the same disk that writes its own markers (and, where a scenario says so,
// announces them on the real BroadcastChannel — or misses the announcement, as
// a frozen tab does).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, SignatureService } from '@hypercomb/core'

vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => {}, get: () => undefined, whenReady: () => {},
  }
})

// ── in-memory OPFS ─────────────────────────────────────────────────────

class MemoryFile {
  readonly kind = 'file'
  bytes = new Uint8Array()
  constructor(readonly name: string) {}
  async getFile(): Promise<File> {
    const exact = this.bytes.slice().buffer
    return Object.assign(new Blob([exact]), {
      name: this.name, lastModified: 1,
      arrayBuffer: async () => exact,
      text: async () => new TextDecoder().decode(exact),
    }) as File
  }
  async createWritable() {
    return {
      write: async (value: ArrayBuffer | Uint8Array | string) => {
        this.bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
      },
      close: async () => {},
      abort: async () => {},
    }
  }
}

class MemoryDirectory {
  readonly kind = 'directory'
  readonly files = new Map<string, MemoryFile>()
  readonly dirs = new Map<string, MemoryDirectory>()
  constructor(readonly name = '') {}
  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    if (this.dirs.has(name)) throw new DOMException('Directory at file address', 'TypeMismatchError')
    let file = this.files.get(name)
    if (!file) {
      if (!options.create) throw new DOMException('File absent', 'NotFoundError')
      this.files.set(name, file = new MemoryFile(name))
    }
    return file
  }
  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    if (this.files.has(name)) throw new DOMException('File at directory address', 'TypeMismatchError')
    let directory = this.dirs.get(name)
    if (!directory) {
      if (!options.create) throw new DOMException('Directory absent', 'NotFoundError')
      this.dirs.set(name, directory = new MemoryDirectory(name))
    }
    return directory
  }
  async removeEntry(name: string) {
    if (!this.files.delete(name) && !this.dirs.delete(name)) throw new DOMException('Absent', 'NotFoundError')
  }
  async *entries() {
    for (const entry of [...this.files]) yield entry
    for (const entry of [...this.dirs]) yield entry
  }
}

// ── the world: one disk, tab A's services, a channel per tab ───────────

const services = new Map<string, unknown>()
const get = (key: string) => services.get(key)
;(globalThis as Record<string, unknown>)['get'] = get
;(window as unknown as { ioc: unknown }).ioc = {
  get, whenReady: () => {}, register: (key: string, value: unknown) => services.set(key, value),
}

/** Every channel a tab opens, closed after each scenario so no tab of an
 *  earlier scenario hears a later one. */
const RealChannel = globalThis.BroadcastChannel
const opened: { close(): void }[] = []
class TrackedChannel extends RealChannel {
  constructor(name: string) { super(name); opened.push(this) }
}
/** A tab that announces its markers but plays no listener here. */
class SendOnlyChannel {
  readonly #real: BroadcastChannel
  constructor(name: string) { this.#real = new RealChannel(name); opened.push(this.#real) }
  postMessage(message: unknown): void { this.#real.postMessage(message) }
  set onmessage(_handler: unknown) { /* B listens to nobody in this harness */ }
  close(): void { this.#real.close() }
}
/** A tab whose announcement is never heard (frozen, discarded). */
class MuteChannel {
  constructor(_name: string) {}
  postMessage(): void {}
  set onmessage(_handler: unknown) {}
  close(): void {}
}

const readBlob = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => resolve(reader.result as ArrayBuffer)
  reader.readAsArrayBuffer(blob)
})

const { HistoryService, ROOT_NAME } = await import('./history.service.js')
const { LayerCommitter } = await import('./layer-committer.drone.js')
type History = InstanceType<typeof HistoryService>

const withChannel = <T>(channel: unknown, make: () => T): T => {
  ;(globalThis as Record<string, unknown>)['BroadcastChannel'] = channel
  try { return make() } finally { (globalThis as Record<string, unknown>)['BroadcastChannel'] = RealChannel }
}

/** ONE committer for the file (it subscribes to the bus forever): tab A's. */
const committer = new LayerCommitter()

const toasts: string[] = []
EffectBus.on<{ message?: string }>('toast:show', t => { if (t?.message) toasts.push(t.message) })
const added: { cell: string; at: number }[] = []
EffectBus.on<{ cell?: string; fromCascade?: boolean }>('cell:added', p => {
  if (p?.cell && p.fromCascade) added.push({ cell: p.cell, at: Date.now() })
})

type World = { root: MemoryDirectory; a: History; b: History; rootLoc: string; store: Record<string, unknown> }

const world = async (bChannel: unknown, cursorWarmsList: boolean, seeded = false): Promise<World> => {
  localStorage.clear()
  toasts.length = 0
  added.length = 0
  const root = new MemoryDirectory()
  const store: Record<string, unknown> = {
    hypercombRoot: root, opfsRoot: root,
    getLayerPoolBytes: async (sig: string) => root.files.get(sig)?.bytes ?? null,
    getResourceLocal: async (sig: string) => root.files.get(sig)?.getFile() ?? null,
    writeLayerBytes: async (sig: string, bytes: ArrayBuffer) => {
      const file = await root.getFileHandle(sig, { create: true })
      file.bytes = new Uint8Array(bytes)
    },
    putResource: async (blob: Blob) => {
      const bytes = await readBlob(blob)
      const sig = await SignatureService.sign(bytes)
      const file = await root.getFileHandle(sig, { create: true })
      file.bytes = new Uint8Array(bytes)
      return sig
    },
  }
  services.clear()
  services.set('@hypercomb.social/Store', store)
  services.set('@hypercomb.social/Lineage', { explorerSegments: () => [], domain: () => 'test.example' })
  if (seeded) {
    // A page that already has a tile: its head is not the genesis husk, so
    // reading it never lists the page's markers — tab A's marker-name cache
    // for it stays COLD while its head is warm.
    const setup = withChannel(MuteChannel, () => new HistoryService())
    await tabAdds(setup, await setup.sign({ explorerSegments: () => [] }), 'tt-seed')
  }
  const a = withChannel(TrackedChannel, () => new HistoryService())
  const b = withChannel(bChannel, () => new HistoryService())
  services.set('@diamondcoreprocessor.com/HistoryService', a)
  const rootLoc = await a.sign({ explorerSegments: () => [] })
  // Tab A's cursor, as the app has it: after every commit it re-lists the
  // page's markers, which is what keeps A's marker-name cache WARM.
  services.set('@diamondcoreprocessor.com/HistoryCursorService', {
    state: { rewound: false },
    onNewLayer: async () => { if (cursorWarmsList) await a.listLayers(rootLoc) },
  })
  return { root, a, b, rootLoc, store }
}

afterEach(() => { for (const channel of opened.splice(0)) channel.close() })

/** Tab A types a tile name: the create path's importTree. */
const aAdds = (name: string): Promise<void> =>
  committer.importTree([{ segments: [name], layer: { name } }])

/** Another tab adds a tile at the root: its own child bag, then its root
 *  marker, built on the head it reads — exactly what its committer writes. */
const tabAdds = async (tab: History, rootLoc: string, name: string): Promise<void> => {
  const childLoc = await tab.sign({ explorerSegments: () => [name] })
  const childSig = await tab.latestMarkerSigFor(childLoc, name)
  const prevSig = await tab.latestMarkerSigFor(rootLoc, ROOT_NAME)
  // (optional call: the same harness runs against the pre-fix service)
  const marker = (tab as { headMarkerOf?: (sig: string) => string | null }).headMarkerOf?.(rootLoc) ?? null
  const prev = await tab.getLayerBySig(prevSig)
  const children = [...((prev?.children as string[] | undefined) ?? []), childSig]
  await tab.commitLayer(rootLoc, { ...(prev ?? { name: ROOT_NAME }), name: ROOT_NAME, children } as never, { marker })
}
const bAdds = (w: World, name: string): Promise<void> => tabAdds(w.b, w.rootLoc, name)

const childNames = async (history: History, layerSig: string | null): Promise<string[]> => {
  const layer = layerSig ? await history.getLayerBySig(layerSig) : null
  const names: string[] = []
  for (const sig of (layer?.children as string[] | undefined) ?? []) {
    const child = await history.getLayerBySig(sig)
    if (child?.name) names.push(child.name)
  }
  return names.sort()
}

/** What a reload shows: a fresh tab reading the disk. */
const onDisk = async (w: World): Promise<string[]> => {
  const fresh = withChannel(MuteChannel, () => new HistoryService())
  return childNames(fresh, await fresh.latestMarkerSigFor(w.rootLoc, ROOT_NAME))
}

/** What tab A has in memory for its page. */
const inTabA = async (w: World): Promise<string[]> =>
  childNames(w.a, w.a.warmHeadSigFor(w.rootLoc))

const waitFor = async (check: () => boolean, ms: number): Promise<boolean> => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (check()) return true
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return check()
}

describe('two tabs of one hive both keep writing', () => {
  it('a stale tab\'s add is RE-APPLIED onto the other tab\'s head (marker collision) — nothing lost, no error', async () => {
    const w = await world(MuteChannel, true)
    const errors = vi.spyOn(console, 'error')
    await aAdds('tt-a1')
    await bAdds(w, 'tt-b1')
    await aAdds('tt-a2')
    await aAdds('tt-a3')
    expect(await onDisk(w)).toEqual(['tt-a1', 'tt-a2', 'tt-a3', 'tt-b1'])
    expect(await inTabA(w)).toEqual(['tt-a1', 'tt-a2', 'tt-a3', 'tt-b1'])
    expect(errors.mock.calls.flat().map(String).filter(s => /already exists/.test(s))).toEqual([])
    expect(toasts).toEqual([])
    errors.mockRestore()
  })

  it('the per-event add path (cell:added → #commit) rebases the same way', async () => {
    const w = await world(MuteChannel, true)
    await aAdds('tt-a1')
    await bAdds(w, 'tt-b1')
    EffectBus.emit('cell:added', { cell: 'tt-a2', segments: [] })
    await committer.settled()
    expect(await onDisk(w)).toEqual(['tt-a1', 'tt-a2', 'tt-b1'])
    expect(toasts).toEqual([])
  })

  it('a COLD marker cache can no longer commit over the other tab\'s change', async () => {
    const w = await world(MuteChannel, false, true)
    await aAdds('tt-a1')
    await bAdds(w, 'tt-b1')
    await aAdds('tt-a2')
    // Before: A's cold name scan picked a FREE name and committed a layer
    // built on its stale head — tt-b1 silently dropped from the page.
    expect(await onDisk(w)).toEqual(['tt-a1', 'tt-a2', 'tt-b1', 'tt-seed'])
  })

  it('the other tab\'s tile reaches this tab\'s page within a second — no commit, no reload', async () => {
    const w = await world(SendOnlyChannel, true)
    await aAdds('tt-a1')
    added.length = 0
    const wroteAt = Date.now()
    await bAdds(w, 'tt-b1')
    expect(await waitFor(() => added.some(e => e.cell === 'tt-b1'), 1000)).toBe(true)
    expect(added.find(e => e.cell === 'tt-b1')!.at - wroteAt).toBeLessThan(1000)
    expect(await inTabA(w)).toEqual(['tt-a1', 'tt-b1'])
    // …and A's next add lands on that head without a refusal at all.
    await aAdds('tt-a2')
    expect(await onDisk(w)).toEqual(['tt-a1', 'tt-a2', 'tt-b1'])
  })

  it('a tab coming back into view re-reads its page (an announcement missed while frozen)', async () => {
    const w = await world(MuteChannel, true)
    await aAdds('tt-a1')
    await bAdds(w, 'tt-b1')
    added.length = 0
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(await waitFor(() => added.some(e => e.cell === 'tt-b1'), 1000)).toBe(true)
    expect(await inTabA(w)).toEqual(['tt-a1', 'tt-b1'])
  })

  it('a rebase that is refused AGAIN says so out loud, and the write is rejected — never silently lost', async () => {
    const w = await world(MuteChannel, true)
    await aAdds('tt-a1')
    // Tab B commits at the root every time tab A writes its root layer bytes —
    // the head moves under every attempt.
    const write = w.store['writeLayerBytes'] as (sig: string, bytes: ArrayBuffer) => Promise<void>
    let racing = false
    let raced = 0
    w.store['writeLayerBytes'] = async (sig: string, bytes: ArrayBuffer) => {
      await write(sig, bytes)
      const layer = JSON.parse(new TextDecoder().decode(bytes)) as { name?: string }
      if (!racing && layer.name === ROOT_NAME && raced < 2) {
        racing = true
        try { await bAdds(w, `tt-b${++raced}`) } finally { racing = false }
      }
    }
    const failure = await aAdds('tt-a2').then(() => null, (e: unknown) => e as { name?: string })
    expect(failure?.name).toBe('StaleHeadError')
    expect(toasts.filter(t => /another tab/i.test(t))).toHaveLength(1)
    // B's tiles are intact; A's tile was refused, and A was told.
    expect(await onDisk(w)).toEqual(['tt-a1', 'tt-b1', 'tt-b2'])
  })
})
