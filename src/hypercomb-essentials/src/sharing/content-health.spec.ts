// content-health.spec.ts — the plain-language fetch-health classifier.
//
// The drone turns the broker's per-host outcome stream into ONE overall
// condition, emitted on TRANSITIONS only. These cover the classifier's
// load-bearing behaviors: priority order, the host-down streak (prior
// success required — a cold host never poisons), the all-hosts-down offline
// inference, recovery (activity line), and the 'local' pseudo-host
// exclusion.
//
// The indicator PILL is retired — this drone must never park a glyph in the
// command line again.
//
// window.ioc is stubbed BEFORE the module import (the drone self-registers
// at load).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: () => undefined,
}

const { ContentHealthDrone } = await import('./content-health.drone.js')

type Pill = { key: string }
type Health = { condition: string; host: string | null; prev: string }

let drone: InstanceType<typeof ContentHealthDrone>
let pills: Pill[]
let health: Health[]
let activity: string[]

const outcome = (host: string, cls: string): void =>
  EffectBus.emit('broker:outcome', { host, cls, at: Date.now() })

/** The classifier runs microtask-coalesced — flush before asserting. */
const settle = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

const boot = async (): Promise<void> => {
  drone = new ContentHealthDrone()
  await (drone as unknown as { pulse: (g: string) => Promise<void> }).pulse('test')
  // capture AFTER boot — heartbeat's stale-pill eviction is not under test
  pills = []
  health = []
  activity = []
  EffectBus.on<Pill>('indicator:set', p => pills.push(p))
  EffectBus.on<Health>('content:health', p => health.push(p))
  EffectBus.on<{ message: string }>('activity:log', p => activity.push(p.message))
}

const setOnLine = (value: boolean): void => {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
}

beforeEach(async () => {
  EffectBus.clear()
  setOnLine(true)
  await boot()
})

afterEach(() => drone.markDisposed())

describe('content-health classifier', () => {
  it('healthy is silence — ok outcomes produce no transition', async () => {
    outcome('jwize.com', 'ok')
    outcome('jwize.com', 'ok')
    await settle()
    expect(health).toHaveLength(0)
  })

  it('host-down: prior success + a 3-streak of unreachable names the host', async () => {
    outcome('jwize.com', 'ok')
    outcome('jwize.com', 'unreachable')
    outcome('jwize.com', 'unreachable')
    await settle()
    expect(health).toHaveLength(0)  // streak of 2 — below threshold
    outcome('jwize.com', 'timeout') // timeouts count toward the streak
    await settle()
    expect(health.at(-1)).toMatchObject({ condition: 'host-down', host: 'jwize.com' })
  })

  it('a host never seen answering cannot go host-down — cold hosts never poison', async () => {
    outcome('unknown.example', 'unreachable')
    outcome('unknown.example', 'unreachable')
    outcome('unknown.example', 'unreachable')
    await settle()
    expect(health).toHaveLength(0)
  })

  it('repeat classifications of the same condition emit nothing — transitions only', async () => {
    outcome('jwize.com', 'ok')
    for (let i = 0; i < 3; i++) outcome('jwize.com', 'unreachable')
    await settle()
    outcome('jwize.com', 'unreachable')
    await settle()
    expect(health).toHaveLength(1)
  })

  it('navigator.onLine false wins over everything', async () => {
    outcome('jwize.com', 'ok')
    for (let i = 0; i < 3; i++) outcome('jwize.com', 'unreachable')
    setOnLine(false)
    await settle()
    expect(health.at(-1)).toMatchObject({ condition: 'offline' })
  })

  it('every dialed host failing infers offline even while onLine claims true', async () => {
    outcome('jwize.com', 'unreachable')
    outcome('jwize.com', 'unreachable')
    outcome('mesh', 'timeout')
    outcome('mesh', 'timeout')
    await settle()
    expect(health.at(-1)).toMatchObject({ condition: 'offline', host: null })
  })

  it('recovery logs the answering-again line — degradation stays quiet', async () => {
    outcome('jwize.com', 'ok')
    for (let i = 0; i < 3; i++) outcome('jwize.com', 'unreachable')
    await settle()
    expect(activity).toHaveLength(0)  // going down stays quiet
    outcome('jwize.com', 'ok')
    await settle()
    expect(health.at(-1)).toMatchObject({ condition: 'healthy', prev: 'host-down' })
    expect(activity.at(-1)).toBe('jwize.com is answering again')
  })

  it('missing: every answering host says not-found, mesh silence counts as nobody-has-it', async () => {
    outcome('jwize.com', 'not-found')
    outcome('mesh', 'timeout')
    await settle()
    expect(health.at(-1)).toMatchObject({ condition: 'missing' })
  })

  it('tampered: a signature mismatch reports even while the host otherwise answers', async () => {
    outcome('jwize.com', 'mismatch')
    outcome('jwize.com', 'ok')
    await settle()
    expect(health.at(-1)).toMatchObject({ condition: 'tampered', host: 'jwize.com' })
  })

  it('never sets an indicator pill, in any condition', async () => {
    outcome('jwize.com', 'ok')
    for (let i = 0; i < 3; i++) outcome('jwize.com', 'unreachable')
    await settle()
    setOnLine(false)
    outcome('mesh', 'timeout')
    await settle()
    expect(health.length).toBeGreaterThan(0)
    expect(pills).toHaveLength(0)
  })

  it("the 'local' pseudo-host informs the ledger but never drives a condition", async () => {
    outcome('local', 'unreachable')
    outcome('local', 'unreachable')
    outcome('local', 'unreachable')
    await settle()
    expect(health).toHaveLength(0)
  })
})
