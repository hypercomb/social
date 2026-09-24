// orchestrator.agent-panel.spec.ts — the agent panel arrives with its first
// open (orchestrator.drone.ts; atomic-modules-plan.md, "adopt the proper
// load"). Boot makes nothing; the first `agent:open` loads the panel and makes
// it ONCE, and the bus's replay opens it. What was pressed while it loaded is
// what stands once it is made: a swarm joined earlier does not put a local
// agent's panel down, a press closed again stays closed, and an open after
// that close stays open — without a word that it closed, which would put the
// perch and the audit view down. A close left over from a failed load is old
// news: the retry opens.

import { describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

// The route-flow drain is the orchestrator's to schedule, not this spec's.
vi.mock('./chat-route.js', () => ({
  drainRouteFlows: vi.fn(async () => ({ organized: 0, behind: 0, elapsedMs: 0 })),
  readRoute: vi.fn(),
  organizeRoute: vi.fn(),
}))

const KEY = '@diamondcoreprocessor.com/AgentPanelView'
const services = new Map<string, unknown>()
const registered: string[] = []
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered.push(key); services.set(key, value) },
  get: (key: string) => services.get(key),
  whenReady: () => { /* noop */ },
  list: () => [...services.keys()],
}

/** A fresh boot: a clean bus, an empty page, the bee loaded anew, and one
 *  local agent in its registry. */
const boot = async (): Promise<void> => {
  EffectBus.clear()
  document.body.innerHTML = ''
  services.clear()
  registered.length = 0
  vi.resetModules()
  await import('./orchestrator.drone.js')
  EffectBus.emit('agent:start', { id: 'local-a', behavior: 'opus' })
  EffectBus.emit('agent:start', { id: 'local-b', behavior: 'opus' })
}
const made = async (): Promise<void> => {
  await vi.waitFor(() => expect(services.has(KEY)).toBe(true), { timeout: 10_000 })
}
const panels = (): number => document.querySelectorAll('.hc-agent').length

describe('the agent panel door', () => {
  it('makes nothing at boot, then the panel once on the first open — later opens reuse it', async () => {
    await boot()
    expect(services.has(KEY)).toBe(false)
    EffectBus.emit('agent:open', { id: 'local-a' })
    await made()
    expect(panels()).toBe(1)
    EffectBus.emit('agent:open', { id: 'local-b' })
    EffectBus.emit('agent:open', { id: 'local-a' })
    expect(panels()).toBe(1)
    expect(registered.filter(key => key === KEY)).toHaveLength(1)
  })

  it('keeps a local agent\'s panel open when the swarm was joined before the press', async () => {
    await boot()
    EffectBus.emit('mesh:public-changed', { public: true })
    EffectBus.emit('agent:open', { id: 'local-a' })
    await made()
    expect(panels()).toBe(1)
  })

  it('leaves a press closed again while it loads closed', async () => {
    await boot()
    EffectBus.emit('agent:open', { id: 'local-a' })
    EffectBus.emit('agent:close', { id: 'local-a' })
    await made()
    expect(panels()).toBe(0)
  })

  it('leaves an open that came after that close open', async () => {
    await boot()
    EffectBus.emit('agent:open', { id: 'local-a' })
    EffectBus.emit('agent:close', { id: 'local-a' })
    EffectBus.emit('agent:open', { id: 'local-a' })
    await made()
    expect(panels()).toBe(1)
    expect(registered.filter(key => key === KEY)).toHaveLength(1)
  })

  it('says it closed only when the last press closed it', async () => {
    await boot()
    const closed: unknown[] = []
    EffectBus.on('agent:closed', payload => { closed.push(payload) })
    EffectBus.emit('agent:open', { id: 'local-a' })
    EffectBus.emit('agent:close', { id: 'local-a' })
    EffectBus.emit('agent:open', { id: 'local-a' })
    await made()
    expect(panels()).toBe(1)
    expect(closed).toEqual([])

    await boot()
    const closedAgain: unknown[] = []
    EffectBus.on('agent:closed', payload => { closedAgain.push(payload) })
    EffectBus.emit('agent:open', { id: 'local-a' })
    EffectBus.emit('agent:close', { id: 'local-a' })
    await made()
    expect(panels()).toBe(0)
    expect(closedAgain).toEqual([{ id: 'local-a' }])
  })

  it('opens on the retry after a failed load, whatever close came between', async () => {
    await boot()
    const logged: unknown[] = []
    const closed: unknown[] = []
    EffectBus.on('activity:log', payload => { logged.push(payload) })
    EffectBus.on('agent:closed', payload => { closed.push(payload) })
    vi.doMock('./agent-panel.view.js', () => { throw new Error('offline') })
    EffectBus.emit('agent:open', { id: 'local-a' })
    await vi.waitFor(() => expect(logged).toHaveLength(1), { timeout: 10_000 })
    vi.doUnmock('./agent-panel.view.js')
    // The second press on the perched bee puts it down while nothing is there.
    EffectBus.emit('agent:close', { id: 'local-a' })
    EffectBus.emit('agent:open', { id: 'local-a' })
    await made()
    expect(panels()).toBe(1)
    expect(closed).toEqual([])
  })
})
