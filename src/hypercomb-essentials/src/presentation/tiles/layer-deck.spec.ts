// layer-deck.spec.ts — the phone's Views sheet, driven through its doors.
//
//   · `layer:deck-open` opens it (phone only, never under a view); again closes
//   · three groups from the registries, nothing hand-listed: open as (the
//     layer's toggles, default accented) · add here (attachable bees the layer
//     lacks + camera + library) · see (lanes rung with its digit, pheromones,
//     undo, redo; no fullscreen where the platform has none)
//   · every plate emits the contract it was written against, and the ones that
//     hand the screen to something else close the sheet first
//   · the way out: back plate, backdrop, Escape, BACK (popstate), deck-close,
//     a view taking the screen, the phone stopping being a phone

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const registered: Record<string, unknown> = {}
const services: Record<string, unknown> = {}
let mobileActive = true
let viewActiveNow = false
let surfaceAdded: unknown = null

;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered[key] = value },
  get: (key: string) => registered[key] ?? services[key],
  has: (key: string) => key in registered || key in services,
  whenReady: (key: string, cb: (v: unknown) => void) => {
    if (key === '@hypercomb.social/ShellSurfaceRegistry') cb({ add: (s: unknown) => { surfaceAdded = s } })
  },
}

type Bee = {
  view: string; toggleIcon: string; decorationKind: string
  attachable?: boolean; adoptable?: boolean; behavior?: string; labelKey?: string; queenKey?: string
}
const bees: Bee[] = [
  { view: 'slides', toggleIcon: 'slideshow', decorationKind: 'visual:diagram:slide', attachable: true, labelKey: 'view.slides', queenKey: '@x/SlidesQueen' },
  { view: 'scroller', toggleIcon: 'view_day', decorationKind: 'visual:scroller:feed', attachable: true },
  { view: 'tree', toggleIcon: 'account_tree', decorationKind: 'visual:tree:branch', attachable: true, behavior: 'navigation' },
  { view: 'website', toggleIcon: 'web', decorationKind: 'visual:website:page' },
]
let segments: string[] = ['honey-garden']

services['@diamondcoreprocessor.com/MobileMode'] = { get active() { return mobileActive } }
services['@diamondcoreprocessor.com/ModeRegistry'] = { isActive: () => viewActiveNow }
services['@hypercomb.social/Lineage'] = { explorerSegments: () => segments }
services['@diamondcoreprocessor.com/VisualBeeRegistry'] = {
  get: (view: string) => bees.find(b => b.view === view),
  forPlatform: () => bees,
  all: () => bees,
}
services['@x/SlidesQueen'] = {}
const createTile = vi.fn<(blob: Blob) => Promise<void>>(async () => {})
services['@diamondcoreprocessor.com/ImagePasteWorker'] = { createTileFromImage: createTile }

// OUT contracts, spied before anything is emitted so a replay cannot confuse.
const out = {
  toggle: vi.fn(), apply: vi.fn(), camera: vi.fn(), tags: vi.fn(), pin: vi.fn(), keymap: vi.fn(), step: vi.fn(), set: vi.fn(),
  publish: vi.fn(), meshModal: vi.fn(), meshLeave: vi.fn(), face: vi.fn(),
}
EffectBus.on('phone:face-set', out.face)
EffectBus.on('publish:view-toggle', out.publish)
EffectBus.on('mesh:open-modal', out.meshModal)
EffectBus.on('mesh:leave', out.meshLeave)
EffectBus.on('view:toggle', out.toggle)
EffectBus.on('feature:apply', out.apply)
EffectBus.on('camera:capture-open', out.camera)
EffectBus.on('tags:view-open', out.tags)
EffectBus.on('viewport:pin-toggle', out.pin)
EffectBus.on('keymap:invoke', out.keymap)
EffectBus.on('lanes:step', out.step)
EffectBus.on('lanes:set', out.set)

const { LAYER_DECK_KEY, LAYER_DECK_SURFACE } = await import('./layer-deck.drone.js')

type DroneShape = { pulse(g: string): Promise<void>; open(): void; close(): void; readonly open_: boolean }
const drone = registered[LAYER_DECK_KEY] as DroneShape
await drone.pulse('')

const el = document.createElement(LAYER_DECK_SURFACE)
document.body.appendChild(el)

