import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { ensureInstall } from './ensure-install'

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
    // Globals stubbed by one case must not decide the next one — __TAURI__
    // below flips the native branch on, and a leaked one would silently
    // exempt every later case from the browser gates it is asserting.
    vi.unstubAllGlobals()
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

    await ensureInstall()

    expect(store.initialize).toHaveBeenCalledOnce()
    expect(localStorage.getItem('hypercomb.installed')).toBeNull()
    expect(emit).toHaveBeenCalledWith('boot:status', {
      kind: 'install-needed',
      reason: 'no-source',
    })
  })

  // The browser gates return early, so the claim has to be normalized BEFORE
  // them: a `true` that survives tells shouldBootstrap and main.ts's first-run
  // path that this hive is installed while nothing is on disk.
  it('clears an installed claim when OPFS is unavailable', async () => {
    store.opfsAvailable = false
    localStorage.setItem('hypercomb.installed', 'true')

    await ensureInstall()

    expect(localStorage.getItem('hypercomb.installed')).toBeNull()
    expect(emit).toHaveBeenCalledWith('boot:status', {
      kind: 'install-needed',
      reason: 'no-storage',
    })
  })

  it('clears an installed claim when OPFS cannot be written (iOS 16.4–18.3)', async () => {
    vi.stubGlobal('FileSystemFileHandle', class FileSystemFileHandle {})
    localStorage.setItem('hypercomb.installed', 'true')

    await ensureInstall()

    expect(localStorage.getItem('hypercomb.installed')).toBeNull()
    expect(emit).toHaveBeenCalledWith('boot:status', {
      kind: 'install-needed',
      reason: 'no-writable',
    })
  })

  // THE NATIVE SHELL HAS NO OPFS TO BE TOO OLD FOR. WebKitGTK presents the
  // very shape the case above describes — FileSystemFileHandle without
  // createWritable — so the Linux client refused to unpack the content it
  // ships with and came up empty on every launch. Its hive is a real
  // directory reached over IPC and its writes never touch that prototype, so
  // the probe is asking about a backend it does not use. Reaching 'no-source'
  // is the point: it got to the real decision instead of refusing at the gate.
  it('does not apply the createWritable gate to the native shell', async () => {
    vi.stubGlobal('FileSystemFileHandle', class FileSystemFileHandle {})
    vi.stubGlobal('__TAURI__', { core: { invoke: vi.fn() } })
    localStorage.setItem('hypercomb.installed', 'true')

    await ensureInstall()

    expect(emit).not.toHaveBeenCalledWith('boot:status', {
      kind: 'install-needed',
      reason: 'no-writable',
    })
    expect(emit).toHaveBeenCalledWith('boot:status', {
      kind: 'install-needed',
      reason: 'no-source',
    })
  })
})
