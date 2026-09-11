// Moving the docked editor to another tile: a click in the hive beside it
// arrives as `editor:switch-request`. Clean, the editor just moves — the same
// window, retargeted, never rebuilt. With unsaved changes the footer asks
// first, and nothing moves until it is answered.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => new Map<string, unknown>())

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => services.get(key),
    register: (key: string, value: unknown) => services.set(key, value),
    // The element defines itself when the shell's registry is ready; it is
    // mounted by hand below.
    whenReady: (key: string, callback: (value: unknown) => void) => {
      if (key === '@hypercomb.social/ShellSurfaceRegistry') callback({ add: () => {}, all: () => [] })
    },
  }
})

import { EffectBus } from '@hypercomb/core'
import './tile-editor.service.js'
import './image-editor.service.js'
import './tile-editor.view.js'
import type { TileEditorService } from './tile-editor.service.js'

const service = (): TileEditorService =>
  services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService

const panel = (): HTMLElement | null => document.querySelector('[data-hc-tile-editor]')
/** A button in the footer — the header carries its own close button, which
 *  is also a cancel. */
const button = (action: string): HTMLButtonElement | null =>
  panel()?.querySelector<HTMLButtonElement>(`.te-actions button[data-action="${action}"]`) ?? null
const settle = async (): Promise<void> => { for (let i = 0; i < 4; i++) await Promise.resolve() }

describe('tile editor — moving to another tile while docked', () => {
  let host: HTMLElement
  let switchTo: ReturnType<typeof vi.fn>
  let previews: { label: string; clear?: boolean }[]
  let offPreview: () => void

  beforeEach(() => {
    switchTo = vi.fn(async (label: string) => {
      service().open(label, {}, null, [], 'dock')
      return true
    })
    services.set('@diamondcoreprocessor.com/TileEditorDrone', {
      switchTo,
      cancelEditing: () => service().close(),
      saveAndComplete: async () => service().close(),
    })
    previews = []
    offPreview = EffectBus.on<{ label: string; clear?: boolean }>('tile:preview', p => { previews.push(p) })
    host = document.createElement('hc-tile-editor')
    document.body.appendChild(host)
    service().open('alpha', {}, null, [], 'dock')
  })

  afterEach(() => {
    offPreview()
    if (service().mode === 'editing') service().close()
    host.remove()
  })

  it('moves at once when nothing has changed — the same window, retargeted', async () => {
    const before = panel()
    expect(before).not.toBeNull()

    EffectBus.emitTransient('editor:switch-request', { label: 'beta' })
    await settle()

    expect(switchTo).toHaveBeenCalledWith('beta', { save: false })
    expect(panel()).toBe(before)
    expect(panel()?.querySelector<HTMLInputElement>('.te-title')?.placeholder).toBe('beta')
  })

  it('ends the first tile\'s preview before the next tile is previewed', async () => {
    previews.length = 0
    EffectBus.emitTransient('editor:switch-request', { label: 'beta' })
    await settle()

    const cleared = previews.findIndex(p => p.label === 'alpha' && p.clear)
    const next = previews.findIndex(p => p.label === 'beta' && !p.clear)
    expect(cleared).toBeGreaterThanOrEqual(0)
    expect(next).toBeGreaterThan(cleared)
    // Nothing of alpha is painted once the editor has left it.
    expect(previews.slice(cleared + 1).some(p => p.label === 'alpha')).toBe(false)
  })

  it('ignores a request for the tile it already holds', async () => {
    EffectBus.emitTransient('editor:switch-request', { label: 'alpha' })
    await settle()
    expect(switchTo).not.toHaveBeenCalled()
  })

  it('asks first when there are unsaved changes, and moves only on an answer', async () => {
    service().setLink('https://example.com')

    EffectBus.emitTransient('editor:switch-request', { label: 'gamma' })
    await settle()

    expect(switchTo).not.toHaveBeenCalled()
    const leave = panel()?.querySelector<HTMLElement>('.te-leave')
    expect(leave?.hidden).toBe(false)
    expect(leave?.textContent).toContain('gamma')
    expect(button('cancel')?.hidden).toBe(true)
    expect(button('save')?.hidden).toBe(true)

    button('leave-stay')?.click()
    expect(leave?.hidden).toBe(true)
    expect(button('save')?.hidden).toBe(false)
    expect(switchTo).not.toHaveBeenCalled()

    EffectBus.emitTransient('editor:switch-request', { label: 'gamma' })
    await settle()
    button('leave-save')?.click()
    await settle()
    expect(switchTo).toHaveBeenCalledWith('gamma', { save: true })
    expect(service().cell).toBe('gamma')
  })

  it('opens without saving on the second choice', async () => {
    service().setHideText(true)
    EffectBus.emitTransient('editor:switch-request', { label: 'delta' })
    await settle()
    button('leave-discard')?.click()
    await settle()
    expect(switchTo).toHaveBeenCalledWith('delta', { save: false })
  })

  it('lets Escape answer "keep editing"', async () => {
    service().setHideText(true)
    EffectBus.emitTransient('editor:switch-request', { label: 'delta' })
    await settle()
    const view = services.get('@diamondcoreprocessor.com/TileEditorView') as { dismissInner(): boolean }
    expect(view.dismissInner()).toBe(true)
    expect(panel()?.querySelector<HTMLElement>('.te-leave')?.hidden).toBe(true)
    expect(service().cell).toBe('alpha')
  })

  it('stays where it is when the move fails, still showing the edit', async () => {
    switchTo.mockImplementationOnce(async () => false)
    service().setHideText(true)
    EffectBus.emitTransient('editor:switch-request', { label: 'epsilon' })
    await settle()
    previews.length = 0
    button('leave-save')?.click()
    await settle()
    expect(service().cell).toBe('alpha')
    expect(previews.some(p => p.label === 'alpha' && !p.clear)).toBe(true)
  })
})
