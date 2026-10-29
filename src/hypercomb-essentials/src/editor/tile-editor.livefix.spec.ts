// The desk, after the live test: an unsafe link scheme is refused before any
// service is asked, Ctrl+Enter saves from the page itself, the list's mark
// follows the OPEN tile after every switch that did not happen, and a text-size
// change re-lays the desk out.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Rail = { showCurrent: ReturnType<typeof vi.fn> }
const services = vi.hoisted(() => new Map<string, unknown>())
const rails = vi.hoisted(() => [] as Rail[])
const observers = vi.hoisted(() => [] as { target: Element; callback: () => void }[])

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
              mount: () => {}, dispose: () => {}, paint: () => {}, refresh: () => {}, showCurrent: vi.fn(),
              showSelection: () => {}, markSibling: () => {}, onSubjectChanged: () => {},
            }
            rails.push(rail)
            return rail
          },
        })
      }
    },
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    #callback: () => void
    constructor(callback: () => void) { this.#callback = callback }
    observe(target: Element): void { observers.push({ target, callback: this.#callback }) }
    unobserve(): void {}
    disconnect(): void {}
  }
})

import { EffectBus, resetWindowSession } from '@hypercomb/core'
import './tile-editor.drone.js'
import { TileEditorElement, tileEditorViewFacade, unsafeScheme } from './tile-editor.view.js'
import type { TileEditorService } from './tile-editor.service.js'

if (!customElements.get('hc-tile-editor')) customElements.define('hc-tile-editor', TileEditorElement)
services.set('@diamondcoreprocessor.com/TileEditorView', tileEditorViewFacade)

const service = (): TileEditorService => services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
const panel = (): HTMLElement => document.querySelector('[data-hc-tile-editor]') as HTMLElement
const nameInput = (): HTMLInputElement => panel().querySelector<HTMLInputElement>('.te-title')!
const button = (action: string): HTMLButtonElement => panel().querySelector<HTMLButtonElement>(`.te-actions button[data-action="${action}"]`)!
const settle = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const frames = async (n = 2): Promise<void> => { for (let i = 0; i < n; i++) await new Promise(resolve => requestAnimationFrame(() => resolve(0))) }
const ctrlEnter = (on: EventTarget): void => { on.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })) }

describe('unsafeScheme', () => {
  it('refuses an explicit scheme that is not web or mail, however it is spelled', () => {
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>', 'file:///etc/passwd', 'vbscript:x', 'blob:abc']) {
      expect(unsafeScheme(bad), bad).not.toBeNull()
    }
  })
  it('lets web, mail, relative and schemeless input stand', () => {
    for (const fine of ['https://a.example', 'HTTP://a.example', 'mailto:me@a.example', 'a.example/page', '/relative', 'a.example:8080/x', 'localhost:3000', '#top']) {
      expect(unsafeScheme(fine), fine).toBeNull()
    }
  })
})

