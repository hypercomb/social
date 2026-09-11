// The orchestrator's answer to "how is it going?" is DERIVED from the agent
// registry every time it is asked — there is no stored health state to drift.
// These cases pin the two things the participant actually acts on:
//
//   • the HEADLINE, which is the whole point of opening the watcher, and
//   • the TILE SET the audit view paints, which has to be one row per PLACE
//     (two agents on one tile is one place to go and look), addressed by its
//     absolute path so a click from the audit travels to the real work.
//
// Everything here runs against a fake registry: the derivation must not need a
// hive, a renderer, or a bridge to be exercised.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const registry = { list: () => [] as unknown[] }

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) =>
      key === '@diamondcoreprocessor.com/AgentRegistry'
        ? (globalThis as unknown as { __registry: unknown }).__registry
        : undefined,
    whenReady: () => { /* noop */ },
  }
})
;(globalThis as unknown as { __registry: unknown }).__registry = registry

// The route-flow drain is the orchestrator's to SCHEDULE, not to run: its
// own behaviour is chat-route.spec.ts's. Here it is a fake whose answers the
// schedule cases choose.
vi.mock('./chat-route.js', () => ({
  drainRouteFlows: vi.fn(async () => ({ organized: 0, behind: 0, elapsedMs: 0 })),
  readRoute: vi.fn(),
  organizeRoute: vi.fn(),
}))

import { EffectBus } from '@hypercomb/core'
import { drainRouteFlows } from './chat-route.js'
import { OrchestratorDrone, ORCHESTRATOR_ID, ROUTE_FLOW_SCHEDULE, ROUTE_FLOW_WAKES } from './orchestrator.drone.js'

const agent = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 'a', behavior: 'opus', kind: 'model', status: 'working',
  targets: [], segments: [], activity: [], context: [],
  startedAt: Date.now(), updatedAt: Date.now(), ...over,
})

let orchestrator: OrchestratorDrone

beforeEach(() => {
  // Dispose the previous one FIRST. A drone that has warmed up holds a sweep
  // interval, and an undisposed one from an earlier case goes on sweeping —
  // and emitting — into the next, which silently doubles anything a test
  // counts.
  ;(orchestrator as unknown as { dispose?: () => void } | undefined)?.dispose?.()
  orchestrator = new OrchestratorDrone()
  registry.list = () => []
})

describe('orchestrator summary — the headline', () => {
  it('says nothing is running when nothing is', () => {
    expect(orchestrator.summary().headline).toBe('Nothing is running.')
    expect(orchestrator.summary().healthy).toBe(true)
  })

  it('reports healthy work as healthy', () => {
    registry.list = () => [agent({ id: 'x' }), agent({ id: 'y', status: 'pending' })]
    const summary = orchestrator.summary()
    expect(summary.healthy).toBe(true)
    expect(summary.headline).toContain('2 agents working')
    expect(summary.headline).toContain('all reporting normally')
  })

  it('stops calling the hive healthy the moment one agent goes quiet', () => {
    registry.list = () => [agent({ id: 'x', stalled: true })]
    const summary = orchestrator.summary()
    expect(summary.stalled).toBe(1)
    expect(summary.healthy).toBe(false)
    expect(summary.headline).toContain('needs a look')
  })

  it('a bridge sweep finding alone is enough to withdraw the all-clear', () => {
    orchestrator.noteSweep('three parts were never broken apart')
    expect(orchestrator.summary().healthy).toBe(false)
    expect(orchestrator.summary().findings.map(f => f.text)).toContain('three parts were never broken apart')
  })

  // The watcher is not part of what it is watching: counting itself would mean
  // an idle hive could never report as idle.
  it('never counts itself', () => {
    registry.list = () => [agent({ id: ORCHESTRATOR_ID, kind: 'orchestrator' })]
    expect(orchestrator.summary().headline).toBe('Nothing is running.')
  })
})

