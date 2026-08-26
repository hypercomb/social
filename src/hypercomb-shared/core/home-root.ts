// hypercomb-shared/core/home-root.ts
//
// THE ROOT *IS* HOME — and it does not say so in the address.
//
// Once a portal is marked as home, the root shows that portal's data while the
// address stays `/`. Home is not a place you travel to and it is not a
// redirect: it is what the root MEANS. There is nothing to spell out, so the
// address bar spells out nothing — which is also why the breadcrumb goes quiet
// there (it reads the address, and the address is still the root).
//
// ── where the substitution belongs ────────────────────────────────────
//
// At the ONE point that turns an address into a location: `Lineage.
// followLocation`. Everything that answers "what is here" — the sigbag, the
// current layer, the explorer directory, and so the whole render — reads
// `explorerPath`, and `followLocation` is the only thing that sets it from the
// URL. Substituting there means the root resolves to home for every reader at
// once, with nothing downstream taught about it.
//
// It deliberately does NOT rewrite the URL. An earlier pass did, and that made
// home a shortcut rather than a home: the address changed the moment you
// arrived, so `/` was never actually the place you lived. Keeping the address
// at `/` is the whole point of the feature.
//
// Walking is unaffected: `explorerEnter` appends to the substituted path and
// pushes it, so stepping into a child materializes the real address
// (`/<home>/<child>`). The address appears exactly when you have gone
// somewhere, and only then.
//
// ── the way back to the true root ─────────────────────────────────────
//
// Marking a home must never cost you the root itself. `showHiveRoot()` suspends
// the substitution for as long as you stay there — the Home menu's "hive root"
// row calls it right before navigating — and it lapses the moment you walk
// anywhere else, so the next arrival at `/` is home again.

import { RECENT_PORTALS_KEY, type RecentPortalsProvider } from '@hypercomb/core'

/** True while the participant has deliberately asked for the bare root. Held
 *  rather than one-shot, so acting AT the root — anything that re-reads the
 *  location without moving — cannot bounce them off it. */
let holdingRoot = false

/** Ask for the hive root ITSELF, not what stands in for it. Call immediately
 *  before navigating to the empty path. */
export const showHiveRoot = (): void => { holdingRoot = true }

/**
 * The location an address actually denotes. Identity for every address except
 * the empty one, which denotes the marked home.
 */
export const homeSubstituted = (address: readonly string[]): readonly string[] => {
  // Anywhere but the root: the hold has served its purpose and lapses.
  if (address.length > 0) { holdingRoot = false; return address }
  if (holdingRoot) return address

  const home = (get(RECENT_PORTALS_KEY) as RecentPortalsProvider | undefined)?.home
  // No home marked — the root means the root, exactly as it always did. A home
  // pointing AT the root is already satisfied and must not recurse.
  if (!home || home.segments.length === 0) return address

  return home.segments
}
