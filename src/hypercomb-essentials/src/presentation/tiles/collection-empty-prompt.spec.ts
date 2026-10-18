// presentation/tiles/collection-empty-prompt.spec.ts — AN EMPTY LAYER OFFERS
// THE BEEHAVIORS PANEL, IT NEVER RAISES IT.
//
// A window opens only when the participant asks for that window. Arriving on
// an empty layer used to send `features:context-open` by itself, so the
// Beehaviors panel docked over every empty layer anyone walked into. Now the
// empty card shows, and its Beehaviors button is the door: the same
// `features:context-open` the top rail's switch sends, sent only on a click.

import { beforeAll, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const segments: string[] = ['garden', 'beds']
const lineage = Object.assign(new EventTarget(), { explorerSegments: () => segments })
const services = new Map<string, unknown>([['@hypercomb.social/Lineage', lineage]])
;(window as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { services.set(key, value) },
}

const contextOpens: unknown[] = []
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0))
}

beforeAll(async () => {
  await import('./collection-empty-prompt.drone.js')
  EffectBus.on('features:context-open', p => { contextOpens.push(p) })
  contextOpens.length = 0          // nothing stored may count as this layer's ask
})

describe('an empty layer and the Beehaviors panel', () => {
  it('a settled-empty layer shows the empty card and never raises the panel', async () => {
    EffectBus.emit('render:cell-count', { count: 0, settled: true })
    await settle()
    expect(document.getElementById('hc-collection-empty-prompt')).not.toBeNull()
    expect(contextOpens).toEqual([])

    // A second reconcile over the same empty layer (a synchronize) stays quiet too.
    window.dispatchEvent(new Event('synchronize'))
    await settle()
    expect(contextOpens).toEqual([])
  })

  it('the card\'s Beehaviors button is the door — one click, one request', async () => {
    const door = document.querySelector<HTMLButtonElement>('#hc-collection-empty-prompt [data-role="behaviors"]')
    expect(door).not.toBeNull()
    door!.click()
    expect(contextOpens).toHaveLength(1)
    // The door is not the card's "Add a tile" target: the card stays up.
    expect(document.getElementById('hc-collection-empty-prompt')).not.toBeNull()
  })
})
