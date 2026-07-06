// diamondcoreprocessor.com/sequence/sequence-target.ts
//
// The `sequence:target` decoration binds a saved drop-target sequence to a
// branch. It rides the existing `decorations` slot (see commands/decoration-
// manifest.ts) exactly like `files:dropbox` — a capability placed on a
// CONTAINER and resolved by walking the lineage UPWARD (SequenceService), so
// every descendant inherits it (cascading, top-down). It affects the branch
// "from its position to the leaf only" — the same scope model as a website
// page, achieved purely by nearest-ancestor resolution (no nav trapping;
// this is placement, not a view).
//
// payload.sequenceSig points at the saved set resource (a content sig file
// at the flat OPFS root; legacy `__resources__/` is a read-fallback)
// of shape `{ kind: 'sequence', name, indexes: number[] }` (the "file that
// has a bunch of indexes"). Storing the indexes as a content-addressed
// resource — not inline — keeps the set shareable, dedup'd, and resolvable
// by peers through the same pipeline that already moves HTML and images.

import {
  writeDecoration,
  removeDecoration,
  listDecorations,
} from '../commands/decoration-manifest.js'

export const SEQUENCE_TARGET_KIND = 'sequence:target'

/** Which saved sequence this branch is bound to. */
export interface SequenceTargetPayload {
  /** Human-friendly set name (palette key); discovery metadata only. */
  readonly name: string
  /** Resource sig of the `{ kind:'sequence', name, indexes }` set. */
  readonly sequenceSig: string
}

/** Bind `segments` (a container) to a saved sequence. Cascades to all
 *  descendants. Persistent so it survives a layer rewrite. */
export function writeSequenceTarget(
  segments: readonly string[],
  name: string,
  sequenceSig: string,
): Promise<string> {
  return writeDecoration<SequenceTargetPayload>({
    kind: SEQUENCE_TARGET_KIND,
    appliesTo: segments,
    payload: { name, sequenceSig },
    segments,
    mark: 'persistent',
  })
}

/** Sequence binding(s) declared AT this exact location (not cascading). */
export function listSequenceTargetHere(
  segments: readonly string[],
): Promise<Array<{ sig: string; record: { payload: SequenceTargetPayload } }>> {
  return listDecorations<SequenceTargetPayload>({ kind: SEQUENCE_TARGET_KIND, segments }) as Promise<
    Array<{ sig: string; record: { payload: SequenceTargetPayload } }>
  >
}

/** Remove the sequence binding declared at this location. */
export function removeSequenceTarget(sig: string, segments: readonly string[]): void {
  removeDecoration({ sig, segments })
}
