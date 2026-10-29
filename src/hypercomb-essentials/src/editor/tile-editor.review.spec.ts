// The desk, at the level of the view — what the review of the full-screen
// redesign found: a group is one page's tiles, a refused name never locks Save
// in a group, Save always runs the link-safety check, "don't save" writes
// nothing, a click on a group member collapses the group, a throw while the
// desk comes down cannot strand the hive's claims, and the desk is a
// well-behaved citizen of a screen reader (frame, alerts, close, focus).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Profile = { toggle(row: { name: string; segments: string[] }): void }
type Rail = { profile: Profile; dispose: () => void }
const services = vi.hoisted(() => new Map<string, unknown>())
const rails = vi.hoisted(() => [] as Rail[])

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => services.get(key),
    register: (key: string, value: unknown) => services.set(key, value),
    whenReady: (key: string, callback: (value: unknown) => void) => {
      if (key === '@hypercomb.social/ShellSurfaceRegistry') callback({ add: () => {}, all: () => [] })
      if (key === '@diamondcoreprocessor.com/AgentTilesRailFactory') {
        callback({
          create: (profile: Profile) => {
            const rail = {
              profile, mount: () => {}, dispose: () => {}, paint: () => {}, refresh: () => {}, showCurrent: () => {},
              showSelection: () => {}, markSibling: () => {}, onSubjectChanged: () => {},
            }
            rails.push(rail)
            return rail
          },
        })
      }
    },
  }
})

import { EffectBus, resetWindowSession } from '@hypercomb/core'
import './tile-editor.drone.js'
import { TileEditorElement, tileEditorViewFacade } from './tile-editor.view.js'
import type { TileEditorService } from './tile-editor.service.js'

if (!customElements.get('hc-tile-editor')) customElements.define('hc-tile-editor', TileEditorElement)
services.set('@diamondcoreprocessor.com/TileEditorView', tileEditorViewFacade)

const service = (): TileEditorService => services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
const panel = (): HTMLElement => document.querySelector('[data-hc-tile-editor]') as HTMLElement
const nameInput = (): HTMLInputElement => panel().querySelector<HTMLInputElement>('.te-title')!
const button = (action: string): HTMLButtonElement => panel().querySelector<HTMLButtonElement>(`.te-actions button[data-action="${action}"]`)!
const settle = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const frames = async (n = 2): Promise<void> => { for (let i = 0; i < n; i++) await new Promise(resolve => requestAnimationFrame(() => resolve(0))) }
const type = (text: string): void => {
  const input = nameInput()
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const ctrlEnter = (): void => { panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })) }

