// commands/website-kind.ts
//
// THE PENDING WEBSITE'S KIND — a page asked for and not yet built. The
// /website word and the view that renders it both read these, and a bee is
// never imported for a value (atomic-modules-plan.md), so they live here, in
// a dependency both import.

/**
 * Build-intent marker kind. `/website here` drops a decoration of this kind
 * on the current cell; the next gen pass / `website-build` skill reads them
 * as the authoritative queue of cells to turn into pages, then replaces each
 * with a `visual:website:page` decoration once generated. Distinct from the
 * page kind so SiteViewDrone (which mounts `visual:website:page` + htmlSig)
 * and ViewBee's presence check never confuse a request for a built page.
 */
export const WEBSITE_PENDING_KIND = 'visual:website:pending'
