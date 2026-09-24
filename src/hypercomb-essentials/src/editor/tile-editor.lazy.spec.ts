// The tile editor's panel arrives with the first edit, not at boot
// (atomic-modules-plan.md, "adopt the proper load"). The bee adds the surface
// at boot without the view; the first `tile:action` edit loads the view and
// defines the element BEFORE the session opens, the element the shell already
// made upgrades in place, and a second edit defines nothing again.

import { afterAll, describe, expect, it, vi } from 'vitest'

const TAG = 'hc-tile-editor'
const VIEW_KEY = '@diamondcoreprocessor.com/TileEditorView'

const state = vi.hoisted(() => ({
  services: new Map<string, unknown>(),
  added: [] as unknown[],
  failNextLoad: false,
}))

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => state.services.get(key),
    // First wins, as the real IoC map does — a stub has to forward, because
    // nothing can replace it.
    register: (key: string, value: unknown) => { if (!state.services.has(key)) state.services.set(key, value) },
    whenReady: (key: string, callback: (value: unknown) => void) => {
      if (key === '@hypercomb.social/ShellSurfaceRegistry') callback({ add: (s: unknown) => state.added.push(s), all: () => [] })
    },
  }
})

vi.mock('./tile-editor.view.js', async importOriginal => {
  if (state.failNextLoad) { state.failNextLoad = false; throw new Error('the atom did not arrive') }
  return importOriginal()
})
vi.mock('./tile-properties.js', () => ({
  readTilePropertiesAt: vi.fn(async () => ({ link: 'https://example.com' })),
  writeTilePropertiesAt: vi.fn(),
  cellLocationSig: vi.fn(),
  readTilePropsIndex: vi.fn(() => ({})),
  lookupTilePropsSig: vi.fn(),
  readCellProperties: vi.fn(),
}))
vi.mock('../commands/decoration-kind-index.js', () => ({
  referenceTargetForLabel: vi.fn(() => null),
  referenceEditsRootDefaultForLabel: vi.fn(() => false),
}))

import { EffectBus } from '@hypercomb/core'
import type { TileEditorService } from './tile-editor.service.js'

const define = vi.spyOn(customElements, 'define')
state.services.set('@hypercomb.social/Store', { getResource: async () => null, putResource: async () => '' })
state.services.set('@hypercomb.social/Lineage', { explorerSegments: () => [] })
await import('./tile-editor.drone.js')

const service = (): TileEditorService => state.services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
const defines = (): number => define.mock.calls.filter(([name]) => name === TAG).length
const edit = (label: string): void => { EffectBus.emit('tile:action', { action: 'edit', label, q: 0, r: 0, index: 0 }) }

// What the shell's surface host does: create the tag, defined or not.
const host = document.createElement(TAG)
document.body.appendChild(host)

afterAll(() => {
  if (service().mode === 'editing') service().close()
  host.remove()
})

describe('tile editor — the panel arrives with the first edit', () => {
  it('adds the surface at boot and leaves the element undefined', () => {
    expect(state.added).toEqual([{ name: TAG, owner: VIEW_KEY, element: TAG, order: 220 }])
    expect(customElements.get(TAG)).toBeUndefined()
    // The Escape cascade asks the view's face synchronously: nothing to unwind.
    expect((state.services.get(VIEW_KEY) as { dismissInner(): boolean }).dismissInner()).toBe(false)
  })

  it('opens nothing when the panel cannot load, says so, and loads again on the next edit', async () => {
    const toasts: { type?: string; message?: string }[] = []
    const off = EffectBus.on<{ type?: string; message?: string }>('toast:show', toast => { toasts.push(toast) })
    toasts.length = 0 // the bus replays whatever was shown last
    state.failNextLoad = true
    edit('alpha')
    await vi.waitFor(() => expect(toasts.some(toast => toast.type === 'warning')).toBe(true))
    off()
    expect(service().mode).not.toBe('editing')
    expect(customElements.get(TAG)).toBeUndefined()
  })

  it('defines the element before the session opens, and the shell’s element upgrades in place', async () => {
    const definedAtOpen: boolean[] = []
    const open = service().open
    vi.spyOn(service(), 'open').mockImplementation((...args) => {
      definedAtOpen.push(!!customElements.get(TAG))
      return open(...args)
    })

    edit('alpha')
    // The first real load of the view module (a cold transform can be slow).
    await vi.waitFor(() => expect(service().cell).toBe('alpha'), { timeout: 15_000 })

    expect(definedAtOpen).toEqual([true])
    expect(defines()).toBe(1)
    expect(host).toBeInstanceOf(customElements.get(TAG)!)
    expect(document.querySelector('[data-hc-tile-editor]')).not.toBeNull()
  }, 20_000)

  it('forwards the Escape cascade to the mounted panel through the face registered at boot', () => {
    const title = document.querySelector<HTMLInputElement>('[data-hc-tile-editor] .te-title')
    expect(title).not.toBeNull()
    title!.focus()
    expect((state.services.get(VIEW_KEY) as { dismissInner(): boolean }).dismissInner()).toBe(true)
  })

  it('a second edit loads and defines nothing again', async () => {
    edit('beta')
    await vi.waitFor(() => expect(service().cell).toBe('beta'))
    expect(defines()).toBe(1)
  })
})
