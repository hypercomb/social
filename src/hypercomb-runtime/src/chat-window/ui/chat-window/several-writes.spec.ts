// several-writes.spec.ts — one reply's write blocks, made in order, each its own write.

import { describe, expect, it, vi } from 'vitest'
import { runSeveralWrites } from './several-writes'

class Refused extends Error {}
const deps = (run: (lines: readonly string[]) => Promise<string>, stopped = false) => ({
  run: vi.fn(run),
  refused: (error: unknown) => error instanceof Refused,
  stopped: () => stopped,
})

describe('several writes in one reply', () => {
  it('makes one block exactly as a single write always was, with no numbering', async () => {
    const d = deps(async lines => `made ${lines[0]}`)
    expect(await runSeveralWrites([['page /shop', 'x']], d)).toBe('made page /shop')
  })

  it('makes each in the order written and says which is which', async () => {
    const order: string[] = []
    const d = deps(async lines => { order.push(lines[0]!); return `made ${lines[0]}` })
    const said = await runSeveralWrites([['page /shop'], ['file /shop a.js'], ['file /shop a.css']], d)
    expect(order).toEqual(['page /shop', 'file /shop a.js', 'file /shop a.css'])
    expect(said).toBe('Write 1 of 3:\nmade page /shop\n\nWrite 2 of 3:\nmade file /shop a.js\n\nWrite 3 of 3:\nmade file /shop a.css')
  })

  it('keeps what was made when a later block is refused, names it, and does not try the rest', async () => {
    const d = deps(async lines => {
      if (lines[0] === 'file /shop a.js') throw new Refused('the tile does not exist')
      return `made ${lines[0]}`
    })
    const said = await runSeveralWrites([['page /shop'], ['file /shop a.js'], ['file /shop a.css'], ['file /shop b.css']], d)
    expect(d.run).toHaveBeenCalledTimes(2)
    expect(said).toContain('Write 1 of 4:\nmade page /shop')
    expect(said).toContain('Write 2 of 4 was NOT made: the tile does not exist. The 2 after it were not tried.')
  })

  it('throws a refusal of the first block, as a single write does', async () => {
    const d = deps(async () => { throw new Refused('read the page first') })
    await expect(runSeveralWrites([['page /shop'], ['file /shop a.js']], d)).rejects.toThrow('read the page first')
    expect(d.run).toHaveBeenCalledTimes(1)
  })

  it('throws a stop or a fault whatever was made before it', async () => {
    let n = 0
    const fault = deps(async () => { if (++n === 2) throw new Error('the store failed'); return 'made' })
    await expect(runSeveralWrites([['a'], ['b']], fault)).rejects.toThrow('the store failed')
    n = 0
    const stop = deps(async () => { if (++n === 2) throw new Refused('skipped'); return 'made' }, true)
    await expect(runSeveralWrites([['a'], ['b']], stop)).rejects.toThrow('skipped')
  })
})
