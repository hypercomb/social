import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { lazyWindow } from './lazy-window.js'

/** A window as the real ones are made: it subscribes to its open effect in its
 *  constructor and every press it hears toggles it. */
const door = (effect: string) => {
  const made: { open: boolean, heard: unknown[] }[] = []
  class View {
    open = false
    heard: unknown[] = []
    constructor() {
      made.push(this)
      EffectBus.on(effect, payload => { this.heard.push(payload); this.open = !this.open })
    }
    close(): void { this.open = false }
  }
  lazyWindow({ effect, place: () => {}, load: async () => View, what: 'test window', tag: 'test' })
  return made
}

const settled = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('a window that arrives with its first open', () => {
  beforeEach(() => EffectBus.clear())

  it('opens on a first press the bus replays', async () => {
    const made = door('test:open')
    EffectBus.emit('test:open', { tab: 'api' })
    await settled()
    expect(made).toHaveLength(1)
    expect(made[0].open).toBe(true)
    expect(made[0].heard).toEqual([{ tab: 'api' }])
  })

  it('opens on a first press the bus does not replay, carrying what it said', async () => {
    const made = door('test:open')
    EffectBus.emitTransient('test:open', { tab: 'api' })
    await settled()
    expect(made).toHaveLength(1)
    expect(made[0].open).toBe(true)
    expect(made[0].heard).toEqual([{ tab: 'api' }])
  })

  it('ends closed after two presses while it loads, either way sent', async () => {
    const kept = door('test:open')
    EffectBus.emit('test:open', {})
    EffectBus.emit('test:open', {})
    await settled()
    expect(kept[0].open).toBe(false)

    EffectBus.clear()
    const passing = door('test:open')
    EffectBus.emitTransient('test:open', {})
    EffectBus.emitTransient('test:open', {})
    await settled()
    expect(passing[0].open).toBe(false)
    expect(passing[0].heard).toEqual([])
  })

  it('answers each later press once', async () => {
    const made = door('test:open')
    EffectBus.emitTransient('test:open', {})
    await settled()
    EffectBus.emitTransient('test:open', {})
    expect(made).toHaveLength(1)
    expect(made[0].open).toBe(false)
    expect(made[0].heard).toHaveLength(2)
  })
})
