import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Bee } from './bee.base.js'

// THE INTERFACE DISCONNECTS (jwize 2026-11-13: "we should be able upgrade and not have to have a refresh … as long
// as the interface disconnects it would be fine"). A bee that leaves while the hive runs must leave nothing answering
// in its place. What it wires through the base is let go for it on dispose, the way its effects always were.

class Wired extends Bee {
  readonly namespace = 'example.com'
  readonly order: string[] = []
  pulse = async (): Promise<void> => undefined
  hear(target: EventTarget, type: string, handler: () => void): () => void { return this.listen(target, type, handler) }
  tick(milliseconds: number, run: () => void): () => void { return this.every(milliseconds, run) }
  later(milliseconds: number, run: () => void): () => void { return this.after(milliseconds, run) }
  hold(release: () => void): () => void { return this.own(release) }
  protected dispose(): void { this.order.push('dispose') }
}

describe('what a bee holds by hand is let go when it is disposed', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('a listener it owns stops answering', () => {
    const bee = new Wired()
    const target = new EventTarget()
    const heard = vi.fn()
    bee.hear(target, 'press', heard)
    target.dispatchEvent(new Event('press'))
    expect(heard).toHaveBeenCalledTimes(1)

    bee.markDisposed()
    target.dispatchEvent(new Event('press'))
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('a repeating timer stops, and a one-shot never fires on a disposed bee', () => {
    const bee = new Wired()
    const ticked = vi.fn()
    const fired = vi.fn()
    bee.tick(10, ticked)
    bee.later(50, fired)
    vi.advanceTimersByTime(25)
    expect(ticked).toHaveBeenCalledTimes(2)

    bee.markDisposed()
    vi.advanceTimersByTime(100)
    expect(ticked).toHaveBeenCalledTimes(2)
    expect(fired).not.toHaveBeenCalled()
  })

  it('a one-shot that fired is no longer held', () => {
    const bee = new Wired()
    const fired = vi.fn()
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    bee.later(10, fired)
    vi.advanceTimersByTime(10)
    expect(fired).toHaveBeenCalledTimes(1)
    clear.mockClear()
    bee.markDisposed()
    expect(clear).not.toHaveBeenCalled()
    clear.mockRestore()
  })

  it('releases run newest first, once, and before the bee’s own dispose()', () => {
    const bee = new Wired()
    bee.hold(() => bee.order.push('first'))
    bee.hold(() => bee.order.push('second'))
    bee.markDisposed()
    bee.markDisposed()
    expect(bee.order).toEqual(['second', 'first', 'dispose'])
  })

  it('the answer lets go early, and then dispose has nothing to do for it', () => {
    const bee = new Wired()
    const release = vi.fn()
    const letGo = bee.hold(release)
    letGo()
    letGo()
    bee.markDisposed()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('a release that throws does not keep the rest held', () => {
    const bee = new Wired()
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    bee.hold(() => bee.order.push('kept'))
    bee.hold(() => { throw new Error('broken') })
    bee.markDisposed()
    expect(bee.order).toEqual(['kept', 'dispose'])
    quiet.mockRestore()
  })

  it('a bee already disposed releases at once', () => {
    const bee = new Wired()
    bee.markDisposed()
    const release = vi.fn()
    bee.hold(release)
    expect(release).toHaveBeenCalledTimes(1)
  })
})
