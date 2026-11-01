// @vitest-environment jsdom
//
// commands/lightbox-forget.spec.ts - forgetting a latent (gallery) picture.
//
// Behavioural: the REAL HistoryService, LayerCommitter, decoration writers and
// tile-properties over an in-memory OPFS (the additive-adopt harness pattern).
// A forgotten picture always leaves the tile's gallery; its bytes are deleted
// only when nothing else names them, and the worn picture is never touched.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'

vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
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

const services = new Map<string, unknown>()
const get = (key: string) => services.get(key)
;(globalThis as Record<string, unknown>)['get'] = get
;(window as unknown as { ioc: unknown }).ioc = {
  get, whenReady: () => {}, register: (key: string, value: unknown) => services.set(key, value),
}

const RealChannel = globalThis.BroadcastChannel
class MuteChannel {
  constructor(_name: string) {}
  postMessage(): void {}
  set onmessage(_handler: unknown) {}
  close(): void {}
}
const withMute = <T>(make: () => T): T => {
  ;(globalThis as Record<string, unknown>)['BroadcastChannel'] = MuteChannel
  try { return make() } finally { (globalThis as Record<string, unknown>)['BroadcastChannel'] = RealChannel }
}

const readBlob = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => resolve(reader.result as ArrayBuffer)
  reader.readAsArrayBuffer(blob)
})
const textOf = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => resolve(String(reader.result))
  reader.readAsText(blob)
})

const { HistoryService } = await import('../history/history.service.js')
const { LayerCommitter } = await import('../history/layer-committer.drone.js')
const { writeTilePropertiesAt } = await import('../editor/tile-properties.js')
const { holdPictures, galleryImageSigsAt, forgetPicture, forgetPreview } = await import('./lightbox-kind.js')

const committer = new LayerCommitter()

let root: MemoryDirectory

const world = async (): Promise<void> => {
  window.dispatchEvent(new Event('pagehide'))
  localStorage.clear()
  root = new MemoryDirectory()
  const store = {
    hypercombRoot: root, opfsRoot: root, clipboard: new MemoryDirectory(),
    getLayerPoolBytes: async (sig: string) => root.files.get(sig)?.bytes ?? null,
    getResourceLocal: async (sig: string) => root.files.get(sig)?.getFile() ?? null,
    // The real Store follows a meta envelope to its payload (store.ts #getResolvedResource).
    getResource: async (sig: string): Promise<Blob | null> => {
      let at = sig
      for (let hop = 0; hop < 8; hop++) {
        const file = root.files.get(at)
        if (!file) return null
        const blob = await file.getFile()
        if (blob.size > 64 * 1024) return blob
        try {
          const parsed = JSON.parse(await textOf(blob)) as { meta?: unknown; resource?: unknown }
          if (parsed && parsed.meta === 1 && typeof parsed.resource === 'string') { at = parsed.resource; continue }
        } catch { /* not JSON: raw bytes */ }
        return blob
      }
      return null
    },
    writeLayerBytes: async (sig: string, bytes: ArrayBuffer) => {
      const file = await root.getFileHandle(sig, { create: true })
      file.bytes = new Uint8Array(bytes)
    },
    fetchLayerFromHost: async () => null,
    putResource: async (blob: Blob) => {
      const bytes = await readBlob(blob)
      const sig = await SignatureService.sign(bytes)
      const file = await root.getFileHandle(sig, { create: true })
      file.bytes = new Uint8Array(bytes)
      return sig
    },
  }
  services.set('@hypercomb.social/Store', store)
  services.set('@hypercomb.social/Lineage', { explorerSegments: () => [], domain: () => 'test.example' })
  const history = withMute(() => new HistoryService())
  services.set('@diamondcoreprocessor.com/HistoryService', history)
  services.set('@diamondcoreprocessor.com/LayerCommitter', committer)
  services.set('@diamondcoreprocessor.com/HistoryCursorService', { state: { rewound: false }, onNewLayer: async () => {} })
  for (const name of ['alpha', 'beta']) await committer.importTree([{ segments: [name], layer: { name } }])
}

const put = async (text: string): Promise<string> =>
  (services.get('@hypercomb.social/Store') as { putResource(b: Blob): Promise<string> })
    .putResource(new Blob([text], { type: 'image/png' }))
const wear = (tile: string, sig: string) =>
  writeTilePropertiesAt([], tile, { large: { image: sig }, small: { image: sig }, imageSig: sig, participant: true }, { onlyHere: true })
const present = (sig: string): boolean => root.files.has(sig)

beforeEach(async () => { await world() })

