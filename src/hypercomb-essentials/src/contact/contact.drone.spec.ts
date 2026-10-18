// contact/contact.drone.spec.ts — a window opens only from its own door.
//
// A body tap (`tile:action` open) pins a contact tile's card. A selection or
// modifier click (`tile:click`) does not, and neither does the `open` the bus
// replays when the drone starts listening. The pin itself goes out
// transient, so a late-mounted hover panel never re-pins an old card.

import { describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

vi.hoisted(() => {
  const service = { active: () => false, hasCards: (label: string) => label === 'ada' || label === 'old' }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => (key === '@diamondcoreprocessor.com/ContactService' ? service : undefined),
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

vi.mock('./contact-card.js', () => ({
  writeContact: vi.fn(),
  removeContact: vi.fn(),
  listContacts: vi.fn(async () => [{ sig: 'c'.repeat(64), payload: { name: 'Ada' } }]),
  CONTACTS_SLOT_DECLARATION: {},
}))
vi.mock('./contact.service.js', () => ({ ContactService: class {} }))

const { ContactDrone } = await import('./contact.drone.js')

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('contact card — pinned only by a body tap', () => {
  it('ignores the replayed open and a tile:click, pins on a live open, transiently', async () => {
    const pins: { label?: string }[] = []
    EffectBus.emit('tile:action', { action: 'open', label: 'old' })

    const drone = new ContactDrone()
    await (drone as unknown as { heartbeat: () => Promise<void> }).heartbeat()
    EffectBus.on<{ label?: string }>('contact:hover-pin', p => { pins.push(p) })
    await settle()
    expect(pins).toEqual([])

    EffectBus.emit('tile:click', { label: 'ada' })
    await settle()
    expect(pins).toEqual([])

    EffectBus.emit('tile:action', { action: 'open', label: 'ada' })
    await settle()
    expect(pins.map(p => p.label)).toEqual(['ada'])

    // Transient: a subscriber that arrives later hears no stored pin.
    const late: unknown[] = []
    EffectBus.on('contact:hover-pin', p => { late.push(p) })
    expect(late).toEqual([])
  })
})
