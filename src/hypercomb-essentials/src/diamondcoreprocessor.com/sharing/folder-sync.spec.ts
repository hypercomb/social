import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
        else if (value instanceof Blob) this.#bytes = new Uint8Array(await value.arrayBuffer())
        else if (ArrayBuffer.isView(value)) {
          this.#bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
        } else if (value instanceof ArrayBuffer) this.#bytes = new Uint8Array(value.slice(0))
        else throw new Error(`unsupported memory write: ${typeof value}`)
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

  async requestPermission(): Promise<PermissionState> {
    return 'granted'
  }
}

const put = async (root: MemoryDir, path: string, bytes: Uint8Array): Promise<void> => {
  const parts = path.split('/')
  const name = parts.pop()!
  let dir = root
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
  const file = await dir.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
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

let FolderSyncService: typeof import('./folder-sync.service.js').FolderSyncService
let FolderSyncQueenBee: typeof import('./folder-sync.queen.js').FolderSyncQueenBee
let FOLDER_SYNC_KEY: typeof import('./folder-sync.service.js').FOLDER_SYNC_KEY

beforeAll(async () => {
  ;({ FolderSyncService, FOLDER_SYNC_KEY } = await import('./folder-sync.service.js'))
  ;({ FolderSyncQueenBee } = await import('./folder-sync.queen.js'))
})

beforeEach(() => {
  localStorage.clear()
  registrations.clear()
  ;(globalThis as any).__sentinelBridge = undefined
  ;(globalThis as any).__getSentinel = async () => ({
    exportBackup: async (
      onFile: (file: { path: string; sha256: string; bytes: ArrayBuffer }) => Promise<void>,
    ) => {
      const bytes = new TextEncoder().encode('DCP registry')
      const sha256 = await SignatureService.sign(bytes.buffer as ArrayBuffer)
      await onFile({ path: 'registry', sha256, bytes: bytes.buffer as ArrayBuffer })
      return { files: 1, bytes: bytes.byteLength }
    },
    importBackupFile: async () => true,
  })
})

describe('FolderSyncService', () => {
  it('opens or resumes folder access when the bare command is invoked', async () => {
    const resume = vi.fn(async () => true)
    const opened = vi.fn()
    EffectBus.on('folder-sync:open', opened)
    registrations.set(FOLDER_SYNC_KEY, {
      isSupported: () => true,
      resume,
      state: () => ({ status: 'backed-up', mode: 'hard-copy', scanned: 1, totalBytes: 1 }),
    })

    await new FolderSyncQueenBee().invoke('')
    expect(opened).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
  })

  it('accepts the short `/folder sync` form', async () => {
    const resume = vi.fn(async () => true)
    registrations.set(FOLDER_SYNC_KEY, {
      isSupported: () => true,
      resume,
      state: () => ({ status: 'backed-up', mode: 'hard-copy', scanned: 1, totalBytes: 1 }),
    })

    await new FolderSyncQueenBee().invoke('sync')
    expect(resume).toHaveBeenCalledOnce()
  })

  it('writes a complete per-device OPFS mirror into the chosen directory', async () => {
    const opfs = new MemoryDir('opfs')
    const chosen = new MemoryDir('Private backups')
    const lineage = 'a'.repeat(64)
    await put(opfs, 'plain-record', new TextEncoder().encode('record'))
    await put(opfs, `${lineage}/00000000`, new TextEncoder().encode('{"layer":"x"}'))

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => opfs },
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chosen),
    })

    const service = new FolderSyncService()
    expect(await service.connect()).toBe(true)
    const deviceId = service.state().deviceId

    expect(new TextDecoder().decode(await read(
      chosen,
      `hypercomb-backup/devices/${deviceId}/opfs/plain-record`,
    ))).toBe('record')
    expect(new TextDecoder().decode(await read(
      chosen,
      `hypercomb-backup/devices/${deviceId}/opfs/${lineage}/00000000`,
    ))).toBe('{"layer":"x"}')
    const report = new TextDecoder().decode(await read(
      chosen,
      'hypercomb-backup/BACKUP-REPORT.txt',
    ))
    expect(report).toContain('Scope: every OPFS root file and every file in every OPFS folder')
    expect(report).toContain('Snapshot files: 2')
    expect(report).toContain('Snapshot bytes:')
  })

  it('materializes referenced bytes before declaring a portable hard copy', async () => {
    const opfs = new MemoryDir('opfs')
    const chosen = new MemoryDir('Hard copy')
    const resource = new TextEncoder().encode('physical resource bytes')
    const resourceSig = await SignatureService.sign(resource.buffer as ArrayBuffer)
    const layer = new TextEncoder().encode(JSON.stringify({
      name: 'portable',
      properties: [resourceSig],
    }))
    const layerSig = await SignatureService.sign(layer.buffer as ArrayBuffer)
    const lineage = 'b'.repeat(64)
    await put(
      opfs,
      `${lineage}/00000000`,
      new TextEncoder().encode(JSON.stringify({ layer: layerSig })),
    )

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => opfs },
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chosen),
    })
    const adopt = vi.fn(async (
      rootSig: string,
      options?: { silent?: boolean; quiet?: boolean },
    ) => {
      expect(rootSig).toBe(layerSig)
      expect(options).toEqual({ silent: true, quiet: true })
      await put(opfs, layerSig, layer)
      await put(opfs, resourceSig, resource)
      EffectBus.emit('content:wrote', {
        sig: resourceSig,
        bytes: resource.buffer as ArrayBuffer,
      })
      return { layers: 1, leaves: 1, failed: 0 }
    })
    registrations.set('@diamondcoreprocessor.com/ContentBrokerDrone', { adopt })

    const service = new FolderSyncService()
    expect(await service.connect('hard-copy')).toBe(true)
    expect(service.state()).toMatchObject({
      status: 'backed-up',
      mode: 'hard-copy',
      resolvedLayers: 1,
      resolvedResources: 1,
      missingReferences: 0,
      scanned: 3,
    })
    const deviceId = service.state().deviceId
    expect(new TextDecoder().decode(await read(
      chosen,
      `hypercomb-backup/devices/${deviceId}/opfs/${resourceSig}`,
    ))).toBe('physical resource bytes')
    const inventory = new TextDecoder().decode(await read(
      chosen,
      `hypercomb-backup/devices/${deviceId}/INVENTORY.txt`,
    ))
    expect(inventory).toContain('Mode: hard-copy')
    expect(inventory).toContain('Closure roots checked: 1')
    const manifest = await read(
      chosen,
      `hypercomb-backup/devices/${deviceId}/manifest.json`,
    )
    const manifestSig = await SignatureService.sign(manifest.buffer as ArrayBuffer)
    const seal = JSON.parse(new TextDecoder().decode(await read(
      chosen,
      `hypercomb-backup/devices/${deviceId}/COMPLETE-${manifestSig.slice(0, 12).toUpperCase()}.hypercomb`,
    )))
    expect(seal).toMatchObject({
      kind: 'hypercomb-backup-completion',
      deviceId,
      manifestSha256: manifestSig,
    })
  })

  it('imports missing files but never overwrites a conflicting local file', async () => {
    const sourceOpfs = new MemoryDir('source-opfs')
    const chosen = new MemoryDir('USB')
    const original = new TextEncoder().encode('portable bytes')
    const sig = await SignatureService.sign(original.buffer as ArrayBuffer)
    const dcpBytes = new TextEncoder().encode('DCP behavior bundle')
    const dcpSha = await SignatureService.sign(dcpBytes.buffer as ArrayBuffer)
    const importBackupFile = vi.fn(async () => true)
    ;(globalThis as any).__getSentinel = async () => ({
      exportBackup: async (
        onFile: (file: { path: string; sha256: string; bytes: ArrayBuffer }) => Promise<void>,
      ) => {
        await onFile({
          path: `${'a'.repeat(64)}/behavior.js`,
          sha256: dcpSha,
          bytes: dcpBytes.buffer.slice(0) as ArrayBuffer,
        })
        return { files: 1, bytes: dcpBytes.byteLength }
      },
      importBackupFile,
    })
    await put(sourceOpfs, sig, original)
    await put(sourceOpfs, 'settings', new TextEncoder().encode('from backup'))

    let activeOpfs = sourceOpfs
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => activeOpfs },
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chosen),
    })

    const exporter = new FolderSyncService()
    expect(await exporter.connect()).toBe(true)

    const destination = new MemoryDir('destination-opfs')
    await put(destination, 'settings', new TextEncoder().encode('keep local'))
    activeOpfs = destination

    // A new Incognito/profile has no remembered device id or folder handle.
    localStorage.clear()
    const importer = new FolderSyncService()
    const result = await importer.importFromFolder()
    expect(result).toMatchObject({ copied: 1, conflicts: 1, invalid: 0 })
    expect(new TextDecoder().decode(await read(destination, sig))).toBe('portable bytes')
    expect(new TextDecoder().decode(await read(destination, 'settings'))).toBe('keep local')
    expect(importBackupFile).toHaveBeenCalledWith(expect.objectContaining({
      path: `${'a'.repeat(64)}/behavior.js`,
      sha256: dcpSha,
    }))
  })

  it('merges snapshots from every computer in a shared backup folder', async () => {
    const chosen = new MemoryDir('Shared disk')
    let activeOpfs = new MemoryDir('computer-one')
    const first = new TextEncoder().encode('from computer one')
    const firstSig = await SignatureService.sign(first.buffer as ArrayBuffer)
    await put(activeOpfs, firstSig, first)

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => activeOpfs },
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chosen),
    })

    expect(await new FolderSyncService().connect()).toBe(true)
    localStorage.clear()

    activeOpfs = new MemoryDir('computer-two')
    const second = new TextEncoder().encode('from computer two')
    const secondSig = await SignatureService.sign(second.buffer as ArrayBuffer)
    await put(activeOpfs, secondSig, second)
    expect(await new FolderSyncService().connect()).toBe(true)

    activeOpfs = new MemoryDir('new-computer')
    const result = await new FolderSyncService().importFromFolder()
    expect(result).toMatchObject({
      copied: 2,
      conflicts: 0,
      invalid: 0,
    })
    expect(result?.sourceDevices).toHaveLength(2)
    expect(new TextDecoder().decode(await read(activeOpfs, firstSig))).toBe('from computer one')
    expect(new TextDecoder().decode(await read(activeOpfs, secondSig))).toBe('from computer two')
  })

  it('rejects a local mirror because it is not a sealed portable export', async () => {
    const chosen = new MemoryDir('Local mirror')
    let activeOpfs = new MemoryDir('source')
    await put(activeOpfs, 'settings', new TextEncoder().encode('local only'))
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => activeOpfs },
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chosen),
    })

    expect(await new FolderSyncService().connect('local')).toBe(true)
    activeOpfs = new MemoryDir('fresh')
    await expect(new FolderSyncService().importFromFolder())
      .rejects.toThrow('no sealed, complete, verified DCP snapshot')
  })

  it('rejects a sealed export when any listed backup file is damaged', async () => {
    const chosen = new MemoryDir('Damaged export')
    let activeOpfs = new MemoryDir('source')
    const bytes = new TextEncoder().encode('original')
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    await put(activeOpfs, sig, bytes)
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => activeOpfs },
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chosen),
    })

    const exporter = new FolderSyncService()
    expect(await exporter.connect('hard-copy')).toBe(true)
    const deviceId = exporter.state().deviceId
    await put(
      chosen,
      `hypercomb-backup/devices/${deviceId}/opfs/${sig}`,
      new TextEncoder().encode('damaged'),
    )

    activeOpfs = new MemoryDir('fresh')
    await expect(new FolderSyncService().importFromFolder())
      .rejects.toThrow('no sealed, complete, verified hard-copy snapshots')
  })
})
