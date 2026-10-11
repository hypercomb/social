// core/location-marker.spec.ts
//
// THE MARKER WRITE KEEPS ITS OWN ERROR (CC-3) and NAMES A TAKEN NAME (CC-1).
//
// A full device makes the stream's write() reject with QuotaExceededError; the
// stream is then ERRORED, and the old `finally { close() }` threw "Cannot close
// a ERRORED writable stream" over it — so no caller could ever recognise "out
// of space". A marker name another tab already wrote is refused with a NAMED
// error, so a writer can tell "re-read the head and re-apply" from a broken
// write.

import { describe, expect, it } from 'vitest'
import { writeLayerMarker } from './location-marker.js'

const LAYER = 'a'.repeat(64)

const quota = (): DOMException => new DOMException('The quota has been exceeded.', 'QuotaExceededError')

/** A writable that behaves like Chrome's after a failed write: write rejects,
 *  close then throws a TypeError, abort is accepted. */
class ErroringWritable {
  aborted = false
  async write(): Promise<void> { throw quota() }
  async close(): Promise<void> { throw new TypeError('Cannot close a ERRORED writable stream') }
  async abort(): Promise<void> { this.aborted = true }
}

class Bag {
  readonly files = new Map<string, Uint8Array>()
  writable: ErroringWritable | null = null
  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    if (!this.files.has(name)) {
      if (!options.create) throw new DOMException(`${name} absent`, 'NotFoundError')
      this.files.set(name, new Uint8Array())
    }
    return {
      kind: 'file' as const,
      createWritable: async () => this.writable ?? {
        write: async (data: ArrayBuffer) => { this.files.set(name, new Uint8Array(data)) },
        close: async () => {},
        abort: async () => {},
      },
      getFile: async () => new Blob([this.files.get(name)!.slice().buffer as ArrayBuffer]),
    }
  }
  async *entries() {
    for (const name of this.files.keys()) yield [name, { kind: 'file' }] as const
  }
}

describe('writeLayerMarker', () => {
  it('rethrows the write\'s QuotaExceededError, not the close() TypeError, and aborts the stream', async () => {
    const bag = new Bag()
    bag.writable = new ErroringWritable()
    const failure = await writeLayerMarker(bag as unknown as FileSystemDirectoryHandle, LAYER, '00000001')
      .then(() => null, (error: unknown) => error as { name?: string })
    expect(failure?.name).toBe('QuotaExceededError')
    expect(bag.writable.aborted).toBe(true)
  })

  it('refuses a name another writer already holds with a NAMED error, never overwriting it', async () => {
    const bag = new Bag()
    await writeLayerMarker(bag as unknown as FileSystemDirectoryHandle, LAYER, '00000001')
    const before = bag.files.get('00000001')!.slice()
    const failure = await writeLayerMarker(bag as unknown as FileSystemDirectoryHandle, 'b'.repeat(64), '00000001')
      .then(() => null, (error: unknown) => error as { name?: string; message?: string })
    expect(failure?.name).toBe('MarkerExistsError')
    expect(failure?.message).toMatch(/Location marker 00000001 already exists/)
    expect(bag.files.get('00000001')).toEqual(before)
  })
})
