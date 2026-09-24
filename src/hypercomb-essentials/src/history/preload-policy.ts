export type PreloadDepthStamp = {
  depth: number
  epoch: number
  /** How deep the pass warmed tile FACES' code (-1: none). */
  faceDepth?: number
}

export type PreloadFrontierEntry = {
  depth: number
  score: number
}

/** A completed shallow warm never satisfies a later deeper request — tiles or
 *  their faces' code. */
export const preloadStampSatisfies = (
  stamp: PreloadDepthStamp | undefined,
  requestedDepth: number,
  epoch: number,
  requestedFaceDepth = -1,
): boolean => !!stamp && stamp.epoch === epoch && stamp.depth >= requestedDepth
  && (stamp.faceDepth ?? -1) >= requestedFaceDepth

/** Keep the deepest completion only while it belongs to the same tree epoch. */
export const mergePreloadStamp = (
  prior: PreloadDepthStamp | undefined,
  completedDepth: number,
  epoch: number,
  completedFaceDepth = -1,
): PreloadDepthStamp => {
  const faceDepth = prior?.epoch === epoch ? Math.max(prior.faceDepth ?? -1, completedFaceDepth) : completedFaceDepth
  return {
    depth: prior?.epoch === epoch
      ? Math.max(prior.depth, completedDepth)
      : completedDepth,
    epoch,
    // A pass that warmed no faces leaves the stamp exactly as it always was.
    ...(faceDepth >= 0 ? { faceDepth } : {}),
  }
}

// ── CODE IS MORE HOPS OF THE SAME WALK ──────────────────────────────────────
//
// jwize, 2026-09-23: "our preloader should be the same as we already have for
// tiles for every hierarchy and when the children are dependent it needs to
// expand when that gets in range of the depth." A tile the walk reaches may
// wear a FACE — a view whose code sits behind a lazy seam (a game, the tutor).
// That face is one more child of the tile: warming it loads the view's code,
// opening nothing, so the first open is already warm. Within reach only: the
// code radius counts tiles from where the participant stands (the tile you
// stand on is 0, what you see is 1), and going up to an ancestor spends it.

/** Faces within this many tiles of the participant warm their code. 0 = off. */
export const PRELOAD_CODE_DEPTH = 1

/** The code radius a browser asked for (`hc:preload:code-depth`), else the default. */
export const readCodeDepth = (raw: string | null | undefined): number => {
  const n = raw == null || raw === '' ? NaN : Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= 2 ? n : PRELOAD_CODE_DEPTH
}

/** The deepest walk depth whose faces warm, in a pass rooted `levelsUp`
 *  above the participant; -1 = none. */
export const faceDepthFor = (codeDepth: number, levelsUp = 0): number =>
  codeDepth > 0 && codeDepth - levelsUp >= 0 ? codeDepth - levelsUp : -1

/** A view that can warm its own code for a face (commands/visual-bee-registry.ts). */
export type FaceOwner = {
  readonly view: string
  readonly slot?: string
  readonly decorationKind: string
  readonly alsoKinds?: readonly string[]
  readonly legacyKinds?: readonly string[]
  readonly prefetch?: (face: { payload?: unknown; segments: readonly string[] }) => Promise<boolean | void>
}

/** The faces a tile wears that a view can warm: a non-empty first-class slot,
 *  or a decoration record of a kind the view owns. One per view and payload. */
export const facesOf = (
  layer: Readonly<Record<string, unknown>>,
  records: readonly { kind?: unknown; payload?: unknown }[],
  owners: readonly FaceOwner[],
): { owner: FaceOwner; payload?: unknown; key: string }[] => {
  const out = new Map<string, { owner: FaceOwner; payload?: unknown; key: string }>()
  for (const owner of owners) {
    if (!owner.prefetch) continue
    const slot = owner.slot ? layer[owner.slot] : undefined
    if (Array.isArray(slot) && slot.length) out.set(owner.view, { owner, key: owner.view })
    const kinds = [owner.decorationKind, ...(owner.alsoKinds ?? []), ...(owner.legacyKinds ?? [])]
    for (const record of records) {
      if (!kinds.includes(String(record?.kind))) continue
      const key = `${owner.view}\u0000${JSON.stringify(record.payload ?? null)}`
      if (!out.has(key)) out.set(key, { owner, payload: record.payload, key })
    }
  }
  return [...out.values()]
}

/**
 * Walking upward spends one unit of radius per ancestor. The remaining radius
 * is then available for sideways/downward expansion from that ancestor.
 */
export const remainingAncestorPreloadDepth = (radius: number, levelsUp: number): number =>
  Math.max(1, radius - levelsUp + 1)

/**
 * Take work from exactly one depth. Usage orders peers at that depth but can
 * never promote a deeper node ahead of an unfinished sibling frontier.
 */
export const takePreloadBreadthSlice = <T extends PreloadFrontierEntry>(
  frontier: T[],
  concurrency: number,
): T[] => {
  frontier.sort((a, b) => (a.depth - b.depth) || (b.score - a.score))
  if (frontier.length === 0) return []
  const depth = frontier[0].depth
  let sameDepth = 0
  while (sameDepth < frontier.length && frontier[sameDepth].depth === depth) sameDepth++
  return frontier.splice(0, Math.min(Math.max(1, concurrency), sameDepth))
}

/** Only a drained, non-superseded pass may advertise completion. */
export const preloadPassCompleted = (input: {
  frontierRemaining: number
  incomplete: boolean
  generationAtStart: number
  generationNow: number
  epochAtStart: number
  epochNow: number
}): boolean => input.frontierRemaining === 0
  && !input.incomplete
  && input.generationAtStart === input.generationNow
  && input.epochAtStart === input.epochNow
