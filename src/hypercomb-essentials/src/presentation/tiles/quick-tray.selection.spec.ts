// @vitest-environment jsdom
// quick-tray.selection.spec.ts — the selection shelf, as it is RENDERED. Two
// or more selected tiles take the shelf's band; the shelf's own rows wait,
// untouched, and come back when the selection drops below two. Driven by the
// real SelectionService, so `replace` is the one the drones call.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { QuickTrayElement, defineQuickTray } from './quick-tray.element'
import { SelectionService } from '../../selection/selection.service'

const SELECTION_KEY = '@diamondcoreprocessor.com/SelectionService'

// Frames are held and run by hand, so a spec can say what a burst looks like
// before the frame and after it.
let frames: Array<FrameRequestCallback | null> = []
const flush = (): void => {
  const due = frames
  frames = []
  for (const cb of due) cb?.(0)
}

const labels = (tray: QuickTrayElement, selector = '.row .label'): string[] =>
  [...(tray.shadowRoot?.querySelectorAll(selector) ?? [])].map(e => e.textContent ?? '')

const said = (): { entries: { label: string }[]; folded: boolean } => {
  let last: { entries: { label: string }[]; folded: boolean } | undefined
  EffectBus.on<{ entries: { label: string }[]; folded: boolean }>('shelf:changed', p => { last = p })()
  return last!
}

let tray: QuickTrayElement
let selection: SelectionService

const mount = (): QuickTrayElement => {
  const fresh = document.createElement('hc-quick-tray') as QuickTrayElement
  document.body.appendChild(fresh)
  return fresh
}

