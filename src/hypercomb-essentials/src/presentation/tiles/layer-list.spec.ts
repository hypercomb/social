// layer-list.spec.ts — the phone's reading of a layer, driven through its doors.
//
//   · phone only, and never under a view; rows come from the replayed
//     render:cell-count in its order, › on branches only
//   · a branch row asks to enter (tile:enter-request); a leaf row opens the
//     tile page (tile:view-open) — never an empty layer
//   · ‹ goes back through Navigation (disabled at the root); the title drops
//     the path and a crumb jumps by goRaw; ⋯ opens the layer deck
//   · an empty layer is a sentence, never a void

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const registered: Record<string, unknown> = {}
const services: Record<string, unknown> = {}
let mobileActive = true
let viewActiveNow = false
let surfaceAdded: unknown = null
let segments: string[] = ['honey-garden']
const nav = { goRaw: vi.fn(), back: vi.fn() }

;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered[key] = value },
  get: (key: string) => registered[key] ?? services[key],
  has: (key: string) => key in registered || key in services,
  whenReady: (key: string, cb: (v: unknown) => void) => {
    if (key === '@hypercomb.social/ShellSurfaceRegistry') cb({ add: (s: unknown) => { surfaceAdded = s } })
  },
}
services['@diamondcoreprocessor.com/MobileMode'] = { get active() { return mobileActive } }
services['@diamondcoreprocessor.com/ModeRegistry'] = { isActive: () => viewActiveNow }
services['@hypercomb.social/Lineage'] = { explorerSegments: () => segments }
services['@hypercomb.social/Navigation'] = nav
services['@diamondcoreprocessor.com/ShowCellDrone'] = {
  snapshotCells: () => [{ q: 0, r: 0, label: 'sunrise', imageSig: 'a'.repeat(64) }],
}
services['@diamondcoreprocessor.com/NotesService'] = {
  getNotes: async (label: string) => label === 'sunrise' ? [{ text: 'a warm one\nsecond line' }] : [],
}

const out = { enter: vi.fn(), view: vi.fn(), deck: vi.fn() }
EffectBus.on('tile:enter-request', out.enter)
EffectBus.on('tile:view-open', out.view)
EffectBus.on('layer:deck-open', out.deck)

const { LAYER_LIST_KEY, LAYER_LIST_SURFACE } = await import('./layer-list.drone.js')

type DroneShape = { pulse(g: string): Promise<void>; readonly showing: boolean; readonly rows: readonly { label: string }[] }
const drone = registered[LAYER_LIST_KEY] as DroneShape
await drone.pulse('')

const el = document.createElement(LAYER_LIST_SURFACE)
document.body.appendChild(el)

const rows = () => Array.from(el.querySelectorAll('[data-role="list-row"]')) as HTMLButtonElement[]
const row = (label: string) => rows().find(r => r.dataset['label'] === label)
const action = (name: string) => el.querySelector(`[data-action="${name}"]`) as HTMLButtonElement
const payload = () => ({
  count: 3,
  labels: ['sunrise', 'meadow', 'comb'],
  branchLabels: ['meadow'],
  linkLabels: ['comb'],
  noImageLabels: ['meadow'],
  settled: true,
})

beforeEach(() => {
  mobileActive = true
  viewActiveNow = false
  segments = ['honey-garden']
  for (const spy of Object.values(out)) spy.mockClear()
  nav.goRaw.mockClear()
  nav.back.mockClear()
  EffectBus.emit('view:active', { active: false })
  EffectBus.emit('mobile:mode', { active: true })
  EffectBus.emit('render:cell-count', payload())
})

describe('the surface', () => {
  it('is contributed to the registry as an element, level with the close-up, before the activity log', () => {
    expect(surfaceAdded).toMatchObject({ name: LAYER_LIST_SURFACE, element: LAYER_LIST_SURFACE, order: 300 })
    expect(el.style.zIndex).toBe('59990')
    expect(drone.showing).toBe(true)
  })

  it('stands down when the phone is not a phone, and under a view', () => {
    EffectBus.emit('mobile:mode', { active: false })
    expect(drone.showing).toBe(false)
    EffectBus.emit('mobile:mode', { active: true })
    expect(drone.showing).toBe(true)
    EffectBus.emit('view:active', { active: true })
    expect(drone.showing).toBe(false)
  })
})

