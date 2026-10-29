// The name, at the level of the view. The name is the tile's TITLE — a
// decoration written by its own chain (tile-title.ts) — and the view's part is
// to let go of it in every place a field can be lost: closing, a displaced
// window, a tile switch and Save, each of which must WRITE it, and the last two
// of which must stop when the write is refused. The header shows what is
// stored, never what is half typed; a tile with no title reads as its address.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => new Map<string, unknown>())
const rails = vi.hoisted(() => [] as { markSibling: ReturnType<typeof vi.fn> }[])

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
              mount: () => {}, dispose: () => {}, paint: () => {}, refresh: () => {}, showCurrent: () => {},
              showSelection: () => {}, markSibling: vi.fn(), onSubjectChanged: () => {},
            }
            rails.push(rail)
            return rail
          },
        })
      }
    },
  }
})

import { EffectBus, parkWindows, resetWindowSession } from '@hypercomb/core'
import './tile-editor.drone.js'
import { TileEditorElement, tileEditorViewFacade } from './tile-editor.view.js'
import type { TileEditorService } from './tile-editor.service.js'

if (!customElements.get('hc-tile-editor')) customElements.define('hc-tile-editor', TileEditorElement)
services.set('@diamondcoreprocessor.com/TileEditorView', tileEditorViewFacade)

