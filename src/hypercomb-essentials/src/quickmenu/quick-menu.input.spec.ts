// quick-menu.input.spec.ts — a finger's hold summons only over the hexagons.
//
//   · on the hive, a phone hold on a tile and let go opens that tile's screen,
//     and a hold off a tile raises the ring (it takes the gate)
//   · the SAME holds on another view laid over the hive do neither — the tile
//     hidden under the finger is not what the hand is holding, and the ring
//     must not paint hexagons over a page being read

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services: Record<string, unknown> = {}
;(window as unknown as { ioc: unknown }).ioc = {
  register: () => {},
  get: (key: string) => services[key],
  has: (key: string) => key in services,
  whenReady: () => {},
}

const root = { name: 'root', title: 'Root', contexts: ['*'], slots: [] }
let hiddenLabel: string | null = 'sunrise'
const gate = { lock: vi.fn(), unlock: vi.fn(), release: vi.fn(), locked: false, owner: null }
services['@diamondcoreprocessor.com/MobileMode'] = { active: true }
services['@diamondcoreprocessor.com/TileOverlayDrone'] = { labelAtClient: () => hiddenLabel }
services['@diamondcoreprocessor.com/InputGate'] = gate
services['@diamondcoreprocessor.com/InputModeStack'] = { push: vi.fn(), pop: vi.fn() }
services['@hypercomb.social/Lineage'] = { explorerSegments: () => ['honey-garden'] }
services['@diamondcoreprocessor.com/QuickMenuRegistry'] = {
  all: () => [root],
  forContext: () => root,
  byName: () => root,
  label: (slot: { label: string }) => slot.label,
}

const opened = vi.fn()
EffectBus.on('tile:view-open', opened)

const canvas = document.createElement('canvas')
const view = document.createElement('div')
document.body.append(canvas, view)
EffectBus.emit('render:host-ready', { canvas })

const { QuickMenuInput } = await import('./quick-menu.input.js')
new QuickMenuInput()

let nextId = 10
function hold(on: Element): void {
  const pointerId = nextId++
  const at = { pointerId, pointerType: 'touch', isPrimary: true, clientX: 120, clientY: 200, bubbles: true }
  on.dispatchEvent(new PointerEvent('pointerdown', at))
  vi.advanceTimersByTime(400)
  on.dispatchEvent(new PointerEvent('pointerup', at))
}

describe('a touch hold summons only over the hexagons', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    opened.mockClear()
    gate.lock.mockClear()
    hiddenLabel = 'sunrise'
  })
  afterEach(() => { vi.useRealTimers() })

  it('on the hive, holding a tile and letting go opens that tile', () => {
    hold(canvas)
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ label: 'sunrise' }))
  })

  it('on the hive, holding off a tile raises the ring', () => {
    hiddenLabel = null
    hold(canvas)
    expect(gate.lock).toHaveBeenCalledWith('quick-menu')
  })

  it('on another view, a hidden tile under the finger is never opened', () => {
    hold(view)
    expect(opened).not.toHaveBeenCalled()
    expect(gate.lock).not.toHaveBeenCalled()
  })

  it('on another view, off a tile, the ring never paints', () => {
    hiddenLabel = null
    hold(view)
    expect(gate.lock).not.toHaveBeenCalled()
    expect(document.documentElement.classList.contains('hc-quick-menu-active')).toBe(false)
  })
})
