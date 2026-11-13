import { describe, expect, it } from 'vitest'
import { executionLineParts } from './execution-line.js'

describe('executionLineParts', () => {
  it('keeps ordinary grammar untouched', () => {
    expect(executionLineParts('/find solomon-maze-v1')).toEqual([
      { text: '/find solomon-maze-v1' },
    ])
  })

  it('compacts a signature while retaining all 64 characters for hover', () => {
    const signature = 'bbea555b4fc6a970b6c4a328a6fd99259c4f91f8d02ed33d477fab8810475abd'

    expect(executionLineParts(`/read ${signature}`)).toEqual([
      { text: '/read ' },
      { text: 'bbea555b4fc6…', signature },
    ])
  })

  it('compacts every signature in the line without consuming adjacent text', () => {
    const first = 'a'.repeat(64)
    const second = 'B'.repeat(64)

    expect(executionLineParts(`/read ${first} then ${second} 2048`)).toEqual([
      { text: '/read ' },
      { text: `${'a'.repeat(12)}…`, signature: first },
      { text: ' then ' },
      { text: `${'B'.repeat(12)}…`, signature: second },
      { text: ' 2048' },
    ])
  })

  it('does not shorten a 64-character run within a longer hex value', () => {
    const longerHex = 'c'.repeat(65)
    expect(executionLineParts(`/read ${longerHex}`)).toEqual([
      { text: `/read ${longerHex}` },
    ])
  })
})
