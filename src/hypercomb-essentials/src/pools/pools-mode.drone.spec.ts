// pools/pools-mode.drone.spec.ts : the pools mode drone against a fake hive.
// The header is played by the spec (it writes LIGHTS_MODE and hears the
// commands), no host is named, and nothing leaves the page.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
const waiting = new Map<string, ((value: unknown) => void)[]>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => {
    services.set(key, value)
    for (const ready of waiting.get(key) ?? []) ready(value)
    waiting.delete(key)
  },
  whenReady: (key: string, ready: (value: unknown) => void) => {
    if (services.has(key)) ready(services.get(key))
    else waiting.set(key, [...(waiting.get(key) ?? []), ready])
  },
  onRegister: () => () => void 0,
}
services.set('@hypercomb.social/Lineage', { explorerLabel: () => '/kitchen', explorerSegments: () => ['kitchen'] })
// The hive's layers, as far as a lit branch is walked: a route's children by name.
const tree: Record<string, string[]> = {
  kitchen: ['soup', 'bread', 'stew', 'salad', 'pie'],
  pantry: ['flour', 'salt', 'yeast'],
}
services.set('@diamondcoreprocessor.com/HistoryService', {
  sign: async (lineage: { explorerSegments(): readonly string[] }) => lineage.explorerSegments().join('/'),
  currentLayerAt: async (route: string) => ({ name: route.split('/').pop(), children: (tree[route] ?? []).map(name => `${route}/${name}`) }),
  getLayerBySig: async (sig: string) => ({ name: sig.split('/').pop() }),
})

const {
  DOMAIN_SHELF_WANTED, LIGHTS_CHANGED, LIGHTS_JOIN_SWARM, LIGHTS_LEAVE, LIGHTS_MODE, LIGHTS_PUBLISH, LIGHTS_PUBLISHED,
} = await import('./lights-contract.js')
const { setBranchPublic, setCellPublic } = await import('../presentation/tiles/tile-public.js')
const { PoolsModeDrone } = await import('./pools-mode.drone.js')

type Drone = InstanceType<typeof PoolsModeDrone>
const drone = services.get('@diamondcoreprocessor.com/PoolsModeDrone') as Drone

const bar = (): HTMLElement | null => document.getElementById('hc-pools-bar')
const frame = (): HTMLElement | null => document.getElementById('hc-pools-frame')
const words = (name: string): string => bar()?.querySelector(`.${name}`)?.textContent ?? ''
const press = (name: string): void => { (bar()?.querySelector(`button.${name}`) as HTMLButtonElement).click() }
const mode = (active: boolean): void => { EffectBus.emit(LIGHTS_MODE, { active }) }
const page = (labels: string[], externalLabels: string[] = []): void => {
  EffectBus.emit('render:cell-count', { count: labels.length, labels, coords: labels.map((_, q) => ({ q, r: 0 })), externalLabels })
}
/** Every transient the drone sends under one name, while `run` runs. */
const heard = <T>(effect: string, run: () => void): T[] => {
  const got: T[] = []
  const off = EffectBus.on<T>(effect, payload => { got.push(payload) })
  got.length = 0
  run()
  off()
  return got
}

beforeEach(async () => {
  localStorage.clear()
  mode(false)
  EffectBus.emit('view:active', { active: false })
  EffectBus.emit('select:mode', { active: false })
  EffectBus.emit('mesh:modal-open', { open: false })
  await drone.pulse('')
})

describe('the pools bar follows the mode', () => {
  it('is not on the page until pools mode is up, and leaves with it', () => {
    expect(bar()).toBeNull()
    mode(true)
    expect(bar()).not.toBeNull()
    expect(frame()).not.toBeNull()
    expect(drone.active).toBe(true)
    mode(false)
    expect(bar()).toBeNull()
    expect(frame()).toBeNull()
  })

  it('stands down under a view that owns the viewport, a picker, and the join selector', () => {
    mode(true)
    for (const [effect, on, off] of [
      ['view:active', { active: true }, { active: false }],
      ['select:mode', { active: true }, { active: false }],
      ['sample:mode', { active: true }, { active: false }],
      ['mesh:modal-open', { open: true }, { open: false }],
      ['render:set-hive-visible', { visible: false }, { visible: true }],
    ] as const) {
      EffectBus.emit(effect, on)
      expect(bar(), effect).toBeNull()
      EffectBus.emit(effect, off)
      expect(bar(), effect).not.toBeNull()
    }
  })

  it('asks for the domain shelf on the way in and lets it go on the way out, once each', () => {
    const asked = heard<{ owner: string; wanted: boolean }>(DOMAIN_SHELF_WANTED, () => { mode(true); mode(true); mode(false); mode(false) })
    expect(asked).toEqual([{ owner: 'pools-mode', wanted: true }, { owner: 'pools-mode', wanted: false }])
  })
})

