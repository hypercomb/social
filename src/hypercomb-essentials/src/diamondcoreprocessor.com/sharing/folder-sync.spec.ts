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
      options?: {
        deepResources?: boolean
        silent?: boolean
        quiet?: boolean
        mirror?: { has?: unknown; read?: unknown; write?: unknown }
      },
    ) => {
      expect(rootSig).toBe(layerSig)
      // A hard copy must descend through resources that name further content,
      // not stop at the contracts — and it must hand the walk the BACKUP as a
      // write-through destination, so bytes are saved as they verify rather
      // than after the whole closure resolves.
      expect(options).toMatchObject({ deepResources: true, silent: true, quiet: true })
      expect(typeof options?.mirror?.has).toBe('function')
      expect(typeof options?.mirror?.read).toBe('function')
      expect(typeof options?.mirror?.write).toBe('function')
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

  it('re-hashes every backed-up file on demand and catches damage', async () => {
    const opfs = new MemoryDir('opfs')
    const chosen = new MemoryDir('Backups')
    const bytes = new TextEncoder().encode('real content')
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    await put(opfs, sig, bytes)
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => opfs },
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chosen),
    })

    const service = new FolderSyncService()
    await service.connect('local')
    const deviceId = service.state().deviceId

    await service.verify()
    expect(service.state()).toMatchObject({
      status: 'backed-up',
      verified: 1,
      damaged: 0,
    })

    // Corrupt the mirror behind the service's back. A copy pass skips this
    // file on name and size; only a re-hash can catch it.
    await put(
      chosen,
      `hypercomb-backup/devices/${deviceId}/opfs/${sig}`,
      new TextEncoder().encode('tampered!!!'),
    )
    await service.verify()
    expect(service.state()).toMatchObject({ status: 'incomplete', damaged: 1, verified: 0 })
  })

  it('advances verifiedAt only on a real re-hash, never on a copy pass', async () => {
    const opfs = new MemoryDir('opfs')
    const chosen = new MemoryDir('Backups')
    const bytes = new TextEncoder().encode('content')
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    await put(opfs, sig, bytes)
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => opfs },
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chosen),
    })

    const service = new FolderSyncService()
    await service.connect('local')
    const deviceId = service.state().deviceId
    const manifestPath = `hypercomb-backup/devices/${deviceId}/manifest.json`
    const afterCopy = JSON.parse(new TextDecoder().decode(await read(chosen, manifestPath)))

    await vi.advanceTimersByTimeAsync(1_000)
    await service.verify()
    const afterVerify = JSON.parse(new TextDecoder().decode(await read(chosen, manifestPath)))
    expect(afterVerify.verifiedAt).toBeGreaterThan(afterCopy.verifiedAt)
  })

  it('follows content named by pool records, which no layer references', async () => {
    const opfs = new MemoryDir('opfs')
    const chosen = new MemoryDir('Backups')
    // sign('threads') — a pool of meaning, not a lineage bag.
    const threadsPool = await SignatureService.sign(
      new TextEncoder().encode('threads').buffer as ArrayBuffer,
    )
    const messageSig = 'a1'.repeat(32)
    await put(
      opfs,
      `${threadsPool}/manifest`,
      new TextEncoder().encode(JSON.stringify({
        turns: [{ role: 'user', contentSig: messageSig }],
      })),
    )
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => opfs },
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chosen),
    })
    const adoptResources = vi.fn(async () => ({ leaves: 1, failed: 0 }))
    registrations.set('@diamondcoreprocessor.com/ContentBrokerDrone', {
      adopt: async () => ({ layers: 0, leaves: 0, failed: 0 }),
      adoptResources,
    })

    const service = new FolderSyncService()
    await service.connect('hard-copy')

    // The message body is named only by a thread manifest in a pool. Nothing
    // in the layer walk would ever reach it.
    expect(adoptResources).toHaveBeenCalledWith(
      [messageSig],
      expect.objectContaining({
        deepResources: true,
        quiet: true,
        // Pool-named content writes through to the backup too — it is the
        // content no layer references, so nothing else would ever save it.
        mirror: expect.objectContaining({
          has: expect.any(Function),
          read: expect.any(Function),
          write: expect.any(Function),
        }),
      }),
    )
    expect(service.state()).toMatchObject({ status: 'backed-up', mode: 'hard-copy' })
  })

  it('will not call pool-named content portable when it cannot be materialized', async () => {
    const opfs = new MemoryDir('opfs')
    const chosen = new MemoryDir('Backups')
    const threadsPool = await SignatureService.sign(
      new TextEncoder().encode('threads').buffer as ArrayBuffer,
    )
    await put(
      opfs,
      `${threadsPool}/manifest`,
      new TextEncoder().encode(JSON.stringify({ contentSig: 'b2'.repeat(32) })),
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
      adopt: async () => ({ layers: 0, leaves: 0, failed: 0 }),
      adoptResources: async () => ({ leaves: 0, failed: 1 }),
    })

    const service = new FolderSyncService()
    await service.connect('hard-copy')
    expect(service.state()).toMatchObject({ status: 'incomplete', missingReferences: 1 })
  })

  it('backs up the hive through the facade, never the pack file', async () => {
    // In packed mode the hive is not records in the raw OPFS — it is one
    // `hive.pack` file. A raw walk copies that whole file alongside the same
    // content expanded (measured: 651 MB of pack in a 1,024 MB folder against
    // 504 MB of storage), and because the pack is append-only its size and
    // mtime change on any hive change, so it is re-copied IN FULL every pass.
    const raw = new MemoryDir('opfs')
    const facade = new MemoryDir('facade')
    const chosen = new MemoryDir('Backups')

    const record = 'a'.repeat(64)
    const packPool = 'b'.repeat(64)
    await put(facade, record, new TextEncoder().encode('a real record'))
    // What the raw root holds and the facade deliberately hides.
    await put(raw, `${packPool}/hive.pack`, new Uint8Array(4096))
    await put(raw, '__layers__/legacy-record', new TextEncoder().encode('undrained'))

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => raw },
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chosen),
    })
    registrations.set('@hypercomb.social/Store', { opfsRoot: facade })

    const service = new FolderSyncService()
    await service.connect('local')

    const opfs = await (await (await (await chosen.getDirectoryHandle('hypercomb-backup'))
      .getDirectoryHandle('devices')).entriesMap.values().next().value as MemoryDir)
      .getDirectoryHandle('opfs')

    // The hive travelled.
    expect(opfs.entriesMap.has(record)).toBe(true)
    // The legacy dir the facade hides travelled too — it still holds records
    // until the drain finishes, and a list of legacy names would have drifted.
    expect(opfs.entriesMap.has('__layers__')).toBe(true)
    // The pack did NOT. It is the storage engine's internal representation,
    // and every record inside it is already here individually.
    expect(opfs.entriesMap.has(packPool)).toBe(false)
  })

  it('joins an in-flight full pass instead of queueing a repeat', async () => {
    const opfs = new MemoryDir('opfs')
    const chosen = new MemoryDir('Backups')
    const lineage = 'c'.repeat(64)
    const layer = new TextEncoder().encode(JSON.stringify({ name: 'root' }))
    const layerSig = await SignatureService.sign(layer.buffer as ArrayBuffer)
    await put(opfs, layerSig, layer)
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
    const adopt = vi.fn(async () => ({ layers: 1, leaves: 0, failed: 0 }))
    registrations.set('@diamondcoreprocessor.com/ContentBrokerDrone', { adopt })

    const service = new FolderSyncService()
    const first = service.connect('hard-copy')
    const second = service.syncNow('hard-copy')
    await Promise.all([first, second])

    // Two requests, one materialization. The boot-time passive pass must
    // likewise decline once a pass has already run this session.
    expect(adopt).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(adopt).toHaveBeenCalledTimes(1)
  })

  it('copies no bytes on a second pass over unchanged content-addressed files', async () => {
    const opfs = new MemoryDir('opfs')
    const chosen = new MemoryDir('Backups')
    const bytes = new TextEncoder().encode('immutable content')
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    await put(opfs, sig, bytes)
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => opfs },
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chosen),
    })

    const service = new FolderSyncService()
    expect(await service.connect('local')).toBe(true)
    expect(service.state()).toMatchObject({ scanned: 1, copied: 1 })

    await service.syncNow('local')
    expect(service.state()).toMatchObject({ scanned: 1, copied: 0, copiedBytes: 0 })
  })

  it('reports a root that produced no layer as an unmeasured closure', async () => {
    const opfs = new MemoryDir('opfs')
    const chosen = new MemoryDir('Backups')
    const lineage = 'd'.repeat(64)
    const missingRoot = 'e'.repeat(64)
    await put(
      opfs,
      `${lineage}/00000000`,
      new TextEncoder().encode(JSON.stringify({ layer: missingRoot })),
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

    const service = new FolderSyncService()
    await service.connect('hard-copy')
    expect(service.state()).toMatchObject({
      status: 'incomplete',
      closureRoots: 1,
      failedRoots: 1,
    })
    // An unmeasured closure must never be importable as a portable hard copy.
    await expect(new FolderSyncService().importFromFolder())
      .rejects.toThrow('no sealed, complete, verified')
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

  it('exports and imports a participant backup on a browser with no DCP', async () => {
    // A private window can never have DCP attached. Requiring a DCP half made
    // both halves of the round trip impossible there.
    delete (globalThis as any).__getSentinel
    delete (globalThis as any).__sentinelBridge
    const chosen = new MemoryDir('Export')
    let activeOpfs = new MemoryDir('source')
    const bytes = new TextEncoder().encode('participant bytes')
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
    expect(exporter.state().status).toBe('backed-up')

    activeOpfs = new MemoryDir('private window')
    localStorage.clear()
    const result = await new FolderSyncService().importFromFolder()
    expect(result).toMatchObject({ copied: 1, conflicts: 0, invalid: 0 })
    expect(new TextDecoder().decode(await read(activeOpfs, sig))).toBe('participant bytes')
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
      .rejects.toThrow('no sealed, complete, verified hard-copy snapshots')
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
