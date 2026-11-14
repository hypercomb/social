// presentation/tiles/pixi3d-lender.ts
//
// THE HIVE LENDS ITS 3D.
//
// A 3D thing the hive stores as a resource — the cigar lounge
// (scripts/lounge3d/bundle-lounge.ts) — would otherwise carry its own Pixi and
// `@pixi/3d`: over a megabyte the page already has. It asks for the hive's
// instead, the same two modules the lift view draws with (lift-view.drone.ts),
// loaded the same lazy way: nothing is fetched until something asks.
//
// Through IoC, not the import map, because the dev shell has no runtime import
// map (its Pixi is bundled). A borrower that finds no lender may still try the
// page's import map itself — a host's page with no hive behind it.
//
// A dependency, so it registers nothing itself: the site view (always awake,
// the frame that runs a page's own scripts) registers the one lender. Not the
// lift view — the other holder of these modules — which sleeps until `/lift`.
// Being awake costs this file; the modules load only on `lend()`.
//
// The modules come as they are. Whether this Pixi needs the no-eval bridge is
// for the borrower to ask of it (pixi3d-no-eval.ts, `bridgeNoEvalPixi`).

export const PIXI3D_LENDER_KEY = '@diamondcoreprocessor.com/Pixi3DLender'

export interface LentPixi3D {
  readonly pixi: typeof import('pixi.js')
  readonly p3d: typeof import('@pixi/3d')
}

export class Pixi3DLender {
  lend(): Promise<LentPixi3D> {
    return Promise.all([import('pixi.js'), import('@pixi/3d')]).then(([pixi, p3d]) => ({ pixi, p3d }))
  }
}
