// touch-move.input.spec.ts — only a press that landed on the hive moves a tile.
//
// The canvas fills the screen even while another view covers it, so a hold
// then a pull on that view used to pick up the hidden tile underneath.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const services: Record<string, unknown> = {}
;(window as unknown as { ioc: unknown }).ioc = {
  register: () => {},
  get: (key: string) => services[key],
  has: (key: string) => key in services,
  whenReady: () => {},
}
services['@diamondcoreprocessor.com/InputGate'] = {
  owner: 'touch-move',
  claim: () => true,
  release: () => {},
}
services['@diamondcoreprocessor.com/HexDetector'] = { pixelToAxial: () => ({ q: 0, r: 0 }) }

const canvas = document.createElement('canvas')
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 800, width: 400, height: 800 }) as DOMRect
const view = document.createElement('div')
document.body.append(canvas, view)

const drone = { beginMove: vi.fn(() => true), updateMove: vi.fn(), commitMoveAt: vi.fn(), cancelMove: vi.fn() }

const { TouchMoveInput } = await import('./touch-move.input.js')
new TouchMoveInput().attach(drone as never, {
  canvas,
  container: { toLocal: (p: { x: number; y: number }) => p },
  renderer: { screen: { width: 400, height: 800 } },
  getMeshOffset: () => ({ x: 0, y: 0 }),
})

let nextId = 10
function holdAndPull(on: Element): void {
  const pointerId = nextId++
  const at = { pointerId, pointerType: 'touch', isPrimary: true, clientX: 120, clientY: 200, bubbles: true }
  on.dispatchEvent(new PointerEvent('pointerdown', at))
  vi.advanceTimersByTime(350)
  on.dispatchEvent(new PointerEvent('pointermove', { ...at, clientY: 260 }))
  on.dispatchEvent(new PointerEvent('pointerup', { ...at, clientY: 260 }))
}

describe('drag-to-move starts only on the hive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    drone.beginMove.mockClear()
  })

  it('a hold and pull on the hive picks the tile up', () => {
    holdAndPull(canvas)
    expect(drone.beginMove).toHaveBeenCalled()
  })

  it('a hold and pull on another view leaves the hidden tile alone', () => {
    holdAndPull(view)
    expect(drone.beginMove).not.toHaveBeenCalled()
  })
})
