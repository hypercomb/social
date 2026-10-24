// setup/arrival-cover.ts
//
// THE LOADING COVER LIFTS WHEN THE ARRIVAL IS ON SCREEN — WHATEVER IT IS.
//
// A published door (main.visitor.ts) keeps `.site-loading` over the page until
// the face its publisher pinned has painted, so a reader never sees the hive's
// own visuals between the cover and the page. The arrival's verdict
// (`view:arrival`, view.bee) says what is coming:
//
//   • '' — the hexagons: up at the first painted (count > 0) or settled
//     `render:cell-count` AT THE PLACE THE VERDICT NAMES, the splash
//     contract — never a pass replayed from where the visit began
//     (setup/visitor-cover.ts);
//   • a view — up once that view's SURFACE is seated, two frames later so its
//     styles have painted:
//       – a website page seats `#hc-site-view-host` (site-view.drone.ts) under
//         the covered body; a business card in it holds until its 3D stage
//         says `scene-live`;
//       – every other takeover view (postit, game, slides, the scroller, tree,
//         document, tutor, workflow, lounge, room, publications, square
//         tiles…) claims the owner-counted `view:active` mode (ModeRegistry)
//         once its surface is appended — the one fact every such view
//         publishes, so the shell never has to name a view.
//
// The wait used to be the site host alone, and the failsafe stood down while
// it waited: a door opening on any other view (arkanoid — a postit face) kept
// an opaque cover over its painted page for good. The failsafe now always
// lifts; a cover is never the last thing a visitor sees.

import { passShowsArrival, type CellCountPass } from './visitor-cover'

export const COVER_FAILSAFE_MS = 25_000
const SITE_HOST_ID = 'hc-site-view-host'

export type CoverBus = { on<T>(effect: string, handler: (payload: T) => void): () => void }

export type CoverOptions = {
  doc?: Document
  /** One animation frame (requestAnimationFrame) — a seam for the spec. */
  frame?: (callback: () => void) => unknown
  failsafeMs?: number
}

/** Is the surface a view verdict opened on screen? A website is its seated
 *  host (and a card's live stage); any other view is its `view:active`
 *  claim. */
export const viewSurfaceUp = (doc: Document, viewActive: boolean): boolean => {
  const host = doc.getElementById(SITE_HOST_ID)
  if (!host) return viewActive
  if (!doc.body.classList.contains('hc-view-covered')) return false
  // The covered class lands as soon as the view mode changes, while the page
  // host and its scripts may still be mounting. The business card builds its
  // 3D stage asynchronously and marks `scene-live` on its first frame: hold
  // until then, so an unfinished card frame never flashes.
  const waitsForScene = host.classList.contains('card-open') || !!host.querySelector('#stageHost')
  return !waitsForScene || host.classList.contains('scene-live')
}

/** Hold the cover until the arrival is on screen. Returns the lift, for the
 *  paths that end the wait themselves (a door that cannot open). */
export const holdCoverUntilArrival = (bus: CoverBus, options: CoverOptions = {}): (() => void) => {
  const doc = options.doc ?? document
  const frame = options.frame ?? ((callback: () => void) => requestAnimationFrame(callback))
  let lifted = false
  const lift = (): void => {
    if (lifted) return
    lifted = true
    const cover = doc.querySelector<HTMLElement>('.site-loading')
    if (!cover) return
    cover.style.transition = 'opacity .3s ease'
    cover.style.opacity = '0'
    setTimeout(() => cover.remove(), 340)
  }

  // EffectBus REPLAYS the last value SYNCHRONOUSLY inside .on(), so a
  // `const off = bus.on(..., () => off())` pattern dies in the TDZ when the
  // replay fires the handler before the const exists. Guard with flags;
  // unsubscribe on the next tick, when the bindings are real.
  let viewActive = false
  bus.on<{ active?: boolean }>('view:active', payload => { viewActive = payload?.active === true })

  const awaitView = (): void => {
    if (lifted) return
    if (!viewSurfaceUp(doc, viewActive)) { frame(awaitView); return }
    // Let the surface and its styles paint before the cover fades.
    frame(() => frame(lift))
  }

  let arrivalSeen = false
  let offArrival: (() => void) | undefined
  let offCells: (() => void) | undefined
  const onVerdict = (view: string, at: readonly string[] | null): void => {
    if (view) { awaitView(); return }
    // This subscription is handed the LAST pass at once, which may be another
    // place's: only a pass painted where the verdict stands may lift the cover.
    let cellsSeen = false
    offCells = bus.on<CellCountPass>('render:cell-count', payload => {
      if (cellsSeen || !passShowsArrival(at, payload)) return
      cellsSeen = true
      lift()
      setTimeout(() => offCells?.(), 0)
    })
  }
  offArrival = bus.on<{ view?: string; segments?: readonly string[] }>('view:arrival', payload => {
    if (arrivalSeen) return
    arrivalSeen = true
    setTimeout(() => offArrival?.(), 0)
    onVerdict(String(payload?.view ?? ''), Array.isArray(payload?.segments) ? payload.segments : null)
  })

  // Never strand a visitor behind the cover — not a boot that reaches no
  // verdict, and not a verdict whose surface never says it is up.
  setTimeout(lift, options.failsafeMs ?? COVER_FAILSAFE_MS)
  return lift
}
