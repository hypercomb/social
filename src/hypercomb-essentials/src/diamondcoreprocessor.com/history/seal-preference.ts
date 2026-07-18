// diamondcoreprocessor.com/history/seal-preference.ts
//
// Pure decision logic for sealSubtree when a parent head's stored child
// hint DISAGREES with the child location's freshly-derived seal.
//
// Two structurally identical-looking states with opposite correct answers
// (found 2026-07-18, the "seal resurrects yesterday's tree" bug):
//
//   NORMAL STALENESS — leaf-only commit freezes a parent's child hints at
//   the parent's last commit; the child location then advances. The hint
//   was once the child bag's head, so it appears among the bag's markers.
//   The location-derived seal is the fresh truth → keep it. (This is the
//   whole point of sealSubtree: freshen grandchildren.)
//
//   OFF-LINEAGE HINT — a deliberate parent-level commit named a child
//   generation the child's own bag never headed at (clipboard/move
//   re-mints via materializeLayer, build pipelines, repair commits: pool
//   writes with NO marker at the child location). The child bag knows
//   nothing about it; recursing into the bag re-derives the OLD subtree
//   byte-for-byte and the publish walk broadcasts a generation the
//   publisher already superseded — consumers' receipts match forever and
//   updates become invisible. The hint is the parent's committed truth →
//   honor it wholesale (re-mint cascades seal bottom-up, so the hint IS a
//   coherent pool subtree handle).
//
// The discriminator is BAG MEMBERSHIP of the hint. In the normal case the
// hint was a marker by construction; in the divergence case it never was.
//
// Known limits, accepted deliberately:
//   - A flattened bag drops old markers, so a very stale hint under a
//     never-recommitted parent can misread as off-lineage. The parent's
//     head named it; preferring it is wrong only if the child ALSO
//     advanced — which a post-flatten bag records, putting the case back
//     on the freshened path.
//   - A true fork (off-lineage hint AND later independent child commits)
//     is undecidable without ordering stamps; the parent's deliberate
//     naming wins. Callers log divergences so forks are never silent.

export type SealChildReason = 'coherent' | 'freshened' | 'hint-off-lineage'

export interface SealChildDecision {
  /** The child handle the seal should carry. */
  readonly handle: string
  readonly reason: SealChildReason
}

export function chooseSealChildHandle(input: {
  /** The child sig stored in the parent head's `children` slot. */
  readonly hintSig: string
  /** The child location's freshly-derived seal (never null here — cold
   *  children abort the seal before any decision is reached). */
  readonly sealSig: string
  /** Every marker layerSig in the child location's bag, any order. */
  readonly bagSigs: readonly string[]
}): SealChildDecision {
  const { hintSig, sealSig, bagSigs } = input
  if (sealSig === hintSig) return { handle: sealSig, reason: 'coherent' }
  if (bagSigs.includes(hintSig)) return { handle: sealSig, reason: 'freshened' }
  return { handle: hintSig, reason: 'hint-off-lineage' }
}
