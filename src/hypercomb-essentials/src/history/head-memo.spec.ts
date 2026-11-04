// @vitest-environment jsdom
//
// history/head-memo.spec.ts — A COMMIT DOES NOT WALK THE BAG.
//
// `commitLayer` with a cold marker list enumerated the whole bag to allocate
// the next marker name, and `head()` enumerated it on every call; with the
// cursor's list warm, every commit still reduced over the whole list. The
// head stamp — the marker this tab's head was read from — is the bag's max
// unless another tab has written, and that tab's marker is the NEXT name in
// sequence. So two targeted lookups replace the walk, and the two-tab
// contract holds: a peer's marker is found, the stale commit is refused with
// `StaleHeadError`, and the re-applied commit lands on the peer's head.
//
// Driven against the REAL HistoryService over an in-memory OPFS that counts
// every `entries()` walk per directory.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'

vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => {}, get: () => undefined, whenReady: () => {},
  }
})

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
  /** Every `entries()` walk of THIS directory. */
  walks = 0
  /** Walks in flight across EVERY directory, and the most at once. */
  static inFlight = 0
  static peakInFlight = 0
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
    this.walks++
    MemoryDirectory.inFlight++
    MemoryDirectory.peakInFlight = Math.max(MemoryDirectory.peakInFlight, MemoryDirectory.inFlight)
    try {
      for (const entry of [...this.files]) {
        await new Promise<void>(resolve => queueMicrotask(resolve))   // a real directory answers asynchronously
        yield entry
      }
      for (const entry of [...this.dirs]) yield entry
    } finally { MemoryDirectory.inFlight-- }
  }
}

const services = new Map<string, unknown>()
const get = (key: string) => services.get(key)
;(globalThis as Record<string, unknown>)['get'] = get
;(window as unknown as { ioc: unknown }).ioc = {
  get, whenReady: () => {}, register: (key: string, value: unknown) => services.set(key, value),
}

/** No tab announces to another here: every move is found on disk. */
class MuteChannel {
  constructor(_name: string) {}
  postMessage(): void {}
  set onmessage(_handler: unknown) {}
  close(): void {}
}
const RealChannel = globalThis.BroadcastChannel
const withMute = <T>(make: () => T): T => {
  ;(globalThis as Record<string, unknown>)['BroadcastChannel'] = MuteChannel
  try { return make() } finally { (globalThis as Record<string, unknown>)['BroadcastChannel'] = RealChannel }
}

const { HistoryService, ROOT_NAME } = await import('./history.service.js')
type History = InstanceType<typeof HistoryService>

const world = async () => {
  localStorage.clear()
  const root = new MemoryDirectory()
  const store: Record<string, unknown> = {
    hypercombRoot: root, opfsRoot: root,
    getLayerPoolBytes: async (sig: string) => root.files.get(sig)?.bytes ?? null,
    writeLayerBytes: async (sig: string, bytes: ArrayBuffer) => {
      const file = await root.getFileHandle(sig, { create: true })
      file.bytes = new Uint8Array(bytes)
    },
  }
  services.clear()
  services.set('@hypercomb.social/Store', store)
  services.set('@hypercomb.social/Lineage', { explorerSegments: () => [], domain: () => 'test.example' })
  const a = withMute(() => new HistoryService())
  const b = withMute(() => new HistoryService())
  const rootLoc = await a.sign({ explorerSegments: () => [] })
  return { root, a, b, rootLoc, bag: () => root.dirs.get(rootLoc)! }
}

afterEach(() => { services.clear() })

/** One tab adds a named child at the root, built on the head it reads —
 *  exactly what its committer does. Returns the commit's error, if any. */
const adds = async (tab: History, rootLoc: string, name: string): Promise<{ name?: string } | null> => {
  const prevSig = await tab.latestMarkerSigFor(rootLoc, ROOT_NAME)
  const marker = tab.headMarkerOf(rootLoc)
  const prev = await tab.getLayerBySig(prevSig)
  const childSig = await SignatureService.sign(new TextEncoder().encode(name).buffer as ArrayBuffer)
  const children = [...((prev?.children as string[] | undefined) ?? []), childSig]
  return tab.commitLayer(rootLoc, { ...(prev ?? { name: ROOT_NAME }), name: ROOT_NAME, children } as never, { marker })
    .then(() => null, (e: unknown) => e as { name?: string })
}

const childCount = async (tab: History, rootLoc: string): Promise<number> => {
  const fresh = withMute(() => new HistoryService())
  const layer = await fresh.getLayerBySig(await fresh.latestMarkerSigFor(rootLoc, ROOT_NAME))
  void tab
  return ((layer?.children as string[] | undefined) ?? []).length
}

