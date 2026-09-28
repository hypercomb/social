// tile-hover.spec.ts — THE TILE UNDER THE POINTER, on its own. A hidden name
// comes back only for the hovered tile and goes again when it leaves; the
// band holds its menu's rows only under the tile they were counted for; the
// shade lifts on the entered tile after the left one is put back; and a torn
// down mesh forgets both the reveal and the row count's owner.
import { describe, expect, it } from 'vitest'

import { TileHover, type HoverHost } from './tile-hover.js'

const INDEX: Record<string, number> = { garden: 0, kitchen: 1, library: 2 }
const PICTURE_ONLY = new Set(['kitchen', 'library'])

const hostWith = (over: Partial<HoverHost> = {}) => {
  const calls = { hovered: [] as number[], rows: [] as number[], names: [] as string[][], shades: [] as (string | null)[] }
  const host: HoverHost & { calls: typeof calls } = {
    calls,
    shader: () => ({ setHoveredIndex: i => { calls.hovered.push(i) }, setBandRows: r => { calls.rows.push(r) } }),
    indexOf: label => INDEX[label],
    hasTile: label => label in INDEX,
    hidesBehindPicture: label => PICTURE_ONLY.has(label),
    repaintNames: labels => { calls.names.push(labels) },
    paintShade: label => { calls.shades.push(label) },
    ...over,
  }
  return host
}

describe('the hover', () => {
  it('reveals a hidden name only while hovered, and repaints only the flips', () => {
    const host = hostWith()
    const hover = new TileHover(host)
    hover.apply('garden')
    expect(host.calls.names).toEqual([])
    hover.apply('kitchen')
    expect(host.calls.names.at(-1)).toEqual(['kitchen'])
    hover.apply('library')
    expect(host.calls.names.at(-1)).toEqual(['kitchen', 'library'])
    hover.apply(null)
    expect(host.calls.names.at(-1)).toEqual(['library'])
    expect(hover.reveal).toBe(null)
    expect(host.calls.hovered).toEqual([0, 1, 2, -1])
  })

  it('holds the menu\'s rows only under the tile they were counted for', () => {
    const host = hostWith()
    const hover = new TileHover(host)
    hover.bandRows('kitchen', 2)
    hover.apply('kitchen')
    expect(host.calls.rows.at(-1)).toBe(2)
    hover.apply('garden')
    expect(host.calls.rows.at(-1)).toBe(1)
    hover.bandRows('garden', 0)
    hover.apply('garden')
    expect(host.calls.rows.at(-1)).toBe(1)
  })

  it('puts the left tile\'s shade back before lifting the entered one', () => {
    const host = hostWith()
    const hover = new TileHover(host)
    hover.apply('garden')
    hover.apply('kitchen')
    expect(host.calls.shades).toEqual([null, 'garden', 'garden', 'kitchen'])
    expect(hover.opaque).toBe('kitchen')
    hover.apply('kitchen')
    expect(host.calls.shades).toHaveLength(4)
    hover.apply('elsewhere')
    expect(hover.opaque).toBe(null)
    expect(host.calls.shades.slice(-2)).toEqual(['kitchen', null])
  })

  it('a torn down mesh forgets the reveal and the rows\' owner', () => {
    const host = hostWith()
    const hover = new TileHover(host)
    hover.bandRows('kitchen', 3)
    hover.apply('kitchen')
    hover.forget()
    expect(hover.reveal).toBe(null)
    // A same-named tile on the next layer does not inherit the rows or re-hide.
    const repaints = host.calls.names.length
    hover.apply('kitchen')
    expect(host.calls.rows.at(-1)).toBe(1)
    expect(host.calls.names.length).toBe(repaints + 1)
  })

  it('without a shader it still tracks the reveal but lights nothing', () => {
    const host = hostWith({ shader: () => null })
    const hover = new TileHover(host)
    hover.apply('kitchen')
    expect(hover.reveal).toBe('kitchen')
    expect(hover.opaque).toBe(null)
    expect(host.calls.shades).toEqual([])
  })
})
