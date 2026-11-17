// publish-sweep.spec.ts — THE PUBLISH WINDOW'S LOOK FINISHES (2026-11-16).
//
// The look checked one row at a time and one step at a time, so a single slow
// answer held every row behind it: the window said "refreshing" for minutes
// and never reached meetups. Rows are now checked a few at a time; sealing,
// the one heavy local walk, still runs alone.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROWS_AT_ONCE, sealLane, sweepRows } from './publish-sweep.js'

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe('the publish look', () => {
  it('a slow row does not hold the rows behind it', async () => {
    const done: string[] = []
    await sweepRows(['slow', 'a', 'b', 'c'], async row => {
      await wait(row === 'slow' ? 60 : 1)
      done.push(row)
    })
    expect(done).toEqual(['a', 'b', 'c', 'slow'])
  })

  it('checks at most ROWS_AT_ONCE rows at a time', async () => {
    let running = 0
    let most = 0
    await sweepRows(Array.from({ length: 12 }, (_, i) => i), async () => {
      running++
      most = Math.max(most, running)
      await wait(2)
      running--
    })
    expect(most).toBe(ROWS_AT_ONCE)
  })

  it('every seal runs alone, in the order handed, even when one fails', async () => {
    let sealing = 0
    let overlapped = false
    const order: number[] = []
    await sweepRows([0, 1, 2, 3, 4, 5], async (row, seal) => {
      await seal(async () => {
        sealing++
        if (sealing > 1) overlapped = true
        await wait(3)
        order.push(row)
        sealing--
        if (row === 2) throw new Error('cold child')
      }).catch(() => null)
    })
    expect(overlapped).toBe(false)
    expect(order).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('a row whose check throws leaves the others to finish', async () => {
    const done: number[] = []
    await sweepRows([1, 2, 3], async row => {
      if (row === 2) throw new Error('boom')
      done.push(row)
    })
    expect(done).toEqual([1, 3])
  })

  it('a seal its caller stopped waiting for still keeps the next one from starting beside it', async () => {
    const lane = sealLane()
    const order: string[] = []
    let release: () => void = () => {}
    const slow = lane(async () => { order.push('slow:start'); await new Promise<void>(resolve => { release = resolve }); order.push('slow:end') })
    // The caller's deadline: it gives up on the slow seal, the lane does not.
    await Promise.race([slow, wait(5)])
    const next = lane(async () => { order.push('next') })
    await wait(10)
    expect(order).toEqual(['slow:start'])
    release()
    await Promise.all([slow, next])
    expect(order).toEqual(['slow:start', 'slow:end', 'next'])
  })

  it('a lane hands back what its work returned', async () => {
    const lane = sealLane()
    await expect(Promise.all([lane(async () => 'a'), lane(async () => 'b')])).resolves.toEqual(['a', 'b'])
  })

  it('the window sweeps through it, sealing in the lane and asking a row\'s reads together', () => {
    const drone = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'sharing', 'publish-status.drone.ts'), 'utf8')
    expect(drone).toContain('await sweepRows(sweep, async (row, seal) => {')
    // The deadline is outside the lane, so the lane waits for the seal itself.
    expect(drone).toMatch(/beforeDeadline\(seal\(\(\) => history\.sealSubtree\(/)
    expect(drone).toMatch(/const \[opensAs, plan, promoted, here, served\] = await Promise\.all\(\[/)
  })
})
