// editor/viewport-store.spec.ts — a viewport commit survives its pool
// directory being removed under it. The store caches the pool handle for the
// life of the tab; when the directory went away after that, every later
// commit threw NotFoundError against the stale handle (1153 times in one
// break log). The retry now forgets the handle and resolves the pool again.

import { beforeAll, describe, expect, it, vi } from 'vitest'

// A minimal OPFS: directories hold files and directories; a removed
// directory's handle stays in callers' hands and answers NotFoundError.
const notFound = (): DOMException => new DOMException('A requested file or directory could not be found', 'NotFoundError')

class FakeFile {
  constructor(public body = '') {}
}

class FakeDir {
  readonly kind = 'directory'
  removed = false
  readonly files = new Map<string, FakeFile>()
  readonly dirs = new Map<string, FakeDir>()

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDir> {
    if (this.removed) throw notFound()
    let dir = this.dirs.get(name)
    if (!dir) {
      if (!opts?.create) throw notFound()
      dir = new FakeDir()
      this.dirs.set(name, dir)
    }
    return dir
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<unknown> {
    if (this.removed) throw notFound()
    let file = this.files.get(name)
    if (!file) {
      if (!opts?.create) throw notFound()
      file = new FakeFile()
      this.files.set(name, file)
    }
    const owner = this
    const target = file
    return {
      kind: 'file',
      getFile: async () => ({ text: async () => target.body }),
      createWritable: async () => {
        if (owner.removed) throw notFound()
        let next = ''
        return {
          write: async (body: string) => { next = body },
          close: async () => { if (owner.removed) throw notFound(); target.body = next },
        }
      },
    }
  }

  async removeEntry(name: string): Promise<void> {
    const dir = this.dirs.get(name)
    if (dir) { dir.removed = true; this.dirs.delete(name); return }
    if (!this.files.delete(name)) throw notFound()
  }

  async *entries(): AsyncIterable<[string, unknown]> {
    for (const [name] of this.files) yield [name, await this.getFileHandle(name)]
  }
}

const root = new FakeDir()
const sig = (c: string): string => c.repeat(64)
const at: Record<string, string> = { a: sig('a'), b: sig('b') }

let store: typeof import('./viewport-store.js')

beforeAll(async () => {
  Object.defineProperty(navigator, 'storage', { value: { getDirectory: async () => root }, configurable: true })
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => key === '@diamondcoreprocessor.com/HistoryService'
      ? { sign: async (l: { explorerSegments: () => string[] }) => at[l.explorerSegments()[0] ?? ''] ?? sig('f') }
      : undefined,
    register: () => undefined,
  }
  vi.useFakeTimers({ toFake: ['setTimeout'] })   // the legacy drain waits 20 s; it never runs here
  store = await import('./viewport-store.js')
})

const poolDir = (): FakeDir => [...root.dirs.values()][0]!

describe('viewport commits', () => {
  it('a commit lands in the pool', async () => {
    await store.writeViewportAt(['a'], { zoom: 2 } as never)
    expect(JSON.parse(poolDir().files.get(sig('a'))!.body)).toMatchObject({ zoom: 2 })
  })

  it('a commit after the pool directory was removed recreates it and lands, instead of failing for the life of the tab', async () => {
    const before = poolDir()
    await root.removeEntry([...root.dirs.keys()][0]!)
    expect(before.removed).toBe(true)
    await store.writeViewportAt(['b'], { zoom: 3 } as never)
    const after = poolDir()
    expect(after).not.toBe(before)
    expect(JSON.parse(after.files.get(sig('b'))!.body)).toMatchObject({ zoom: 3 })
    // …and the next one keeps working on the fresh handle.
    await store.writeViewportAt(['a'], { zoom: 4 } as never)
    expect(JSON.parse(after.files.get(sig('a'))!.body)).toMatchObject({ zoom: 4 })
  })
})
