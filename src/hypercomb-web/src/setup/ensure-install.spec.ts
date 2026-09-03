import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { checkForUpdate, ensureInstall } from './ensure-install'

const POOL_ADDRESS = 'f'.repeat(64)

vi.mock('@hypercomb/core', () => ({
  EffectBus: { emit: vi.fn() },
  SignatureStore: class SignatureStore {},
  // The pool address is DERIVED from the meaning, so the test derives it the
  // same way the code does — through this port, not by writing a hex down.
  registerPoolMeaning: async () => POOL_ADDRESS,
}))

vi.mock('@hypercomb/shared/core', () => ({
  Store: class Store {},
}))

// The DEEP specifier is a different module to vitest, and the mock above does
// not cover it: resolve-import-map imports `@hypercomb/shared/core/store`,
// whose module scope calls the `register` global that only ioc.web installs in
// a browser. Without this the whole spec file fails to load — a suite that
// reports "0 tests" rather than a failure, which is how it went unnoticed.
vi.mock('@hypercomb/shared/core/store', () => ({
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

// The shell's own `/content/` is a host like any other: it carries the
// `host:packages` pool at the derived address, and the head of that pool is
// the package this build ships. There is no manifest left to read, so the
// update check settles on the one thing that answers "is this the same tree" —
// the signature.
describe('checkForUpdate — the signature is the answer', () => {
  const INSTALLED = 'a'.repeat(64)
  const NEWER = 'd'.repeat(64)

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    emit.mockReset()
    localStorage.clear()
  })

  /** `/content/` laid out as a host: a directory listing, and the entry. */
  const bundledPool = async (packageSig: string, label = 'development') => {
    const pool = POOL_ADDRESS
    const routes: Record<string, string> = {
      [`/content/${pool}/`]: '00000000',
      [`/content/${pool}/00000000`]: `${packageSig}\n${label}`,
    }
    return vi.fn(async (url: string) => {
      const body = routes[String(url)]
      if (body === undefined) return { ok: false, status: 404, headers: new Headers() } as unknown as Response
      return { ok: true, status: 200, headers: new Headers(), text: async () => body } as unknown as Response
    })
  }

  const installed = (packageSig: string): void => {
    localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({
      version: 2, layers: [], bees: ['b'.repeat(64)], dependencies: [], source: 'bundled',
    }))
    localStorage.setItem('sentinel.sync-signature', packageSig)
  }

  it('offers nothing when the bundled signature is the one installed', async () => {
    installed(INSTALLED)
    vi.stubGlobal('fetch', await bundledPool(INSTALLED))

    await checkForUpdate()

    expect(emit).toHaveBeenCalledWith('update:available', expect.objectContaining({
      available: false,
      packageSig: INSTALLED,
    }))
  })

  it('reports an update when the bundled signature differs', async () => {
    installed(INSTALLED)
    vi.stubGlobal('fetch', await bundledPool(NEWER))

    await checkForUpdate()

    // No delta: the count was only ever available because a document
    // enumerated an inventory, and nothing does now.
    expect(emit).toHaveBeenCalledWith('update:available', expect.objectContaining({
      available: true,
      newCount: 0,
      newBees: [],
      packageSig: NEWER,
      label: 'development',
    }))
  })

  it('stays silent for an install the bundle is not the authority for', async () => {
    // A host-sourced install surfaces its own updates; diffing it against the
    // shell's bundle is what used to raise phantom "New features".
    localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({
      version: 2, layers: [], bees: ['b'.repeat(64)], dependencies: [], source: 'sentinel',
    }))
    localStorage.setItem('sentinel.sync-signature', INSTALLED)
    vi.stubGlobal('fetch', await bundledPool(NEWER))

    await checkForUpdate()

    expect(emit).toHaveBeenCalledWith('update:available', expect.objectContaining({ available: false }))
  })
})
