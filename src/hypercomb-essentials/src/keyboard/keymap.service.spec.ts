// keyboard/keymap.service.spec.ts
//
// The two things the keyboard desk asks of the keymap: a chosen press belongs to
// the participant alone, and a held map fires nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, type KeyBinding } from '@hypercomb/core'
import { USER_KEYMAP_LAYER } from './chord-match.js'
import { KeyMapService } from './keymap.service.js'

const press = (key: string, extra: KeyboardEventInit = {}): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }))
}

const fired = (): string[] => invoked.map(payload => payload.cmd)
let invoked: { cmd: string }[] = []
let off: (() => void) | undefined
// One service: each one listens on the window for good.
const service = new KeyMapService()

const chosen = (...bindings: KeyBinding[]): void => {
  service.addLayer({ id: USER_KEYMAP_LAYER, priority: 100, bindings })
}

beforeEach(() => {
  off?.()
  invoked = []
  service.removeLayer(USER_KEYMAP_LAYER)
  service.removeLayer('context')
  vi.restoreAllMocks()
  service.addLayer({
    id: 'test', priority: 20, bindings: [
      { cmd: 'test.loose', sequence: [[{ key: 'q' }]], description: 'Loose', category: 'Test' },
      { cmd: 'test.pierce', sequence: [[{ key: 'y', primary: true }]], pierce: true },
    ],
  })
  let live = false
  off = EffectBus.on<{ cmd: string }>('keymap:invoke', payload => { if (live) invoked.push(payload) })
  live = true
})

describe('a chosen press', () => {
  it('fires the chosen binding and not the looser default', () => {
    chosen({ cmd: 'mine', sequence: [[{ key: 'q', ctrl: true, shift: false, alt: false, meta: false }]] })
    press('q', { ctrlKey: true })
    expect(fired()).toEqual(['mine'])
  })

  it('leaves the default alone on every other press', () => {
    chosen({ cmd: 'mine', sequence: [[{ key: 'q', ctrl: true, shift: false, alt: false, meta: false }]] })
    press('q')
    expect(fired()).toEqual(['test.loose'])
  })

  it('an empty sequence takes a default off the keys', () => {
    chosen({ cmd: 'test.loose', sequence: [] })
    press('q')
    expect(fired()).toEqual([])
  })

  it('a record takes what it does not say from the layer beneath', () => {
    chosen({ cmd: 'test.loose', sequence: [[{ key: 'w' }]] })
    const merged = service.getEffective().find(binding => binding.cmd === 'test.loose')
    expect(merged).toMatchObject({ description: 'Loose', category: 'Test', sequence: [[{ key: 'w' }]] })
  })

  it('another layer never inherits this way', () => {
    service.addLayer({ id: 'context', priority: 30, bindings: [{ cmd: 'test.loose', sequence: [[{ key: 'w' }]] }] })
    expect(service.getEffective().find(binding => binding.cmd === 'test.loose')).not.toHaveProperty('description')
  })
})

describe('the hold', () => {
  it('fires nothing, pierce bindings included, until it is let go', () => {
    EffectBus.emit('keymap:hold', { reason: 'desk' })
    press('y', { ctrlKey: true })
    expect(fired()).toEqual([])
    EffectBus.emit('keymap:release', { reason: 'desk' })
    press('y', { ctrlKey: true })
    expect(fired()).toEqual(['test.pierce'])
  })

  it('suppression still lets a pierce binding through', () => {
    vi.spyOn(service, 'suppressed', 'get').mockReturnValue(true)
    press('y', { ctrlKey: true })
    expect(fired()).toEqual(['test.pierce'])
  })
})
