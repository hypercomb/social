// editor/draft-pad.ts
//
// PUTTING A TILE'S DRAFT BACK. The pad (TileEditorService's drafts) keeps one
// changed draft per tile the editor has moved away from. Two things take one
// out: the participant's "restore" on a tile reopened after the desk closed
// (the view), and the editor arriving at a tile while the desk is open (the
// drone) — the same steps, so they live here once.

import type { HexOrientation } from './crop-math.js'
import type { EditorDraftStash, TileEditorService } from './tile-editor.service.js'

/** The slice of the picture model a draft is put back through. */
export type DraftPictureModel = {
  removePicture(): void
  loadImage(blob: Blob): Promise<void>
  setLinked(linked: boolean): void
  setMode(mode: 'fill' | 'fit'): void
  setFraming(framing: { x: number; y: number; scale: number }, orientation: HexOrientation): void
}

/** The draft's properties and choices back in the session, its picture back in
 *  the model with the framing it had, and the draft out of the pad — from here
 *  it is the open tile's own, and is stashed again if the editor moves on.
 *  `orientations` is the model's variants in order: the first carries the
 *  framing, the second its own only when the two were unlinked. */
export async function applyDraft(
  service: TileEditorService,
  images: DraftPictureModel,
  draft: EditorDraftStash,
  orientations: readonly HexOrientation[],
): Promise<void> {
  service.restoreDraft(draft)
  if (draft.pictureRemoved) {
    images.removePicture()
  } else if (draft.picture) {
    const picture = draft.picture
    service.setLargeBlob(picture.source)
    await images.loadImage(picture.source)
    images.setLinked(picture.linked)
    images.setMode(picture.mode)
    const [first, second] = orientations
    if (first) images.setFraming(picture.point, first)
    if (!picture.linked && second) images.setFraming(picture.flat, second)
  }
  service.dropStash(draft.cell, draft.segments)
}
