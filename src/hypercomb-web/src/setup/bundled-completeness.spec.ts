// bundled-completeness.spec.ts — COMPLETE OR ABSENT on the boot path.
//
// install-by-replication step 4: the boot gate reads the CLOSURE RESULT, not
// the individual files. Before this, installFromBundled warned about a partial
// install and then set `hypercomb.installed = 'true'` anyway, and
// upgradeFromBundled returned `true` unconditionally — so an incomplete tree
// activated and main.ts reloaded into a hive with bees missing. The failure
// was silent: every step "succeeded".
//
// These pin the two halves of the gate: a package that does not fully resolve
// never activates, and one that does, does.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveInventory = vi.fn()
const isComplete = vi.fn()
const validateSealedPackage = vi.fn()

vi.mock('@hypercomb/core', () => ({
  EffectBus: { emit: vi.fn() },
  SignatureStore: class SignatureStore {
    trustAll(): void { /* no-op */ }
    toJSON(): unknown { return {} }
  },
}))

vi.mock('@hypercomb/shared/core', () => ({
  Store: class Store {
    static BEES_MEANING = 'bees'
    static DEPENDENCIES_MEANING = 'dependencies'
    static poolSignature = async (): Promise<string> => 'a'.repeat(64)
  },
  resolveInventory: (...args: unknown[]) => resolveInventory(...args),
  isComplete: (...args: unknown[]) => isComplete(...args),
  validateSealedPackage: (...args: unknown[]) => validateSealedPackage(...args),
}))

vi.mock('@hypercomb/shared/ui/features-viewer/behavior-enablement', () => ({
  seedDarkOnFreshInstall: vi.fn(),
}))

const PACKAGE_SIG = 'b'.repeat(64)
const BEE_SIG = 'c'.repeat(64)

const emptyDir = {
  getFileHandle: vi.fn(async () => { throw new Error('absent') }),
  getDirectoryHandle: vi.fn(async () => emptyDir),
  removeEntry: vi.fn(async () => undefined),
  entries: () => (async function* () { /* empty */ })(),
}

describe('bundled package completeness gate', () => {
  const sigStore = { trustAll: vi.fn(), toJSON: () => ({}) }
  const store = {
    initialize: vi.fn(async () => undefined),
    opfsAvailable: true,
    hypercombRoot: emptyDir,
    bees: emptyDir,
    dependencies: emptyDir,
    layers: undefined,
    legacyBees: undefined,
    legacyDependencies: undefined,
    legacyHive: undefined,
    legacyHypercombIo: undefined,
  }

  beforeEach(() => {
    localStorage.clear()
    resolveInventory.mockReset()
    isComplete.mockReset()
    validateSealedPackage.mockReset().mockReturnValue({ valid: true, errors: [] })
    vi.stubGlobal('register', vi.fn())
    vi.stubGlobal('get', vi.fn((key: string) =>
      key === '@hypercomb/SignatureStore' ? sigStore : store))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('manifest.json')) {
        return {
          ok: true,
          json: async () => ({ packages: { [PACKAGE_SIG]: { bees: [BEE_SIG], dependencies: [], layers: [PACKAGE_SIG] } } }),
        }
      }
      return { ok: false }
    }))
  })

  it('does NOT activate a package that did not fully resolve', async () => {
    // One hole is enough: the tree is not whole, so it is not installed.
    resolveInventory.mockResolvedValue({
      root: PACKAGE_SIG, total: 1, present: 0, fetched: 0,
      held: [], holes: [BEE_SIG], refused: [], limited: false,
    })
    isComplete.mockReturnValue(false)

    const { upgradeFromBundled } = await import('./ensure-install')
    const ok = await upgradeFromBundled()

    expect(ok).toBe(false)
    expect(localStorage.getItem('hypercomb.installed')).toBeNull()
  })

  it('activates only when every declared set resolved completely', async () => {
    resolveInventory.mockResolvedValue({
      root: PACKAGE_SIG, total: 1, present: 0, fetched: 1,
      held: [BEE_SIG], holes: [], refused: [], limited: false,
    })
    isComplete.mockReturnValue(true)

    const { upgradeFromBundled } = await import('./ensure-install')
    const ok = await upgradeFromBundled()

    expect(ok).toBe(true)
    expect(localStorage.getItem('hypercomb.installed')).toBe('true')
  })

  it('refuses a package whose record is not sealed — nothing outside it is a candidate', async () => {
    validateSealedPackage.mockReturnValue({ valid: false, errors: ['package root signature is not declared in layers'] })

    const { upgradeFromBundled } = await import('./ensure-install')
    const ok = await upgradeFromBundled()

    expect(ok).toBe(false)
    expect(resolveInventory).not.toHaveBeenCalled()
    expect(localStorage.getItem('hypercomb.installed')).toBeNull()
  })
})
