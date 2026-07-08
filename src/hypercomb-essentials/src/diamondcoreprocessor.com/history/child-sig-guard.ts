// diamondcoreprocessor.com/history/child-sig-guard.ts
//
// The cold-mint preserve guard, as two PURE, side-effect-free functions so
// they can be unit-tested without the IoC-heavy LayerCommitter harness.
//
// WHY. `HistoryService.latestMarkerSigFor` auto-mints an empty `{name}` layer
// for any lineage bag that reads cold (no markers on disk). So any commit that
// re-lists a parent's children BY NAME — paste, cut, move-into, promote,
// adopt, any `nameSlots` layer update — re-resolves every sibling through that
// function, and a cold sibling's REAL sig gets silently swapped for the empty
// husk. For a REFERENCE tile that is fatal: its whole identity is the
// `decorations` slot (no image fallback), so a cold re-resolve strips its
// reference-ness and it renders blank / stops portaling. Ordinary tiles merely
// go imageless. Undo recovers (the prior marker still holds the real sig) but
// the next same op re-breaks it. The guard: never let a bare-husk resolve
// overwrite a child we already hold a rich sig for.

export type LayerLike = { name?: string; [slot: string]: unknown } | null | undefined

/**
 * True when a layer is a bare `{ name }` husk — no slot carries content.
 * That is exactly the shape `latestMarkerSigFor` mints for a cold bag, so a
 * bare result for an EXISTING child is the auto-mint fingerprint (a live child
 * always carries children / notes / tags / decorations / properties). A
 * null / absent layer counts as bare, so a read-miss also prefers a known-live
 * prior sig rather than trusting an unreadable resolve.
 */
export const isBareLayer = (layer: LayerLike): boolean => {
  if (!layer || typeof layer !== 'object') return true
  for (const [k, v] of Object.entries(layer)) {
    if (k === 'name') continue
    if (Array.isArray(v) ? v.length > 0 : (v !== null && v !== undefined && v !== '')) return false
  }
  return true
}

/**
 * Decide which sig a child NAME should resolve to. The async gathering (sign
 * → latestMarkerSigFor → bareness reads) lives in the committer; this is the
 * pure decision it makes.
 *
 *  - No prior sig for this name → a genuinely NEW child → mint as resolved.
 *  - Prior sig equals the resolve → unchanged → resolved (the common path).
 *  - Resolve is a bare husk but the prior is rich → COLD-MINT → keep the prior
 *    (the fix: a transient cold bag must not blank a live reference/tile).
 *  - Otherwise (a legitimate edit resolves to a non-bare sig) → trust the
 *    resolve verbatim.
 */
export const chooseChildSig = (args: {
  resolvedSig: string
  resolvedBare: boolean
  priorSig?: string
  priorBare?: boolean
}): string => {
  const { resolvedSig, resolvedBare, priorSig, priorBare } = args
  if (!priorSig || priorSig === resolvedSig) return resolvedSig
  return (resolvedBare && !priorBare) ? priorSig : resolvedSig
}
