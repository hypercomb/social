// hypercomb-runtime/src/store.quota.spec.ts
//
// AN OUT-OF-SPACE DEVICE IS SAID, ONCE (CC-3).
//
// Reproduced live (critic/quota-full.cjs, CDP quota pinned to usage + 64 KB):
// store.putResource(200 KB) threw "TypeError: Cannot close a ERRORED writable
// stream" — every OPFS write was `try { write } finally { close() }`, and the
// close() on the errored stream replaced the QuotaExceededError — and no toast
// ever appeared. Now the write's own error reaches the caller, the stream is
// aborted, and a full device raises exactly one "out of space" toast however
// many writes fail behind it.

import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g['get'] = () => undefined
  g['register'] = () => { /* noop */ }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

import { EffectBus } from '@hypercomb/core'

const toasts: { type?: string; message?: string }[] = []
EffectBus.on<{ type?: string; message?: string }>('toast:show', t => { if (t) toasts.push(t) })

/** The device is full: every write rejects with QuotaExceededError and the
 *  errored stream refuses to close, exactly as Chrome's OPFS does. */
let full = false
let aborts = 0

class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  constructor(public name: string) {}
  async getFile(): Promise<File> {
    const slice = this.bytes.slice().buffer as ArrayBuffer
    return { name: this.name, size: slice.byteLength, arrayBuffer: async () => slice } as unknown as File
  }
  async createWritable() {
    let errored = false
    return {
      write: async (chunk: ArrayBuffer | Uint8Array) => {
        if (full) { errored = true; throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') }
        this.bytes = new Uint8Array(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))
      },
      close: async () => { if (errored) throw new TypeError('Cannot close a ERRORED writable stream') },
      abort: async () => { aborts++ },
    }
  }
}

class MockDir {
  kind = 'directory' as const
  files = new Map<string, MockFile>()
  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<MockFile> {
    let f = this.files.get(name)
    if (!f) {
      if (!opts.create) throw new DOMException(`${name} not found`, 'NotFoundError')
      f = new MockFile(name); this.files.set(name, f)
    }
    return f
  }
  async *entries(): AsyncIterable<[string, MockFile]> { for (const e of [...this.files]) yield e }
}

type StoreLike = {
  hypercombRoot: MockDir
  putResource(blob: Blob): Promise<string>
  writeLayerBytes(sig: string, bytes: ArrayBuffer): Promise<void>
}
let store: StoreLike

beforeAll(async () => {
  const mod = await import('./store')
  store = new (mod.Store as unknown as new () => StoreLike)()
  store.hypercombRoot = new MockDir()
})

/** A dropped picture's bytes (jsdom's Blob has no arrayBuffer()). */
const picture = (n: number): Blob => {
  const bytes = new Uint8Array(200 * 1024).map((_, i) => (i * 7919 + n) & 255)
  return { type: 'image/png', size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer } as unknown as Blob
}

describe('a full device', () => {
  it('putResource rejects with the QuotaExceededError itself, and the stream is aborted', async () => {
    full = true
    toasts.length = 0
    aborts = 0
    const failure = await store.putResource(picture(1)).then(() => null, (e: unknown) => e as { name?: string })
    expect(failure?.name).toBe('QuotaExceededError')
    expect(aborts).toBe(1)
  })

  it('raises exactly ONE out-of-space toast for a burst of failing writes', async () => {
    full = true
    // The first test's failure already spoke inside this window; a burst of
    // further failures (a picture, then a layer commit) adds nothing.
    await store.putResource(picture(2)).catch(() => undefined)
    await store.writeLayerBytes('c'.repeat(64), new Uint8Array([1, 2, 3]).buffer as ArrayBuffer).catch(() => undefined)
    const spoken = toasts.filter(t => /out of space/i.test(String(t.message)))
    expect(spoken).toHaveLength(1)
    expect(spoken[0].type).toBe('warning')
  })

  it('a write that succeeds says nothing', async () => {
    full = false
    toasts.length = 0
    const sig = await store.putResource(picture(3))
    expect(sig).toMatch(/^[a-f0-9]{64}$/)
    expect(toasts).toHaveLength(0)
  })
})
