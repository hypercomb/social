import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import './upgrade-indicator.element'

describe('hc-upgrade-indicator', () => {
  beforeEach(() => {
    EffectBus.clear()
    localStorage.clear()
    sessionStorage.clear()
    document.body.replaceChildren()
  })

  afterEach(() => document.body.replaceChildren())

  it('expands an announced update and dispatches the silent adoption contract', () => {
    const element = document.createElement('hc-upgrade-indicator')
    document.body.appendChild(element)
    EffectBus.emit('update:available', {
      available: true,
      newCount: 3,
      packageSig: 'ABC123',
      newBees: ['one', 'two'],
      previous: 'old',
      label: 'Summer build',
    })

    expect(element.textContent).toContain('New features available')
    expect(element.querySelector('.upgrade-count')?.textContent).toBe('3')
    element.querySelector<HTMLButtonElement>('.status-button')!.click()
    const input = element.querySelector<HTMLInputElement>('input')!
    input.value = 'My restore point'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    const applied = vi.fn()
    window.addEventListener('hypercomb:apply-update', applied, { once: true })
    element.querySelector<HTMLButtonElement>('.upgrade-act.adopt')!.click()
    const detail = (applied.mock.calls[0][0] as CustomEvent).detail
    expect(detail).toEqual({
      restorePointName: 'My restore point',
      packageSig: 'abc123',
      newBees: ['one', 'two'],
      previous: 'old',
    })
  })

  it('routes review to the installer without applying the update', () => {
    const element = document.createElement('hc-upgrade-indicator')
    document.body.appendChild(element)
    EffectBus.emit('update:available', { available: true, packageSig: 'bee', newBees: ['new'] })
    element.querySelector<HTMLButtonElement>('.status-button')!.click()

    const opened = vi.fn()
    window.addEventListener('portal:open', opened, { once: true })
    element.querySelector<HTMLButtonElement>('.upgrade-act.review')!.click()
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
      target: 'dcp',
      upgrade: { packageSig: 'bee', newBees: ['new'], previous: null },
    })
  })
})
