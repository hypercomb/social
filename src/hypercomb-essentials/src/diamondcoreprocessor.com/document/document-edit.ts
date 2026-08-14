// diamondcoreprocessor.com/document/document-edit.ts
// Pure editing decisions for the document view — no DOM, no IoC, no storage.

/** How long typing must pause before a save is committed. */
export const SAVE_DEBOUNCE_MS = 800

const SIG = /^[0-9a-f]{64}$/

/**
 * The cell's CURRENT body signature: the newest entry in the `document`
 * slot. Older entries stay for history; the last one is what opens.
 *
 * Tolerant on purpose — a cold or malformed layer returns null and the
 * caller shows nothing rather than throwing inside a render pass.
 */
export function newestBodySig(layer: Record<string, unknown> | null | undefined): string | null {
  const slot = layer?.['document']
  if (!Array.isArray(slot)) return null
  for (let i = slot.length - 1; i >= 0; i--) {
    const sig = String(slot[i] ?? '')
    if (SIG.test(sig)) return sig
  }
  return null
}

/**
 * Whether a save is worth committing.
 *
 * A commit mints new bytes, a new signature, a new layer and therefore a
 * HISTORY ENTRY. Committing a body identical to the last one would spend
 * an undo step on nothing, so the participant's undo walks through phantom
 * saves that change no text. Debounced editors fire on focus loss and on
 * every pause, so this is the common case, not the rare one.
 *
 * The comparison is exact: trailing spaces and blank lines are content in
 * a document, and normalizing them here would silently rewrite what the
 * participant typed.
 */
export function shouldCommitBody(next: string, lastCommitted: string | null): boolean {
  if (lastCommitted === null) return next.length > 0
  return next !== lastCommitted
}

/**
 * Whether the hive's body has moved away from what Google last saw.
 *
 * This is the local half of the reconcile decision — `pulledSig` is the
 * signature of the bytes Google's copy corresponds to. Kept here (rather
 * than inlined in the view) so the view never has to reason about sync.
 */
export function hasUnpushedEdits(currentSig: string | null, pulledSig: string | null): boolean {
  if (!currentSig || !pulledSig) return false
  return currentSig !== pulledSig
}
