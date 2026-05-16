// hypercomb-essentials/.../presentation/tiles/sources/swarm-tile.source.ts
//
// The swarm peer contributor. Returns one TileEntry per child name in
// every other peer's most recent layer at the current lineage. The
// SwarmDrone holds the per-peer cache (Map<pubkey, layer>) populated
// from the Nostr mesh; this source is a thin adapter from that shape
// into TileEntry.
//
// Mine-vs-theirs: the drone already filters out our own pubkey before
// returning, so every entry here is "theirs". Show-cell additionally
// dedupes against the OPFS-owned set, so a tile a peer publishes that
// also exists locally surfaces as 'opfs' (mine), not 'peer'.

import type {
  LocationContext,
  TileEntry,
  TileSource,
} from '../tile-source.types.js'

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'

interface SwarmDroneLike {
  peerTilesAtCurrentSig: () => readonly { name: string; peerPubkey: string }[]
}

/** The swarm source: emits TileEntries for each tile any peer is
 *  currently publishing at the current lineage. Empty if the drone
 *  isn't registered (mesh off, swarm disabled) or no peers have
 *  published yet. */
export const swarmTileSource: TileSource = async (
  _loc: LocationContext,
): Promise<readonly TileEntry[]> => {
  const drone = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
    SWARM_DRONE_KEY,
  ) as SwarmDroneLike | undefined
  if (!drone?.peerTilesAtCurrentSig) return []
  const tiles = drone.peerTilesAtCurrentSig()
  return tiles.map(({ name, peerPubkey }) => ({
    name,
    kind: 'peer' as const,
    source: { peerPubkey },
  }))
}
