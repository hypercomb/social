// @vitest-environment jsdom
//
// history/seal-refusal-memo.spec.ts — A REFUSAL IS AS PURE AS A SUCCESS
// (BCL-6, the history half).
//
// Reproduced live (bigclosure/sealhole.cjs, run SH1): one layer under a public
// root held nowhere. Every swarm walk re-ran sealSubtree, every seal re-asked
// the hosts for the missing layer with the miss window cleared, the refusal
// finished past the walk's patience and scheduled the next walk: 150 refusal
// warnings and 267 GETs for the missing sig in ~300 s, and the tile was never
// takeable. A refusal is a pure function of the subtree's heads exactly like a
// success, so it is memoised per tree epoch; a BACKGROUND seal (the walk) takes
// the memo and keeps the store's host-miss window, while an explicit operation
// (snapshot, publish) still asks the hosts again. A layer that arrives drops
// the refusals.

import { describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

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
  constructor(readonly name = '') {}
  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    let file = this.files.get(name)
    if (!file) {
      if (!options.create) throw new DOMException('File absent', 'NotFoundError')
      this.files.set(name, file = new MemoryFile(name))
    }
    return file
  }
  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
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

const root = new MemoryDirectory()
const asks: { sig: string; bypassMissWindow?: boolean }[] = []
const store = {
  hypercombRoot: root, opfsRoot: root,
  getLayerPoolBytes: async (sig: string) => root.files.get(sig)?.bytes ?? null,
  getResourceLocal: async (sig: string) => root.files.get(sig)?.getFile() ?? null,
  writeLayerBytes: async (sig: string, bytes: ArrayBuffer) => {
    const file = await root.getFileHandle(sig, { create: true })
    file.bytes = new Uint8Array(bytes)
  },
  putResource: async (blob: Blob) => {
    const bytes = new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error)
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.readAsArrayBuffer(blob)
    }))
    const { SignatureService } = await import('@hypercomb/core')
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    const file = await root.getFileHandle(sig, { create: true })
    file.bytes = bytes
    return sig
  },
  // The layer is on no host: every ask is a (slow) miss.
  fetchLayerFromHost: async (sig: string, options: { bypassMissWindow?: boolean } = {}) => {
    asks.push({ sig, bypassMissWindow: options.bypassMissWindow })
    await new Promise(resolve => setTimeout(resolve, 5))
    return null
  },
}
const services = new Map<string, unknown>([['@hypercomb.social/Store', store]])
;(globalThis as Record<string, unknown>)['get'] = (key: string) => services.get(key)

const { HistoryService } = await import('./history.service.js')

/** /hole with one child whose layer bytes are held nowhere. Returns a FRESH
 *  service (no in-memory copy of the lost layer) and the lost files. */
const holeyTree = async () => {
  const author = new HistoryService()
  const childLoc = await author.sign({ explorerSegments: () => ['hole', 'lost'] })
  const childSig = await author.commitLayer(childLoc, { name: 'lost', notes: ['n'] } as never)
  const parentLoc = await author.sign({ explorerSegments: () => ['hole'] })
  await author.commitLayer(parentLoc, { name: 'hole', children: [childSig] } as never)
  const parent = await author.currentLayerAt(parentLoc)
  const slot = String((parent?.children as string[])[0])
  // The slot may hold a metadata incidence: lose the layer it names too.
  const lost = new Map<string, MemoryFile['bytes']>()
  for (const sig of new Set([slot, childSig])) {
    const file = root.files.get(sig)
    if (file) { lost.set(sig, file.bytes); root.files.delete(sig) }
  }
  return { history: new HistoryService(), lost }
}

describe('sealSubtree memoises a refusal per tree epoch', () => {
  it('a background seal asks the hosts ONCE per epoch and says why on every call', async () => {
    const { history } = await holeyTree()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    asks.length = 0
    expect(await history.sealSubtree(['hole'], undefined, { bypassMissWindow: false })).toBeNull()
    const firstAsks = asks.length
    expect(firstAsks).toBeGreaterThan(0)
    const reason = history.lastSealFailure
    expect(reason?.reason).toBe('child-unresolvable')

    for (let walk = 0; walk < 5; walk++) {
      expect(await history.sealSubtree(['hole'], undefined, { bypassMissWindow: false })).toBeNull()
      expect(history.lastSealFailure).toEqual(reason)
    }
    // Before: every walk re-asked (6 seals → 6× the asks) and re-warned.
    expect(asks.length).toBe(firstAsks)
    expect(warn.mock.calls.filter(c => String(c[0]).includes('sealSubtree refused'))).toHaveLength(1)
    warn.mockRestore()
  })

  it('a background seal keeps the store\'s host-miss window (never clears it to re-ask)', async () => {
    const { history } = await holeyTree()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    asks.length = 0
    await history.sealSubtree(['hole'], undefined, { bypassMissWindow: false })
    expect(asks.length).toBeGreaterThan(0)
    expect(asks.every(a => a.bypassMissWindow === false)).toBe(true)
    vi.mocked(console.warn).mockRestore()
  })

  it('an explicit operation (the default) still asks the hosts again, clearing the miss window', async () => {
    const { history } = await holeyTree()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await history.sealSubtree(['hole'], undefined, { bypassMissWindow: false })
    asks.length = 0
    expect(await history.sealSubtree(['hole'])).toBeNull()
    expect(asks.length).toBeGreaterThan(0)
    expect(asks.every(a => a.bypassMissWindow === true)).toBe(true)
    vi.mocked(console.warn).mockRestore()
  })

  it('a layer that ARRIVES drops the refusal: the next background seal succeeds', async () => {
    const { history, lost } = await holeyTree()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await history.sealSubtree(['hole'], undefined, { bypassMissWindow: false })).toBeNull()
    for (const [sig, bytes] of lost) (await root.getFileHandle(sig, { create: true })).bytes = bytes
    EffectBus.emit('content:arrived', { sig: [...lost.keys()][0], kind: 'layer' })
    expect(await history.sealSubtree(['hole'], undefined, { bypassMissWindow: false })).toMatch(/^[a-f0-9]{64}$/)
    vi.mocked(console.warn).mockRestore()
  })
})
