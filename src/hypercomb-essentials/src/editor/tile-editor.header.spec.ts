// The desk's header, at the view: a size slider and a separator before the
// buttons that write the tile, Save for THIS tile and Save all for every tile
// the editor was moved away from with changes, and the list marking those tiles.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RailMock = { showSelection: ReturnType<typeof vi.fn>; showCurrent: ReturnType<typeof vi.fn> }
const services = vi.hoisted(() => new Map<string, unknown>())
const rails = vi.hoisted(() => [] as RailMock[])

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => services.get(key),
    register: (key: string, value: unknown) => services.set(key, value),
    whenReady: (key: string, callback: (value: unknown) => void) => {
      if (key === '@hypercomb.social/ShellSurfaceRegistry') callback({ add: () => {}, all: () => [] })
      if (key === '@diamondcoreprocessor.com/AgentTilesRailFactory') {
        callback({
          create: () => {
            const rail = {
              mount: () => {}, dispose: () => {}, paint: () => {}, refresh: () => {},
              showCurrent: vi.fn(), showSelection: vi.fn(), markSibling: () => {}, onSubjectChanged: () => {},
            }
            rails.push(rail)
            return rail
          },
        })
      }
    },
  }
})

import './tile-editor.drone.js'
import { TileEditorElement, tileEditorViewFacade } from './tile-editor.view.js'
import { SCALE_DEFAULT, editorScale, setEditorScale } from './editor-size.js'
import type { TileEditorService } from './tile-editor.service.js'

if (!customElements.get('hc-tile-editor')) customElements.define('hc-tile-editor', TileEditorElement)
services.set('@diamondcoreprocessor.com/TileEditorView', tileEditorViewFacade)

const service = (): TileEditorService => services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
const panel = (): HTMLElement => document.querySelector('[data-hc-tile-editor]') as HTMLElement
const head = (): HTMLElement => panel().querySelector<HTMLElement>('.te-actions')!
const slider = (): HTMLInputElement => head().querySelector<HTMLInputElement>('input[type="range"]')!
const action = (name: string): HTMLButtonElement => head().querySelector<HTMLButtonElement>(`button[data-action="${name}"]`)!
const settle = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const frames = async (): Promise<void> => { for (let i = 0; i < 3; i++) await new Promise(resolve => requestAnimationFrame(() => resolve(0))) }
const figureSize = (): number => parseFloat(panel().querySelector<HTMLElement>('.te-figure')!.style.width)

/** A tile left with changes, as the drone's move leaves one in the pad. */
const leftBehind = (cell: string): void => {
  service().stash({ cell, segments: ['page', cell], properties: { link: 'https://x.example' }, picture: null, pictureRemoved: false })
}

describe('tile editor — the header', () => {
  let host: HTMLElement
  let saveAndComplete: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    saveAndComplete = vi.fn(async () => {})
    services.set('@diamondcoreprocessor.com/DecorationService', { titleOf: async () => '', setTitle: async () => 'set', duplicateTitle: async () => null })
    services.set('@diamondcoreprocessor.com/TileEditorDrone', { cancelEditing: () => service().close(), saveAndComplete })
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1440 })
    rails.length = 0
    for (const draft of service().drafts) service().dropStash(draft.cell, draft.segments)
    host = document.createElement('hc-tile-editor')
    document.body.appendChild(host)
    service().open('alpha', {}, null, ['page', 'alpha'])
    await settle()
    await frames()
  })

  afterEach(() => {
    setEditorScale(SCALE_DEFAULT)
    if (service().mode === 'editing') service().close()
    for (const draft of service().drafts) service().dropStash(draft.cell, draft.segments)
    host.remove()
  })

  it('puts a size slider, then a separator, then the buttons that write the tile', () => {
    const order = [...head().children]
    const size = order.findIndex(node => node.classList.contains('te-size'))
    const rule = order.findIndex(node => node.classList.contains('te-sep'))
    const save = order.indexOf(action('save'))
    expect(size).toBeGreaterThan(-1)
    expect(rule).toBeGreaterThan(size)
    expect(save).toBeGreaterThan(rule)
    expect(order[rule]!.getAttribute('role')).toBe('separator')
    expect(order.indexOf(action('save-all'))).toBeGreaterThan(rule)
    expect(order.indexOf(action('save-all'))).toBeLessThan(save)
  })

  it('has a slider that is named, spans the sizes, and starts at the usual one', () => {
    expect(slider().getAttribute('aria-label')).toBe('tile size')
    expect(Number(slider().min)).toBeLessThan(100)
    expect(Number(slider().max)).toBeGreaterThan(100)
    expect(slider().value).toBe('100')
  })

  it('draws the tile smaller as the slider goes down, and keeps the choice', async () => {
    const usual = figureSize()
    slider().value = '60'
    slider().dispatchEvent(new Event('input', { bubbles: true }))
    await frames()
    expect(editorScale()).toBeCloseTo(0.6, 10)
    expect(figureSize()).toBeLessThan(usual)
    expect(panel().dataset['layout']).toBe('wide')
  })

  it('goes back to the usual size on a double-click', async () => {
    const usual = figureSize()
    slider().value = '60'
    slider().dispatchEvent(new Event('input', { bubbles: true }))
    await frames()
    slider().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await frames()
    expect(slider().value).toBe('100')
    expect(editorScale()).toBe(SCALE_DEFAULT)
    expect(figureSize()).toBe(usual)
  })

  it('shows Save all only while another tile waits, counting this one if it has changes', async () => {
    expect(action('save-all').hidden).toBe(true)

    leftBehind('beta')
    await settle()
    await frames()
    expect(action('save-all').hidden).toBe(false)
    expect(action('save-all').textContent).toBe('save all (1)')

    service().setLink('https://alpha.example')
    leftBehind('gamma')
    await settle()
    await frames()
    expect(action('save-all').textContent).toBe('save all (3)')
    expect(head().querySelector('.te-state-word')?.textContent).toBe('3 unsaved')
    // the tooltip names the tiles
    expect(action('save-all').title).toBe('beta, gamma, alpha')
  })

  it('Save writes this tile; Save all asks the drone for every tile', async () => {
    leftBehind('beta')
    service().setLink('https://alpha.example')
    await settle()
    await frames()

    action('save').click()
    await vi.waitFor(() => expect(saveAndComplete).toHaveBeenCalledTimes(1))
    expect(saveAndComplete).toHaveBeenLastCalledWith()

    action('save-all').click()
    await vi.waitFor(() => expect(saveAndComplete).toHaveBeenCalledTimes(2))
    expect(saveAndComplete).toHaveBeenLastCalledWith({ all: true })
  })

  it('marks the tiles that wait in the list, and nothing once they are gone', async () => {
    const rail = rails.at(-1)!
    leftBehind('beta')
    leftBehind('gamma')
    await settle()
    await frames()
    expect(rail.showSelection).toHaveBeenLastCalledWith([['page', 'beta'], ['page', 'gamma']])

    service().dropStash('beta', ['page', 'beta'])
    service().dropStash('gamma', ['page', 'gamma'])
    await settle()
    await frames()
    expect(rail.showSelection).toHaveBeenLastCalledWith([])
  })

  it('does not offer the restore strip for a draft that is being put back', async () => {
    leftBehind('alpha')
    service().setResuming(true)
    await settle()
    await frames()
    expect(panel().querySelector<HTMLElement>('.te-note[role="status"]')?.hidden).toBe(true)
    service().setResuming(false)
    await settle()
    await frames()
    expect(panel().querySelector<HTMLElement>('.te-note[role="status"]')?.hidden).toBe(false)
  })
})
