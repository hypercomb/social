import { describe, expect, it } from 'vitest'
import { AWAKE_LOCK, holdAwake } from './stay-awake.js'

const fakeLocks = () => {
  const held: { name: string; mode: string; done: boolean }[] = []
  return {
    held,
    request: (name: string, options: { mode: 'shared' }, hold: () => Promise<void>) => {
      const entry = { name, mode: options.mode, done: false }
      held.push(entry)
      return hold().then(() => { entry.done = true })
    },
  }
}

describe('a turn stays awake', () => {
  it('holds a shared lock until it is let go, and letting go twice is harmless', async () => {
    const locks = fakeLocks()
    const release = holdAwake(undefined, locks)
    expect(locks.held).toEqual([{ name: AWAKE_LOCK, mode: 'shared', done: false }])
    release()
    release()
    await Promise.resolve()
    await Promise.resolve()
    expect(locks.held[0].done).toBe(true)
  })

  it('two turns hold it at once', () => {
    const locks = fakeLocks()
    const first = holdAwake(undefined, locks)
    const second = holdAwake(undefined, locks)
    expect(locks.held.filter(entry => !entry.done)).toHaveLength(2)
    first(); second()
  })

  it('costs nothing where there is no Locks API, or one that throws', () => {
    expect(() => holdAwake(undefined, undefined)()).not.toThrow()
    const broken = { request: () => { throw new Error('denied') } }
    expect(() => holdAwake(undefined, broken as never)()).not.toThrow()
  })
})