beforeAll(() => { defineQuickTray() })

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { if (id > 0) frames[id - 1] = null })
  EffectBus.emit('images:queue', { segments: [], labels: [], done: [], current: null })
  document.body.innerHTML = ''
  selection = new SelectionService()
  ;(globalThis as { ioc?: unknown }).ioc = { get: (k: string) => (k === SELECTION_KEY ? selection : undefined) }
  tray = mount()
  tray.take([
    { label: 'held-one', sourceSegments: ['page'] },
    { label: 'held-two', sourceSegments: [] },
  ])
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('the selection shelf', () => {
  it('does not come up for a single tile', () => {
    selection.add('alpha')
    flush()
    expect(tray.shadowRoot?.querySelector('.shelf.picks')).toBeNull()
    expect(labels(tray)).toEqual(['held-one', 'held-two'])
  })

  it('takes the band at two, listing the selection in order with the count', () => {
    selection.add('alpha'); selection.add('beta')
    flush()
    expect(tray.shadowRoot?.querySelector('.shelf.picks')).not.toBeNull()
    expect(labels(tray)).toEqual(['alpha', 'beta'])
    expect(tray.shadowRoot?.querySelector('.legend .count')?.textContent).toBe('2')
    // Never both at once, and no fold: it is what you are about to act on.
    expect(tray.shadowRoot?.querySelectorAll('.shelf')).toHaveLength(1)
    expect(tray.shadowRoot?.querySelector('.fold')).toBeNull()
  })

  it('shows whatever the shelf held, and however it was folded', () => {
    ;(tray.shadowRoot?.querySelector('.fold') as HTMLElement).click()
    selection.replace(['alpha', 'beta', 'gamma'])
    flush()
    expect(labels(tray)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('reads a service that registers after the shelf mounts', () => {
    document.body.innerHTML = ''
    let ready: ((v: unknown) => void) | undefined
    ;(globalThis as { ioc?: unknown }).ioc = {
      get: () => undefined,
      whenReady: (k: string, cb: (v: unknown) => void) => { if (k === SELECTION_KEY) ready = cb },
    }
    const late = mount()
    selection.replace(['alpha', 'beta'])
    ready?.(selection)
    expect(labels(late)).toEqual(['alpha', 'beta'])
  })
})

describe('the × on a selection row', () => {
  it('takes that tile out of the selection and nothing else', () => {
    selection.replace(['alpha', 'beta', 'gamma'])
    flush()
    ;(tray.shadowRoot?.querySelectorAll('.pick .remove')[1] as HTMLElement).click()
    expect([...selection.selected]).toEqual(['alpha', 'gamma'])
    flush()
    expect(labels(tray)).toEqual(['alpha', 'gamma'])
    expect(tray.entries.map(e => e.label)).toEqual(['held-one', 'held-two'])
  })

  it('hands the band back to the shelf, every row intact, below two', () => {
    selection.replace(['alpha', 'beta'])
    flush()
    ;(tray.shadowRoot?.querySelectorAll('.pick .remove')[0] as HTMLElement).click()
    flush()
    expect(tray.shadowRoot?.querySelector('.shelf.picks')).toBeNull()
    expect(labels(tray)).toEqual(['held-one', 'held-two'])
    expect(tray.shadowRoot?.querySelector('.fold')).not.toBeNull()
  })
})

describe('what the shelf says it holds', () => {
  it('never carries a selected tile on shelf:changed', () => {
    const heard: string[][] = []
    const off = EffectBus.on<{ entries: { label: string }[] }>('shelf:changed', p => { heard.push(p.entries.map(e => e.label)) })
    selection.replace(['alpha', 'beta', 'gamma'])
    flush()
    selection.remove('beta')
    flush()
    off()
    expect(said().entries.map(e => e.label)).toEqual(['held-one', 'held-two'])
    for (const entries of heard) expect(entries).toEqual(['held-one', 'held-two'])
  })

  it('says what it lists on selection-shelf:changed instead', () => {
    let last: { labels: string[]; shown: boolean } | undefined
    const off = EffectBus.on<{ labels: string[]; shown: boolean }>('selection-shelf:changed', p => { last = p })
    selection.replace(['alpha', 'beta'])
    flush()
    expect(last).toEqual({ labels: ['alpha', 'beta'], shown: true })
    selection.clear()
    flush()
    expect(last).toEqual({ labels: [], shown: false })
    off()
  })
})

describe('the image wall walking the selection', () => {
  it('ticks the tiles done and lights the one being chosen for', () => {
    selection.replace(['alpha', 'beta', 'gamma'])
    flush()
    EffectBus.emit('images:queue', { segments: [], labels: ['alpha', 'beta', 'gamma'], done: ['alpha'], current: 'beta' })
    expect(labels(tray, '.pick.done .label')).toEqual(['alpha'])
    expect(labels(tray, '.pick.current .label')).toEqual(['beta'])
    expect(tray.shadowRoot?.querySelectorAll('.pick .mark')).toHaveLength(1)
    EffectBus.emit('images:queue', { segments: [], labels: [], done: ['alpha', 'beta', 'gamma'], current: null })
    expect(tray.shadowRoot?.querySelectorAll('.pick.done, .pick.current')).toHaveLength(0)
  })
})

describe('the pictures on the selection rows', () => {
  // A hive with one picture per tile: the placement worker names a props
  // record, the props name the picture. `pictures` is what each tile wears now.
  const pictures = new Map<string, string>()
  let minted = 0
  const thumbs = (of: QuickTrayElement): string[] =>
    [...(of.shadowRoot?.querySelectorAll('.pick') ?? [])].map(row =>
      row.querySelector('img')?.getAttribute('src') ?? '⬢')
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }

  beforeEach(() => {
    pictures.clear(); minted = 0
    pictures.set('alpha', 'a'.repeat(64)); pictures.set('beta', 'b'.repeat(64))
    URL.createObjectURL = ((blob: { picture?: string }) => `blob:${blob.picture}#${++minted}`) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL
    // Blob-shaped records: only `text()` is read, and the picture's bytes are
    // never opened, so a plain object stands in for each.
    const store = {
      getResource: async (sig: string) => {
        if (sig.startsWith('props:')) {
          const label = sig.slice('props:'.length)
          const text = JSON.stringify({ small: { image: pictures.get(label) } })
          return { text: async () => text }
        }
        return { picture: sig.slice(0, 1) }
      },
    }
    const placement = { propsSigAt: async (segments: string[]) => `props:${segments[segments.length - 1]}` }
    ;(globalThis as { ioc?: unknown }).ioc = {
      get: (k: string) => k === SELECTION_KEY ? selection
        : k === '@hypercomb.social/Store' ? store
        : k === '@diamondcoreprocessor.com/ShelfPlacementWorker' ? placement
        : undefined,
    }
    document.body.innerHTML = ''
    tray = mount()
  })

  afterEach(() => {
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
  })

  it('shows the new picture when the wall saves one for a selected tile', async () => {
    selection.replace(['alpha', 'beta'])
    flush()
    await vi.waitFor(() => expect(thumbs(tray)).toEqual(['blob:a#1', 'blob:b#2']))
    // The wall chose a new picture for alpha and saved the tile.
    pictures.set('alpha', 'c'.repeat(64))
    EffectBus.emit('tile:saved', { cell: 'alpha', segments: [] })
    await vi.waitFor(() => expect(thumbs(tray)).toEqual(['blob:c#3', 'blob:b#2']))
  })

  it('loads its pictures again after a remount with the same selection', async () => {
    selection.replace(['alpha', 'beta'])
    flush()
    await vi.waitFor(() => expect(thumbs(tray)).toEqual(['blob:a#1', 'blob:b#2']))
    tray.remove()
    document.body.appendChild(tray)
    await vi.waitFor(() => expect(thumbs(tray)).toEqual(['blob:a#3', 'blob:b#4']))
  })

  it('takes back selection-shelf:changed when it leaves the page', () => {
    selection.replace(['alpha', 'beta'])
    flush()
    tray.remove()
    let last: { labels: string[]; shown: boolean } | undefined
    EffectBus.on<{ labels: string[]; shown: boolean }>('selection-shelf:changed', p => { last = p })()
    expect(last).toEqual({ labels: [], shown: false })
  })
})

describe('while the select is still in hand', () => {
  const key = (type: 'keydown' | 'keyup', k = 'Control'): void => { document.dispatchEvent(new KeyboardEvent(type, { key: k })) }
  const pointer = (type: string, buttons: number): void => {
    document.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, buttons }))
  }
  const up = (): boolean => tray.shadowRoot?.querySelector('.shelf.picks') !== null

  it('waits for Ctrl to come up before taking the band', () => {
    key('keydown')
    selection.replace(['alpha', 'beta'])
    flush()
    expect(up()).toBe(false)
    expect(labels(tray)).toEqual(['held-one', 'held-two'])
    key('keyup')
    expect(up()).toBe(true)
    expect(labels(tray)).toEqual(['alpha', 'beta'])
  })

  it('waits for the button to come up on a paint drag', () => {
    pointer('pointerdown', 1)
    selection.add('alpha'); selection.add('beta'); selection.add('gamma')
    flush()
    expect(up()).toBe(false)
    pointer('pointerup', 0)
    expect(up()).toBe(true)
    expect(labels(tray)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('shows the selection as it stood when the hand lifted, not when it pressed', () => {
    key('keydown')
    selection.replace(['alpha', 'beta'])
    flush()
    selection.add('gamma')
    flush()
    key('keyup')
    expect(labels(tray)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('still updates the rows of a band already taken', () => {
    selection.replace(['alpha', 'beta'])
    flush()
    key('keydown')
    selection.add('gamma')
    flush()
    expect(labels(tray)).toEqual(['alpha', 'beta', 'gamma'])
    key('keyup')
  })

  it('waits before handing the band back, too', () => {
    selection.replace(['alpha', 'beta'])
    flush()
    key('keydown')
    selection.remove('beta')
    flush()
    expect(up()).toBe(true)
    key('keyup')
    expect(up()).toBe(false)
    expect(labels(tray)).toEqual(['held-one', 'held-two'])
  })

  it('reads a swallowed release off the next move', () => {
    pointer('pointerdown', 1)
    selection.replace(['alpha', 'beta'])
    flush()
    expect(up()).toBe(false)
    pointer('pointermove', 0)
    expect(up()).toBe(true)
  })

  it('lets go when the window loses focus', () => {
    key('keydown')
    selection.replace(['alpha', 'beta'])
    flush()
    window.dispatchEvent(new Event('blur'))
    expect(up()).toBe(true)
  })
})

describe('a selection rebuilt in a burst', () => {
  it('never shows the shelf through the empty set it passes through', () => {
    selection.replace(['alpha', 'beta'])
    flush()
    const shown: boolean[] = []
    const off = EffectBus.on<{ shown: boolean }>('selection-shelf:changed', p => { shown.push(p.shown) })
    shown.length = 0   // the replayed last value is not part of the burst
    // The old drone sync: clear, then add back one by one, in one tick.
    selection.clear(); selection.add('alpha'); selection.add('beta'); selection.add('gamma')
    expect(tray.shadowRoot?.querySelector('.shelf.picks')).not.toBeNull()
    flush()
    off()
    expect(shown).toEqual([true])
    expect(labels(tray)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('replace announces the new set once', () => {
    selection.replace(['alpha', 'beta'])
    let changes = 0
    selection.addEventListener('change', () => { changes++ })
    selection.replace(['alpha', 'beta', 'gamma'])
    expect(changes).toBe(1)
    expect(selection.active).toBe('alpha')
  })
})
