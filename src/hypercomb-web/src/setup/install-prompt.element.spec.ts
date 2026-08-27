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
})
