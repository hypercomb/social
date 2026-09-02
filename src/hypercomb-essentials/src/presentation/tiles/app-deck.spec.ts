// app-deck.spec.ts — the phone's plate language, pinned.
//
//   · a group spreads EVENLY over the pages it needs (9 → 5 + 4, never 8 + 1)
//   · a page splits evenly over its centred rows (5 → 3 + 2), one row when it fits
//   · the tap door: one view opens, several offer the menu, none walks in
//   · the built deck keeps its markers, lands on the asked page, names its dock,
//     gives dots and arrows thumb-sized boxes, and keeps a drag out of the host

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_HIT, appDeckPage, balancePages, buildAppDeck, splitRows, viewDoorFor, type AppChip,
} from './app-deck.js'

const chips = (n: number, prefix = 'c'): AppChip[] =>
  Array.from({ length: n }, (_, i) => ({ action: `${prefix}${i}`, glyph: 'star', labelKey: '', fallback: `${prefix} ${i}` }))

const sizes = <T>(pages: Array<{ chips: T[] }>): number[] => pages.map(p => p.chips.length)

describe('balancePages', () => {
  it('spreads a group evenly over the pages it needs', () => {
    expect(sizes(balancePages([{ title: 'a', chips: chips(9) }], 8))).toEqual([5, 4])
    expect(sizes(balancePages([{ title: 'a', chips: chips(17) }], 8))).toEqual([6, 6, 5])
    expect(sizes(balancePages([{ title: 'a', chips: chips(8) }], 8))).toEqual([8])
    expect(sizes(balancePages([{ title: 'a', chips: chips(16) }], 8))).toEqual([8, 8])
  })

  it('one row across in landscape balances the same way', () => {
    expect(sizes(balancePages([{ title: 'a', chips: chips(9) }], 6))).toEqual([5, 4])
    expect(sizes(balancePages([{ title: 'a', chips: chips(7) }], 6))).toEqual([4, 3])
    expect(sizes(balancePages([{ title: 'a', chips: chips(6) }], 6))).toEqual([6])
    // The last page is never the thin one: 13 over three pages is 5 + 4 + 4.
    expect(sizes(balancePages([{ title: 'a', chips: chips(13) }], 6))).toEqual([5, 4, 4])
    expect(sizes(balancePages([{ title: 'a', chips: chips(13) }], 8))).toEqual([7, 6])
  })

  it('every group starts a page of its own and an empty group has none', () => {
    const pages = balancePages([
      { title: 'open as', chips: chips(2, 'v') },
      { title: 'none', chips: [] },
      { title: 'actions', chips: chips(9, 'a') },
    ], 8)
    expect(pages.map(p => p.title)).toEqual(['open as', 'actions', 'actions'])
    expect(sizes(pages)).toEqual([2, 5, 4])
  })
})

describe('splitRows', () => {
  it('splits a page evenly over two centred rows', () => {
    expect(splitRows(chips(5), 4, 2).map(r => r.length)).toEqual([3, 2])
    expect(splitRows(chips(7), 4, 2).map(r => r.length)).toEqual([4, 3])
    expect(splitRows(chips(8), 4, 2).map(r => r.length)).toEqual([4, 4])
  })

  it('a page that fits one row is one row; one row is all a landscape page gets', () => {
    expect(splitRows(chips(4), 4, 2).map(r => r.length)).toEqual([4])
    expect(splitRows(chips(1), 4, 2).map(r => r.length)).toEqual([1])
    expect(splitRows(chips(6), 6, 1).map(r => r.length)).toEqual([6])
    expect(splitRows([], 4, 2)).toEqual([])
  })

  it('never makes more rows than asked for', () => {
    expect(splitRows(chips(9), 4, 2).map(r => r.length)).toEqual([5, 4])
  })
})

describe('viewDoorFor — the tap door', () => {
  it('one view opens it, several offer the menu, none walks in', () => {
    expect(viewDoorFor([])).toBe('enter')
    expect(viewDoorFor(['slides'])).toBe('view')
    expect(viewDoorFor(['slides', 'lightbox'])).toBe('menu')
  })
})