const service = (): TileEditorService => services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
const panel = (): HTMLElement => document.querySelector('[data-hc-tile-editor]') as HTMLElement
const nameInput = (): HTMLInputElement => panel().querySelector<HTMLInputElement>('.te-title')!
const reading = (): string => panel().querySelector('.te-reading')?.textContent ?? ''
const button = (action: string): HTMLButtonElement => panel().querySelector<HTMLButtonElement>(`.te-actions button[data-action="${action}"]`)!
const settle = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const frames = async (): Promise<void> => { for (let i = 0; i < 2; i++) await new Promise(resolve => requestAnimationFrame(() => resolve(0))) }
const type = (text: string): void => {
  const input = nameInput()
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('tile editor — the name', () => {
  let host: HTMLElement
  let stored = ''
  let setTitle: ReturnType<typeof vi.fn>
  let saveAndComplete: ReturnType<typeof vi.fn>
  let switchTo: ReturnType<typeof vi.fn>
  let toasts: { type?: string; message?: string }[]
  let offToast: () => void

  beforeEach(async () => {
    stored = ''
    setTitle = vi.fn(async (_segments: readonly string[], text: string) => (text === 'Taken' ? 'duplicate' : text ? 'set' : 'cleared'))
    services.set('@diamondcoreprocessor.com/DecorationService', {
      titleOf: async () => stored,
      setTitle,
      duplicateTitle: async () => ({ reading: 'Taken', address: 'salt-flats' }),
      readingAt: (segments: readonly string[]) => segments[segments.length - 1],
    })
    saveAndComplete = vi.fn(async () => service().close())
    switchTo = vi.fn(async (label: string) => { service().open(label, {}, null, []); return true })
    services.set('@diamondcoreprocessor.com/TileEditorDrone', { cancelEditing: () => service().close(), saveAndComplete, switchTo })
    toasts = []
    offToast = EffectBus.on<{ type?: string; message?: string }>('toast:show', toast => { toasts.push(toast) })
    toasts.length = 0
    host = document.createElement('hc-tile-editor')
    document.body.appendChild(host)
  })

  afterEach(() => {
    offToast()
    if (service().mode === 'editing') service().close()
    host.remove()
    resetWindowSession()
  })

  const openAlpha = async (): Promise<void> => {
    service().open('alpha', {}, null, [])
    await settle()
    await frames()
  }

  it('shows the STORED reading in the header, never what is half typed', async () => {
    stored = 'Stored'
    await openAlpha()
    expect(reading()).toBe('Stored')
    type('Typed')
    await frames()
    expect(reading()).toBe('Stored')
    expect(panel().querySelector('.te-state')?.getAttribute('data-state')).toBe('dirty')
  })

  it('reads as its address with no title, and clearing the text returns to it', async () => {
    await openAlpha()
    expect(reading()).toBe('alpha')
    expect(nameInput().placeholder).toBe('alpha')
    type('')
    nameInput().blur()
    await settle()
    expect(setTitle).not.toHaveBeenCalled()
  })

  it('writes a name still being typed when the editor closes', async () => {
    await openAlpha()
    type('Harbour')
    button('cancel').click()
    await settle()
    expect(setTitle).toHaveBeenCalledWith(['alpha'], 'Harbour')
  })

  it('writes it when the shell puts the window away, and names it in the Draft kept toast', async () => {
    await openAlpha()
    type('Harbour')
    parkWindows()
    await settle()
    expect(setTitle).toHaveBeenCalledWith(['alpha'], 'Harbour')
    expect(toasts.some(toast => toast.type === 'info' && toast.message?.includes('Harbour'))).toBe(true)
  })

  it('awaits the name in Save, before the drone saves', async () => {
    await openAlpha()
    type('Harbour')
    button('save').click()
    await settle()
    expect(setTitle).toHaveBeenCalledWith(['alpha'], 'Harbour')
    expect(saveAndComplete).toHaveBeenCalledTimes(1)
    expect(setTitle.mock.invocationCallOrder[0]).toBeLessThan(saveAndComplete.mock.invocationCallOrder[0])
  })

  it('keeps the editor open when the name is refused, returns to it, and marks the sibling', async () => {
    await openAlpha()
    type('Taken')
    nameInput().blur()
    button('save').click()
    await vi.waitFor(() => expect(document.activeElement).toBe(nameInput()))
    expect(saveAndComplete).not.toHaveBeenCalled()
    expect(service().mode).toBe('editing')
    expect(rails.at(-1)!.markSibling).toHaveBeenCalledWith(['salt-flats'])
    // the typed text is never mirrored into the header, and never dropped
    expect(reading()).toBe('alpha')
    expect(nameInput().value).toBe('Taken')
  })

  it('counts a pending name as a change: switching asks, and "don’t save" drops it', async () => {
    await openAlpha()
    type('Harbour')
    EffectBus.emitTransient('editor:switch-request', { label: 'beta' })
    await settle()
    expect(switchTo).not.toHaveBeenCalled()
    expect(panel().querySelector<HTMLElement>('.te-leave')?.hidden).toBe(false)
    button('leave-discard').click()
    await settle()
    // "don't save" lets go of the typed words: they are NOT written (changed on purpose)
    expect(setTitle).not.toHaveBeenCalled()
    expect(switchTo).toHaveBeenCalledWith('beta', { save: false })
  })

  it('does not save and open on a refused name', async () => {
    await openAlpha()
    type('Taken')
    EffectBus.emitTransient('editor:switch-request', { label: 'beta' })
    await settle()
    button('leave-save').click()
    await vi.waitFor(() => expect(document.activeElement).toBe(nameInput()))
    expect(switchTo).not.toHaveBeenCalled()
    expect(service().cell).toBe('alpha')
  })

  it('lets Escape revert the typed name to the stored reading, one rung', async () => {
    stored = 'Stored'
    await openAlpha()
    type('Typed')
    expect(tileEditorViewFacade.dismissInner()).toBe(true)
    expect(nameInput().value).toBe('Stored')
    expect(document.activeElement).not.toBe(nameInput())
  })

  it('draws a group on its own band element and never touches the title input', async () => {
    stored = 'Stored'
    await openAlpha()
    type('Typed')
    service().setGroup(['alpha', 'beta'])
    await settle()
    await frames()
    const band = panel().querySelector<HTMLElement>('.te-band-label')
    expect(band).not.toBeNull()
    expect(band).not.toBe(nameInput())
    expect(band!.contains(nameInput())).toBe(false)
    expect(band!.textContent).toContain('2')
    expect(nameInput().value).toBe('Typed')
    expect(nameInput().hidden).toBe(true)
    expect(panel().querySelector('.te-reading')?.textContent).toContain('2')
  })
})
