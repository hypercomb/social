// publish-lane.spec.ts — one publish at a time, whatever started it.

import { describe, expect, it, vi } from 'vitest'
import { inPublishLane, publishLaneLength } from './publish-lane.js'

const later = <T>(value: T, ms = 5): Promise<T> => new Promise(resolve => setTimeout(() => resolve(value), ms))

describe('the publish lane', () => {
  it('runs acts one after another, in the order they arrived', async () => {
    const seen: string[] = []
    const act = (name: string, ms: number) => async () => {
      seen.push(`start ${name}`)
      await later(null, ms)
      seen.push(`end ${name}`)
      return name
    }
    // The first is the slowest: side by side, the others would finish first.
    const results = await Promise.all([inPublishLane(act('a', 30)), inPublishLane(act('b', 1)), inPublishLane(act('c', 1))])
    expect(results).toEqual(['a', 'b', 'c'])
    expect(seen).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
    expect(publishLaneLength()).toBe(0)
  })

  it('tells an act it is waiting only when something is ahead of it', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const a = inPublishLane(() => later('a', 10), first)
    const b = inPublishLane(() => later('b'), second)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    await Promise.all([a, b])
  })

  it('an act that fails answers its caller, and the ones behind it still run', async () => {
    const failed = inPublishLane(async () => { throw new Error('host refused') })
    const next = inPublishLane(() => later('next'))
    await expect(failed).rejects.toThrow('host refused')
    await expect(next).resolves.toBe('next')
  })

  it('is one lane for every copy of the module — a hive can load it twice', async () => {
    vi.resetModules()
    const again = await import('./publish-lane.js')
    const seen: string[] = []
    const a = inPublishLane(async () => { seen.push('a'); await later(null, 20); seen.push('a done') })
    const b = again.inPublishLane(async () => { seen.push('b') })
    await Promise.all([a, b])
    expect(seen).toEqual(['a', 'a done', 'b'])
  })
})
