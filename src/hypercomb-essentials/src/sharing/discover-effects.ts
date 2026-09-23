// sharing/discover-effects.ts
//
// The discover word's effect name — shared by the word (a bee) and the
// publications view, so a dependency atom (atomic-modules-plan.md).

/** Effect the publications view listens for. `at` guards the bus's
 *  last-value replay: only a fresh gesture may take the view over. */
export const DISCOVER_EFFECT = 'publications:discover'
