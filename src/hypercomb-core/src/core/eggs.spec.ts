import { describe, expect, it } from 'vitest'
import { askUntried, clearEggs, untriedHosts, type EggProbe } from './eggs.js'

const sig = (c: string): string => c.repeat(64)

/** A host set where each host holds exactly what it is given. */
const hosts = (held: Record<string, EggProbe<string>>) => {
  const asked: string[] = []
  const ask = async (base: string): Promise<EggProbe<string>> => { asked.push(base); return held[base] ?? 'absent' }
  return { asked, ask }
}

describe('eggs — a signature that has not arrived, at rest', () => {
  it('asks each refusing host once; the next ask sends nothing', async () => {
    const s = sig('a')
    const net = hosts({})
    expect(await askUntried(s, ['https://one', 'https://two'], net.ask)).toBeNull()
    expect(net.asked).toEqual(['https://one', 'https://two'])
    expect(await askUntried(s, ['https://one', 'https://two'], net.ask)).toBeNull()
    expect(net.asked).toEqual(['https://one', 'https://two'])
  })

  it('wakes only for a host it has never asked', async () => {
    const s = sig('b')
    const net = hosts({ 'https://three': 'bytes' })
    await askUntried(s, ['https://one', 'https://two'], net.ask)
    expect(await askUntried(s, ['https://one', 'https://two', 'https://three'], net.ask)).toBe('bytes')
    expect(net.asked).toEqual(['https://one', 'https://two', 'https://three'])
  })

  it('never records an unreachable host — offline is not "not here"', async () => {
    const s = sig('c')
    const net = hosts({ 'https://one': 'unreachable' })
    await askUntried(s, ['https://one'], net.ask)
    expect(await untriedHosts(s, ['https://one'])).toEqual(['https://one'])
  })

  it('hatches when the bytes arrive: no egg is left for what is now held', async () => {
    const s = sig('d')
    const net = hosts({ 'https://two': 'bytes' })
    expect(await askUntried(s, ['https://one', 'https://two'], net.ask)).toBe('bytes')
    expect(await untriedHosts(s, ['https://one', 'https://two'])).toEqual(['https://one', 'https://two'])
  })

  it('leaves anything that is not a signature alone', async () => {
    const net = hosts({})
    await askUntried('not-a-sig', ['https://one'], net.ask)
    await askUntried('not-a-sig', ['https://one'], net.ask)
    expect(net.asked).toEqual(['https://one', 'https://one'])
  })

  describe('asks in flight at once for one signature take turns', () => {
    /** Hosts that answer only when released, so asks can be piled up first. */
    const slowHosts = (held: Record<string, EggProbe<string>>) => {
      const asked: string[] = []
      const waiting: (() => void)[] = []
      const ask = (base: string): Promise<EggProbe<string>> => new Promise(resolve => {
        asked.push(base)
        waiting.push(() => resolve(held[base] ?? 'absent'))
      })
      const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
      // Answer every ask as it lands, until a few ticks pass with none.
      const release = async (): Promise<void> => {
        for (let idle = 0; idle < 3; idle++) {
          await tick()
          while (waiting.length) { waiting.shift()!(); await tick(); idle = 0 }
        }
      }
      return { asked, ask, release }
    }

    it('a burst of misses asks each host once, not once per caller', async () => {
      const s = sig('f')
      const net = slowHosts({})
      const bases = ['https://one', 'https://two']
      const burst = Array.from({ length: 6 }, () => askUntried(s, bases, net.ask))
      await net.release()
      expect(await Promise.all(burst)).toEqual([null, null, null, null, null, null])
      expect(net.asked).toEqual(['https://one', 'https://two'])
    })

    it('a burst that finds the bytes shares the one answer', async () => {
      const s = sig('1')
      const net = slowHosts({ 'https://two': 'bytes' })
      const bases = ['https://one', 'https://two']
      const burst = Array.from({ length: 6 }, () => askUntried(s, bases, net.ask))
      await net.release()
      expect(await Promise.all(burst)).toEqual(['bytes', 'bytes', 'bytes', 'bytes', 'bytes', 'bytes'])
      expect(net.asked).toEqual(['https://one', 'https://two'])
    })

    it('a later caller listing more hosts asks only what the first left untried', async () => {
      const s = sig('2')
      const net = slowHosts({ 'https://two': 'bytes' })
      const first = askUntried(s, ['https://one'], net.ask)
      const second = askUntried(s, ['https://one', 'https://two'], net.ask)
      await net.release()
      expect(await first).toBeNull()
      expect(await second).toBe('bytes')
      expect(net.asked).toEqual(['https://one', 'https://two'])
    })

    it('bytes found for the first are the answer for a later caller listing other hosts', async () => {
      const s = sig('3')
      const net = slowHosts({ 'https://two': 'bytes', 'https://three': 'bytes' })
      const first = askUntried(s, ['https://one', 'https://two'], net.ask)
      const second = askUntried(s, ['https://one', 'https://three'], net.ask)
      await net.release()
      expect(await first).toBe('bytes')
      expect(await second).toBe('bytes')
      // The signature arrived: nobody asks three, and one is not asked twice.
      expect(net.asked).toEqual(['https://one', 'https://two'])
    })

    it('an ask that throws frees the signature for the next caller', async () => {
      const s = sig('4')
      const asked: string[] = []
      const failing = askUntried(s, ['https://one'], async () => { throw new Error('boom') })
      const next = askUntried(s, ['https://one'], async base => { asked.push(base); return 'bytes' })
      await expect(failing).rejects.toThrow('boom')
      expect(await next).toBe('bytes')
      expect(asked).toEqual(['https://one'])
    })
  })

  it('clearEggs asks everyone again', async () => {
    const s = sig('e')
    const net = hosts({})
    await askUntried(s, ['https://one'], net.ask)
    await clearEggs()
    await askUntried(s, ['https://one'], net.ask)
    expect(net.asked).toEqual(['https://one', 'https://one'])
  })
})
