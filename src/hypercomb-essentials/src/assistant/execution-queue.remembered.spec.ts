import { beforeEach, describe, expect, it } from 'vitest'
import { ExecutionQueueStore } from './execution-queue.js'
import { llmHiveAccess } from './llm-hive-access.js'

// "If they've looked it up once it's totally OK to look it up — unless we
// stop allowing it" (Jaime, 2026-09-13).
const ask = (keys: readonly string[], providerId = 'openrouter') => ({
  convoId: 'c1', providerId, model: 'deepseek/deepseek-v4-flash-0731',
  kind: 'read' as const, lines: keys, keys, needsGrant: true,
})

beforeEach(() => {
  localStorage.clear()
  llmHiveAccess.setMayRead('openrouter', false)
})

describe('a read allowed once is remembered', () => {
  it('waits the first time, runs on arrival the next time', async () => {
    const queue = new ExecutionQueueStore()
    const first = queue.request(ask(['read /projects/roadmap']))
    expect(queue.requests()[0]?.state).toBe('waiting')
    queue.decide(first.id, 'run')
    expect(await first.decision).toBe('run')
    expect(queue.allowed('openrouter')).toEqual(['read /projects/roadmap'])

    const again = queue.request(ask(['read /projects/roadmap']))
    expect(await again.decision).toBe('run')
    expect(queue.requests()[0]).toMatchObject({ auto: true, remembered: true, state: 'running' })
  })

  it('survives a new queue (a restart), per provider', () => {
    const queue = new ExecutionQueueStore()
    queue.decide(queue.request(ask(['read /notes'])).id, 'run')
    const restarted = new ExecutionQueueStore()
    restarted.request(ask(['read /notes']))
    expect(restarted.requests()[0]?.remembered).toBe(true)
    restarted.request(ask(['read /notes'], 'other-provider'))
    expect(restarted.requests()[0]?.state).toBe('waiting')
  })

  it('asks again when any line was never allowed, and never remembers a skip', () => {
    const queue = new ExecutionQueueStore()
    queue.decide(queue.request(ask(['read /a'])).id, 'run')
    queue.request(ask(['read /a', 'read /b']))
    expect(queue.requests()[0]?.state).toBe('waiting')
    queue.decide(queue.requests()[0]!.id, 'skip')
    expect(queue.allowed('openrouter')).toEqual(['read /a'])
  })

  it('forgets everything the moment the provider is no longer allowed to read', () => {
    const queue = new ExecutionQueueStore()
    queue.decide(queue.request(ask(['read /a'])).id, 'run')
    llmHiveAccess.setMayRead('openrouter', true)
    expect(queue.allowed('openrouter')).toEqual(['read /a'])
    llmHiveAccess.setMayRead('openrouter', false)
    expect(queue.allowed('openrouter')).toEqual([])
    queue.request(ask(['read /a']))
    expect(queue.requests()[0]?.state).toBe('waiting')
  })
})
