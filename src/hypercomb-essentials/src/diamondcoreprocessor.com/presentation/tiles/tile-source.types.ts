// hypercomb-essentials/.../presentation/tiles/tile-source.types.ts
//
// Public types for the TileSourceRegistry decomposition of show-cell.
// A tile source is a contributor that says "at this location, here are
// the tiles I know about." The registry unions everyone's contributions
// into the set the renderer draws.
//
// `kind` carries enough information for the pixi draw layer to pick a
// visual treatment without consulting any specific source — owned tiles
// look one way, ephemeral previews look another, clipboard overlays
// another. New kinds plug in by adding a string + a source.

/**
 * What flavour of tile this entry represents. The renderer maps each
 * kind to a visual treatment; downstream services (layout, filter) may
 * branch on kind to skip OPFS-only work for ephemeral entries.
 *
 * - `opfs`      — A real cell on disk in the current lineage. The
 *                 source carries the directory handle.
 * - `ephemeral` — A preview from the mesh that has NOT been adopted to
 *                 OPFS. Source carries the layer sig (look up content
 *                 in the paired-channel machine's state.layers).
 * - `clipboard` — A clipboard overlay (cross-browser drag preview).
 * - `peer`      — A tile contributed by another peer in the public
 *                 swarm at the current lineage. Source carries the
 *                 publisher's Nostr pubkey for mine/theirs tagging.
 */
export type TileKind = 'opfs' | 'ephemeral' | 'clipboard' | 'peer'

/**
 * One contributed tile. The renderer treats it as opaque — name + kind
 * are everything it needs to draw. `source` lets the layout/property
 * services find the actual content for that tile.
 */
export interface TileEntry {
  /** Display name (the lineage segment for an OPFS tile, the branch
   *  name for an ephemeral, the label for a clipboard entry). */
  readonly name: string
  readonly kind: TileKind
  /** Where the content lives. Different fields are populated per kind:
   *  opfs → `dir`; ephemeral → `channelId`+`layerSig`+`branchSig`. */
  readonly source: TileSourceRef
}

export interface TileSourceRef {
  /** OPFS dir handle for the cell — set on kind='opfs'. */
  readonly dir?: FileSystemDirectoryHandle
  /** Mesh layer sig — set on kind='ephemeral'. Look up content in
   *  PairedChannelMachine.state.layers.get(layerSig). */
  readonly layerSig?: string
  /** The branch (root) sig of the share this preview belongs to. May
   *  equal layerSig for top-level ephemerals; descendants share the
   *  branchSig of the root they were unfurled from. */
  readonly branchSig?: string
  /** Channel the ephemeral came in on — needed for adopt-time
   *  materialiseFromSig calls. */
  readonly channelId?: string
  /** Publisher's Nostr pubkey — set on kind='peer'. Identifies the
   *  swarm participant whose layer contributed this tile, so the
   *  renderer can distinguish my-tiles from theirs at draw time. */
  readonly peerPubkey?: string
  /** Slot index the peer was rendering this tile at — set on kind='peer'
   *  when the publisher included an `index` in their swarm payload.
   *  Show-cell's pinned order resolver honours this so a peer's tile
   *  lands at the same axial position the publisher sees, instead of
   *  being demoted to the next-free slot starting at 0 (which collides
   *  with the local cell at index 0 and produces a disjoint layout). */
  readonly peerIndex?: number
}

/**
 * The location being resolved. Sources may consult both the segment
 * path and the OPFS dir handle (when present) to compute their tiles.
 * For navigation into an ephemeral subtree, `dir` will be null but
 * `segments` will reflect the current path — sources that don't need
 * OPFS (the ephemeral source) still resolve correctly.
 */
export interface LocationContext {
  readonly segments: readonly string[]
  readonly dir: FileSystemDirectoryHandle | null
}

/**
 * A tile source. Returns the tiles it contributes for the given
 * location. Returning [] means "I have nothing for this location"
 * (not an error). Throwing is allowed; the registry catches and treats
 * as []. Sources are queried in parallel — they MUST be independent.
 */
export type TileSource = (loc: LocationContext) => Promise<readonly TileEntry[]>

/** Returned by `register` to remove a source later. */
export type UnregisterTileSource = () => void
