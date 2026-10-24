// app-deck.spec.ts — the phone's menu rows, pinned.
//
//   · the tap door: one view opens, several offer the menu, none walks in
//   · the built deck is one expansion row per non-empty group, one open at a
//     time, each opening to its whole group in one strip; it reopens the row
//     it was asked for, names its dock, and keeps a drag out of the host

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_HIT, appDeckPage, buildAppDeck, viewDoorFor, type AppChip } from './app-deck.js'

const chips = (n: number, prefix = 'c'): AppChip[] =>
  Array.from({ length: n }, (_, i) => ({ action: `${prefix}${i}`, glyph: 'star', labelKey: '', fallback: `${prefix} ${i}` }))

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
        { title: 'empty', chips: [] },
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
  const heads = (section: HTMLElement) =>
    Array.from(section.querySelectorAll('[data-hc-tv-group]')) as HTMLElement[]
  const strips = (section: HTMLElement) =>
    Array.from(section.querySelectorAll('[data-role="deck-strip"]')) as HTMLElement[]

  it('one row per non-empty group, each holding its whole group in one strip', () => {
    const { section } = build()
    expect(section.dataset['role']).toBe('app-deck')
    expect(heads(section).map(h => h.getAttribute('aria-label'))).toEqual(['open as', 'actions'])
    expect(Array.from(section.querySelectorAll('[data-role="deck-count"]')).map(c => c.textContent))
      .toEqual(['9', '3'])
    expect(strips(section).map(s => s.querySelectorAll('[data-hc-tv-app]').length)).toEqual([9, 3])
    expect(strips(section)[0].getAttribute('data-hc-tv-deck')).toBe('')
    // No paging left anywhere.
    expect(section.querySelector('[data-hc-tv-dot], [data-hc-tv-page-arrow], [data-role="deck-pager"]')).toBeNull()
  })

  it('opens the first row by default, one at a time; tapping the open row shuts it', () => {
    const { section } = build()
    const [first, second] = heads(section)
    const [one, two] = strips(section)
    expect(first.getAttribute('aria-expanded')).toBe('true')
    expect(one.style.display).toBe('flex')
    expect(two.style.display).toBe('none')
    second.click()
    expect(appDeckPage(section)).toBe(1)
    expect(one.style.display).toBe('none')
    expect(two.style.display).toBe('flex')
    expect(first.getAttribute('aria-expanded')).toBe('false')
    second.click()
    expect(appDeckPage(section)).toBe(-1)
    expect(two.style.display).toBe('none')
  })

  it('opens the row it was asked for and reports it back', () => {
    expect(appDeckPage(build({ page: 1 }).section)).toBe(1)
    expect(appDeckPage(build({ page: 99 }).section)).toBe(1)
    expect(appDeckPage(build({ page: -1 }).section)).toBe(-1)
    expect(appDeckPage(null)).toBe(0)
  })

  it('names the dock items and gives row heads a thumb-sized box', () => {
    const { section } = build()
    const dock = section.querySelector('[data-role="deck-dock"] [data-hc-tv-app]') as HTMLElement
    expect(dock.getAttribute('aria-label')).toBe('named')
    expect(dock.querySelector('[data-role="app-name"]')?.textContent).toBe('named')
    expect(heads(section)[0].style.minHeight).toBe(APP_HIT)
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
})
