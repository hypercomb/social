// Picture search opens Google's image grid in its own tab. The words are the
// tile's text. Nothing is drawn inside the editor.

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

const service = (): TileEditorService =>
  services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService

const panel = (): HTMLElement | null => document.querySelector('[data-hc-tile-editor]')
const search = (): HTMLButtonElement | null =>
  panel()?.querySelector<HTMLButtonElement>('button[data-action="search"]') ?? null

describe('tile editor — picture search', () => {
  let host: HTMLElement
  let open: ReturnType<typeof vi.fn>

  beforeEach(() => {
    open = vi.fn(() => ({}))
    vi.stubGlobal('open', open)
    services.set('@diamondcoreprocessor.com/TileEditorDrone', {
      cancelEditing: () => service().close(),
      saveAndComplete: async () => service().close(),
    })
    host = document.createElement('hc-tile-editor')
    document.body.appendChild(host)
    service().open('honey', {}, null, [], 'dock')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (service().mode === 'editing') service().close()
    host.remove()
  })

  it('opens Google Images in a tab for the tile name', () => {
    search()?.click()
    expect(open).toHaveBeenCalledWith(
      'https://www.google.com/search?tbm=isch&q=honey',
      '_blank',
      'noopener',
    )
    expect(panel()?.querySelector('.te-results')).toBeNull()
  })

  it('opens the tab for the text in the field', () => {
    const title = panel()?.querySelector<HTMLInputElement>('.te-title')
    title!.value = 'wax comb'
    search()?.click()
    expect(open).toHaveBeenCalledWith(
      `https://www.google.com/search?tbm=isch&q=${encodeURIComponent('wax comb')}`,
      '_blank',
      'noopener',
    )
    expect(title?.value).toBe('wax comb')
  })
})