describe('rows', () => {
  it('paint in the payload order, › on branches only, the second line saying what a leaf holds', () => {
    expect(rows().map(r => r.dataset['label'])).toEqual(['sunrise', 'meadow', 'comb'])
    expect(row('meadow')?.dataset['kind']).toBe('branch')
    expect(row('meadow')?.querySelector('.hc-ll-tail')?.textContent).toBe('›')
    expect(row('sunrise')?.querySelector('.hc-ll-tail')?.textContent).toBe('')
    expect(row('comb')?.querySelector('.hc-ll-sub')?.textContent).toBe('link')
    expect(row('meadow')?.querySelector('.hc-ll-sub')?.textContent).toBe('inside')
  })

  it('carry the hexagon capture as the thumbnail when the renderer has one', () => {
    const img = row('sunrise')?.querySelector('img')
    expect(img?.getAttribute('src')).toContain('a'.repeat(64))
    expect(row('meadow')?.querySelector('img')).toBeNull()
  })

  it('fill the first line of the first note once it lands', async () => {
    await new Promise(r => setTimeout(r, 0))
    expect(row('sunrise')?.querySelector('.hc-ll-sub')?.textContent).toBe('a warm one')
  })

  it('a branch asks to enter; a leaf opens the tile page', () => {
    row('meadow')?.click()
    expect(out.enter).toHaveBeenCalledWith({ label: 'meadow' })
    expect(out.view).not.toHaveBeenCalled()
    row('sunrise')?.click()
    expect(out.view).toHaveBeenCalledWith({ label: 'sunrise', segments: ['honey-garden'] })
  })

  it('an empty layer is a sentence, never a void', () => {
    EffectBus.emit('render:cell-count', { count: 0, labels: [], settled: true })
    expect(rows()).toHaveLength(0)
    expect(el.querySelector('[data-role="list-empty"]')?.textContent).toContain('Nothing here yet.')
  })

  it('a navigate clears the old page until the next pass', () => {
    window.dispatchEvent(new Event('navigate'))
    expect(rows()).toHaveLength(0)
    expect(el.querySelector('[data-role="list-empty"]')).toBeNull()
    EffectBus.emit('render:cell-count', payload())
    expect(rows()).toHaveLength(3)
  })
})

describe('the title bar', () => {
  it('‹ goes back through Navigation, and is disabled at the root', () => {
    action('back').click()
    expect(nav.back).toHaveBeenCalledTimes(1)
    segments = []
    EffectBus.emit('render:cell-count', payload())
    expect(action('back').disabled).toBe(true)
  })

  it('the title names where I am, drops the path, and a crumb jumps by goRaw', () => {
    segments = ['honey-garden', 'meadow']
    EffectBus.emit('render:cell-count', payload())
    expect(action('path').textContent).toBe('meadow')
    action('path').click()
    const crumbs = Array.from(el.querySelectorAll('[data-action="jump"]')) as HTMLButtonElement[]
    expect(crumbs.map(c => c.textContent)).toEqual(['your hive', 'honey-garden', 'meadow'])
    crumbs[1].click()
    expect(nav.goRaw).toHaveBeenCalledWith(['honey-garden'])
    expect(el.querySelector('[data-role="list-path"]')).toBeNull()
  })

  it('⋯ opens the layer deck', () => {
    action('more').click()
    expect(out.deck).toHaveBeenCalledTimes(1)
  })
})

describe('the face', () => {
  it('list and hexagons are one selector: choosing the hexagons puts the list away, and it publishes the face', () => {
    const faces = vi.fn()
    const off = EffectBus.on('phone:face', faces)
    expect(action('face:list').getAttribute('aria-pressed')).toBe('true')
    action('face:hexagons').click()
    expect(faces).toHaveBeenLastCalledWith({ face: 'hexagons' })
    expect(drone.showing).toBe(false)
    expect(el.querySelector('[data-role="list-row"]')).toBeNull()
    EffectBus.emit('phone:face-set', { face: 'list' })
    expect(faces).toHaveBeenLastCalledWith({ face: 'list' })
    expect(drone.showing).toBe(true)
    expect(action('face:list').getAttribute('aria-pressed')).toBe('true')
    off()
  })
})