const sheet = () => el.querySelector('[data-role="sheet"]') as HTMLElement | null
const plates = () => Array.from(el.querySelectorAll('[data-hc-tv-app]')) as HTMLElement[]
const plate = (action: string) => plates().find(p => p.dataset['action'] === action) as HTMLElement | undefined
const titles = () => Array.from(el.querySelectorAll('[data-hc-tv-dot]')).map(d => d.getAttribute('aria-label'))
const isOpen = () => el.style.display !== 'none' && !!sheet()
const open = () => { EffectBus.emit('layer:deck-open', {}) }

beforeEach(() => {
  drone.close()
  mobileActive = true
  viewActiveNow = false
  segments = ['honey-garden']
  for (const spy of Object.values(out)) spy.mockClear()
  createTile.mockClear()
  EffectBus.emit('view-toggles:changed', { toggles: [
    { view: 'slides', icon: 'slideshow', label: 'Slides', active: false, isDefault: true },
    { view: 'website', icon: 'web', label: 'Website', active: false, isDefault: false },
  ] })
  EffectBus.emit('lanes:changed', { active: true, lanes: 3 })
})

describe('the surface', () => {
  it('is contributed to the shell-surface registry as an element, above the bar, hidden until asked', () => {
    expect(surfaceAdded).toMatchObject({ name: LAYER_DECK_SURFACE, element: LAYER_DECK_SURFACE, order: 700 })
    expect(el.style.zIndex).toBe('100003')
    expect(isOpen()).toBe(false)
  })
})

describe('opening', () => {
  it('layer:deck-open opens a sheet of plates; again closes it', () => {
    open()
    expect(isOpen()).toBe(true)
    expect(drone.open_).toBe(true)
    expect(plates().length).toBeGreaterThanOrEqual(3)
    open()
    expect(isOpen()).toBe(false)
  })

  it('pushes one history entry and pops it on a close that was not BACK', () => {
    const push = vi.spyOn(window.history, 'pushState')
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    open()
    expect(push).toHaveBeenCalledTimes(1)
    drone.close()
    expect(back).toHaveBeenCalledTimes(1)
    back.mockClear()
    // BACK itself: the entry is already gone — close without popping.
    open()
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(isOpen()).toBe(false)
    expect(back).not.toHaveBeenCalled()
    push.mockRestore()
    back.mockRestore()
  })

  it('refuses when the phone is not a phone, or a view holds the screen', () => {
    mobileActive = false
    open()
    expect(isOpen()).toBe(false)
    mobileActive = true
    viewActiveNow = true
    open()
    expect(isOpen()).toBe(false)
  })
})