describe('the head memo on the commit path', () => {
  it('a run of commits walks the bag on first touch only — never per commit', async () => {
    const w = await world()
    expect(await adds(w.a, w.rootLoc, 'c1')).toBeNull()
    const afterFirst = w.bag().walks
    for (let i = 2; i <= 12; i++) expect(await adds(w.a, w.rootLoc, `c${i}`)).toBeNull()
    expect(w.bag().walks).toBe(afterFirst)
    expect([...w.bag().files.keys()].filter(n => /^\d{8}$/.test(n)).sort().at(-1)).toBe('00000012')
    expect(await childCount(w.a, w.rootLoc)).toBe(12)
  })

  it('head() answers from the stamp with no walk, and still sees a peer\'s newer marker', async () => {
    const w = await world()
    await adds(w.a, w.rootLoc, 'c1')
    await adds(w.a, w.rootLoc, 'c2')
    const before = w.bag().walks
    expect((await w.a.head(w.rootLoc))?.index).toBe(2)
    expect((await w.a.head(w.rootLoc))?.index).toBe(2)
    expect(w.bag().walks).toBe(before)
    // Tab B writes 00000003 — tab A has not heard. head() must not serve 2.
    await adds(w.b, w.rootLoc, 'b1')
    expect((await w.a.head(w.rootLoc))?.index).toBe(3)
  })

  it('two tabs: the stale commit is REFUSED by lookup, the re-applied one lands — no revision lost', async () => {
    const w = await world()
    expect(await adds(w.a, w.rootLoc, 'a1')).toBeNull()
    expect(await adds(w.b, w.rootLoc, 'b1')).toBeNull()
    const before = w.bag().walks
    const prev = w.a.headMarkerOf(w.rootLoc)
    const refused = await adds(w.a, w.rootLoc, 'a2')
    expect(refused?.name).toBe('StaleHeadError')
    // The refusal found B's marker by targeted lookup and re-read the head
    // from it: tab A now stands on B's marker without a walk of the bag.
    expect(w.bag().walks).toBe(before)
    expect(w.a.headMarkerOf(w.rootLoc)).not.toBe(prev)
    expect(w.a.headMarkerOf(w.rootLoc)).toBe(w.b.headMarkerOf(w.rootLoc))
    expect(await adds(w.a, w.rootLoc, 'a2')).toBeNull()
    expect([...w.bag().files.keys()].filter(n => /^\d{8}$/.test(n)).sort()).toEqual(['00000000', '00000001', '00000002', '00000003'])
    expect(await childCount(w.a, w.rootLoc)).toBe(3)
  })

  it('replay() is memoized under the head it was read under — a commit or a peer\'s marker is never hidden', async () => {
    const w = await world()
    await adds(w.a, w.rootLoc, 'a1')
    const first = await w.a.replay(w.rootLoc)
    const before = w.bag().walks
    expect(await w.a.replay(w.rootLoc)).toBe(first)        // served from the memo
    expect(w.bag().walks).toBe(before)
    await adds(w.a, w.rootLoc, 'a2')                         // the head moved: the entry stops matching
    const second = await w.a.replay(w.rootLoc)
    expect(second).not.toBe(first)
    expect(second.length).toBe(first.length + 1)
    await adds(w.b, w.rootLoc, 'b1')                         // a peer's marker, learned on revalidation
    await w.a.revalidateHead(w.rootLoc)
    expect((await w.a.replay(w.rootLoc)).length).toBe(second.length + 1)
  })

  it('preloadAllBags walks bags with bounded concurrency — more than one at a time, never all', async () => {
    const w = await world()
    // Forty lineages, each with a head: forty bags on disk.
    const locs: string[] = []
    for (let i = 0; i < 40; i++) {
      const loc = await w.a.sign({ explorerSegments: () => [`bag-${i}`] })
      locs.push(loc)
      await adds(w.a, loc, `tile-${i}`)
    }
    const fresh = withMute(() => new HistoryService())
    MemoryDirectory.peakInFlight = 0
    await fresh.preloadAllBags()
    for (const loc of locs) expect(fresh.warmHeadSigFor(loc)).toBe(w.a.warmHeadSigFor(loc))
    expect(MemoryDirectory.peakInFlight).toBeGreaterThan(1)
    expect(MemoryDirectory.peakInFlight).toBeLessThanOrEqual(12)
  }, 30_000)

  it('a peer that wrote SEVERAL markers is caught the same way', async () => {
    const w = await world()
    await adds(w.a, w.rootLoc, 'a1')
    for (const name of ['b1', 'b2', 'b3']) expect(await adds(w.b, w.rootLoc, name)).toBeNull()
    expect((await adds(w.a, w.rootLoc, 'a2'))?.name).toBe('StaleHeadError')
    expect(await adds(w.a, w.rootLoc, 'a2')).toBeNull()
    expect(await childCount(w.a, w.rootLoc)).toBe(5)
  })
})
