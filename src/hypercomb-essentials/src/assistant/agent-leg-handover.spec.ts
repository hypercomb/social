import { describe, expect, it } from 'vitest'
import { shippedHandoverStep } from '@hypercomb/core'

// THE OPEN REQUEST GOES OVER IN WHOLE LINES. A block carries up to eight
// reads; the handover used to cut the joined lines at 200 characters, which
// held two by-signature reads and ended the third mid-signature.

const sig = (n: number): string => n.toString(16).padStart(64, '0')
const left = (requestLines: readonly string[], prose = ''): string | undefined =>
  shippedHandoverStep.left({ requestLines, prose, lastRound: true, proseFallback: true })

describe('the handover of a request still open', () => {
  it('carries a full block of eight by-signature reads, every signature whole', () => {
    const lines = Array.from({ length: 8 }, (_, at) => `/read ${sig(at + 1)}`)
    const carried = left(lines)
    expect(carried).toBe(`carry on from: ${lines.join(' · ')}`)
    expect(carried?.match(/[0-9a-f]{64}/g)).toHaveLength(8)
  })

  it('carries eight reads that name a file and a position inside a signature', () => {
    const lines = Array.from({ length: 8 }, (_, at) => `/read ${sig(at + 1)} src/assistant/hive-tree-reader.ts ${at * 4_000}`)
    expect(left(lines)).toBe(`carry on from: ${lines.join(' · ')}`)
  })

  it('carries no more than a block, and never a cut line', () => {
    const lines = Array.from({ length: 12 }, (_, at) => `/read /business/people/person-${at}`)
    expect(left(lines)).toBe(`carry on from: ${lines.slice(0, 8).join(' · ')}`)
    // A long line is left out whole, with everything after it, never sliced.
    const long = `write src/long.ts ${'x'.repeat(2_000)}`
    const carried = left(['/read /a', '/read /b', long, '/read /c'])
    expect(carried).toBe('carry on from: /read /a · /read /b')
  })

  it('still hands the request over when no line of it can go whole', () => {
    const long = 'x'.repeat(2_000)
    expect(left([long])).toBe('carry on with the request that was still open')
    // The model's own word about what is left is better than that.
    expect(left([long], 'Done so far.\n\nNext step: write the rest of the file.')).toBe('write the rest of the file.')
    expect(left([])).toBeUndefined()
  })
})
