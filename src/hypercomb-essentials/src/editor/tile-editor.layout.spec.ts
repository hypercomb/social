// The desk's layout, at the view: wide or narrow is an ARRANGEMENT of the same
// nodes. A window that turns, a soft keyboard, a larger text size: none of them
// rebuilds anything, so a half-typed answer survives the flip both ways. There
// is no resize handler that tears the desk down and builds it again.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => new Map<string, unknown>())

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => services.get(key),
    register: (key: string, value: unknown) => services.set(key, value),
    whenReady: (key: string, callback: (value: unknown) => void) => {
      if (key === '@hypercomb.social/ShellSurfaceRegistry') callback({ add: () => {}, all: () => [] })
    },
  }
})

import './tile-editor.drone.js'
import { TileEditorElement, tileEditorViewFacade } from './tile-editor.view.js'
import type { TileEditorService } from './tile-editor.service.js'

if (!customElements.get('hc-tile-editor')) customElements.define('hc-tile-editor', TileEditorElement)
services.set('@diamondcoreprocessor.com/TileEditorView', tileEditorViewFacade)

const service = (): TileEditorService => services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
const panel = (): HTMLElement => document.querySelector('[data-hc-tile-editor]') as HTMLElement
const settle = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const frames = async (): Promise<void> => { for (let i = 0; i < 3; i++) await new Promise(resolve => requestAnimationFrame(() => resolve(0))) }

const setWidth = (width: number): void => {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

describe('tile editor — layout', () => {
  let host: HTMLElement

  beforeEach(async () => {
    services.set('@diamondcoreprocessor.com/DecorationService', { titleOf: async () => '', setTitle: async () => 'set', duplicateTitle: async () => null })
    services.set('@diamondcoreprocessor.com/NotesService', {
      notesFor: () => [{ id: 'q1', text: '[Q] Where was this taken?' }],
    })
    services.set('@diamondcoreprocessor.com/TileEditorDrone', { cancelEditing: () => service().close(), saveAndComplete: async () => service().close() })
    setWidth(1440)
    host = document.createElement('hc-tile-editor')
    document.body.appendChild(host)
    service().open('alpha', {}, null, [])
    await settle()
    await frames()
  })

  afterEach(() => {
    if (service().mode === 'editing') service().close()
    host.remove()
  })

  it('flips between wide and narrow without rebuilding: the same nodes, the same half-typed answer', async () => {
    expect(panel().dataset['layout']).toBe('wide')
    const desk = panel()
    const figure = desk.querySelector('.te-figure')
    const stage = desk.querySelector('.te-stage')
    const name = desk.querySelector('.te-title')
    // a card is painted when it is opened: open the Questions card
    desk.querySelector<HTMLButtonElement>('.te-dg-callout[data-kind="questions"] .te-dg-lab')!.click()
    await frames()
    const answer = desk.querySelector<HTMLTextAreaElement>('textarea')
    expect(answer).not.toBeNull()
    answer!.value = 'half an answ'
    answer!.dispatchEvent(new Event('input', { bubbles: true }))

    setWidth(520)
    await frames()
    expect(panel().dataset['layout']).toBe('narrow')
    expect(panel()).toBe(desk)
    expect(desk.querySelector('.te-figure')).toBe(figure)
    expect(desk.querySelector('.te-stage')).toBe(stage)
    expect(desk.querySelector('.te-title')).toBe(name)
    expect(desk.querySelector('textarea')).toBe(answer)
    expect(answer!.value).toBe('half an answ')

    setWidth(1440)
    await frames()
    expect(panel().dataset['layout']).toBe('wide')
    expect(desk.querySelector('textarea')).toBe(answer)
    expect(answer!.value).toBe('half an answ')
  })

  it('takes the list from the desk width: the full list, the mid list, the faces', async () => {
    const list = (): string | undefined => panel().dataset['list']
    setWidth(1920)
    await frames()
    expect(list()).toBe('full')
    setWidth(1200)
    await frames()
    expect(list()).toBe('mid')
    setWidth(980)
    await frames()
    expect(list()).toBe('faces')
  })

  it('sizes the figure square from the layout, and keeps it when the window is unchanged', async () => {
    const figure = panel().querySelector<HTMLElement>('.te-figure')!
    const side = figure.style.width
    expect(side).toMatch(/^\d+px$/)
    expect(figure.style.height).toBe(side)
    window.dispatchEvent(new Event('resize'))
    await frames()
    expect(figure.style.width).toBe(side)
  })

  it('has no resize handler that rebuilds the desk, and no surface switch', () => {
    const source = readFileSync(join(__dirname, 'tile-editor.view.ts'), 'utf8')
    expect(source).not.toMatch(/#onResize/)
    expect(source).not.toMatch(/setSurface|editorSurface|dockWidthFor/)
    expect(source).not.toMatch(/backdrop-filter|viewport:inset/)
  })

  it('claims the desk as the one covering view and lets the control bar keep its edge', () => {
    const entered: string[] = []
    const modes = { enter: (mode: string, owner: string) => entered.push(`${mode}:${owner}`), exit: () => {}, releaseOwner: () => {} }
    services.set('@diamondcoreprocessor.com/ModeRegistry', modes)
    service().close()
    service().open('beta', {}, null, [])
    expect(entered).toEqual(['view:keeps-controls:tile-editor', 'view:active:tile-editor'])
    services.delete('@diamondcoreprocessor.com/ModeRegistry')
  })
})
