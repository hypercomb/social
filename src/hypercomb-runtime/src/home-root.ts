// hypercomb-shared/core/home-root.ts
//
// THE ROOT *IS* HOME — and it does not say so in the address.
//
// Once a place is pinned as home, the root shows that place's data while the
// address stays `/`. Home is not a place you travel to and it is not a
// redirect: it is what the root MEANS. Choosing a home puts you AT THE ROOT,
// never at a nested address, which is also why the breadcrumb goes quiet there
// (it reads the address, and the address is still the root). Home is picked
// from Recent (ui/aggregate-index/sources/recent.source.ts): every place ever
// pinned, read back from the pin's own markers.
//
// The pinned place keeps its REAL lineage behind the `/`. Everything that
// asks "what is here" reads that lineage, so swarm and every cross-domain
// index and search still see where the place actually lives.
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
// arrived, so `/` was never actually the place you lived.
//
// Walking is unaffected: `explorerEnter` appends to the substituted path and
// pushes it, so stepping into a child materializes the real address
// (`/<home>/<child>`). The address appears exactly when you have gone
// somewhere, and only then.
//
// ── the way back to the true root ─────────────────────────────────────
//
// Recent's last row is the hive root: choosing it releases the pin, and the
// root means the root again. The old one-shot hold (`showHiveRoot`) had no
// caller left and retired with the per-window pins (2026-11-26).

// MOVED DOWN FROM hypercomb-shared/core (2026-11-11, jwize: "anything built in the
// debugger (subdomains) should not load angular"). The framework-free host had
// no lineage and no navigation, so a page there had no "where you stand": a
// create committed nothing and said it ran. This file imports no Angular and
// nothing of the shell; the shell file of the same name re-exports it.
/** As much of the shell's home store as this reads: the pinned home. */
type HomeStore = { readonly home?: { readonly segments: readonly string[] } | null }

/**
 * The location an address actually denotes. Identity for every address except
 * the empty one, which denotes the pinned home.
 */
export const homeSubstituted = (address: readonly string[]): readonly string[] => {
  if (address.length > 0) return address

  const home = (get('@hypercomb.social/RecentPortalsStore') as HomeStore | undefined)?.home
  // No home pinned — the root means the root, exactly as it always did. A home
  // pointing AT the root is already satisfied and must not recurse.
  if (!home || home.segments.length === 0) return address

  return home.segments
}
