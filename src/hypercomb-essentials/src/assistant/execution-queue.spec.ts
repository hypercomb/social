import { beforeEach, describe, expect, it } from 'vitest'

// The module registers itself in IoC at load (as every essentials service
// does); the store is exercised directly and needs no live map.
const g = globalThis as { window?: { ioc?: unknown } }
g.window ??= {}
g.window.ioc ??= { register: () => {}, get: () => undefined, whenReady: () => {} }
const { ExecutionQueueStore } = await import('./execution-queue.js')
const { llmHiveAccess } = await import('./llm-hive-access.js')

const ask = (over: Partial<Parameters<InstanceType<typeof ExecutionQueueStore>['request']>[0]> = {}) => ({
  convoId: 'c1', providerId: 'openrouter', model: 'deepseek/deepseek-v4-flash',
  kind: 'additive' as const, lines: ['/title a = b'], needsGrant: false, ...over,
})

describe('the execution queue', () => {
  it('keeps an uncertain decision under participant review through policy changes', async () => {
    const queue = new ExecutionQueueStore()
    queue.setMode('everything')
    const entry = queue.request(ask({ forceReview: true }))
    expect(queue.requests().find(row => row.id === entry.id)?.state).toBe('waiting')
    queue.setMode('manual')
    queue.setMode('everything')
    expect(queue.requests().find(row => row.id === entry.id)?.state).toBe('waiting')
    queue.decide(entry.id, 'run')
    expect(await entry.decision).toBe('run')
  })
  beforeEach(() => {
    localStorage.clear()
    llmHiveAccess.setMayRead('openrouter', false)
  })

  it('by default runs reads on arrival and holds changes for the participant', async () => {
    const queue = new ExecutionQueueStore()
    const read = queue.request(ask({ kind: 'read', lines: ['/read'] }))
    expect(await read.decision).toBe('run')
    const change = queue.request(ask())
    expect(queue.requests().find(r => r.id === change.id)?.state).toBe('waiting')
    queue.decide(change.id, 'run')
    expect(await change.decision).toBe('run')
  })

  it('never runs an ungranted read by policy, even on everything', async () => {
    const queue = new ExecutionQueueStore()
    queue.setMode('everything')
    const read = queue.request(ask({ kind: 'read', lines: ['/read'], needsGrant: true }))
    expect(queue.requests()[0].state).toBe('waiting')
    queue.decide(read.id, 'skip')
    expect(await read.decision).toBe('skip')
  })

  it('"always" grants the provider and answers its other waiting reads', async () => {
    const queue = new ExecutionQueueStore()
    const first = queue.request(ask({ kind: 'read', lines: ['/read'], needsGrant: true }))
    const second = queue.request(ask({ kind: 'read', lines: ['/list'], needsGrant: true }))
    queue.decide(first.id, 'always')
    expect(await first.decision).toBe('run')
    expect(await second.decision).toBe('run')
    expect(llmHiveAccess.mayRead('openrouter')).toBe(true)
  })

  it('a looser policy releases what it now covers, and the policy sticks', async () => {
    const queue = new ExecutionQueueStore()
    queue.setMode('manual')
    const change = queue.request(ask({ kind: 'editing' }))
    queue.setMode('auto')
    queue.setAuto('editing', true)
    expect(await change.decision).toBe('run')
    const again = new ExecutionQueueStore()
    expect(again.mode()).toBe('auto')
    expect(again.autoKinds()).toEqual(['read', 'editing'])
  })

  it('stopping the conversation skips what is still waiting', async () => {
    const queue = new ExecutionQueueStore()
    const stop = new AbortController()
    const change = queue.request(ask({ signal: stop.signal }))
    stop.abort()
    expect(await change.decision).toBe('skip')
    expect(queue.requests()[0].state).toBe('skipped')
  })

  it('settles with an outcome, and a waiting row cannot be settled past', () => {
    const queue = new ExecutionQueueStore()
    const change = queue.request(ask())
    queue.settle(change.id, 'ran', 'done')
    expect(queue.requests()[0].state).toBe('waiting')
    queue.decide(change.id, 'run')
    queue.settle(change.id, 'failed', 'no such tile')
    expect(queue.requests()[0]).toMatchObject({ state: 'failed', outcome: 'no such tile' })
  })
})
