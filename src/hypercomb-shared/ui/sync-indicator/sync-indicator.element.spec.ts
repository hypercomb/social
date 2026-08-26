import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import './sync-indicator.element'

describe('hc-sync-indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    EffectBus.clear()
    document.body.replaceChildren()
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.useRealTimers()
  })

  it('renders determinate sync progress and a readable completion flash', () => {
    const element = document.createElement('hc-sync-indicator')
    document.body.appendChild(element)
    expect(element.children).toHaveLength(0)

    EffectBus.emit('install:sync', { active: true, source: 'install', current: 2, total: 5 })
    expect(element.textContent).toContain('2 of 5 files · 3 left')
    expect(element.querySelector<HTMLElement>('.sync-fill')?.style.width).toBe('40%')

    EffectBus.emit('install:sync', { active: false, source: 'install' })
    expect(element.textContent).toContain('synchronized · 2 files')
    expect(element.querySelector('.sync-cell')?.classList.contains('done')).toBe(true)
    vi.advanceTimersByTime(3_500)
    expect(element.children).toHaveLength(0)
  })

  it('keeps overlapping lanes visible until the last lane finishes', () => {
    const element = document.createElement('hc-sync-indicator')
    document.body.appendChild(element)
    EffectBus.emit('install:sync', { active: true, source: 'install', current: 1, total: 2 })
    EffectBus.emit('install:sync', { active: true, source: 'resync' })
    EffectBus.emit('install:sync', { active: false, source: 'install' })
    expect(element.textContent).toContain('synchronizing…')
    expect(element.querySelector('.sync-cell')?.classList.contains('done')).toBe(false)

    EffectBus.emit('install:sync', { active: false, source: 'resync' })
    expect(element.textContent).toContain('synchronized · 1 file')
  })
})