describe('buildAppDeck', () => {
  const t = (key: string, fallback: string): string => (key === 'x.named' ? 'named' : fallback)
  const ready = new Set<string>()

  beforeEach(() => {
    ready.clear()
    ;(window as unknown as { ioc: unknown }).ioc = {
      register: () => {},
      get: () => undefined,
      has: (key: string) => ready.has(key),
      whenReady: () => {},
    }
  })

  const build = (extra: Partial<Parameters<typeof buildAppDeck>[0]> = {}) => {
    const onActivate = vi.fn()
    const section = buildAppDeck({
      groups: [
        { title: 'open as', chips: chips(9, 'v').map(c => ({ ...c, accent: true })) },
        { title: 'actions', chips: chips(3, 'a') },
      ],
      dock: [{ action: 'exit', glyph: 'arrow_back', labelKey: 'x.named', fallback: 'back' }],
      onActivate,
      t,
      ...extra,
    })
    document.body.appendChild(section)
    return { section, onActivate }
  }

  it('keeps the harness markers and pages the groups', () => {
    const { section } = build()
    expect(section.dataset['role']).toBe('app-deck')
    expect(section.querySelectorAll('[data-role="deck-page"]').length).toBe(3)
    expect(section.querySelectorAll('[data-hc-tv-dot]').length).toBe(3)
    expect(section.querySelectorAll('[data-hc-tv-page-arrow]').length).toBe(2)
    expect(section.querySelector('[data-role="deck-pager"]')?.getAttribute('data-hc-tv-deck')).toBe('')
    const perPage = Array.from(section.querySelectorAll('[data-role="deck-page"]'))
      .map(p => p.querySelectorAll('[data-hc-tv-app]').length)
    expect(perPage).toEqual([5, 4, 3])
    expect(section.querySelector('[data-role="deck-title"]')?.textContent).toBe('open as')
    expect(section.querySelector('[data-role="deck-count"]')?.textContent).toBe('1/3')
    const prev = section.querySelector('[data-hc-tv-page-arrow="prev"]') as HTMLElement
    expect(prev.style.opacity).toBe('0')
  })

  it('lands on the page it was asked for and reports it back', () => {
    const { section } = build({ page: 2 })
    expect(appDeckPage(section)).toBe(2)
    expect(section.querySelector('[data-role="deck-title"]')?.textContent).toBe('actions')
    expect(section.querySelector('[data-role="deck-count"]')?.textContent).toBe('3/3')
    const next = section.querySelector('[data-hc-tv-page-arrow="next"]') as HTMLElement
    expect(next.style.opacity).toBe('0')
    expect(appDeckPage(build({ page: 99 }).section)).toBe(2)
    expect(appDeckPage(null)).toBe(0)
  })

  it('names the dock plates and gives dots and arrows thumb-sized boxes', () => {
    const { section } = build()
    const dock = section.querySelector('[data-role="deck-dock"] [data-hc-tv-app]') as HTMLElement
    expect(dock.getAttribute('aria-label')).toBe('named')
    expect(dock.querySelector('[data-role="app-name"]')?.textContent).toBe('named')
    const dot = section.querySelector('[data-hc-tv-dot]') as HTMLElement
    expect(dot.style.height).toBe(APP_HIT)
    expect(dot.firstElementChild).not.toBeNull()
    const arrow = section.querySelector('[data-hc-tv-page-arrow]') as HTMLElement
    expect(arrow.style.width).toBe(APP_HIT)
    expect(arrow.style.height).toBe(APP_HIT)
  })

  it('tones, badges and readiness', () => {
    const onActivate = vi.fn()
    const section = buildAppDeck({
      groups: [{ title: 'see', chips: [
        { action: 'lanes', glyph: 'view_column', badge: '3', labelKey: '', fallback: 'lanes' },
        { action: 'remove', glyph: 'delete', labelKey: '', fallback: 'remove', danger: true },
        { action: 'later', glyph: 'star', labelKey: '', fallback: 'later', backingKey: '@x/NotYet' },
      ] }],
      onActivate,
      t,
    })
    const [lanes, remove, later] = Array.from(section.querySelectorAll('[data-hc-tv-app]')) as HTMLElement[]
    expect(lanes.querySelector('[data-role="app-badge"]')?.textContent).toBe('3')
    expect((remove.firstElementChild as HTMLElement).dataset['tone']).toBe('danger')
    expect((lanes.firstElementChild as HTMLElement).dataset['tone']).toBe('plain')
    expect(later.style.opacity).toBe('0.32')
    expect(later.style.pointerEvents).toBe('none')
  })

  it('a tap runs the chip through the caller, and a drag inside never reaches the host', () => {
    const { section, onActivate } = build()
    const host = document.createElement('div')
    const seen = vi.fn()
    host.addEventListener('pointerdown', seen)
    host.appendChild(section)
    const plate = section.querySelector('[data-hc-tv-app]') as HTMLElement
    plate.click()
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate.mock.calls[0][0].action).toBe('v0')
    plate.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(seen).not.toHaveBeenCalled()
  })

  it('cols and rows shape the page', () => {
    const section = buildAppDeck({
      groups: [{ title: 'a', chips: chips(6) }],
      onActivate: () => {},
      t,
      cols: 6,
      rows: 1,
    })
    expect(section.dataset['cols']).toBe('6')
    expect(section.dataset['rows']).toBe('1')
    const page = section.querySelector('[data-role="deck-page"]') as HTMLElement
    expect(page.children.length).toBe(1)
    expect(page.querySelectorAll('[data-hc-tv-app]').length).toBe(6)
  })
})