describe('orchestrator summary — the tiles the audit paints', () => {
  it('gathers one row per tile, with the count of agents on it', () => {
    registry.list = () => [
      agent({ id: 'x', targets: ['ledger'], segments: ['work'] }),
      agent({ id: 'y', targets: ['ledger'], segments: ['work'] }),
      agent({ id: 'z', targets: ['notes'], segments: [] }),
    ]
    const tiles = orchestrator.summary().tiles
    expect(tiles).toHaveLength(2)
    // Busiest first — the tile two passes are fighting over is the one to open.
    expect(tiles[0]).toEqual({ label: 'ledger', path: ['work', 'ledger'], agents: 2 })
    expect(tiles[1]).toEqual({ label: 'notes', path: ['notes'], agents: 1 })
  })

  it('leaves finished work out — an audit is of what is still running', () => {
    registry.list = () => [
      agent({ id: 'x', targets: ['done-tile'], status: 'done' }),
      agent({ id: 'y', targets: ['live-tile'] }),
    ]
    expect(orchestrator.summary().tiles.map(t => t.label)).toEqual(['live-tile'])
  })

  it('counts live models by vendor', () => {
    registry.list = () => [
      agent({ id: 'x', vendor: 'anthropic' }),
      agent({ id: 'y', vendor: 'anthropic' }),
      agent({ id: 'z', vendor: 'openai' }),
      agent({ id: 'w', kind: 'script', behavior: 'sync', vendor: undefined }),
    ]
    expect(orchestrator.summary().vendors).toEqual([
      { vendor: 'anthropic', count: 2 },
      { vendor: 'openai', count: 1 },
    ])
  })
})

describe('orchestrator audit', () => {
  it('reports how many tiles it gathered, so an empty audit can be refused', () => {
    expect(orchestrator.audit()).toBe(0)
    registry.list = () => [agent({ id: 'x', targets: ['one', 'two'], segments: ['here'] })]
    expect(orchestrator.audit()).toBe(2)
  })
})