describe('the three groups', () => {
  it('open as: the layer\'s toggles, the default accented; a tap closes then view:toggle on', () => {
    open()
    expect(titles()[0]).toBe('open as')
    const slides = plate('view-toggle:slides')!
    const website = plate('view-toggle:website')!
    expect(slides.firstElementChild?.getAttribute('data-tone')).toBe('accent')
    expect(website.firstElementChild?.getAttribute('data-tone')).toBe('plain')
    slides.click()
    expect(isOpen()).toBe(false)
    expect(out.toggle).toHaveBeenCalledWith({ view: 'slides', mode: 'on' })
  })

  it('add here: attachable bees the layer lacks, never navigation or unattachable ones — the camera and library moved to the Add sheet', () => {
    open()
    expect(plate('feature:apply:scroller')).toBeDefined()
    expect(plate('feature:apply:slides')).toBeUndefined()   // carried already
    expect(plate('feature:apply:tree')).toBeUndefined()     // navigation
    expect(plate('feature:apply:website')).toBeUndefined()  // not attachable
    expect(plate('camera')).toBeUndefined()
    expect(plate('library')).toBeUndefined()
    plate('feature:apply:scroller')!.click()
    expect(out.apply).toHaveBeenCalledWith({ view: 'scroller', segments: ['honey-garden'], remove: false })
    expect(isOpen()).toBe(false)
  })

  it('add here at the root offers no behaviour (nothing to mark)', () => {
    segments = []
    open()
    expect(plate('feature:apply:scroller')).toBeUndefined()
  })

  it('see: share hands the screen to the publish sheet; swarm joins through the location dialog and leaves through mesh:leave', () => {
    open()
    plate('share')!.click()
    expect(isOpen()).toBe(false)
    expect(out.publish).toHaveBeenCalledTimes(1)
    open()
    plate('swarm')!.click()
    expect(out.meshModal).toHaveBeenCalledWith({ join: true })
    expect(out.meshLeave).not.toHaveBeenCalled()
    EffectBus.emit('mesh:public-changed', { public: true })
    open()
    expect(plate('swarm')!.firstElementChild?.getAttribute('data-tone')).toBe('accent')
    plate('swarm')!.click()
    expect(out.meshLeave).toHaveBeenCalledTimes(1)
    EffectBus.emit('mesh:public-changed', { public: false })
  })

  it('see: from the list face the lanes plate selects the hexagons and closes; on the hexagons a list plate is the way back', () => {
    EffectBus.emit('phone:face', { face: 'list' })
    open()
    expect(plate('list')).toBeUndefined()
    plate('lanes')!.click()
    expect(out.face).toHaveBeenCalledWith({ face: 'hexagons' })
    expect(out.step).not.toHaveBeenCalled()
    expect(isOpen()).toBe(false)
    EffectBus.emit('phone:face', { face: 'hexagons' })
    open()
    expect(plate('lanes')!.firstElementChild?.getAttribute('data-tone')).toBe('accent')
    plate('list')!.click()
    expect(out.face).toHaveBeenCalledWith({ face: 'list' })
    expect(isOpen()).toBe(false)
  })

  it('see: on the hexagons the rung carries its digit and steps down, wrapping to three at one; no fullscreen plate here', () => {
    EffectBus.emit('phone:face', { face: 'hexagons' })
    open()
    const lanes = plate('lanes')!
    expect(lanes.querySelector('[data-role="app-badge"]')?.textContent).toBe('3')
    expect(plate('fullscreen')).toBeUndefined()
    lanes.click()
    expect(out.step).toHaveBeenCalledWith({ dir: -1 })
    expect(isOpen()).toBe(true)
    EffectBus.emit('lanes:changed', { active: true, lanes: 1 })
    expect(plate('lanes')!.querySelector('[data-role="app-badge"]')?.textContent).toBe('1')
    plate('lanes')!.click()
    expect(out.set).toHaveBeenCalledWith({ lanes: 3 })
  })

  it('see: pheromones hands over; undo and redo keep the sheet up', () => {
    open()
    plate('undo')!.click()
    expect(out.keymap).toHaveBeenCalledWith({ cmd: 'history.undo' })
    expect(isOpen()).toBe(true)
    plate('redo')!.click()
    expect(out.keymap).toHaveBeenCalledWith({ cmd: 'history.redo' })
    plate('pheromones')!.click()
    expect(out.tags).toHaveBeenCalledTimes(1)
    expect(isOpen()).toBe(false)
  })

  it('see: pin asks the controls owner to toggle persisted pin state, then closes', () => {
    open()
    expect(plate('pin')).toBeDefined()
    plate('pin')!.click()
    expect(out.pin).toHaveBeenCalledTimes(1)
    expect(isOpen()).toBe(false)
  })

  it('the dock is one named close plate wearing arrow_back', () => {
    open()
    const dock = Array.from(el.querySelectorAll('[data-role="deck-dock"] [data-hc-tv-app]')) as HTMLElement[]
    expect(dock.length).toBe(1)
    expect(dock[0].textContent).toContain('arrow_back')
    expect(dock[0].querySelector('[data-role="app-name"]')?.textContent).toBe('close')
    dock[0].click()
    expect(isOpen()).toBe(false)
  })
})

describe('the ways out', () => {
  it('a tap on the backdrop, Escape, layer:deck-close', () => {
    open()
    ;(el.querySelector('[data-role="backdrop"]') as HTMLElement).click()
    expect(isOpen()).toBe(false)
    open()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(isOpen()).toBe(false)
    open()
    EffectBus.emit('layer:deck-close', {})
    expect(isOpen()).toBe(false)
  })

  it('a view taking the screen, or the phone stopping being a phone', () => {
    open()
    EffectBus.emit('view:active', { active: true, owner: 'x' })
    expect(isOpen()).toBe(false)
    EffectBus.emit('view:active', { active: false, owner: 'x' })
    open()
    EffectBus.emit('mobile:mode', { active: false })
    expect(isOpen()).toBe(false)
    EffectBus.emit('mobile:mode', { active: true })
  })

  it('re-renders on the same page when the layer\'s views change while open', () => {
    open()
    const before = plates().length
    EffectBus.emit('view-toggles:changed', { toggles: [] })
    expect(isOpen()).toBe(true)
    expect(plates().length).toBeLessThan(before)
    expect(titles()[0]).toBe('add here')
  })
})
