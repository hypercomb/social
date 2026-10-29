// Putting a picture on a tile keeps the one it wore, so the images button
// can offer it again.
import { describe, expect, it, vi } from 'vitest'

const kept = vi.hoisted(() => ({
  pictures: [] as { address: readonly string[]; bytes: readonly string[] }[],
  written: false,
}))

vi.mock('./tile-properties.js', () => ({
  isSignature: (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value),
  writeTilePropertiesAt: vi.fn(async () => { kept.written = true }),
}))

vi.mock('../sharing/tile-image-intake.js', () => ({
  wornPictureSig: vi.fn(async () => kept.written ? 'b'.repeat(64) : 'a'.repeat(64)),
}))

vi.mock('../commands/lightbox-kind.js', () => ({
  holdPictures: vi.fn(async (address: readonly string[], bytes: readonly string[]) => {
    kept.pictures.push({ address, bytes })
    return bytes
  }),
}))

vi.mock('../commands/decoration-kind-index.js', () => ({
  referenceEditsRootDefaultForLabel: () => false,
  referenceTargetForLabel: () => null,
}))

vi.hoisted(() => {
  ;(window as unknown as { ioc: { get: (key: string) => unknown; register: () => void } }).ioc = {
    get: (key: string) => {
      if (key === '@hypercomb.social/Store') return { putResource: async () => '', getResource: async () => null }
      if (key === '@hypercomb.social/Lineage') return { explorerSegments: () => ['page'] }
      return undefined
    },
    register: () => {},
  }
})

import { EffectBus } from '@hypercomb/core'
import './resource-attach.drone.js'

describe('a picture landing on a tile that already wears one', () => {
  it('keeps the previous picture beside the new one', async () => {
    kept.pictures = []
    kept.written = false
    EffectBus.emit('cell:attach-resource', {
      cell: 'garden',
      largeSig: 'b'.repeat(64),
      smallPointSig: null,
      smallFlatSig: null,
      url: null,
      type: 'image',
    })
    await vi.waitFor(() => expect(kept.pictures).toHaveLength(1))
    expect(kept.pictures[0]).toEqual({
      address: ['page', 'garden'],
      bytes: ['a'.repeat(64), 'b'.repeat(64)],
    })
  })
})
