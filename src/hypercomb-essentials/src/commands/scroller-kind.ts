// commands/scroller-kind.ts
//
// THE SCROLLER'S NAMES — its view and its decoration kind. The /scroller
// word and the view that renders it both read these, and a bee is never
// imported for a value (atomic-modules-plan.md), so they live here, in a
// dependency both import.

/** The view token — doubles as the ViewMode string. */
export const SCROLLER_VIEW = 'scroller'

/** The mark a branch wears to carry the feed. Payload-free: the feed is
 *  whatever the branch already holds, so writing the record IS the install. */
export const SCROLLER_KIND = 'visual:scroller:feed'
