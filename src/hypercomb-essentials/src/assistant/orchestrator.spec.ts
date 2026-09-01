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

import { EffectBus } from '@hypercomb/core'
import { OrchestratorDrone, ORCHESTRATOR_ID } from './orchestrator.drone.js'

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
