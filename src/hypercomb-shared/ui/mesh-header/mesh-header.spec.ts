// hypercomb-shared/ui/mesh-header/mesh-header.spec.ts : the lock's way on.
//
// The shell is raw source and the essentials package is updated only when the
// participant takes a new one, so this header meets packages from before pools
// mode. Such a package has no pools bar, and the bar's "Join the swarm" is the
// only thing that sends `pools:join-swarm`. The header asks the bus whether
// anybody answers pools mode's own commands: with nobody there, the second
// press is the way on to the selector, as it always was.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

// The header's two field decorators need the Angular compiler; the toggle's
// logic does not touch it. Here they decorate nothing.
vi.mock('@angular/core', async (original) => ({
  ...(await original<typeof import('@angular/core')>()),
  Input: () => () => undefined,
  Output: () => () => undefined,
}))

const services = new Map<string, unknown>()
;(globalThis as { get?: unknown }).get = (key: string) => services.get(key)

const { MeshHeaderComponent } = await import('./mesh-header.component')

type Header = InstanceType<typeof MeshHeaderComponent>
const offs: (() => void)[] = []

const mount = (): Header => {
  const header = new MeshHeaderComponent()
  header.ngOnInit()
  offs.push(() => header.ngOnDestroy())
  return header
}

/** Every time the selector was asked for while `run` ran. */
const selectorAsked = (run: () => void): unknown[] => {
  const asked: unknown[] = []
  const off = EffectBus.on('mesh:open-modal', payload => { asked.push(payload) })
  asked.length = 0
  run()
  off()
  return asked
}

/** A package with pools mode: its drone hears the bar's Publish. */
const poolsPackage = (): void => { offs.push(EffectBus.on('pools:publish', () => void 0)) }

beforeEach(() => {
  EffectBus.clear()
  localStorage.clear()
})

afterEach(() => {
  for (const off of offs.splice(0)) off()
})

describe('the second press of the lock', () => {
  it('goes on to the selector when no package answers pools mode', () => {
    const header = mount()
    header.onToggle()
    expect(header.stage()).toBe(1)
    const asked = selectorAsked(() => header.onToggle())
    expect(asked).toEqual([{ join: true }])
    expect(header.stage()).toBe(2)
    expect(header.worldMode()).toBe(true)
  })

  it('is the Close when a package with a pools bar is listening', () => {
    poolsPackage()
    const header = mount()
    header.onToggle()
    expect(header.stage()).toBe(1)
    const asked = selectorAsked(() => header.onToggle())
    expect(asked).toEqual([])
    expect(header.stage()).toBe(0)
  })

  it('takes a publish that was only ever sent, never heard, as nobody listening', () => {
    // A last value is not a listener: the probe asks who is subscribed now.
    EffectBus.emit('pools:publish', {})
    const header = mount()
    header.onToggle()
    expect(selectorAsked(() => header.onToggle())).toEqual([{ join: true }])
  })

  it('goes back to the old press once the pools drone is gone', () => {
    const leave = EffectBus.on('pools:publish', () => void 0)
    const header = mount()
    header.onToggle()
    leave()
    expect(selectorAsked(() => header.onToggle())).toEqual([{ join: true }])
    expect(header.stage()).toBe(2)
  })

  it('wraps back to private from the selector either way', () => {
    const header = mount()
    header.onToggle()
    header.onToggle()
    header.onToggle()
    expect(header.stage()).toBe(0)
    expect(header.worldMode()).toBe(false)
  })

  it('still hears the bar\'s Join the swarm from a package that has one', () => {
    poolsPackage()
    const header = mount()
    header.onToggle()
    const asked = selectorAsked(() => EffectBus.emitTransient('pools:join-swarm', {}))
    expect(asked).toEqual([{ join: true }])
    expect(header.stage()).toBe(2)
  })
})