describe('tile editor — the live-test fixes', () => {
  let host: HTMLElement
  let saveAndComplete: ReturnType<typeof vi.fn>
  let switchTo: ReturnType<typeof vi.fn>
  let check: ReturnType<typeof vi.fn>
  let open: { label: string; parent: readonly string[] }

  beforeEach(() => {
    services.set('@diamondcoreprocessor.com/DecorationService', {
      titleOf: async () => '',
      setTitle: vi.fn(async (_s: readonly string[], text: string) => (text === 'Taken' ? 'duplicate' : text ? 'set' : 'cleared')),
      duplicateTitle: async () => ({ reading: 'Taken', address: 'salt-flats' }),
      readingAt: (segments: readonly string[]) => segments[segments.length - 1],
    })
    check = vi.fn(async () => ({ decision: 'allow', reason: '' }))
    services.set('@diamondcoreprocessor.com/LinkSafetyService', { check })
    services.set('@diamondcoreprocessor.com/ModeRegistry', { enter: vi.fn(), exit: vi.fn(), releaseOwner: vi.fn() })
    open = { label: 'alpha', parent: [] }
    saveAndComplete = vi.fn(async () => service().close())
    switchTo = vi.fn(async () => false)
    services.set('@diamondcoreprocessor.com/TileEditorDrone', {
      cancelEditing: () => service().close(), saveAndComplete, switchTo,
      get openTile() { return open },
    })
    rails.length = 0
    observers.length = 0
    host = document.createElement('hc-tile-editor')
    document.body.appendChild(host)
  })

  afterEach(() => {
    if (service().mode === 'editing') service().close()
    host.remove()
    services.delete('@diamondcoreprocessor.com/ModeRegistry')
    resetWindowSession()
  })

  const openAlpha = async (): Promise<void> => {
    service().open('alpha', {}, null, [])
    await settle()
    await frames()
  }

  it('denies an unsafe scheme before the service is asked, clears it and does not save', async () => {
    await openAlpha()
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///c:/x', 'vbscript:go']) {
      service().setLink(bad)
      ctrlEnter(panel())
      await settle()
      await frames()
      expect(service().link, bad).toBe('')
      expect(panel().textContent).toContain('Only web and mail links can be saved.')
    }
    expect(check).not.toHaveBeenCalled()
    expect(saveAndComplete).not.toHaveBeenCalled()
    expect(service().mode).toBe('editing')
  })

  it('still sends a web link to the safety service', async () => {
    await openAlpha()
    service().setLink('https://fine.example')
    ctrlEnter(panel())
    await vi.waitFor(() => expect(saveAndComplete).toHaveBeenCalledTimes(1))
    expect(check).toHaveBeenCalledWith('https://fine.example')
  })

  it('saves on Ctrl+Enter when focus is on the page itself, and not from another field', async () => {
    await openAlpha()
    ;(document.activeElement as HTMLElement | null)?.blur()
    const other = document.createElement('input')
    document.body.appendChild(other)
    other.focus()
    ctrlEnter(other)
    await settle()
    expect(saveAndComplete).not.toHaveBeenCalled()
    other.remove()

    ctrlEnter(document.body)
    await vi.waitFor(() => expect(saveAndComplete).toHaveBeenCalledTimes(1))
  })

  it('stops listening on the page once the desk is closed', async () => {
    await openAlpha()
    service().close()
    await settle()
    ctrlEnter(document.body)
    await settle()
    expect(saveAndComplete).not.toHaveBeenCalled()
  })

  it('puts the list mark back on the open tile after "keep editing"', async () => {
    await openAlpha()
    const rail = rails.at(-1)!
    nameInput().focus()
    nameInput().value = 'Harbour'
    nameInput().dispatchEvent(new Event('input', { bubbles: true }))
    EffectBus.emitTransient('editor:switch-request', { label: 'beta' })
    await settle()
    rail.showCurrent.mockClear()
    button('leave-stay').click()
    await settle()
    expect(rail.showCurrent).toHaveBeenCalledWith('alpha', [])
  })

  it('puts the list mark back when a switch did not happen', async () => {
    await openAlpha()
    const rail = rails.at(-1)!
    rail.showCurrent.mockClear()
    EffectBus.emitTransient('editor:switch-request', { label: 'beta' })   // switchTo answers false: the desk stays on alpha
    await settle()
    await frames()
    expect(switchTo).toHaveBeenCalled()
    expect(rail.showCurrent).toHaveBeenCalledWith('alpha', [])
  })

  it('re-lays the desk out when the text size changes (the em probe resizes)', async () => {
    await openAlpha()
    const probe = panel().querySelector('.te-em-probe')
    expect(probe).not.toBeNull()
    const watching = observers.filter(o => o.target === probe)
    expect(watching.length).toBe(1)
    panel().dataset['layout'] = 'stale'
    watching[0]!.callback()
    await frames()
    expect(panel().dataset['layout']).not.toBe('stale')
  })
})
