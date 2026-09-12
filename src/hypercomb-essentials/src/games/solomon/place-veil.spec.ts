// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlaceVeil, VEIL_MS, VEIL_SWAP, VEIL_ZOOM, veilAlpha, veilBlock, veilGridPicture, veilScale } from './place-veil.js'

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

describe('the veil: the one way into any place', () => {
  it('takes about a second: the old place breaks up, the new one resolves, then the veil lifts', () => {
    expect(VEIL_MS).toBe(1000)
    expect(VEIL_SWAP).toBe(0.4)
    expect(veilBlock(0)).toBe(1)
    expect(veilBlock(0.39)).toBe(6)
    expect(veilBlock(0.41)).toBe(6)
    expect(veilBlock(0.81)).toBe(1)
    expect(veilBlock(1)).toBe(1)
    expect(veilAlpha(0)).toBe(1)
    expect(veilAlpha(0.82)).toBe(1)
    expect(veilAlpha(1)).toBe(0)
  })

  it('zooms into the entrance you took, then settles from the one you arrived by', () => {
    const { leave, arrive } = VEIL_ZOOM.in
    expect(veilScale(0, leave, arrive)).toBe(1)
    expect(veilScale(0.39, leave, arrive)).toBeGreaterThan(2.4)
    expect(veilScale(0.4, leave, arrive)).toBe(arrive)
    expect(veilScale(1, leave, arrive)).toBeCloseTo(1, 6)
    // Coming out, the world shrinks back into its entrance before the outer place pulls back.
    const out = VEIL_ZOOM.out
    expect(veilScale(0.39, out.leave, out.arrive)).toBeLessThan(0.5)
    expect(veilScale(0.55, out.leave, out.arrive)).toBeGreaterThan(1)
    expect(veilScale(0.55, out.leave, out.arrive)).toBeLessThan(out.arrive)
  })

  it('paints a block in the colour most of its cells wear, never their average', () => {
    const stone = [200, 200, 200] as const, air = [20, 40, 80] as const
    const picture = veilGridPicture(4, 4, (col, row) => (row === 0 || col === 0 ? stone : air))
    const filled: Array<[string, number, number]> = []
    const ctx = { fillStyle: '', fillRect: (x: number, y: number) => filled.push([String(ctx.fillStyle), x, y]) } as unknown as CanvasRenderingContext2D
    picture.paint(ctx, 2)
    expect(filled).toHaveLength(4)
    // Top-left block: three stone cells, one air cell — stone. Bottom-right: all air.
    expect(filled[0]![0]).toMatch(/^rgb\(2\d\d, 2\d\d, 2\d\d\)$/)
    expect(filled[3]![0]).toMatch(/^rgb\(\d\d?, \d\d, \d\d\)$/)
    // A tie (two and two) goes to the brighter colour.
    const tied = veilGridPicture(2, 2, col => (col === 0 ? stone : air))
    filled.length = 0
    tied.paint(ctx, 2)
    expect(filled[0]![0]).toMatch(/^rgb\(2\d\d/)
  })

  it('without a canvas, or under reduced motion, the swap simply happens', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const host = document.createElement('div')
    document.body.append(host)
    const veil = new PlaceVeil(host)
    expect(host.querySelector('canvas.sol-veil')).not.toBeNull()
    const order: string[] = []
    const leg = { element: host, picture: null, origin: [0.5, 0.5] as const, scale: 2 }
    veil.play({ leave: leg, arrive: leg, onSwap: () => order.push('swap'), onDone: () => order.push('done') })
    expect(order).toEqual(['swap', 'done'])
    expect(veil.playing).toBe(false)
    expect(host.style.transform).toBe('')
    veil.dispose()
    expect(host.querySelector('canvas.sol-veil')).toBeNull()
  })
})