describe('tile editor — the review fixes', () => {
  let host: HTMLElement
  let setTitle: ReturnType<typeof vi.fn>
  let saveAndComplete: ReturnType<typeof vi.fn>
  let switchTo: ReturnType<typeof vi.fn>
  let check: ReturnType<typeof vi.fn>
  let modes: { enter: ReturnType<typeof vi.fn>; exit: ReturnType<typeof vi.fn>; releaseOwner: ReturnType<typeof vi.fn> }
  let open: { label: string; parent: readonly string[] }
  let toasts: { type?: string; message?: string }[]
  let offToast: () => void

  beforeEach(() => {
    setTitle = vi.fn(async (_segments: readonly string[], text: string) => (text === 'Taken' ? 'duplicate' : text ? 'set' : 'cleared'))
    services.set('@diamondcoreprocessor.com/DecorationService', {
      titleOf: async () => '',
      setTitle,
      duplicateTitle: async () => ({ reading: 'Taken', address: 'salt-flats' }),
      readingAt: (segments: readonly string[]) => segments[segments.length - 1],
    })
    check = vi.fn(async () => ({ decision: 'allow', reason: '' }))
    services.set('@diamondcoreprocessor.com/LinkSafetyService', { check })
    modes = { enter: vi.fn(), exit: vi.fn(), releaseOwner: vi.fn() }
    services.set('@diamondcoreprocessor.com/ModeRegistry', modes)
    open = { label: 'alpha', parent: [] }
    saveAndComplete = vi.fn(async () => service().close())
    switchTo = vi.fn(async (label: string) => { service().open(label, {}, null, []); return true })
    services.set('@diamondcoreprocessor.com/TileEditorDrone', {
      cancelEditing: () => service().close(), saveAndComplete, switchTo,
      get openTile() { return open },
    })
    rails.length = 0
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
    services.delete('@diamondcoreprocessor.com/ModeRegistry')
    resetWindowSession()
  })

  const openAlpha = async (): Promise<void> => {
    service().open('alpha', {}, null, [])
    await settle()
    await frames()
  }

  // 1 ── a group is one page ─────────────────────────────────────────────

  it('ignores a rail row of another page when toggling a group, and says why; a row of this page goes through', async () => {
    open = { label: 'alpha', parent: ['harbour'] }
    await openAlpha()
    const toggled: unknown[] = []
    const off = EffectBus.on('editor:group-toggle', payload => { toggled.push(payload) })
    toggled.length = 0
    const rail = rails.at(-1)!

    rail.profile.toggle({ name: 'elsewhere', segments: ['other', 'elsewhere'] })
    expect(toggled).toEqual([])
    expect(toasts.filter(toast => toast.type === 'info').map(toast => toast.message)).toEqual(['A group is tiles of one page.'])

    rail.profile.toggle({ name: 'beta', segments: ['harbour', 'beta'] })
    off()
    expect(toggled).toEqual([{ label: 'beta' }])
  })

  // 3 ── a refused name never locks Save in a group ──────────────────────

  it('lets Save through in a group after a name was refused: entering the group lets the draft go', async () => {
    await openAlpha()
    type('Taken')
    nameInput().blur()
    await vi.waitFor(() => expect(nameInput().getAttribute('aria-invalid')).toBe('true'))

    service().setGroup(['alpha', 'beta'])
    await settle()
    await frames()
    expect(nameInput().value).toBe('')
    expect(nameInput().hasAttribute('aria-invalid')).toBe(false)

    button('save').click()
    await settle()
    expect(saveAndComplete).toHaveBeenCalledTimes(1)
  })

  // 4 ── Ctrl+Enter runs the link-safety check ───────────────────────────

  it('checks the link before Ctrl+Enter saves, and does not save a denied one', async () => {
    check.mockResolvedValue({ decision: 'deny', reason: 'a known bad host' })
    await openAlpha()
    service().setLink('https://bad.example')
    ctrlEnter()
    await vi.waitFor(() => expect(check).toHaveBeenCalledWith('https://bad.example'))
    await settle()
    expect(saveAndComplete).not.toHaveBeenCalled()
    expect(service().link).toBe('')
    expect(service().mode).toBe('editing')
  })

  it('saves an allowed link after exactly one check', async () => {
    await openAlpha()
    service().setLink('https://fine.example')
    ctrlEnter()
    await vi.waitFor(() => expect(saveAndComplete).toHaveBeenCalledTimes(1))
    expect(check).toHaveBeenCalledTimes(1)
    expect(check.mock.invocationCallOrder[0]).toBeLessThan(saveAndComplete.mock.invocationCallOrder[0])
  })

  // 5 ── the leave prompt ────────────────────────────────────────────────

  it('"don’t save" never writes the typed name; "save and open" does', async () => {
    await openAlpha()
    type('Harbour')
    EffectBus.emitTransient('editor:switch-request', { label: 'beta' })
    await settle()
    button('leave-discard').click()
    await settle()
    expect(setTitle).not.toHaveBeenCalled()
    expect(switchTo).toHaveBeenCalledWith('beta', { save: false })

    await frames()
    service().close()
    await settle()
    setTitle.mockClear()
    switchTo.mockClear()
    await openAlpha()
    type('Harbour')
    EffectBus.emitTransient('editor:switch-request', { label: 'beta' })
    await settle()
    button('leave-save').click()
    await settle()
    expect(setTitle).toHaveBeenCalledWith(['alpha'], 'Harbour')
    expect(switchTo).toHaveBeenCalledWith('beta', { save: true })
  })

  // 6 ── a plain click on a member collapses the group ───────────────────

  it('moves to a tile of the group on a plain click, so the group collapses onto it', async () => {
    await openAlpha()
    service().setGroup(['alpha', 'beta'])
    await settle()
    await frames()
    EffectBus.emitTransient('editor:switch-request', { label: 'beta' })
    await settle()
    expect(switchTo).toHaveBeenCalledWith('beta', { save: false })
  })

  // 8 ── teardown ────────────────────────────────────────────────────────

  it('releases the hive’s claims even when a part of the desk throws as it comes down', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const unsuppressed: unknown[] = []
    const off = EffectBus.on('keymap:unsuppress', payload => { unsuppressed.push(payload) })
    await openAlpha()
    unsuppressed.length = 0
    rails.at(-1)!.dispose = () => { throw new Error('the rail broke') }

    service().close()
    await settle()
    off()
    warn.mockRestore()

    expect(modes.exit).toHaveBeenCalledWith('view:active', 'tile-editor')
    expect(modes.exit).toHaveBeenCalledWith('view:keeps-controls', 'tile-editor')
    expect(modes.releaseOwner).toHaveBeenCalledWith('tile-editor')
    expect(unsuppressed).toEqual([{ reason: 'tile-editor' }])
    expect(document.querySelector('[data-hc-tile-editor]')).toBeNull()
  })

  // 11 ── a screen reader ────────────────────────────────────────────────

  it('makes the stage a described group named the picture frame', async () => {
    await openAlpha()
    const stage = panel().querySelector<HTMLElement>('.te-stage')!
    expect(stage.getAttribute('role')).toBe('group')
    expect(stage.getAttribute('aria-roledescription')).toBe('picture frame')
    expect(stage.getAttribute('aria-label')).toBe('Picture frame')
    const keys = document.getElementById(stage.getAttribute('aria-describedby') ?? '')
    expect(keys?.textContent).toBe('Arrow keys move the picture, plus and minus zoom, 0 resets, F fits.')
  })

  it('announces a refused name in the alert region, again when the same name is refused again', async () => {
    await openAlpha()
    const alert = panel().querySelector<HTMLElement>('.te-live[role="alert"]')!
    const heard: string[] = []
    const watcher = new MutationObserver(() => { heard.push(alert.textContent ?? '') })
    watcher.observe(alert, { childList: true, characterData: true, subtree: true })
    const said = '"Taken" is taken. The tile salt-flats already reads that way here.'

    type('Taken')
    nameInput().blur()
    await vi.waitFor(() => expect(alert.textContent).toBe(said))
    type('Tak')
    type('Taken')
    nameInput().blur()
    await vi.waitFor(() => expect(heard.filter(text => text === said).length).toBe(2))
    await frames()
    watcher.disconnect()

    expect(heard).toEqual([said, '', said])
  })

  it('says it is closed from a region that outlives the desk, and gives focus back', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    await openAlpha()
    expect(document.activeElement).not.toBe(opener)

    service().close()
    await settle()

    expect(host.querySelector('.te-live[role="status"]')?.textContent).toBe('Closed')
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  // 12 ── the group writes line ──────────────────────────────────────────

  it('says what a group will write to every tile, once something is set', async () => {
    await openAlpha()
    service().setGroup(['alpha', 'beta'])
    await settle()
    await frames()
    const lines = (): string[] => [...panel().querySelectorAll<HTMLElement>('.te-note')]
      .filter(note => !note.hidden && note.textContent?.startsWith('Set on all'))
      .map(note => note.textContent ?? '')
    expect(lines()).toEqual([])

    service().setBorderColor('#abcdef')
    await frames()
    expect(lines()).toEqual(['Set on all 2 tiles: border.'])

    service().setLink('https://fine.example')
    await frames()
    expect(lines()).toEqual(['Set on all 2 tiles: border, link.'])

    service().setBorderColor('')
    service().setLink('')
    await frames()
    expect(lines()).toEqual([])
  })
})
