import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import type { BootStatus } from './ensure-install'

const values = new Map<string, unknown>()

beforeAll(async () => {
  const getValue = (key: string): unknown => values.get(key)
  const registerValue = (key: string, value: unknown): void => { values.set(key, value) }
  Object.assign(globalThis, { get: getValue, register: registerValue })
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: getValue,
    register: registerValue,
    whenReady: () => {},
    onRegister: () => () => {},
  }
  await import('./install-prompt.element')
})

describe('hc-install-prompt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    EffectBus.clear()
    localStorage.clear()
    sessionStorage.clear()
    document.body.replaceChildren()
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.useRealTimers()
  })

  const mount = (): HTMLElement => {
    const element = document.createElement('hc-install-prompt')
    document.body.appendChild(element)
    return element
  }

  it('renders replayed install state and dispatches the start contract', () => {
    EffectBus.emit<BootStatus>('boot:status', {
      kind: 'install-needed',
      reason: 'no-sentinel',
    })
    const element = mount()

    expect(element.querySelector('[role="dialog"]')).not.toBeNull()
    expect(element.textContent).toContain('Welcome to Hypercomb')
    expect(element.querySelector<HTMLButtonElement>('.install-cta')?.textContent).toBe('Start')

    const started = vi.fn()
    window.addEventListener('hypercomb:start-install', started, { once: true })
    element.querySelector<HTMLButtonElement>('.install-cta')!.click()
    expect(started).toHaveBeenCalledOnce()
    expect(element.querySelector<HTMLButtonElement>('.install-cta')?.disabled).toBe(true)
    expect(element.textContent).toContain('Starting…')

    EffectBus.emit('install:sync', {
      active: true,
      source: 'install',
      phase: 'dependencies',
      current: 2,
      total: 5,
    })
    expect(element.textContent).toContain('install · dependencies 2/5')
  })

  it('replaces Start with the correct storage explanation', () => {
    const element = mount()
    EffectBus.emit<BootStatus>('boot:status', {
      kind: 'install-needed',
      reason: 'no-storage',
    })
    expect(element.querySelector('.install-cta')).toBeNull()
    expect(element.textContent).toContain('persistent browser storage')

    EffectBus.emit<BootStatus>('boot:status', {
      kind: 'install-needed',
      reason: 'no-writable',
    })
    expect(element.textContent).toContain('cannot write to it')
  })

  it('gets out of the way while the installer portal is open', () => {
    const element = mount()
    EffectBus.emit<BootStatus>('boot:status', {
      kind: 'install-needed',
      reason: 'no-sentinel',
    })
    expect(element.querySelector('[role="dialog"]')).not.toBeNull()

    window.dispatchEvent(new CustomEvent('portal:open', { detail: { target: 'dcp' } }))
    expect(element.childElementCount).toBe(0)
    window.dispatchEvent(new CustomEvent('dcp:embed-closed'))
    expect(element.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('mirrors an upgrade restore point through an already-connected installer lineage', async () => {
    const { saveInstallRestorePoint } = await import('./install-prompt.element')
    const host = globalThis as typeof globalThis & {
      __sentinelBridge?: unknown
      __getSentinel?: unknown
    }
    const originalBridge = host.__sentinelBridge
    const originalGetSentinel = host.__getSentinel
    try {
      const saveBranch = vi.fn(async () => 'a'.repeat(64))
      host.__sentinelBridge = { saveBranch }
      host.__getSentinel = vi.fn(async () => null)

      await expect(saveInstallRestorePoint('Before update', 1_000)).resolves.toEqual({
        available: true,
        rootSig: 'a'.repeat(64),
      })
      expect(saveBranch).toHaveBeenCalledWith('Before update')
      expect(host.__getSentinel).not.toHaveBeenCalled()
    } finally {
      host.__sentinelBridge = originalBridge
      host.__getSentinel = originalGetSentinel
    }
  })

  it('reports an unavailable installer checkpoint without consulting hive services', async () => {
    const { saveInstallRestorePoint } = await import('./install-prompt.element')
    const host = globalThis as typeof globalThis & {
      __sentinelBridge?: unknown
      __getSentinel?: unknown
    }
    const originalBridge = host.__sentinelBridge
    const originalGetSentinel = host.__getSentinel
    try {
      host.__sentinelBridge = undefined
      host.__getSentinel = vi.fn(async () => null)
      await expect(saveInstallRestorePoint('Before update', 1_000)).resolves.toEqual({
        available: false,
        rootSig: null,
      })
    } finally {
      host.__sentinelBridge = originalBridge
      host.__getSentinel = originalGetSentinel
    }
  })

  it('saves a bootstrap-owned restore point when DCP is not connected', async () => {
    const {
      INSTALL_CHECKPOINT_PREFIX,
      restoreLocalInstallCheckpoint,
    } = await import('./install-checkpoint')
    const { saveInstallRestorePoint } = await import('./install-prompt.element')
    const host = globalThis as typeof globalThis & {
      __sentinelBridge?: unknown
      __getSentinel?: unknown
    }
    const originalBridge = host.__sentinelBridge
    const originalGetSentinel = host.__getSentinel
    try {
      const priorManifest = JSON.stringify({ version: 1, packageSig: '1'.repeat(64), bees: ['2'.repeat(64)], dependencies: [], layers: [] })
      localStorage.setItem('core-adapter.installed-manifest', priorManifest)
      localStorage.setItem('sentinel.sync-signature', '1'.repeat(64))
      localStorage.setItem('hypercomb.installed', 'true')
      host.__sentinelBridge = undefined
      host.__getSentinel = vi.fn(async () => null)

      const checkpoint = await saveInstallRestorePoint('Before update', 1_000)

      expect(checkpoint.available).toBe(true)
      expect(checkpoint.rootSig).toMatch(/^[a-f0-9]{64}$/)
      expect(host.__getSentinel).not.toHaveBeenCalled()
      expect(localStorage.getItem(`${INSTALL_CHECKPOINT_PREFIX}${checkpoint.rootSig}`)).toContain('Before update')

      localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({ version: 1, bees: ['3'.repeat(64)] }))
      localStorage.setItem('sentinel.sync-signature', '4'.repeat(64))
      await expect(restoreLocalInstallCheckpoint(checkpoint.rootSig!)).resolves.toBe(true)
      expect(localStorage.getItem('core-adapter.installed-manifest')).toBe(priorManifest)
      expect(localStorage.getItem('sentinel.sync-signature')).toBe('1'.repeat(64))
    } finally {
      host.__sentinelBridge = originalBridge
      host.__getSentinel = originalGetSentinel
    }
  })

  it('refuses a checkpoint whose immutable record was tampered with', async () => {
    const {
      INSTALL_CHECKPOINT_PREFIX,
      restoreLocalInstallCheckpoint,
      saveLocalInstallCheckpoint,
    } = await import('./install-checkpoint')
    localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({ version: 1, bees: ['2'.repeat(64)] }))
    const sig = await saveLocalInstallCheckpoint('Before update')
    expect(sig).toMatch(/^[a-f0-9]{64}$/)
    localStorage.setItem(`${INSTALL_CHECKPOINT_PREFIX}${sig}`, '{"tampered":true}')
    await expect(restoreLocalInstallCheckpoint(sig!)).resolves.toBe(false)
  })
})
