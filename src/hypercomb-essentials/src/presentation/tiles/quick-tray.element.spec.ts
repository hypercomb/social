// @vitest-environment jsdom
// quick-tray.element.spec.ts — the tray as it is RENDERED. A row is found from
// what the DOM hands back, so these run through real markup: a key carrying a
// NUL once went through an attribute, the parser rewrote it, and both the × and
// the row's drag found nothing while every entry-level spec stayed green.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { QuickTrayElement, defineQuickTray } from './quick-tray.element'

const shown = (tray: QuickTrayElement): string[] =>
  [...(tray.shadowRoot?.querySelectorAll('.row .label') ?? [])].map(e => e.textContent ?? '')

const click = (tray: QuickTrayElement, selector: string, at = 0): void => {
  (tray.shadowRoot?.querySelectorAll(selector)[at] as HTMLElement).click()
}

/** What the shelf last said on `shelf:changed` — what the shell's button reads. */
const said = (): { entries: unknown[]; folded: boolean } => {
  let last: { entries: unknown[]; folded: boolean } | undefined
  EffectBus.on<{ entries: unknown[]; folded: boolean }>('shelf:changed', p => { last = p })()
  return last!
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

  it('tells the shell button when the shelf is folded', () => {
    click(tray, '.fold')
    tray.take([{ label: 'fourth', sourceSegments: [] }])
    expect(said()).toMatchObject({ folded: true })
    expect(said().entries).toHaveLength(4)
  })
})

describe('hiding the shelf', () => {
  it('folds away entirely, says so, and lets go of nothing', () => {
    click(tray, '.fold')
    expect(shown(tray)).toEqual([])
    expect(tray.shadowRoot?.querySelector('.shelf, .fold')).toBeNull()
    expect(said()).toMatchObject({ folded: true })
    expect(tray.entries).toHaveLength(3)
  })

  it('stays folded when a take lands, with the count moving', () => {
    click(tray, '.fold')
    tray.take([{ label: 'fourth', sourceSegments: [] }])
    expect(shown(tray)).toEqual([])
    expect(said().entries).toHaveLength(4)
  })

  it('comes back on shelf:toggle with every row', () => {
    click(tray, '.fold')
    EffectBus.emitTransient('shelf:toggle', {})
    expect(shown(tray)).toEqual(['first', 'second', 'third'])
    expect(said()).toMatchObject({ folded: false })
  })

  it('shelf:toggle with open says which way, so a repeat is harmless', () => {
    EffectBus.emitTransient('shelf:toggle', { open: true })
    expect(shown(tray)).toEqual(['first', 'second', 'third'])
    EffectBus.emitTransient('shelf:toggle', { open: false })
    EffectBus.emitTransient('shelf:toggle', { open: false })
    expect(shown(tray)).toEqual([])
  })
})

// The fold is sticky: a press keeps one current record in the shelf:state pool,
// and a shelf that mounts reads it back.
describe('the fold is sticky', () => {
  const pool = {} as FileSystemDirectoryHandle
  let saved: ArrayBuffer | null = null
  const store = {
    getPool: async () => pool,
    getPoolDoc: async () => saved,
    putPoolDoc: async (_: unknown, bytes: ArrayBuffer) => { saved = bytes; return true },
  }
  const folded = (): unknown => saved && JSON.parse(new TextDecoder().decode(saved)).folded
  const settle = () => new Promise(r => setTimeout(r, 0))
  const mount = (): QuickTrayElement => {
    document.body.innerHTML = ''
    const fresh = document.createElement('hc-quick-tray') as QuickTrayElement
    document.body.appendChild(fresh)
    fresh.take([{ label: 'first', sourceSegments: [] }])
    return fresh
  }

  beforeEach(() => {
    saved = null
    ;(globalThis as { ioc?: unknown }).ioc = { get: (k: string) => (k === '@hypercomb.social/Store' ? store : undefined) }
  })

  it('a press keeps the fold, and the next shelf comes up folded', async () => {
    click(mount(), '.fold')
    await settle()
    expect(folded()).toBe(true)
    const next = mount()
    await settle()
    expect(shown(next)).toEqual([])
    expect(said()).toMatchObject({ folded: true })
  })

  it('opening it again is kept too', async () => {
    click(mount(), '.fold')
    await settle()
    EffectBus.emitTransient('shelf:toggle', {})
    await settle()
    expect(folded()).toBe(false)
    expect(shown(mount())).toEqual(['first'])
  })

  it('a press made before the saved fold is read wins', async () => {
    saved = new TextEncoder().encode(JSON.stringify({ folded: true })).buffer as ArrayBuffer
    const next = mount()
    EffectBus.emitTransient('shelf:toggle', { open: true })
    await settle()
    expect(shown(next)).toEqual(['first'])
  })
})
