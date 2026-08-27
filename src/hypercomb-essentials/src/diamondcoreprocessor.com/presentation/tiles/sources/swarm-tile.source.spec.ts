import { beforeEach, describe, expect, it } from 'vitest'

import { swarmTileSource } from './swarm-tile.source.js'

const ALICE = 'a'.repeat(64)
const ALICE_IMAGE = 'b'.repeat(64)

describe('swarm tile source image provenance', () => {
  beforeEach(() => {
    ;(window as unknown as { ioc: unknown }).ioc = {
      get: () => ({
        peerTilesAtCurrentSig: () => [{
          name: 'people',
          peerPubkey: ALICE,
          index: 4,
          imageSig: ALICE_IMAGE,
        }],
      }),
    }
  })

  it('carries the peer image into the participant stack projection', async () => {
    await expect(swarmTileSource({ segments: ['project'], dir: null })).resolves.toEqual([{
      name: 'people',
      kind: 'peer',
      source: {
        peerPubkey: ALICE,
        peerIndex: 4,
        imageSig: ALICE_IMAGE,
      },
    }])
  })
})
