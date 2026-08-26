// The incremental drain is driven by EffectBus, which replays its last value
// to every new subscriber. That replay leaks across tests in a shared file and
// makes instance attribution ambiguous, so the drain invariant gets its own
// spec file: one module registry, one bus, one service.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { EffectBus, SignatureService } from '@hypercomb/core'

class MemoryFile {
  readonly kind = 'file'
  #bytes = new Uint8Array()
  #modified = Date.now()

  constructor(readonly name: string) {}

  async getFile(): Promise<File> {
    const snapshot = this.#bytes.slice()
    return {
      name: this.name,
      size: snapshot.byteLength,
      lastModified: this.#modified,
      arrayBuffer: async () => snapshot.buffer.slice(0),
      text: async () => new TextDecoder().decode(snapshot),
    } as File
  }

  async createWritable(): Promise<{ write: (value: unknown) => Promise<void>; close: () => Promise<void> }> {
    return {
      write: async value => {
        if (typeof value === 'string') this.#bytes = new TextEncoder().encode(value)
        else if (ArrayBuffer.isView(value)) {
          this.#bytes = new Uint8Array(
            value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer,
          )
        } else if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
          this.#bytes = new Uint8Array((value as ArrayBuffer).slice(0))
        } else throw new Error(`unsupported memory write: ${typeof value}`)
        this.#modified = Date.now()
      },
      close: async () => {},
    }
  }
}

class MemoryDir {
  readonly kind = 'directory'
  readonly entriesMap = new Map<string, MemoryDir | MemoryFile>()

  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDir> {
    const found = this.entriesMap.get(name)
    if (found instanceof MemoryDir) return found
    if (found || !options?.create) throw new DOMException('not found', 'NotFoundError')
    const created = new MemoryDir(name)
    this.entriesMap.set(name, created)
    return created
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    const found = this.entriesMap.get(name)
    if (found instanceof MemoryFile) return found
    if (found || !options?.create) throw new DOMException('not found', 'NotFoundError')
    const created = new MemoryFile(name)
    this.entriesMap.set(name, created)
    return created
  }

  async *entries(): AsyncGenerator<[string, MemoryDir | MemoryFile]> {
    yield* this.entriesMap.entries()
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted'
  }
}

const put = async (root: MemoryDir, path: string, bytes: Uint8Array): Promise<void> => {
  const parts = path.split('/')
  const name = parts.pop()!
  let dir = root
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
  await writable.write(bytes)
  await writable.close()
}

const read = async (root: MemoryDir, path: string): Promise<Uint8Array> => {
  const parts = path.split('/')
  const name = parts.pop()!
  let dir = root
  for (const part of parts) dir = await dir.getDirectoryHandle(part)
  return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer())
}

vi.useFakeTimers()
const registrations = new Map<string, unknown>()
;(window as any).ioc = {
  register: (key: string, value: unknown) => registrations.set(key, value),
  get: (key: string) => registrations.get(key),
}
;(globalThis as any).__getSentinel = async () => null

let FolderSyncService: typeof import('./folder-sync.service.js').FolderSyncService

beforeAll(async () => {
  ;({ FolderSyncService } = await import('./folder-sync.service.js'))
})

describe('incremental drain', () => {
  it('adds bytes without restating what the full pass reported', async () => {
    const opfs = new MemoryDir('opfs')
    const chosen = new MemoryDir('Backups')
    const lineage = 'f'.repeat(64)
    const unreachableRoot = '9'.repeat(64)
    await put(
      opfs,
      `${lineage}/00000000`,
      new TextEncoder().encode(JSON.stringify({ layer: unreachableRoot })),
    )
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => opfs },
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chosen),
    })
    registrations.set('@diamondcoreprocessor.com/ContentBrokerDrone', {
      adopt: async () => ({ layers: 0, leaves: 0, failed: 1 }),
    })
    ;(globalThis as any).requestIdleCallback = (callback: () => void) => {
      callback()
      return 0
    }

    const service = new FolderSyncService()
    await service.connect('hard-copy')
    const deviceId = service.state().deviceId

    // The root produced no layer, so the closure is unmeasured, not portable.
    expect(service.state()).toMatchObject({
      status: 'incomplete',
      closureRoots: 1,
      failedRoots: 1,
    })
    const before = JSON.parse(new TextDecoder().decode(
      await read(chosen, `.hypercomb/devices/${deviceId}/manifest.json`),
    ))
    expect(before.closure.rootsFailed).toBe(1)

    const drained = new TextEncoder().encode('newly written resource')
    const drainedSig = await SignatureService.sign(drained.buffer as ArrayBuffer)
    await put(opfs, drainedSig, drained)
    EffectBus.emit('content:wrote', { sig: drainedSig, bytes: drained.buffer as ArrayBuffer })
    await vi.advanceTimersByTimeAsync(20_000)

    const after = JSON.parse(new TextDecoder().decode(
      await read(chosen, `.hypercomb/devices/${deviceId}/manifest.json`),
    ))
    expect(after.files[drainedSig]).toBeDefined()
    // A drain only ADDS bytes. Restating these erased the record of what was
    // missing and silently dropped the snapshot below the import bar.
    expect(after.closure).toEqual(before.closure)
    expect(after.mode).toBe(before.mode)
  })
})
