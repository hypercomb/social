// A peer-only tile can become a shared-name stack the instant the participant
// pastes their own tile. The peer's image pointer must survive that transition:
// show-cell builds the stack from TileSource entries, not directly from the
// swarm cache, so dropping any of that projection here makes the pasted/local
// properties paint on both variants even though the peer bytes still exist.

import { beforeEach, describe, expect, it } from 'vitest'
import { swarmTileSource } from './swarm-tile.source.js'

const ALICE = 'a'.repeat(64)
const ALICE_IMAGE = 'b'.repeat(64)
const ALICE_LAYER = 'c'.repeat(64)

describe('swarm tile source image provenance', () => {
  beforeEach(() => {
    ;(window as unknown as { ioc: unknown }).ioc = {
      get: () => ({
        peerTilesAtCurrentSig: () => [{
          name: 'people',
          peerPubkey: ALICE,
          index: 4,
          imageSig: ALICE_IMAGE,
          layerSig: ALICE_LAYER,
          border: { color: '#336699' },
          link: 'https://example.test/alice',
          hideText: true,
          titles: { en: 'Alice People', fr: 'Les gens d’Alice' },
        }],
      }),
    }
  })

  it('carries the complete peer variant while the fixed name remains its identity', async () => {
    await expect(swarmTileSource({ segments: ['project'], dir: null })).resolves.toEqual([{
      name: 'people',
      kind: 'peer',
      source: {
        peerPubkey: ALICE,
        peerIndex: 4,
        imageSig: ALICE_IMAGE,
        layerSig: ALICE_LAYER,
        properties: {
          index: 4,
          imageSig: ALICE_IMAGE,
          border: { color: '#336699' },
          link: 'https://example.test/alice',
          hideText: true,
        },
        titles: { en: 'Alice People', fr: 'Les gens d’Alice' },
      },
    }])
  })
})
