// mail/cue.spec.ts — the timing pieces the mail window's cues are made of, on a
// clock the spec turns by hand. What it proves: a poll asks nothing while the
// page is hidden, never overlaps itself, and stops for good after two failures
// in a row; a draft save waits for the typing to pause and can be made at once.

import { describe, expect, it } from 'vitest'
import { Debounced, POLL_MAX_ERRORS, Poller, progressShare, sizeLabel, type Timers } from './cue.js'

/** A clock that moves only when told. */
function handClock() {
  let now = 0
  let next = 1
  const waiting = new Map<number, { at: number; run: () => void }>()
  const timers: Timers = {
    set: (run, ms) => { const id = next++; waiting.set(id, { at: now + ms, run }); return id },
    clear: handle => { waiting.delete(handle as number) },
  }
  const advance = async (ms: number): Promise<void> => {
    const until = now + ms
    for (;;) {
      const due = [...waiting.entries()].filter(([, w]) => w.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      waiting.delete(due[0])
      now = due[1].at
      due[1].run()
      for (let i = 0; i < 5; i++) await Promise.resolve()
    }
    now = until
  }
  return { timers, advance, pending: () => waiting.size }
}

describe('Poller', () => {
  it('waits one interval before the first check, then checks every interval', async () => {
    const clock = handClock()
    let checks = 0
    const poll = new Poller({ everyMs: 100, visible: () => true, check: async () => { checks++ }, timers: clock.timers })
    poll.start()
    await clock.advance(99)
    expect(checks).toBe(0)
    await clock.advance(1)
    expect(checks).toBe(1)
    await clock.advance(300)
    expect(checks).toBe(4)
    poll.stop()
    await clock.advance(1000)
    expect(checks).toBe(4)
    expect(clock.pending()).toBe(0)
  })

  it('asks nothing while the page is hidden, and starts again when it is seen', async () => {
    const clock = handClock()
    let visible = false
    let checks = 0
    const poll = new Poller({ everyMs: 100, visible: () => visible, check: async () => { checks++ }, timers: clock.timers })
    poll.start()
    await clock.advance(1000)
    expect(checks).toBe(0)
    expect(poll.running).toBe(true)
    visible = true
    await clock.advance(100)
    expect(checks).toBe(1)
  })

  it('stops for good after two failures in a row, and a success in between resets the count', async () => {
    const clock = handClock()
    const outcomes = ['fail', 'ok', 'fail', 'fail', 'ok']
    let checks = 0
    let gaveUp = 0
    const poll = new Poller({
      everyMs: 10, visible: () => true, timers: clock.timers, onGiveUp: () => { gaveUp++ },
      check: async () => { if (outcomes[checks++] === 'fail') throw new Error('down') },
    })
    poll.start()
    await clock.advance(100)
    expect(POLL_MAX_ERRORS).toBe(2)
    expect(checks).toBe(4) // fail, ok (reset), fail, fail → stopped
    expect(poll.running).toBe(false)
    expect(gaveUp).toBe(1)
    expect(clock.pending()).toBe(0)
  })

  it('never runs two checks at once: a slow check holds the next one back', async () => {
    const clock = handClock()
    let running = 0
    let most = 0
    let finish: () => void = () => {}
    const poll = new Poller({
      everyMs: 10, visible: () => true, timers: clock.timers,
      check: () => new Promise<void>(resolve => { running++; most = Math.max(most, running); finish = () => { running--; resolve() } }),
    })
    poll.start()
    await clock.advance(10)
    expect(await poll.tick()).toBe('skipped') // one is still out
    await clock.advance(100)
    expect(most).toBe(1)
    finish()
    await clock.advance(10)
    expect(most).toBe(1)
    poll.stop()
  })

  it('a tick after stop asks nothing', async () => {
    let checks = 0
    const poll = new Poller({ everyMs: 10, visible: () => true, check: async () => { checks++ }, timers: handClock().timers })
    expect(await poll.tick()).toBe('stopped')
    expect(checks).toBe(0)
  })
})

describe('Debounced', () => {
  it('runs once the calls stop, and flush runs it at once', async () => {
    const clock = handClock()
    let runs = 0
    const later = new Debounced(() => { runs++ }, 2000, clock.timers)
    later.call(); await clock.advance(1500)
    later.call(); await clock.advance(1500)
    expect(runs).toBe(0)
    await clock.advance(500)
    expect(runs).toBe(1)
    later.call()
    expect(later.pending).toBe(true)
    await later.flush()
    expect(runs).toBe(2)
    expect(later.pending).toBe(false)
    await later.flush() // nothing waiting: nothing runs
    expect(runs).toBe(2)
    later.call(); later.cancel(); await clock.advance(5000)
    expect(runs).toBe(2)
  })

  it('a failing act does not escape', async () => {
    const later = new Debounced(() => { throw new Error('kept') }, 10, handClock().timers)
    later.call()
    await expect(later.flush()).resolves.toBeUndefined()
  })
})

describe('words for progress and size', () => {
  it('says how far a load has got, and nothing before the total is known', () => {
    expect(progressShare(null)).toBeNull()
    expect(progressShare({ opened: 0, total: 0 })).toBeNull()
    expect(progressShare({ opened: 1, total: 4 })).toBe(0.25)
    expect(progressShare({ opened: 9, total: 4 })).toBe(1)
  })

  it('says sizes in KB under a megabyte and MB above, never "0 KB"', () => {
    expect(sizeLabel(0)).toBe('1 KB')
    expect(sizeLabel(2048)).toBe('2 KB')
    expect(sizeLabel(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(sizeLabel(10 * 1024 * 1024)).toBe('10 MB')
    expect(sizeLabel(Number.NaN)).toBe('1 KB')
  })
})
