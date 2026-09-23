// commands/square-tile-kind.ts
//
// THE SQUARE TILE VIEW'S NAMES — its view and kind, and the retired welcome
// view it still reads. The /square-tile-view word and the view that renders
// it both read these, and a bee is never imported for a value
// (atomic-modules-plan.md), so they live here, in a dependency both import.

export const SQUARE_TILE_VIEW = 'square-tile-view'

export const SQUARE_TILE_KIND = 'visual:square-tile:view'

/** The retired Revolución names — read-side aliases only, never written. */
export const LEGACY_WELCOME_VIEW = 'revolucion-welcome'

export const LEGACY_WELCOME_KIND = 'visual:revolucion:welcome'