describe('forgetting a latent picture', () => {
  it('removes the ref AND the bytes when nothing else references them', async () => {
    const worn = await put('worn'), p1 = await put('latent-1'), p2 = await put('latent-2')
    await wear('alpha', worn)
    await holdPictures(['alpha'], [worn, p1, p2])

    const preview = await forgetPreview(['alpha'], p1)
    expect(preview).toMatchObject({ held: true, worn: false, bytesGo: true })
    expect(preview.size).toBe('latent-1'.length)

    const result = await forgetPicture(['alpha'], p1)
    expect(result).toEqual({ removed: true, bytesRemoved: true })
    expect(await galleryImageSigsAt(['alpha'])).toEqual(expect.arrayContaining([worn, p2]))
    expect(await galleryImageSigsAt(['alpha'])).not.toContain(p1)
    expect(present(p1)).toBe(false)
    expect(present(p2)).toBe(true)
    expect(present(worn)).toBe(true)
  })

  it('removes the ref but keeps the bytes while another tile wears them', async () => {
    const worn = await put('worn'), shared = await put('shared-by-beta')
    await wear('alpha', worn)
    await wear('beta', shared)
    await holdPictures(['alpha'], [worn, shared])

    expect(await forgetPreview(['alpha'], shared)).toMatchObject({ held: true, bytesGo: false })
    const result = await forgetPicture(['alpha'], shared)
    expect(result).toEqual({ removed: true, bytesRemoved: false, bytesKept: 'shared' })
    expect(await galleryImageSigsAt(['alpha'])).not.toContain(shared)
    expect(present(shared)).toBe(true)
  })

  it('keeps the bytes while another tile\'s gallery still holds them', async () => {
    const worn = await put('worn'), shared = await put('shared-gallery')
    await wear('alpha', worn)
    await holdPictures(['alpha'], [worn, shared])
    await holdPictures(['beta'], [shared])

    const result = await forgetPicture(['alpha'], shared)
    expect(result).toMatchObject({ removed: true, bytesRemoved: false, bytesKept: 'shared' })
    expect(present(shared)).toBe(true)
    expect(await galleryImageSigsAt(['beta'])).toEqual([shared])
  })

  it('refuses the picture the tile wears and changes nothing', async () => {
    const worn = await put('worn'), other = await put('other')
    await wear('alpha', worn)
    await holdPictures(['alpha'], [worn, other])

    expect(await forgetPicture(['alpha'], worn)).toEqual({ removed: false, bytesRemoved: false, reason: 'worn' })
    expect(await forgetPreview(['alpha'], worn)).toMatchObject({ worn: true, bytesGo: false })
    expect(await galleryImageSigsAt(['alpha'])).toEqual(expect.arrayContaining([worn, other]))
    expect(present(worn)).toBe(true)
  })

  it('never touches another tile\'s gallery', async () => {
    const wornA = await put('worn-a'), wornB = await put('worn-b'), a1 = await put('a-latent'), b1 = await put('b-latent')
    await wear('alpha', wornA)
    await wear('beta', wornB)
    await holdPictures(['alpha'], [wornA, a1])
    await holdPictures(['beta'], [wornB, b1])
    const betaBefore = await galleryImageSigsAt(['beta'])

    await forgetPicture(['alpha'], a1)
    expect(await galleryImageSigsAt(['beta'])).toEqual(betaBefore)
    expect(present(b1)).toBe(true)
    // a picture alpha does not hold cannot be forgotten through alpha
    expect(await forgetPicture(['alpha'], b1)).toMatchObject({ removed: false, reason: 'not-held' })
    expect(present(b1)).toBe(true)
  })

  it('is idempotent', async () => {
    const worn = await put('worn'), p1 = await put('latent')
    await wear('alpha', worn)
    await holdPictures(['alpha'], [worn, p1])
    expect(await forgetPicture(['alpha'], p1)).toMatchObject({ removed: true, bytesRemoved: true })
    expect(await forgetPicture(['alpha'], p1)).toEqual({ removed: false, bytesRemoved: false, reason: 'not-held' })
    expect(await galleryImageSigsAt(['alpha'])).toEqual(expect.arrayContaining([worn]))
  })

  it('forgetting the last latent picture empties the gallery cleanly', async () => {
    const worn = await put('worn'), p1 = await put('only-latent')
    await wear('alpha', worn)
    await holdPictures(['alpha'], [p1])
    expect(await forgetPicture(['alpha'], p1)).toMatchObject({ removed: true, bytesRemoved: true })
    expect(await galleryImageSigsAt(['alpha'])).toEqual([])
  })
})


