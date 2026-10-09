// page-cells.spec.ts — every view reads ONE answer to "what does this page
// show", the one show-cell publishes after every filter.

import { describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { onPageCellsChanged, pageCellsAt, pageKeyOf, whenPageCells } from './page-cells.js'

const render = (payload: Record<string, unknown>): void => { EffectBus.emit('render:cell-count', payload) }

describe('page cells', () => {
  it('keys a page the way show-cell does', () => {
    expect(pageKeyOf([])).toBe('/')
    expect(pageKeyOf(['revolucion', 'journal'])).toBe('/revolucion/journal')
  })

  it('answers the cells the page shows, each at its own path', () => {
    render({ locationKey: '/shop', labels: ['cigars', 'humidor'], flatPaths: {}, settled: true })
    expect(pageCellsAt(['shop'])).toEqual({
      cells: [
        { label: 'cigars', segments: ['shop', 'cigars'] },
        { label: 'humidor', segments: ['shop', 'humidor'] },
      ],
      narrowed: false,
    })
    expect(pageCellsAt(['elsewhere'])).toBeNull()
  })

  it('carries a flattened match to where it really lives', () => {
    render({
      locationKey: '/shop', labels: ['maduro'], narrowed: true, settled: true,
      flatPaths: { maduro: ['shop', 'cigars', 'wrappers', 'maduro'] },
    })
    expect(pageCellsAt(['shop'])).toEqual({
      cells: [{ label: 'maduro', segments: ['shop', 'cigars', 'wrappers', 'maduro'] }],
      narrowed: true,
    })
  })

  it('tells a filter that matched nothing from an empty branch', () => {
    render({ locationKey: '/shop', labels: [], narrowed: true, settled: true })
    expect(pageCellsAt(['shop'])).toEqual({ cells: [], narrowed: true })
  })

  it('ignores a render still streaming in', () => {
    render({ locationKey: '/shop', labels: ['a', 'b'], settled: true })
    render({ locationKey: '/shop', labels: ['a'], settled: false })
    expect(pageCellsAt(['shop'])?.cells.map(cell => cell.label)).toEqual(['a', 'b'])
  })

  it('tells views only when what the page shows changed', () => {
    render({ locationKey: '/quiet', labels: ['x'], settled: true })
    let calls = 0
    const off = onPageCellsChanged(() => { calls++ })
    render({ locationKey: '/quiet', labels: ['x'], settled: true })
    expect(calls).toBe(0)
    render({ locationKey: '/quiet', labels: ['x', 'y'], settled: true })
    expect(calls).toBe(1)
    render({ locationKey: '/quiet', labels: ['x', 'y'], narrowed: true, settled: true })
    expect(calls).toBe(2)
    off()
    render({ locationKey: '/quiet', labels: [], settled: true })
    expect(calls).toBe(2)
  })

  it('waits for the page to render, and gives up honestly', async () => {
    const pending = whenPageCells(['later'], 1000)
    render({ locationKey: '/later', labels: ['one'], settled: true })
    expect((await pending)?.cells).toEqual([{ label: 'one', segments: ['later', 'one'] }])
    expect(await whenPageCells(['never'], 10)).toBeNull()
  })
})
