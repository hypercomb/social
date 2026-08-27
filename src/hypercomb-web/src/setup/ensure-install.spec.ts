import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { ensureInstall, resyncFromSentinel } from './ensure-install'

vi.mock('@hypercomb/core', () => ({
  EffectBus: { emit: vi.fn() },
  SignatureStore: class SignatureStore {},
}))

vi.mock('@hypercomb/shared/core', () => ({
  Store: class Store {},
}))

const emit = vi.mocked(EffectBus.emit)

describe('ensureInstall install-state validation', () => {
  const store = {
    initialize: vi.fn(async () => undefined),
    opfsAvailable: true,
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    emit.mockReset()
    store.initialize.mockReset().mockResolvedValue(undefined)
    store.opfsAvailable = true
    localStorage.clear()
    vi.stubGlobal('register', vi.fn())
    vi.stubGlobal('get', vi.fn(() => store))
    // The test environment has no OPFS at all, so ensureInstall's writability
    // gate would send every case down the 'no-writable' branch. Present a
    // modern browser by default; the gate cases below opt out explicitly.
    vi.stubGlobal('FileSystemFileHandle', class FileSystemFileHandle {
      async createWritable(): Promise<void> { /* modern browser */ }
    })
  })

  it('clears an installed claim when its required manifest is absent', async () => {
    localStorage.setItem('hypercomb.installed', 'true')

    await ensureInstall(null)

    expect(store.initialize).toHaveBeenCalledOnce()
    expect(localStorage.getItem('hypercomb.installed')).toBeNull()
    expect(emit).toHaveBeenCalledWith('boot:status', {
      kind: 'install-needed',
      reason: 'no-sentinel',
    })
  })

  // The browser gates return early, so the claim has to be normalized BEFORE
  // them: a `true` that survives tells main.ts's first-run path that this hive
  // is installed while nothing is on disk.
  it('clears an installed claim when OPFS is unavailable', async () => {
    store.opfsAvailable = false
    localStorage.setItem('hypercomb.installed', 'true')

    await ensureInstall(null)

    expect(localStorage.getItem('hypercomb.installed')).toBeNull()
    expect(emit).toHaveBeenCalledWith('boot:status', {
      kind: 'install-needed',
      reason: 'no-storage',
    })
  })

  it('clears an installed claim when OPFS cannot be written (iOS 16.4–18.3)', async () => {
    vi.stubGlobal('FileSystemFileHandle', class FileSystemFileHandle {})
    localStorage.setItem('hypercomb.installed', 'true')

    await ensureInstall(null)

    expect(localStorage.getItem('hypercomb.installed')).toBeNull()
    expect(emit).toHaveBeenCalledWith('boot:status', {
      kind: 'install-needed',
      reason: 'no-writable',
    })
  })
})

describe('resyncFromSentinel append-only heap', () => {
  const fakeDirectory = (name: string, initial: string[]) => {
    const files = new Set(initial)
    const removeEntry = vi.fn(async (entry: string) => { files.delete(entry) })
    return {
      name,
      files,
      removeEntry,
      async *entries() {
        for (const entry of files) yield [entry, { kind: 'file' }]
      },
    }
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    emit.mockReset()
    localStorage.clear()
  })

  it('advances the active manifest without deleting inactive signatures', async () => {
    const activeBee = 'a'.repeat(64)
    const oldBee = 'b'.repeat(64)
    const activeDependency = 'c'.repeat(64)
    const oldDependency = 'd'.repeat(64)
    const activeLayer = 'e'.repeat(64)
    const oldLayer = 'f'.repeat(64)

    const bees = fakeDirectory('bees-pool', [`${activeBee}.js`, `${oldBee}.js`])
    const dependencies = fakeDirectory('dependencies-pool', [`${activeDependency}.js`, `${oldDependency}.js`])
    const root = fakeDirectory('root', [activeLayer, oldLayer])
    const store = {
      opfsAvailable: true,
      bees,
      dependencies,
      hypercombRoot: root,
    }
    const signatureStore = { trustAll: vi.fn(), toJSON: vi.fn(() => []) }
    vi.stubGlobal('get', vi.fn((key: string) => key === '@hypercomb/SignatureStore' ? signatureStore : store))

    localStorage.setItem('sentinel.sync-signature', 'prior-sync')
    const sentinel = {
      sync: vi.fn(async () => ({
        syncSig: 'next-sync',
        enabledBees: [activeBee],
        enabledDeps: [activeDependency],
        enabledLayers: [activeLayer],
        beeDeps: {},
        files: [],
      })),
    }

    await resyncFromSentinel(sentinel as never)

    expect(bees.removeEntry).not.toHaveBeenCalled()
    expect(dependencies.removeEntry).not.toHaveBeenCalled()
    expect(root.removeEntry).not.toHaveBeenCalled()
    expect(bees.files).toContain(`${oldBee}.js`)
    expect(dependencies.files).toContain(`${oldDependency}.js`)
    expect(root.files).toContain(oldLayer)
    expect(localStorage.getItem('sentinel.sync-signature')).toBe('next-sync')
  })
})
