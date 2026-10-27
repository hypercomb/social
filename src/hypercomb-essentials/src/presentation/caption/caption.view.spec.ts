// caption.view.spec.ts — the caption says one thing at a time, and each speaker
// owns only its own words.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

;(globalThis as unknown as { ioc: unknown }).ioc = { get: () => undefined, register: () => void 0, whenReady: () => void 0 }

await import('./caption.drone.js')

const box = (): HTMLElement => document.querySelector('.hc-caption') as HTMLElement
const title = (): string => document.querySelector('.hc-caption-title')?.textContent ?? ''
const text = (): string => document.querySelector('.hc-caption-text')?.textContent ?? ''

beforeEach(() => {
  EffectBus.clear()
  document.body.innerHTML = ''
  document.body.appendChild(document.createElement('hc-caption'))
})

describe('the caption', () => {
  it('is hidden until something speaks', () => {
    expect(box().hidden).toBe(true)
  })

  it('shows a title and text, and clears them', () => {
    EffectBus.emit('caption:show', { source: 'icon-hint', title: 'Copy', text: 'Copies the tile' })
    expect(box().hidden).toBe(false)
    expect(title()).toBe('Copy')
    expect(text()).toBe('Copies the tile')
    EffectBus.emit('caption:clear', { source: 'icon-hint' })
    expect(box().hidden).toBe(true)
  })

  it('the newest speaker is shown, and clearing it gives the older one back', () => {
    EffectBus.emit('caption:show', { source: 'images', title: 'select image' })
    EffectBus.emit('caption:show', { source: 'icon-hint', title: 'Copy' })
    expect(title()).toBe('Copy')
    EffectBus.emit('caption:clear', { source: 'icon-hint' })
    expect(title()).toBe('select image')
    EffectBus.emit('caption:clear', { source: 'images' })
    expect(box().hidden).toBe(true)
  })

  it('draws words as text, never markup', () => {
    EffectBus.emit('caption:show', { source: 'a', title: '<img src=x onerror=alert(1)>' })
    expect(document.querySelector('.hc-caption img')).toBeNull()
    expect(title()).toBe('<img src=x onerror=alert(1)>')
  })

  it('a source repeating itself does not climb over a newer speaker', () => {
    EffectBus.emit('caption:show', { source: 'tile', title: 'howard' })
    EffectBus.emit('caption:show', { source: 'icon-hint', title: 'Copy' })
    EffectBus.emit('caption:show', { source: 'tile', title: 'howard' })
    expect(title()).toBe('Copy')
  })

  it('draws a source icon as a mask after the label, with the description last', () => {
    EffectBus.emit('caption:show', { source: 'icon-hint', title: 'Copy', text: 'Copies the tile', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>' })
    const kids = [...(box().children)].map(c => c.className)
    expect(kids).toEqual(['hc-caption-title', 'hc-caption-icon', 'hc-caption-text'])
    expect((document.querySelector('.hc-caption-icon') as HTMLElement).hidden).toBe(false)
    expect(document.querySelector('.hc-caption svg')).toBeNull()
  })

  it('a speaker with nothing to say is cleared, not shown empty', () => {
    EffectBus.emit('caption:show', { source: 'a', title: 'hello' })
    EffectBus.emit('caption:show', { source: 'a' })
    expect(box().hidden).toBe(true)
  })
})
