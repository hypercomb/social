// diamondcoreprocessor.com/presentation/tiles/tile-stack.ts
//
// The participant STACK read model — "how many versions of this tile
// exist here, whose, and in what order".
//
// Superimposition (documentation/superimposition.md) says two trees at
// the same coordinates ARE the same tree: a peer publishing `notes` at
// your `notes` slot is not a second tile, it is a second IMPLEMENTATION
// of one tile. The renderer honoured half of that — it dropped the
// peer's copy (show-cell's mismatch filter) so the duplicate never
// appeared — but dropping is not collapsing: the peer's version became
// unreachable instead of stacked underneath yours.
//
// This module holds the other half. Per render pass show-cell publishes
// the variants it resolved; the stack is ORDERED BY PARTICIPANT — index
// 0 is you whenever you hold the label, then each publisher in the
// swarm's freshness order (the same order the layer-cycle strip and the
// spotlight cycle use, so rolling never disagrees with the strip).
//
// Rolling a stack is a LAYER move, not a tile move: it sets the global
// SpotlightService to that participant, so every tile they publish
// changes together and you read their whole layer at once. The wheel is
// merely anchored on the tile under the pointer — it picks WHICH
// participants are worth rolling through (the ones present in that
// tile's stack), never a per-tile override.
//
// State is per-pass and in-memory only. A stack is a derivation of live
// peer presence; persisting it would outlive the peers that justified
// it — the same posture SpotlightService and SwarmFilterService take.

import { EffectBus } from '@hypercomb/core'

const SPOTLIGHT_KEY = '@diamondcoreprocessor.com/SpotlightService'

/** One participant's version of a tile. `pubkey: ''` is YOU — the local
 *  layer's own version, which always sits at stack index 0 when present. */
export interface StackVariant {
  readonly pubkey: string
  readonly imageSig?: string
  /** The publisher's own slot index for this tile, when they published
   *  one. Rolling onto a participant adopts their indices, so you see
   *  their ARRANGEMENT and not yours with their pictures in it. */
  readonly index?: number
}

/** Empty stack — shared so `stackFor` never allocates on a miss. */
const NO_VARIANTS: readonly StackVariant[] = []

let stacks: ReadonlyMap<string, readonly StackVariant[]> = new Map()
let hovered: string | null = null

/** Publish the stacks resolved by this render pass. Replaces the whole
 *  map — a label that stopped stacking (peer left) must stop reading as
 *  stacked immediately, and a per-key merge would strand it. */
export const setTileStacks = (
  next: ReadonlyMap<string, readonly StackVariant[]>,
): void => { stacks = next }

/** Every variant of `label`, in participant order. */
export const stackFor = (label: string): readonly StackVariant[] =>
  stacks.get(label) ?? NO_VARIANTS

/** How many participants hold this tile. 0/1 = nothing to roll. */
export const stackDepth = (label: string): number => stackFor(label).length

/** Labels held by more than one participant — the tiles that carry the
 *  multiplicity mark on the canvas. */
export const stackedLabels = (): readonly string[] =>
  [...stacks.entries()].filter(([, v]) => v.length > 1).map(([label]) => label)

/** The variant `pubkey` published for `label`, if any. */
export const variantFor = (
  label: string,
  pubkey: string,
): StackVariant | undefined => stackFor(label).find(v => v.pubkey === pubkey)

/** The tile under the pointer, or null over chrome / empty canvas. */
export const hoveredLabel = (): string | null => hovered

/** Depth of the hovered tile's stack — the wheel's gate. */
export const hoveredStackDepth = (): number =>
  hovered === null ? 0 : stackDepth(hovered)

interface SpotlightLike {
  readonly activePeer: string | null
  set(pubkey: string | null): void
  dismiss(): void
}

/** Roll the hovered tile's stack by `delta` (+1 forward, -1 back).
 *
 *  The roll walks THAT TILE's participants — a wheel over a tile only
 *  two people hold must not march through six unrelated publishers to
 *  get back to yours — but what it moves is the global spotlight, so
 *  the whole of the chosen participant's layer surfaces at once.
 *
 *  Returns true when the roll was consumed, so the caller knows whether
 *  to fall through to zoom. */
export const rollHoveredStack = (delta: number): boolean => {
  const label = hovered
  if (label === null) return false
  const variants = stackFor(label)
  if (variants.length < 2) return false

  const spotlight = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(
    SPOTLIGHT_KEY,
  ) as SpotlightLike | undefined
  if (!spotlight) return false

  // Current position within THIS tile's stack. A spotlight aimed at a
  // participant who doesn't hold this tile reads as position 0 — the
  // roll then starts from the top of the stack rather than refusing,
  // which is what "wheel over this tile" should always do.
  const active = spotlight.activePeer ?? ''
  const at = Math.max(0, variants.findIndex(v => v.pubkey === active))
  const next = variants[((at + delta) % variants.length + variants.length) % variants.length]
  if (!next) return false

  if (next.pubkey === '') spotlight.dismiss()
  else spotlight.set(next.pubkey)
  return true
}

// Hover tracking. show-cell already resolves the occupied tile under
// the pointer and broadcasts it (with label absent when the pointer is
// over chrome), so the stack model subscribes rather than re-deriving
// pixel → axial → label a second time.
EffectBus.on<{ label?: string | null }>('tile:hover', (payload) => {
  hovered = typeof payload?.label === 'string' && payload.label.length > 0
    ? payload.label
    : null
})
