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

  it('clearEggs asks everyone again', async () => {
    const s = sig('e')
    const net = hosts({})
    await askUntried(s, ['https://one'], net.ask)
    await clearEggs()
    await askUntried(s, ['https://one'], net.ask)
    expect(net.asked).toEqual(['https://one', 'https://one'])
  })
})
