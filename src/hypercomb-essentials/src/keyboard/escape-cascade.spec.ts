// escape-cascade.spec.ts — ONE PRESS TAKES EVERYTHING; THE NEXT ONE, IF IT
// COMES STRAIGHT AWAY, GIVES IT ALL BACK.
//
//     press           → the tiles
//     press (at once) → everything back, exactly as it was
//     press           → the tiles again
//
// What these cover, in the order they matter:
//   · the sweep — one press clears the screen, however many surfaces were up
//   · the toggle — back, then away again, on the same key
//   · IMMEDIATELY, and only then: a press that comes late, or after anything
//     else at all, finds nothing to give back
//   · a press never costs you both a panel and a selection
//   · the memory is PLACED, and SPENT — one press back, not every press after

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

/** What the cascade resolves through IoC, swapped per test. */
const services: Record<string, unknown> = {}

/** Where the hive is standing. The memory is placed against this. */
let here: string[] = []

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => {},
  get: (key: string) => services[key],
  whenReady: () => {},
}

await import('./escape-cascade.js')

const escape = (): void => { EffectBus.emit('keymap:invoke', { cmd: 'global.escape' }) }

/** The facade's answer, standing in for the real surfaces: one call takes
 *  everything showing, and the way back reports whether it landed. */
const screenOf = (...ids: string[]) => {
  const showing = new Set(ids)
  return {
    showing,
    facade: {
      dismissFocused: (): boolean => false,
      putAwayAll: (): (() => boolean) | null => {
        if (!showing.size) return null
        const taken = [...showing]
        showing.clear()
        return (): boolean => {
          const back = taken.filter(id => !showing.has(id))
          for (const id of back) showing.add(id)
          return back.length > 0
        }
      },
      closeFocused: (): boolean => false,
    },
  }
}

/** A selection service with the four members the cascade asks for. */
const selectionOf = (...labels: string[]) => {
  const items = new Set(labels)
  return {
    items,
    service: {
      get count(): number { return items.size },
      get selected(): ReadonlySet<string> { return items },
      add: (label: string): void => { items.add(label) },
      clear: (): void => { items.clear() },
    },
  }
}

beforeEach(() => {
  vi.useRealTimers()
  for (const key of Object.keys(services)) delete services[key]
  here = []
  EffectBus.emit('editor:mode', { active: false })
  // A press with nothing up and nothing registered falls all the way through,
  // spending whatever the last test left in the slot.
  escape()
  services['@hypercomb.social/Lineage'] = { explorerSegments: (): readonly string[] => here }
})

describe('one press takes everything', () => {
  it('clears the screen however many surfaces were up', () => {
    const screen = screenOf('tutorials', 'palette', 'contact-card')
    services['@hypercomb.social/ToolWindows'] = screen.facade

    escape()

    expect([...screen.showing]).toEqual([])
  })

  it('gives all of it back on the next press, and takes it again on the one after', () => {
    const screen = screenOf('tutorials', 'palette')
    services['@hypercomb.social/ToolWindows'] = screen.facade

    escape()
    expect([...screen.showing]).toEqual([])

    escape()
    expect([...screen.showing].sort()).toEqual(['palette', 'tutorials'])

    escape()
    expect([...screen.showing]).toEqual([])
  })
})

describe('immediately after, and only then', () => {
  it('gives nothing back to a press that comes later', () => {
    vi.useFakeTimers()
    const screen = screenOf('tutorials')
    services['@hypercomb.social/ToolWindows'] = screen.facade

    escape()
    vi.advanceTimersByTime(3001)
    escape()

    expect([...screen.showing]).toEqual([])
  })

  it('still gives it back within the moment', () => {
    vi.useFakeTimers()
    const screen = screenOf('tutorials')
    services['@hypercomb.social/ToolWindows'] = screen.facade

    escape()
    vi.advanceTimersByTime(900)
    escape()

    expect([...screen.showing]).toEqual(['tutorials'])
  })

  it('gives nothing back once anything else has happened', () => {
    const screen = screenOf('tutorials')
    services['@hypercomb.social/ToolWindows'] = screen.facade

    escape()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    escape()

    expect([...screen.showing]).toEqual([])
  })

  it('is not ended by the Escape press that is asking for it back', () => {
    const screen = screenOf('tutorials')
    services['@hypercomb.social/ToolWindows'] = screen.facade

    escape()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    escape()

    expect([...screen.showing]).toEqual(['tutorials'])
  })
})

describe('a press never costs you both', () => {
  it('takes what is covering the hive and leaves the selection standing', () => {
    const screen = screenOf('tutorials')
    const { items, service } = selectionOf('alpha', 'beta')
    services['@hypercomb.social/ToolWindows'] = screen.facade
    services['@diamondcoreprocessor.com/SelectionService'] = service

    escape()

    expect([...screen.showing]).toEqual([])
    expect([...items]).toEqual(['alpha', 'beta'])
  })
})

describe('a selection Escape cleared', () => {
  it('comes back tile for tile', () => {
    const { items, service } = selectionOf('alpha', 'beta')
    services['@diamondcoreprocessor.com/SelectionService'] = service

    escape()
    expect([...items]).toEqual([])

    escape()
    expect([...items]).toEqual(['alpha', 'beta'])
  })

  it('is given back ONCE — the slot is spent, not sticky', () => {
    const { items, service } = selectionOf('alpha')
    services['@diamondcoreprocessor.com/SelectionService'] = service

    escape()             // cleared, remembered
    escape()             // back
    items.clear()        // cleared by something that is not this key
    escape()             // nothing above answers, and the slot is empty

    expect([...items]).toEqual([])
  })
})

describe('the memory is placed', () => {
  it('is dropped rather than replayed once the press lands on another page', () => {
    here = ['hive']
    const screen = screenOf('tutorials')
    services['@hypercomb.social/ToolWindows'] = screen.facade

    escape()
    here = ['hive', 'somewhere-else']
    escape()

    expect([...screen.showing]).toEqual([])
  })
})
