// hypercomb-essentials/.../presentation/tiles/sources/ephemeral-tile.source.ts
//
// The ephemeral preview contributor. Returns one TileEntry per share
// that the paired-channel drone has accepted but not yet been adopted
// to OPFS. These tiles live in memory only — close the tab and they
// evaporate; the swarm holds the bytes, this peer's read cursor
// surfaces them as previews.
//
// The drone exposes ephemeralSharesAt(location) which already does
// the heavy lifting (channel-aware, location-aware, deduped). This
// source is a thin adapter from that shape into TileEntry.

import type {
  LocationContext,
  TileEntry,
  TileSource,
} from '../tile-source.types.js'

const PAIRED_CHANNEL_DRONE_KEY = '@diamondcoreprocessor.com/PairedChannelDrone'

interface EphemeralShareRow {
  readonly channelId: string
  readonly branchName: string
  readonly branchSig: string
  readonly approvalId: string | null
}

interface PairedChannelDroneLike {
  ephemeralSharesAt: (location: string) => readonly EphemeralShareRow[]
}

/** Compose the location string the drone expects. Mirrors how the
 *  drone normalises locations internally: leading slash, segments
 *  joined with `/`, no trailing slash. */
function locationStringFromSegments(segments: readonly string[]): string {
  const cleaned = segments
    .map(s => String(s ?? '').trim())
    .filter(s => s.length > 0 && !(s.startsWith('__') && s.endsWith('__')))
  return '/' + cleaned.join('/')
}

/** The ephemeral source: emits TileEntries for each share the drone
 *  is currently showing as a preview at this location. Empty if the
 *  drone isn't registered (e.g. mesh off, sync disabled). */
export const ephemeralTileSource: TileSource = async (
  loc: LocationContext,
): Promise<readonly TileEntry[]> => {
  const drone = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
    PAIRED_CHANNEL_DRONE_KEY,
  ) as PairedChannelDroneLike | undefined
  if (!drone?.ephemeralSharesAt) return []
  const location = locationStringFromSegments(loc.segments)
  const rows = drone.ephemeralSharesAt(location) ?? []
  return rows.map(r => ({
    name: r.branchName,
    kind: 'ephemeral' as const,
    source: {
      channelId: r.channelId,
      layerSig: r.branchSig,
      branchSig: r.branchSig,
    },
  }))
}
