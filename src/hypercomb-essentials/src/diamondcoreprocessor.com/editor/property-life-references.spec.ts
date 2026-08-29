import { describe, expect, it, vi } from 'vitest'

import { canonicalPropertyLifeReferences } from './property-life-references.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

describe('canonicalPropertyLifeReferences', () => {
  it('types every nested artifact reference while retaining inline properties', async () => {
    const ensure = vi.fn(async (sig: string, relation: string) => `${relation}:${sig}`)
    const result = await canonicalPropertyLifeReferences({
      index: 7,
      tags: ['friends'],
      small: { image: A },
      flat: { small: { image: B } },
      attachment: C,
    }, ensure)

    expect(result).toEqual({
      index: 7,
      tags: ['friends'],
      small: { image: `image:${A}` },
      flat: { small: { image: `image:${B}` } },
      attachment: `attachment:${C}`,
    })
  })

  it('does not turn lineage and group referents into resource edges', async () => {
    const ensure = vi.fn(async (sig: string, relation: string) => `${relation}:${sig}`)
    const result = await canonicalPropertyLifeReferences({
      targetSig: A,
      groupSig: B,
      content: C,
    }, ensure)

    expect(result).toEqual({ targetSig: A, groupSig: B, content: `content:${C}` })
    expect(ensure).toHaveBeenCalledTimes(1)
  })
})
