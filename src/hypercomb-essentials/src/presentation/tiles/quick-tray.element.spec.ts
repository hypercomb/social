// @vitest-environment jsdom
// quick-tray.element.spec.ts — the tray as it is RENDERED. A row is found from
// what the DOM hands back, so these run through real markup: a key carrying a
// NUL once went through an attribute, the parser rewrote it, and both the × and
// the row's drag found nothing while every entry-level spec stayed green.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { QuickTrayElement, defineQuickTray } from './quick-tray.element'

const shown = (tray: QuickTrayElement): string[] =>
  [...(tray.shadowRoot?.querySelectorAll('.row .label') ?? [])].map(e => e.textContent ?? '')

const click = (tray: QuickTrayElement, selector: string, at = 0): void => {
  (tray.shadowRoot?.querySelectorAll(selector)[at] as HTMLElement).click()
}

let tray: QuickTrayElement

beforeAll(() => { defineQuickTray() })

beforeEach(() => {
  document.body.innerHTML = ''
  tray = document.createElement('hc-quick-tray') as QuickTrayElement
  document.body.appendChild(tray)
  tray.take([
    { label: 'first', sourceSegments: ['page', 'deep'] },
    { label: 'second', sourceSegments: ['page'] },
    { label: 'third', sourceSegments: [] },
  ])
})

describe('the × on a row', () => {
  it('lets go of that row and no other', () => {
    click(tray, '.remove', 1)
    expect(shown(tray)).toEqual(['first', 'third'])
    expect(tray.entries.map(e => e.label)).toEqual(['first', 'third'])
  })

  it('empties the strip when the last row goes', () => {
    click(tray, '.remove'); click(tray, '.remove'); click(tray, '.remove')
    expect(tray.entries).toEqual([])
    expect(tray.shadowRoot?.querySelector('.tray')).toBeNull()
  })
})

describe('a row lifted off the strip', () => {
  it('resolves to its entry, so a drag can start', () => {
    const row = tray.shadowRoot?.querySelectorAll('.row')[2] as HTMLElement
    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }))
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }))
    expect(tray.shadowRoot?.querySelector('.ghost .name')?.textContent).toBe('third')
    document.dispatchEvent(new Event('pointercancel'))
    expect(tray.shadowRoot?.querySelector('.ghost')).toBeNull()
  })
})

describe('after a drag', () => {
  const dragOff = (): void => {
    const row = tray.shadowRoot?.querySelectorAll('.row')[0] as HTMLElement
    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }))
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }))
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 50 }))
  }
  const reachesThePage = (): boolean => {
    let reached = false
    const hear = (): void => { reached = true }
    document.addEventListener('click', hear)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.removeEventListener('click', hear)
    return reached
  }

  it('swallows the trailing click the drag itself produced', () => {
    dragOff()
    expect(reachesThePage()).toBe(false)
  })

  it('never swallows the next real press when the drag produced no click', () => {
    dragOff()
    window.dispatchEvent(new MouseEvent('pointerdown'))
    expect(reachesThePage()).toBe(true)
  })
})

describe('a take answers where it landed', () => {
  it('lights the row when the tile is already held', () => {
    tray.take([{ label: 'second', sourceSegments: ['page'] }])
    expect(shown(tray)).toEqual(['first', 'second', 'third'])
    const lit = [...(tray.shadowRoot?.querySelectorAll('.row.taken') ?? [])]
    expect(lit.map(e => e.querySelector('.label')?.textContent)).toEqual(['second'])
  })

  it('lights the chip when the tray is folded', () => {
    click(tray, '.fold')
    tray.take([{ label: 'fourth', sourceSegments: [] }])
    expect(tray.shadowRoot?.querySelector('.fold.taken')).not.toBeNull()
  })
})

describe('hiding the tray', () => {
  it('folds to a chip that keeps the count, and lets go of nothing', () => {
    click(tray, '.fold')
    expect(shown(tray)).toEqual([])
    expect(tray.shadowRoot?.querySelector('.tray.folded .count')?.textContent).toBe('3')
    expect(tray.entries).toHaveLength(3)
  })

  it('stays folded when a take lands, with the count moving', () => {
    click(tray, '.fold')
    tray.take([{ label: 'fourth', sourceSegments: [] }])
    expect(shown(tray)).toEqual([])
    expect(tray.shadowRoot?.querySelector('.count')?.textContent).toBe('4')
  })

  it('comes back from the chip with every row', () => {
    click(tray, '.fold')
    click(tray, '.fold')
    expect(shown(tray)).toEqual(['first', 'second', 'third'])
  })
})
