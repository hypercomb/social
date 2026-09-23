// assistant/reshape.ts
//
// ONE GESTURE, TWO OPERATIONS — the facts the break-apart and organize bees
// share with each other and with the slash provider that speaks for them. A
// bee never holds another bee (atomic-modules-plan.md), so what two doors
// agree on lives here, in a dependency both of them import.

/** Below this, a layer is already manageable — organizing it would add a
 *  level of navigation to save nothing. Above it, a layer is CROWDED, and
 *  crowded is the condition that decides which operation a page needs:
 *  `/break-apart` on a crowded layer routes to organize instead of
 *  deepening. The participant should never have to know which of the two
 *  they want. */
export const ORGANIZE_THRESHOLD = 12

/** Wording for every way a break-apart can decline. Shared so the slash
 *  provider phrases the selection case identically — two doors, one voice. */
export const BREAK_APART_SKIP_LABELS: Record<string, (n: number) => string> = {
  'has-children': n => `${n} already had children`,
  'already-queued': n => `${n} already queued`,
  'ancestor-busy': n => `${n} waiting on a parent already being reshaped`,
  'failed': n => `${n} could not be read`,
}
