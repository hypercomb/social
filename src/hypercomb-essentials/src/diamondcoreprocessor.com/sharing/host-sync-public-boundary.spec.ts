import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@hypercomb/core', () => ({
  EffectBus: { on: vi.fn(), emit: vi.fn() },
  SignatureService: { sign: vi.fn(async () => '0'.repeat(64)) },
  registerPoolMeaning: vi.fn(async (meaning: string) => `${meaning}-pool`),
}))

type WritableBytes = ArrayBuffer | ArrayBufferView

const memoryDirectory = (name: string) => {
  const files = new Map<string, Uint8Array>()
  const directories = new Map<string, ReturnType<typeof memoryDirectory>>()
  return {
    name,
    files,
    directories,
    async getDirectoryHandle(child: string, options?: { create?: boolean }) {
      let directory = directories.get(child)
      if (!directory && options?.create) {
        directory = memoryDirectory(child)
        directories.set(child, directory)
      }
      if (!directory) throw new DOMException('not found', 'NotFoundError')
      return directory
    },
    async getFileHandle(fileName: string, options?: { create?: boolean }) {
      if (!files.has(fileName) && !options?.create) throw new DOMException('not found', 'NotFoundError')
      if (!files.has(fileName)) files.set(fileName, new Uint8Array())
      return {
        kind: 'file' as const,
        async createWritable() {
          return {
            async write(value: WritableBytes) {
              const bytes = ArrayBuffer.isView(value)
                ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
                : new Uint8Array(value)
              files.set(fileName, new Uint8Array(bytes))
            },
            async close() { /* memory sink */ },
          }
        },
        async getFile() {
          const bytes = files.get(fileName) ?? new Uint8Array()
          return { lastModified: 1, arrayBuffer: async () => bytes.slice().buffer }
        },
      }
    },
    async *entries() {
      for (const fileName of files.keys()) yield [fileName, { kind: 'file' as const }]
    },
    async removeEntry(fileName: string) { files.delete(fileName) },
  }
}

describe('HostSyncService public exposure boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    localStorage.clear()
  })

  it('does not retain an unmarked private signature in the transmission queue', async () => {
    const root = memoryDirectory('root')
    const register = vi.fn()
    Object.assign(window, {
      ioc: {
        register,
        get: (key: string) => key === '@hypercomb.social/Store' ? { opfsRoot: root } : undefined,
      },
    })
    const { HostSyncService } = await import('./host-sync.service')
    const service = new HostSyncService()
    const privateSig = 'a'.repeat(64)

    await service.enqueue(privateSig, 'resource', new TextEncoder().encode('private').buffer)

    expect(root.directories.get('host-push-pool')).toBeUndefined()
  })

  it('retains explicitly public bytes and their marker for one-way draining', async () => {
    const root = memoryDirectory('root')
    const bytes = new TextEncoder().encode('{}').buffer
    Object.assign(window, {
      ioc: {
        register: vi.fn(),
        get: (key: string) => key === '@hypercomb.social/Store'
          ? { opfsRoot: root, getLayerPoolBytes: vi.fn(async () => new Uint8Array(bytes)) }
          : undefined,
      },
    })
    const { HostSyncService } = await import('./host-sync.service')
    const service = new HostSyncService()
    const publicSig = 'b'.repeat(64)

    await service.markPublic(publicSig, 'layer', false)
    await vi.waitFor(() => {
      const queue = root.directories.get('host-push-pool')
      expect(queue?.files.has(`${publicSig}.public`)).toBe(true)
      expect(queue?.files.has(`${publicSig}.layer`)).toBe(true)
    })
  })
})
