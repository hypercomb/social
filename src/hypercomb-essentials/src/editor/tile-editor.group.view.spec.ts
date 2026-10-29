// Editing several tiles together, at the level of the view: what the list does
// with the gesture (a toggle goes to the drone on the bus; the marks come from
// the SESSION, which can refuse a toggle), what the drawing keeps (only the
// parts that own a group field), and what the stage refuses (a drop, the
// camera). The write itself — only fields that were set, per tile — is the
// drone's and is pinned by tile-editor.group.spec.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Profile = { toggle(row: { name: string; segments: string[] }): void; labelOf(row: { name: string; segments: string[] }): string }
const services = vi.hoisted(() => new Map<string, unknown>())
const rails = vi.hoisted(() => [] as { profile: Profile; showSelection: ReturnType<typeof vi.fn>; showCurrent: ReturnType<typeof vi.fn> }[])

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
              profile, mount: () => {}, dispose: () => {}, paint: () => {}, refresh: () => {},
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

import { EffectBus } from '@hypercomb/core'
import './tile-editor.drone.js'
import { TileEditorElement, tileEditorViewFacade } from './tile-editor.view.js'
import type { TileEditorService } from './tile-editor.service.js'
import type { ImageEditorService } from './image-editor.service.js'
import { modelFor } from './models/models.js'
import { groupParts } from './diagram/fields.js'

if (!customElements.get('hc-tile-editor')) customElements.define('hc-tile-editor', TileEditorElement)
services.set('@diamondcoreprocessor.com/TileEditorView', tileEditorViewFacade)

const service = (): TileEditorService => services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
const images = (): ImageEditorService => services.get('@diamondcoreprocessor.com/ImageEditorService') as ImageEditorService
const panel = (): HTMLElement => document.querySelector('[data-hc-tile-editor]') as HTMLElement
const settle = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const frames = async (): Promise<void> => { for (let i = 0; i < 2; i++) await new Promise(resolve => requestAnimationFrame(() => resolve(0))) }
const callouts = (): string[] => [...panel().querySelectorAll<HTMLElement>('.te-dg-callout[data-part]')].map(node => node.dataset['part']!)

describe('tile editor — a group, at the view', () => {
  let host: HTMLElement

  beforeEach(async () => {
    services.set('@diamondcoreprocessor.com/DecorationService', {
      titleOf: async () => '', setTitle: async () => 'set', duplicateTitle: async () => null,
      readingAt: (segments: readonly string[]) => `read ${segments[segments.length - 1]}`,
    })
    services.set('@diamondcoreprocessor.com/TileEditorDrone', { cancelEditing: () => service().close(), saveAndComplete: async () => service().close() })
    rails.length = 0
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

  it('hands a toggled row to the drone as editor:group-toggle, and a plain click as a switch request', async () => {
    const rail = rails.at(-1)!
    const toggled: unknown[] = []
    const off = EffectBus.on('editor:group-toggle', payload => { toggled.push(payload) })
    rail.profile.toggle({ name: 'beta', segments: ['beta'] })
    off()
    expect(toggled.at(-1)).toEqual({ label: 'beta' })
  })

  it('reads a row by its reading, not its address', () => {
    const rail = rails.at(-1)!
    expect(rail.profile.labelOf({ name: 'beta', segments: ['beta'] })).toBe('read beta')
  })

  it('marks the list from the session, not from the list', async () => {
    const rail = rails.at(-1)!
    expect(rail.showCurrent).toHaveBeenCalledWith('alpha', [])
    service().setGroup(['alpha', 'beta'])
    await settle()
    await frames()
    expect(rail.showSelection).toHaveBeenLastCalledWith([['alpha'], ['beta']])
    // a group let go of marks nothing
    service().open('alpha', {}, null, [])
    await settle()
    await frames()
    expect(rail.showSelection).toHaveBeenLastCalledWith([])
  })

  it('keeps only the parts that own a group field, and no questions', async () => {
    const model = modelFor()
    const all = model.parts.map(part => part.id).sort()
    expect(callouts().filter(id => all.includes(id)).sort()).toEqual(all)
    service().setGroup(['alpha', 'beta'])
    await settle()
    await frames()
    const kept = groupParts(model.parts).map(part => part.id).sort()
    expect(kept.length).toBeLessThan(all.length)
    expect(callouts().filter(id => all.includes(id)).sort()).toEqual(kept)
    expect(callouts().filter(id => !all.includes(id))).toEqual([])
  })

  it('disarms the stage: a dropped picture and the camera do nothing', async () => {
    service().setGroup(['alpha', 'beta'])
    await settle()
    await frames()
    const load = vi.spyOn(images(), 'loadImage')
    const stage = panel().querySelector('.te-stage')!
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown }
    drop.dataTransfer = { files: [new File(['x'], 'x.png', { type: 'image/png' })], types: ['Files'] }
    stage.dispatchEvent(drop)
    await settle()
    expect(load).not.toHaveBeenCalled()
    const getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices: async () => [] } })
    panel().querySelector<HTMLButtonElement>('.te-empty-btn[data-action="camera"]')?.click()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(panel().querySelector<HTMLElement>('.te-empty')?.hidden).toBe(true)
    load.mockRestore()
  })

  it('dismissing the restore strip drops the stash', async () => {
    service().stash({ cell: 'alpha', segments: [], properties: { link: 'https://example.com' }, picture: null, pictureRemoved: false })
    service().restoreProperties({})
    await settle()
    await frames()
    const strip = panel().querySelector<HTMLElement>('.te-note[role="status"]')!
    expect(strip.hidden).toBe(false)
    strip.querySelector<HTMLButtonElement>('button[data-action="dismiss-restore"]')!.click()
    expect(strip.hidden).toBe(true)
    expect(service().stashFor('alpha', [])).toBeNull()
  })
})