// A finding you cannot act on is just a complaint. Acting on one means going
// to look first, and the trip is the hard part: the hive navigates, the sweep
// rebuilds every finding object several times over, and the button waiting at
// the far end still has to refer to the SAME finding. That is why a key is
// carried and the finding re-resolved, and it is what these cases pin.
describe('carrying a finding to completion', () => {
  const stopped: string[] = []
  const withAgents = (agents: Array<Record<string, unknown>>): void => {
    registry.list = () => agents
    ;(registry as Record<string, unknown>).get = (id: string) => agents.find(a => a.id === id)
    ;(registry as Record<string, unknown>).stop = async (id: string) => { stopped.push(id); return true }
  }

  beforeEach(() => { stopped.length = 0 })

  it('picks a finding up by key and puts it down again, leaving it standing', () => {
    orchestrator.noteSweep('slides has no page tile')
    const [finding] = orchestrator.findings
    expect(orchestrator.hold(finding.key)?.text).toBe('slides has no page tile')
    expect(orchestrator.held?.key).toBe(finding.key)
    orchestrator.release()
    expect(orchestrator.held).toBeUndefined()
    expect(orchestrator.findings).toHaveLength(1)
  })

  it('carries nothing when the finding has already cleared', () => {
    expect(orchestrator.hold('failed:a-ghost')).toBeUndefined()
    expect(orchestrator.held).toBeUndefined()
  })

  it('completing a bridge finding acknowledges it — there is nothing in the hive to stop', async () => {
    orchestrator.noteSweep('a note cites a source file that no longer exists')
    orchestrator.hold(orchestrator.findings[0].key)
    expect(await orchestrator.complete()).toBe('marked as dealt with')
    // Completed means gone: it must not be raised at the participant again.
    expect(orchestrator.findings).toHaveLength(0)
    expect(orchestrator.held).toBeUndefined()
  })

  it('completing an overlap keeps the agent still talking and stops the rest', async () => {
    vi.useFakeTimers()
    try {
      const now = Date.now()
      withAgents([
        agent({ id: 'stale', behavior: 'website', targets: ['roadmap'], updatedAt: now - 120_000 }),
        agent({ id: 'fresh', behavior: 'opus', targets: ['roadmap'], updatedAt: now }),
      ])
      await orchestrator.warmup()

      const overlap = orchestrator.findings.find(f => f.kind === 'overlap')
      expect(overlap, 'two agents on one tile should be found').toBeDefined()
      orchestrator.hold(overlap!.key)
      const did = await orchestrator.complete()

      expect(stopped).toEqual(['stale'])
      expect(did).toContain('opus')
      expect(orchestrator.findings.some(f => f.kind === 'overlap')).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('a finding remembers where to go — resolved when raised, not when pressed', async () => {
    vi.useFakeTimers()
    try {
      withAgents([agent({ id: 'x', status: 'failed', behavior: 'opus', targets: ['q3'], segments: ['plans'] })])
      await orchestrator.warmup()
      const failed = orchestrator.findings.find(f => f.kind === 'failed')
      expect(failed?.path).toEqual(['plans', 'q3'])
    } finally { vi.useRealTimers() }
  })

  it('completing a failure stops the agent it names', async () => {
    vi.useFakeTimers()
    try {
      withAgents([agent({ id: 'x', status: 'failed', behavior: 'website', targets: ['home'] })])
      await orchestrator.warmup()
      orchestrator.hold(orchestrator.findings.find(f => f.kind === 'failed')!.key)
      expect(await orchestrator.complete()).toBe('stopped 1 agent')
      expect(stopped).toEqual(['x'])
    } finally { vi.useRealTimers() }
  })
})

// The running commentary is the orchestrator generalizing in its own words, on
// its own clock. Both failure modes it is bounded against are real: narrated
// every sweep it is noise nobody reads, narrated only on change a hive that is
// quietly stuck says nothing at all.
describe('the running commentary', () => {
  const said: string[] = []
  /** Listen, and hand back the way to STOP listening. Leaving the handler
   *  subscribed leaves a second copy of it for the next case, which counts
   *  every line twice. */
  const listen = (): (() => void) => {
    said.length = 0
    // Called on EffectBus itself — pulling `on` out of it loses `this` and the
    // handler set with it.
    const off = EffectBus.on<{ id?: string; activity?: string }>('agent:progress', payload => {
      if (payload?.id === ORCHESTRATOR_ID && payload.activity) said.push(payload.activity)
    })
    return () => { off?.(); said.length = 0 }
  }

  it('speaks once when it starts watching, and does not repeat itself every sweep', async () => {
    vi.useFakeTimers()
    const stop = listen()
    try {
      registry.list = () => [
        agent({ id: 'a', behavior: 'opus' }),
        agent({ id: 'b', behavior: 'website', status: 'pending' }),
      ]
      await orchestrator.warmup()
      const commentary = (): string[] => said.filter(s => s.includes('working'))
      expect(commentary()).toHaveLength(1)
      expect(commentary()[0]).toContain('1 working, 1 queued')

      // Several more sweeps inside the quiet window say nothing further.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(commentary()).toHaveLength(1)
    } finally { vi.useRealTimers(); stop() }
  })

  // The activity log keeps only the last N entries. A line repeated every
  // sweep is therefore not merely noise — it EVICTS the findings and summaries
  // the log exists to hold. Caught live: three identical all-clears in 30s.
  it('says the all-clear once, not on every sweep', async () => {
    vi.useFakeTimers()
    const stop = listen()
    try {
      registry.list = () => [agent({ id: 'a' })]
      await orchestrator.warmup()
      await vi.advanceTimersByTimeAsync(90_000)
      expect(said.filter(s => s.includes('all healthy'))).toHaveLength(1)
    } finally { vi.useRealTimers(); stop() }
  })

  it('says it again when the count changes — the all-clear is about a state, not a fact', async () => {
    vi.useFakeTimers()
    const stop = listen()
    try {
      const agents = [agent({ id: 'a' })]
      registry.list = () => agents
      await orchestrator.warmup()
      agents.push(agent({ id: 'b' }))
      await vi.advanceTimersByTimeAsync(30_000)
      const clears = said.filter(s => s.includes('all healthy'))
      expect(clears).toHaveLength(2)
      expect(clears[1]).toContain('2 agents')
    } finally { vi.useRealTimers(); stop() }
  })
})

// THE ROUTE-FLOW DRAIN'S CLOCK. "Ollama visits as many chats as possible" is a
// promise about a schedule: soon while there is organizing to do, slow when
// there is none, early when something changed, and never two passes stacked —
// a model call outlasts any interval, and a second pass would pay for the same
// conversations twice. Wakes are emitted TRANSIENT here so no case replays
// its wake into the next.
describe('the route-flow schedule', () => {
  const drain = vi.mocked(drainRouteFlows)
  const wake = (effect: string = ROUTE_FLOW_WAKES[0]): void => EffectBus.emitTransient(effect, { at: Date.now() })
  const { soonMs, idleMs, wakeMs } = ROUTE_FLOW_SCHEDULE

  /** When each pass started, on the fake clock. The schedule is asserted as
   *  the GAPS between passes: the first pass may come at the early wake
   *  instead of `soonMs`, because a wake effect emitted before the drone
   *  subscribed replays to it — which is the behaviour, not a flake. */
  const passes: number[] = []
  type Drain = Awaited<ReturnType<typeof drainRouteFlows>>
  const answer = (...results: Drain[]): void => {
    for (const result of results) drain.mockImplementationOnce(async () => { passes.push(Date.now()); return result })
  }
  /** An answer built when the pass RUNS — for fields that are times. */
  const answerAt = (result: () => Drain): void => {
    drain.mockImplementationOnce(async () => { passes.push(Date.now()); return result() })
  }
  const gaps = (): number[] => passes.slice(1).map((at, i) => at - passes[i]!)

  beforeEach(() => {
    passes.length = 0
    drain.mockReset()
    drain.mockImplementation(async () => { passes.push(Date.now()); return { organized: 0, behind: 0, elapsedMs: 0 } })
  })

  // A PASS THAT RAN OUT OF BUDGET RESTS AS LONG AS IT RAN. "Ollama visits as
  // many chats as possible" still leaves the participant's GPU half the time
  // the page is open — a 90 s pass, then a 90 s rest.
  it('rests after a budget pass for as long as the pass ran — a true 50%', async () => {
    vi.useFakeTimers()
    try {
      answer({ organized: 3, behind: 2, stopped: 'budget', elapsedMs: 90_000 })
      await orchestrator.warmup()
      await vi.advanceTimersByTimeAsync(soonMs)
      expect(passes).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(90_000 - 1)
      expect(passes).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(gaps()).toEqual([90_000])
    } finally { vi.useRealTimers() }
  })

  it('after a yield, comes back when the drain says the lane reopens — or soon when it did not say', async () => {
    vi.useFakeTimers()
    try {
      answerAt(() => ({ organized: 0, behind: 1, stopped: 'yield', resumeAt: Date.now() + 30_000, elapsedMs: 1_200 }))
      answer({ organized: 0, behind: 1, stopped: 'yield', elapsedMs: 10 } as Drain)
      await orchestrator.warmup()
      await vi.advanceTimersByTimeAsync(soonMs + 30_000 + soonMs)
      expect(passes).toHaveLength(3)
      expect(gaps(), 'resumeAt, then soonMs with no resumeAt').toEqual([30_000, soonMs])
    } finally { vi.useRealTimers() }
  })

  it('never schedules NaN — a result missing its fields waits soonMs', async () => {
    vi.useFakeTimers()
    try {
      const delays: number[] = []
      const real = globalThis.setTimeout
      const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: () => void, ms?: number) => {
        delays.push(Number(ms))
        return real(handler, ms)
      }) as typeof setTimeout)
      try {
        answer(
          { organized: 0, behind: 0, stopped: 'budget' } as unknown as Drain,
          { organized: 0, behind: 0, stopped: 'yield', resumeAt: Number.NaN } as unknown as Drain,
        )
        await orchestrator.warmup()
        await vi.advanceTimersByTimeAsync(soonMs * 3)
        expect(passes).toHaveLength(3)
        expect(gaps()).toEqual([soonMs, soonMs])
        expect(delays.every(ms => Number.isFinite(ms)), `delays: ${delays.join(',')}`).toBe(true)
      } finally { spy.mockRestore() }
    } finally { vi.useRealTimers() }
  })

  it('comes back slowly after a call ran out of time — the server may be loading', async () => {
    vi.useFakeTimers()
    try {
      answer({ organized: 0, behind: 1, stopped: 'timeout', elapsedMs: 45_000 })
      await orchestrator.warmup()
      await vi.advanceTimersByTimeAsync(soonMs + idleMs)
      expect(passes).toHaveLength(2)
      expect(gaps()).toEqual([idleMs])
    } finally { vi.useRealTimers() }
  })

  it('a wake during a rest does not shorten it — opening a conversation must not cancel the rest', async () => {
    vi.useFakeTimers()
    try {
      answer({ organized: 2, behind: 3, stopped: 'budget', elapsedMs: 60_000 })
      await orchestrator.warmup()
      await vi.advanceTimersByTimeAsync(soonMs)
      expect(passes).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(10_000)
      for (const effect of ROUTE_FLOW_WAKES) wake(effect)
      await vi.advanceTimersByTimeAsync(wakeMs * 5)
      expect(passes, 'still resting').toHaveLength(1)
      await vi.advanceTimersByTimeAsync(60_000 - 10_000 - wakeMs * 5)
      expect(passes).toHaveLength(2)
      expect(gaps()).toEqual([60_000])
    } finally { vi.useRealTimers() }
  })

  it('a wake heard during a pass that ends in a rest waits the rest out', async () => {
    vi.useFakeTimers()
    try {
      let release!: (value: Drain) => void
      drain.mockImplementationOnce(() => new Promise(resolve => { passes.push(Date.now()); release = resolve }))
      await orchestrator.warmup()
      await vi.advanceTimersByTimeAsync(soonMs)
      expect(drain).toHaveBeenCalledTimes(1)
      wake('chat:threads-changed')
      await vi.advanceTimersByTimeAsync(20_000)
      const endedAt = Date.now()
      release({ organized: 1, behind: 4, stopped: 'budget', elapsedMs: 25_000 })
      await vi.advanceTimersByTimeAsync(wakeMs)
      expect(drain, 'not at the wake').toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(25_000 - wakeMs)
      expect(drain).toHaveBeenCalledTimes(2)
      expect(passes[1]! - endedAt).toBe(25_000)
    } finally { vi.useRealTimers() }
  })

  it('passes within a few seconds of starting, then comes back slowly when nothing is behind', async () => {
    vi.useFakeTimers()
    try {
      const started = Date.now()
      await orchestrator.warmup()
      await vi.advanceTimersByTimeAsync(soonMs)
      expect(passes).toHaveLength(1)
      expect(passes[0]! - started).toBeLessThanOrEqual(soonMs)
      await vi.advanceTimersByTimeAsync(idleMs)
      expect(passes).toHaveLength(2)
      expect(gaps()).toEqual([idleMs])
    } finally { vi.useRealTimers() }
  })

  it('comes back soon while a conversation is behind or a short pass hit its budget, slowly once caught up', async () => {
    vi.useFakeTimers()
    try {
      // A budget pass rests max(soonMs, elapsedMs): one that ran a second
      // comes back at soonMs, like a pass that left conversations behind.
      answer(
        { organized: 1, behind: 2, elapsedMs: 8_000 },
        { organized: 4, behind: 0, stopped: 'budget', elapsedMs: 1_000 },
        { organized: 0, behind: 0, elapsedMs: 50 },
      )
      await orchestrator.warmup()
      await vi.advanceTimersByTimeAsync(soonMs * 3 + idleMs)
      expect(passes).toHaveLength(4)
      expect(gaps(), 'behind → soon, budget → max(soon, elapsed), caught up → slow').toEqual([soonMs, soonMs, idleMs])
    } finally { vi.useRealTimers() }
  })

  it('stays slow with no local model awake, and after a failed call', async () => {
    vi.useFakeTimers()
    try {
      answer(
        { organized: 0, behind: 0, stopped: 'gate', elapsedMs: 3 },
        { organized: 0, behind: 1, stopped: 'fault', elapsedMs: 900 },
      )
      await orchestrator.warmup()
      await vi.advanceTimersByTimeAsync(soonMs + idleMs * 2)
      expect(passes).toHaveLength(3)
      expect(gaps()).toEqual([idleMs, idleMs])
    } finally { vi.useRealTimers() }
  })

  it('comes back just after a thread\'s last exchange goes quiet', async () => {
    vi.useFakeTimers()
    try {
      answer({ organized: 0, behind: 0, dueIn: 30_000, elapsedMs: 40 })
      await orchestrator.warmup()
      await vi.advanceTimersByTimeAsync(soonMs + 31_000)
      expect(passes).toHaveLength(2)
      expect(gaps()).toEqual([31_000])
    } finally { vi.useRealTimers() }
  })

  it('wakes early on each of its effects — and a burst of them is one pass', async () => {
    vi.useFakeTimers()
    try {
      await orchestrator.warmup()
      await vi.advanceTimersByTimeAsync(soonMs)
      expect(drain).toHaveBeenCalledTimes(1)

      for (const effect of ROUTE_FLOW_WAKES) wake(effect)
      wake(); wake()
      await vi.advanceTimersByTimeAsync(wakeMs - 1)
      expect(drain).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(drain, 'five wakes, one pass').toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(wakeMs * 3)
      expect(drain).toHaveBeenCalledTimes(2)

      for (const [at, effect] of ROUTE_FLOW_WAKES.entries()) {
        wake(effect)
        await vi.advanceTimersByTimeAsync(wakeMs)
        expect(drain, effect).toHaveBeenCalledTimes(3 + at)
      }
    } finally { vi.useRealTimers() }
  })

  it('never runs two passes at once — a wake during a pass becomes one pass after it', async () => {
    vi.useFakeTimers()
    try {
      let release!: (value: { organized: number; behind: number }) => void
      drain.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
      await orchestrator.warmup()
      await vi.advanceTimersByTimeAsync(soonMs)
      expect(drain).toHaveBeenCalledTimes(1)

      for (const effect of ROUTE_FLOW_WAKES) wake(effect)
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(drain, 'still the one pass').toHaveBeenCalledTimes(1)

      release({ organized: 0, behind: 0 })
      await vi.advanceTimersByTimeAsync(wakeMs)
      expect(drain, 'the wake it heard, once').toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(idleMs - 1)
      expect(drain).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('stops for good when disposed', async () => {
    vi.useFakeTimers()
    try {
      await orchestrator.warmup()
      await vi.advanceTimersByTimeAsync(soonMs)
      expect(drain).toHaveBeenCalledTimes(1)
      ;(orchestrator as unknown as { dispose: () => void }).dispose()
      wake()
      await vi.advanceTimersByTimeAsync(idleMs * 2)
      expect(drain).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
})
