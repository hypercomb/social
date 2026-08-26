import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import './mesh-header.element'

describe('hc-mesh-header', () => {
  beforeEach(() => {
    EffectBus.clear()
    localStorage.clear()
    document.body.replaceChildren()
  })

  afterEach(() => document.body.replaceChildren())

  it('owns the safe private, review and host cycle', () => {
    const opened = vi.fn()
    EffectBus.on('mesh:open-modal', opened)
    const element = document.createElement('hc-mesh-header')
    document.body.appendChild(element)
    const click = (): void => element.querySelector<HTMLButtonElement>('button')!.click()
    const glyph = (): string => element.querySelector('.mat-sym')?.textContent ?? ''

    expect(glyph()).toBe('lock')
    expect(localStorage.getItem('hc:world-mode')).toBe('0')
    click()
    expect(glyph()).toBe('public')
    expect(localStorage.getItem('hc:world-mode')).toBe('1')
    click()
    expect(glyph()).toBe('hub')
    expect(opened).toHaveBeenCalledWith({ join: true })

    EffectBus.emit('mesh:modal-open', { open: false, cancelled: true })
    expect(glyph()).toBe('lock')
    expect(localStorage.getItem('hc:world-mode')).toBe('0')
  })

  it('renders membership from the bus and leaves through the runtime command', () => {
    const invoked = vi.fn()
    EffectBus.on('keymap:invoke', invoked)
    EffectBus.emit('mesh:public-changed', { public: true })
    const element = document.createElement('hc-mesh-header')
    document.body.appendChild(element)

    expect(element.querySelector('.mat-sym')?.textContent).toBe('groups')
    element.querySelector<HTMLButtonElement>('button')!.click()
    expect(invoked).toHaveBeenCalledWith({ cmd: 'mesh.togglePublic' })
  })
})
