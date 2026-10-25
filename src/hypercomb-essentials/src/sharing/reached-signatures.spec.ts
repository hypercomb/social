import { describe, expect, it } from 'vitest'
import { reachedSignatures } from './reached-signatures.js'

const s = (c: string): string => c.repeat(64)

describe('reachedSignatures — what a head reaches, by the host\'s reach rule', () => {
  it('collects every whole signature the layers name, deduplicated, the head first', () => {
    const layers = [
      { name: 'top', children: [s('a'), s('b')], properties: [s('c')], decorations: [s('a')] },
      { name: 'child', notes: { body: s('d') }, title: 'not a sig', count: 3 },
    ]
    expect(reachedSignatures(layers, [s('f')])).toEqual([s('f'), s('a'), s('b'), s('c'), s('d')])
  })

  it('never follows a referent field — those point at the past', () => {
    const layers = [{ prev: s('1'), seal: s('2'), groupSig: s('3'), targetSig: s('4'), pubkey: s('5'), children: [s('6')] }]
    expect(reachedSignatures(layers)).toEqual([s('6')])
  })

  it('folds case and ignores strings that are not a whole signature', () => {
    expect(reachedSignatures([{ a: s('A'), b: s('a').slice(1), c: `${s('b')}.js` }])).toEqual([s('a')])
  })
})
