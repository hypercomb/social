// tile-rail.spec.ts — the left sidebar is the chat's tile list, mounted, and nothing more.
//
//   · closed until asked; registered with the shell the doctrine way
//   · asked with nothing, it is exactly the chat's list: the factory is
//     called with no profile and no press handler of its own
//   · a profile and a press handler pass through untouched
//   · it takes its edge of the stage while open and gives it back on close
//   · a late factory never mounts a closed or replaced rail

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const registered: Record<string, unknown> = {}
let surfaceAdded: { name?: string; element?: string; owner?: string; order?: number } | null = null
const waiting: { key: string; cb: (v: unknown) => void }[] = []

;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered[key] = value },
  get: (key: string) => registered[key],
  has: (key: string) => key in registered,
  whenReady: (key: string, cb: (v: unknown) => void) => {
    if (key === '@hypercomb.social/ShellSurfaceRegistry') { cb({ add: (s: typeof surfaceAdded) => { surfaceAdded = s } }); return }
    waiting.push({ key, cb })
  },
}

const FACTORY = '@diamondcoreprocessor.com/AgentTilesRailFactory'

type FakeRail = { mount: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; onSubjectChanged: (s: unknown) => void; own: (s: unknown) => void }
let rails: FakeRail[] = []
const create = vi.fn((_profile?: Record<string, unknown>): FakeRail => {
  const own = (): void => {}
  const rail: FakeRail = { mount: vi.fn(), dispose: vi.fn(), refresh: vi.fn(), onSubjectChanged: own, own }
  rails.push(rail)
  return rail
})
/** The factory arrives: every waiting caller is told. */
const factoryArrives = (): void => { for (const w of waiting.splice(0)) if (w.key === FACTORY) w.cb({ create }) }

const { TileRailDrone, TileRailElement, TILE_RAIL_KEY, TILE_RAIL_SURFACE, TILE_RAIL_WIDTH, SHELL_LEFT_RAIL } = await import('./tile-rail.drone.js')

const insets: { owner: string; side: string; size: number }[] = []
EffectBus.on<{ owner: string; side: string; size: number }>('viewport:inset', p => { if (p?.owner === 'tile-rail') insets.push(p) })

let drone: InstanceType<typeof TileRailDrone>
let el: HTMLElement
const beat = (d: unknown): Promise<void> => (d as { heartbeat: () => Promise<void> }).heartbeat()

beforeEach(async () => {
  waiting.length = 0
  rails = []
  create.mockClear()
  insets.length = 0
  drone = registered[TILE_RAIL_KEY] as InstanceType<typeof TileRailDrone>
  await beat(drone) // binds the effects and the navigate listener once
  drone.close()
  insets.length = 0
  el = document.createElement(TILE_RAIL_SURFACE)
  document.body.replaceChildren(el)
})

describe('the tile rail surface', () => {
  it('is registered with the shell, and the element tells the drone where it is', () => {
    expect(surfaceAdded).toMatchObject({ name: TILE_RAIL_SURFACE, element: TILE_RAIL_SURFACE, owner: TILE_RAIL_KEY })
    expect(customElements.get(TILE_RAIL_SURFACE)).toBe(TileRailElement)
    expect(el.style.display).toBe('none')
    expect(drone.isOpen).toBe(false)
  })

  it('asked with nothing it is exactly the chat list: no profile, no press handler of its own', () => {
    drone.open()
    factoryArrives()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toBeUndefined()
    expect(rails[0].mount).toHaveBeenCalledWith(el)
    // the rail keeps its own move: the surface did not replace the handler
    expect(rails[0].onSubjectChanged).toBe(rails[0].own)
  })

  it('a profile and a press handler pass through untouched', () => {
    const profile = { walk: true, chats: false, choose: false, findLabel: 'find pages' }
    const onPick = vi.fn()
    drone.open({ profile, onPick })
    factoryArrives()
    expect(create.mock.calls[0][0]).toBe(profile)
    rails[0].onSubjectChanged({ name: 'simple', path: ['protocol'] })
    expect(onPick).toHaveBeenCalledWith({ name: 'simple', path: ['protocol'] })
    rails[0].onSubjectChanged(null)
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('takes its edge of the stage while open and gives it back on close', () => {
    drone.open()
    expect(el.style.display).toBe('block')
    expect(el.style.left).toBe(SHELL_LEFT_RAIL)
    expect(el.style.width).toBe(`${TILE_RAIL_WIDTH}px`)
    expect(insets.at(-1)).toEqual({ owner: 'tile-rail', side: 'left', size: TILE_RAIL_WIDTH })
    factoryArrives()
    drone.close()
    expect(el.style.display).toBe('none')
    expect(rails[0].dispose).toHaveBeenCalledTimes(1)
    expect(insets.at(-1)).toEqual({ owner: 'tile-rail', side: 'left', size: 0 })
  })

  it('takes the side and width it is asked for, and gives the old edge back when it moves', () => {
    drone.open({ width: 320 })
    drone.open({ side: 'right', width: 300 })
    expect(el.style.right).toBe('0px')
    expect(el.style.width).toBe('300px')
    expect(insets).toEqual([
      { owner: 'tile-rail', side: 'left', size: 320 },
      { owner: 'tile-rail', side: 'left', size: 0 },
      { owner: 'tile-rail', side: 'right', size: 300 },
    ])
    drone.close()
    expect(insets.at(-1)).toEqual({ owner: 'tile-rail', side: 'right', size: 0 })
  })

  it('an explicit offset overrides the default edge', () => {
    drone.open({ offset: 12 })
    expect(el.style.left).toBe('12px')
    drone.open({ side: 'right', offset: 0 })
    expect(el.style.right).toBe('0px')
    expect(el.style.left).toBe('auto')
  })

  it('a new request replaces the list that is up', () => {
    drone.open({ profile: { chats: true } })
    factoryArrives()
    drone.open({ profile: { chats: false } })
    factoryArrives()
    expect(rails).toHaveLength(2)
    expect(rails[0].dispose).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[1][0]).toEqual({ chats: false })
    expect(rails[1].mount).toHaveBeenCalledWith(el)
  })

  it('a factory that arrives after close mounts nothing', () => {
    drone.open()
    drone.close()
    factoryArrives()
    expect(create).not.toHaveBeenCalled()
  })

  it('a factory that arrives for an old request is ignored', () => {
    drone.open({ profile: { chats: true } })
    drone.open({ profile: { chats: false } })
    factoryArrives()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toEqual({ chats: false })
  })

  it('re-lists when you move, and only while open', () => {
    drone.open()
    factoryArrives()
    window.dispatchEvent(new Event('navigate'))
    expect(rails[0].refresh).toHaveBeenCalledTimes(1)
    drone.close()
    window.dispatchEvent(new Event('navigate'))
    expect(rails[0].refresh).toHaveBeenCalledTimes(1)
  })

  it('is opened and closed by the effects', () => {
    EffectBus.emit('tile-rail:open', { width: 280 })
    expect(drone.isOpen).toBe(true)
    expect(el.style.width).toBe('280px')
    EffectBus.emit('tile-rail:close', {})
    expect(drone.isOpen).toBe(false)
  })
})