describe('the counts', () => {
  it('counts what is on among your own tiles on this page, and follows a light as it turns', () => {
    setCellPublic('/kitchen', 'soup', true)
    mode(true)
    page(['soup', 'bread', 'visitor'], ['visitor'])
    expect(words('hc-pools-counts')).toMatch(/^1 on here/)
    setCellPublic('/kitchen', 'bread', true)
    EffectBus.emit(LIGHTS_CHANGED, { cell: 'bread', location: '/kitchen', public: true })
    expect(words('hc-pools-counts')).toMatch(/^2 on here/)
  })

  it('counts a lit branch in all with everything under it, as it counts it here', async () => {
    setBranchPublic('/', 'kitchen', true)
    mode(true)
    page(tree['kitchen'])
    // The page is read at once, the hive a moment later: never the whole below its part.
    expect(words('hc-pools-counts')).toMatch(/^5 on here · 5 on in all/)
    await vi.waitFor(() => expect(words('hc-pools-counts')).toMatch(/^5 on here · 6 on in all/))
    setBranchPublic('/', 'kitchen', false)
  })

  it('counts a branch lit on another page by its tiles, not as one mark', async () => {
    setBranchPublic('/', 'pantry', true)
    mode(true)
    page(['soup'])
    await vi.waitFor(() => expect(words('hc-pools-counts')).toMatch(/^0 on here · 4 on in all/))
    setBranchPublic('/', 'pantry', false)
  })
})

describe('the presses', () => {
  it('sends Close, Join the swarm and Publish as commands', () => {
    mode(true)
    expect(heard(LIGHTS_JOIN_SWARM, () => press('hc-pools-join'))).toHaveLength(1)
    expect(heard(LIGHTS_PUBLISH, () => press('hc-pools-publish'))).toHaveLength(1)
    expect(heard(LIGHTS_LEAVE, () => press('hc-pools-close'))).toHaveLength(1)
  })

  it('closes on the Escape nothing else took, only while the bar is up', () => {
    expect(heard(LIGHTS_LEAVE, () => EffectBus.emit('global:escape', undefined))).toHaveLength(0)
    mode(true)
    expect(heard(LIGHTS_LEAVE, () => EffectBus.emit('global:escape', undefined))).toHaveLength(1)
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    expect(heard(LIGHTS_LEAVE, () => EffectBus.emit('global:escape', undefined))).toHaveLength(0)
    field.remove()
  })

  it('turns every tile on this page on, skipping the ones already on and a peer\'s tile', () => {
    setCellPublic('/kitchen', 'soup', true)
    mode(true)
    page(['soup', 'bread', 'visitor', 'stew'], ['visitor'])
    const sent = heard<{ action: string; label: string; index: number }>('tile:action', () => press('hc-pools-all-on'))
    expect(sent.map(action => [action.action, action.label, action.index])).toEqual([['make-public', 'bread', 1], ['make-public', 'stew', 3]])
  })

  it('turns off only what was turned on here, each by the scope that lit it', () => {
    setCellPublic('/kitchen', 'soup', true)
    setBranchPublic('/kitchen', 'bread', true)
    mode(true)
    page(['soup', 'bread', 'stew'])
    const sent = heard<{ action: string; label: string }>('tile:action', () => press('hc-pools-all-off'))
    expect(sent.map(action => [action.action, action.label])).toEqual([['make-public', 'soup'], ['make-branch-public', 'bread']])
  })
})

describe('publish', () => {
  it('runs without the bar, says why it could not with no host named, and announces what happened', async () => {
    const logged = vi.fn()
    const off = EffectBus.on<{ message: string }>('activity:log', logged)
    logged.mockClear()
    EffectBus.emitTransient(LIGHTS_PUBLISH, {})
    await vi.waitFor(() => expect(logged).toHaveBeenCalled())
    off()
    expect(bar()).toBeNull()
    let last: { ok?: boolean; reason?: string } = {}
    EffectBus.on<{ ok?: boolean; reason?: string }>(LIGHTS_PUBLISHED, published => { last = published })()
    expect(last.ok).toBe(false)
    expect(logged.mock.calls.at(-1)?.[0].message).toBe(`${String(last.reason).replace(/\.+$/, '')}.`)
  })

  it('shows the refusal in the bar in place of the lead, and a turned light takes it down again', async () => {
    mode(true)
    press('hc-pools-publish')
    await vi.waitFor(() => expect(words('hc-pools-say')).toMatch(/Name your home domain first/))
    expect((bar()?.querySelector('.hc-pools-say') as HTMLElement).dataset['tone']).toBe('refused')
    EffectBus.emit(LIGHTS_CHANGED, { cell: 'soup', location: '/kitchen', public: true })
    expect(words('hc-pools-say')).toMatch(/^Tap a tile/)
  })
})
