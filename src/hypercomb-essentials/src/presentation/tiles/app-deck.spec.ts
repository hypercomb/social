// app-deck.spec.ts — the phone's home screen of icons, pinned.
//
//   · every group's icons run on as ONE set, cut into full pages in order
//   · the tap door: one view opens, several offer the menu, none walks in
//   · the built deck is a grid four across filled top to bottom, as tall as
//     its fullest page needs; it lands on the asked page, names its dock,
//     gives the dots thumb-sized boxes, and keeps a drag out of the host

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_HIT, appDeckPage, buildAppDeck, pageChips, viewDoorFor, type AppChip } from './app-deck.js'

const chips = (n: number, prefix = 'c'): AppChip[] =>
  Array.from({ length: n }, (_, i) => ({ action: `${prefix}${i}`, glyph: 'star', labelKey: '', fallback: `${prefix} ${i}` }))

describe('pageChips', () => {
  it('one set across the groups, in order, each page full before the next', () => {
    const pages = pageChips([{ chips: [1, 2, 3] }, { chips: [] }, { chips: [4, 5, 6, 7, 8] }], 4)
    expect(pages).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]])
    expect(pageChips([{ chips: [1, 2, 3, 4, 5] }], 16)).toEqual([[1, 2, 3, 4, 5]])
    expect(pageChips([{ chips: [] }], 16)).toEqual([])
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
        { title: 'actions', chips: chips(12, 'a') },
      ],
      dock: [{ action: 'exit', glyph: 'arrow_back', labelKey: 'x.named', fallback: 'back' }],
      onActivate,
      t,
      cols: 4,
      rows: 4,
      ...extra,
    })
    document.body.appendChild(section)
    return { section, onActivate }
  }

  it('one grid, four across, full pages of sixteen, dots to say there is more', () => {
    const { section } = build()
    expect(section.dataset['role']).toBe('app-deck')
    const pages = Array.from(section.querySelectorAll('[data-role="deck-page"]')) as HTMLElement[]
    expect(pages.map(p => p.querySelectorAll('[data-hc-tv-app]').length)).toEqual([16, 5])
    expect(pages[0].style.gridTemplateColumns).toContain('repeat(4')
    // Order runs across the groups: the ninth "open as" icon, then the actions.
    const first = Array.from(pages[0].querySelectorAll('[data-hc-tv-app]')).map(b => (b as HTMLElement).dataset['action'])
    expect(first.slice(8, 10)).toEqual(['v8', 'a0'])
    expect(section.querySelectorAll('[data-hc-tv-dot]').length).toBe(2)
    expect(section.querySelector('[data-hc-tv-page-arrow], [data-role="deck-title"]')).toBeNull()
    expect(section.querySelector('[data-role="deck-pager"]')?.getAttribute('data-hc-tv-deck')).toBe('')
  })

  it('is only as tall as its fullest page needs', () => {
    const section = buildAppDeck({ groups: [{ title: 'a', chips: chips(6) }], onActivate: () => {}, t, cols: 4, rows: 4 })
    expect(section.dataset['rows']).toBe('2')
    const nav = section.querySelector('[data-role="deck-nav"]') as HTMLElement
    expect(nav.style.visibility).toBe('hidden')
  })

  it('lands on the page it was asked for and reports it back', () => {
    expect(appDeckPage(build({ page: 1 }).section)).toBe(1)
    expect(appDeckPage(build({ page: 99 }).section)).toBe(1)
    expect(appDeckPage(null)).toBe(0)
  })

  it('names the dock plates and gives the dots thumb-sized boxes', () => {
    const { section } = build()
    const dock = section.querySelector('[data-role="deck-dock"] [data-hc-tv-app]') as HTMLElement
    expect(dock.getAttribute('aria-label')).toBe('named')
    expect(dock.querySelector('[data-role="app-name"]')?.textContent).toBe('named')
    const dot = section.querySelector('[data-hc-tv-dot]') as HTMLElement
    expect(dot.style.height).toBe(APP_HIT)
    expect(dot.firstElementChild).not.toBeNull()
  })

  it('tones, badges and readiness', () => {
    const section = buildAppDeck({
      groups: [{ title: 'see', chips: [
        { action: 'lanes', glyph: 'view_column', badge: '3', labelKey: '', fallback: 'lanes' },
        { action: 'remove', glyph: 'delete', labelKey: '', fallback: 'remove', danger: true },
        { action: 'later', glyph: 'star', labelKey: '', fallback: 'later', backingKey: '@x/NotYet' },
      ] }],
      onActivate: vi.fn(),
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
})
