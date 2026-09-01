// sequence/frame-target.ts
//
// The `layout:frame` decoration binds a PATTERN to a branch. It rides the
// `decorations` slot exactly like `sequence:target` — a capability placed on a
// CONTAINER and resolved by walking the lineage UPWARD (FrameService), so
// every descendant inherits it. Mark it on a parent and the whole branch below
// reads through the same frame; a descendant that wants its own shape marks
// its own, and nearest-ancestor resolution hands it the win. Same cascade the
// default view uses, for the same reason: this is a fact about the PLACE.
//
// `payload.patternSig` points at the saved pattern resource — a content sig
// file at the flat OPFS root, shape `{ kind:'pattern', name, coords, step }`.
// Never inline: the whole point of decoupling patterns from frames is that one
// pattern is SHARED by every frame bound to it. N frames on a pattern are N
// references, never N copies — edit the pattern and every frame follows.
//
// What the frame does NOT carry: the scroll offset. Where you have scrolled to
// is a viewing position, like zoom — participant-local, uncommitted, and not
// something a peer inherits when they walk into your tile. It lives in
// FrameService for the life of the session.

import {
  writeDecoration,
  removeDecoration,
  listDecorations,
} from '../commands/decoration-manifest.js'

export const FRAME_TARGET_KIND = 'layout:frame'

/** Which saved pattern this branch is framed by. */
export interface FrameTargetPayload {
  /** Human-friendly pattern name (palette key); discovery metadata only. */
  readonly name: string
  /** Resource sig of the `{ kind:'pattern', name, coords, step }` record. */
  readonly patternSig: string
}

/** Frame `segments` (a container) with a saved pattern. Cascades to every
 *  descendant. Persistent so it survives a layer rewrite. */
export function writeFrameTarget(
  segments: readonly string[],
  name: string,
  patternSig: string,
): Promise<string> {
  return writeDecoration<FrameTargetPayload>({
    kind: FRAME_TARGET_KIND,
    appliesTo: segments,
    payload: { name, patternSig },
    segments,
    mark: 'persistent',
  })
}

/** Frame binding(s) declared AT this exact location (not cascading). */
export function listFrameTargetHere(
  segments: readonly string[],
): Promise<Array<{ sig: string; record: { payload: FrameTargetPayload } }>> {
  return listDecorations<FrameTargetPayload>({ kind: FRAME_TARGET_KIND, segments }) as Promise<
    Array<{ sig: string; record: { payload: FrameTargetPayload } }>
  >
}

/** Remove the frame binding declared at this location. The branch goes back to
 *  reading through whatever an ancestor frames it with, or to free hexagons. */
export function removeFrameTarget(sig: string, segments: readonly string[]): void {
  removeDecoration({ sig, segments })
}
