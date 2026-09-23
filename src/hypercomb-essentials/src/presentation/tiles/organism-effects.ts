// presentation/tiles/organism-effects.ts
//
// The organism view's effect names — shared by the organism bee and the
// organism word (a bee of its own), so a dependency atom: a bee is never
// imported for a value (atomic-modules-plan.md).

/** Ask for a mode. `promote` names the tag lifted to the top layer, and is
 *  ignored by the texture. */
export const ORGANISM_SET = 'organism:set'
/** What the mode is now, for the chrome and for the word's answer. */
export const ORGANISM_CHANGED = 'organism:changed'
