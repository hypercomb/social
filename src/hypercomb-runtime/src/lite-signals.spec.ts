// lite-signals.spec.ts — Angular's signal semantics, as the chat window's
// logic relies on them, answered without Angular.

import { describe, expect, it, vi } from 'vitest'
import { afterNextRender, computed, createOwner, effect, flush, isSignal, PRIORITY, scheduled, signal, untracked } from './lite-signals'

// A refresh is a macrotask (Angular's setTimeout / requestAnimationFrame race): wait one out.
const tick = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0)) }

describe('signal', () => {
  it('reads, sets, updates, and ignores a write of the same value (Object.is)', () => {
    const count = signal(1)
    expect(count()).toBe(1)
    count.set(2)
    count.update(v => v + 1)
    expect(count()).toBe(3)
    expect(isSignal(count)).toBe(true)
    expect(isSignal(() => 3)).toBe(false)
    const ro = count.asReadonly()
    expect(ro()).toBe(3)
    expect('set' in ro).toBe(false)
  })
})

describe('computed', () => {
  it('is lazy: nothing runs until it is read', () => {
    const fn = vi.fn(() => 1)
    const c = computed(fn)
    expect(fn).not.toHaveBeenCalled()
    expect(c()).toBe(1)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('is memoised until something it read changes', () => {
    const a = signal(1)
    const fn = vi.fn(() => a() * 2)
    const c = computed(fn)
    c(); c()
    expect(fn).toHaveBeenCalledOnce()
    a.set(2)
    expect(c()).toBe(4)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('compares with Object.is: an equal result does not wake its readers', async () => {
    const a = signal(1)
    const parity = computed(() => a() % 2)
    const seen: number[] = []
    effect(() => { seen.push(parity()) })
    await tick()
    a.set(3)                      // parity is still 1
    await tick()
    expect(seen).toEqual([1])
    a.set(4)
    await tick()
    expect(seen).toEqual([1, 0])
  })

  it('tracks only what the last run read (dynamic dependencies)', () => {
    const which = signal(true), left = signal('l'), right = signal('r')
    const fn = vi.fn(() => (which() ? left() : right()))
    const c = computed(fn)
    expect(c()).toBe('l')
    right.set('R')                // not read: no recompute
    expect(c()).toBe('l')
    expect(fn).toHaveBeenCalledOnce()
    which.set(false)
    expect(c()).toBe('R')
  })

  it('rethrows what its function threw, and recovers when its input does', () => {
    const a = signal(0)
    const c = computed(() => { if (a() === 0) throw new Error('zero'); return 10 / a() })
    expect(() => c()).toThrow('zero')
    a.set(2)
    expect(c()).toBe(5)
  })
})

describe('effect', () => {
  it('(a) first runs after construction, never inside it — a later field may be read', async () => {
    class Window {
      readonly log: string[] = []
      readonly #watch = effect(() => { this.log.push(this.railVisible()) })
      readonly railVisible = signal('shown')   // declared after the effect, as in the chat window
    }
    const w = new Window()
    expect(w.log).toEqual([])
    await tick()
    expect(w.log).toEqual(['shown'])
  })

  it('(b) may write signals, and what it wrote is seen in the same flush', async () => {
    const question = signal(0), cursor = signal(-1)
    const seen: number[] = []
    effect(() => { if (question() > 0) cursor.set(0) })
    effect(() => { seen.push(cursor()) })
    await tick()
    question.set(1)
    await tick()
    expect(seen).toEqual([-1, 0])
  })

  it('(c) tracks reads inside methods the run calls', async () => {
    class Rail {
      readonly here = signal('a')
      readonly seen: string[] = []
      #note(): void { this.seen.push(this.here()) }
      readonly #watch = effect(() => this.#note())
    }
    const rail = new Rail()
    await tick()
    rail.here.set('b')
    await tick()
    expect(rail.seen).toEqual(['a', 'b'])
  })

  it('(e) runs once per flush however many writes it saw', async () => {
    const a = signal(0)
    const fn = vi.fn(() => { a() })
    effect(fn)
    await tick()
    a.set(1); a.set(2); a.set(3)
    await tick()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('(e) effects run before views, views before after-render hooks', async () => {
    const order: string[] = []
    const a = signal(0)
    scheduled(() => { a(); order.push('view') }, PRIORITY.view)
    effect(() => { a(); order.push('effect') })
    afterNextRender(() => order.push('after'))
    await tick()
    expect(order).toEqual(['effect', 'view', 'after'])
  })

  it('does not track what untracked() read', async () => {
    const tracked = signal(0), quiet = signal(0)
    const fn = vi.fn(() => { tracked(); untracked(() => quiet()) })
    effect(fn)
    await tick()
    quiet.set(1)
    await tick()
    expect(fn).toHaveBeenCalledOnce()
    tracked.set(1)
    await tick()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('is disposed with the owner it was created under (DestroyRef)', async () => {
    const a = signal(0)
    const fn = vi.fn(() => { a() })
    const owner = createOwner()
    owner.run(() => { effect(fn) })
    await tick()
    owner.dispose()
    a.set(1)
    await tick()
    expect(fn).toHaveBeenCalledOnce()
    expect(owner.disposed).toBe(true)
  })

  it('an after-render hook queued under an owner that is gone never runs', async () => {
    const owner = createOwner()
    const fn = vi.fn()
    owner.run(() => afterNextRender(fn))
    owner.dispose()
    await tick()
    expect(fn).not.toHaveBeenCalled()
  })

  it('a destroyed effect never runs again', async () => {
    const a = signal(0)
    const fn = vi.fn(() => { a() })
    const ref = effect(fn)
    await tick()
    ref.destroy()
    a.set(1)
    await tick()
    expect(fn).toHaveBeenCalledOnce()
  })

  it('stops a runaway loop instead of freezing the page, and what it dropped can run again', async () => {
    const a = signal(0), b = signal(0)
    const views: number[] = []
    scheduled(() => { a(); views.push(b()) }, PRIORITY.view)
    await tick()                                  // the view has run, and reads a and b
    const error = vi.spyOn(console, 'error').mockImplementation(() => { /* expected */ })
    const ref = effect(() => { a.set(a() + 1) })
    await tick()
    flush()
    ref.destroy()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
    b.set(42)
    await tick()
    expect(views.at(-1)).toBe(42)                 // the view, dropped by the guard, is scheduled again
  })
})

describe('when a flush runs (Angular’s zoneless timing)', () => {
  it('a microtask queued right after a write runs BEFORE the refresh', async () => {
    const armed = signal(false)
    const seen: boolean[] = []
    scheduled(() => { seen.push(armed()) }, PRIORITY.view)
    await tick()
    armed.set(true)
    let inMicrotask: boolean[] = []
    queueMicrotask(() => { inMicrotask = [...seen] })
    await tick()
    expect(inMicrotask).toEqual([false])          // the refresh had not run yet
    expect(seen).toEqual([false, true])
  })

  it('in the microtask right after a flush, a write refreshes on a microtask', async () => {
    const a = signal(0)
    const seen: number[] = []
    scheduled(() => { seen.push(a()) }, PRIORITY.view)
    afterNextRender(() => { queueMicrotask(() => { a.set(1); queueMicrotask(() => queueMicrotask(() => { seen.push(-1) })) }) })
    await tick()
    expect(seen).toEqual([0, 1, -1])              // 1 landed in the microtask window, before the marker
  })
})
