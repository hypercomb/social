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
    emit.mockReset()
    store.initialize.mockReset().mockResolvedValue(undefined)
    localStorage.clear()
    vi.stubGlobal('register', vi.fn())
    vi.stubGlobal('get', vi.fn(() => store))
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
})
