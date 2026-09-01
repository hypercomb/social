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
  peerTilesAtCurrentSig: () => readonly {
    name: string
    peerPubkey: string
    index?: number
    imageSig?: string
    layerSig?: string
    titles?: Readonly<Record<string, string>>
    [property: string]: unknown
  }[]
}

const asTitles = (value: unknown): Readonly<Record<string, string>> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const titles = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  return Object.keys(titles).length > 0 ? titles : undefined
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
  return tiles.map((tile) => {
    const { name, peerPubkey, layerSig, titles: rawTitles, ...properties } = tile
    const index = properties['index']
    const imageSig = properties['imageSig']
    const titles = asTitles(rawTitles)
    return {
      name,
      kind: 'peer' as const,
      source: {
        peerPubkey,
        properties,
        ...(typeof index === 'number' ? { peerIndex: index } : {}),
        ...(typeof imageSig === 'string' ? { imageSig } : {}),
        ...(typeof layerSig === 'string' ? { layerSig } : {}),
        ...(titles ? { titles } : {}),
      },
    }
  })
}
