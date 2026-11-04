// egg-stage.ts — the life of an egg on the page, as one number per tile.
//
// An egg is a tile the adopt queue holds but whose content is not here yet.
// It is never a race: it WHITE-shells while the content is out of reach,
// FROSTS to the thumbnail when a picture is known, and HATCHES (a bee breaks
// out and reveals the tile) once the full-quality image is in.
//
// The queue is the single source of truth (adopt-queue.service.ts): this
// file only reads its entries, it keeps nothing of its own that must
// survive. The shader's aEgg attribute is the number this returns:
//   0 none · 1 white egg · 2 thumbnail egg · 3 + p hatching (p in 0..1)

export const EGG_NONE = 0
export const EGG_WHITE = 1
export const EGG_THUMB = 2
export const EGG_HATCH = 3

/** The hatch takes its time: a calm reveal, never a snap. */
export const HATCH_MS = 2600

/** An incubating egg that never gets its full image still hatches — the tile
 *  is real, the picture simply never came — so nothing waits forever. */
export const INCUBATE_MAX_MS = 45_000

export type EggPhase =
  | { kind: 'egg' }
  | { kind: 'incubating'; since: number }
  | { kind: 'hatching'; since: number }

export interface EggEntryLike { label: string; at: readonly string[]; egg?: boolean }

/** The labels of the eggs laid AT this location, read straight off the queue. */
export const eggLabelsAt = (entries: readonly EggEntryLike[], at: readonly string[]): Set<string> => {
  const here = at.join('/')
  const out = new Set<string>()
  for (const e of entries) if (e.egg && e.at.join('/') === here) out.add(e.label)
  return out
}

/** 0..1 across the hatch, clamped. */
export const hatchProgress = (since: number, now: number): number =>
  Math.min(1, Math.max(0, (now - since) / HATCH_MS))

/** The value the shader reads for a tile in `phase`. */
export const eggAttribute = (phase: EggPhase | undefined, now: number, hasThumbnail: boolean): number => {
  if (!phase) return EGG_NONE
  if (phase.kind === 'hatching') return EGG_HATCH + hatchProgress(phase.since, now)
  return hasThumbnail ? EGG_THUMB : EGG_WHITE
}

/** Has an incubating egg earned its hatch? The full image is in (or the tile
 *  never had one), or it has waited as long as it ever will. */
export const readyToHatch = (o: { hasImageSig: boolean; imageSharp: boolean; since: number; now: number }): boolean =>
  !o.hasImageSig || o.imageSharp || o.now - o.since >= INCUBATE_MAX_MS
