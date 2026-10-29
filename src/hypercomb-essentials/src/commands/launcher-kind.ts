// commands/launcher-kind.ts
//
// THE LAUNCHER VIEW'S NAMES. The slash word and the view that renders it
// both read these. A bee is never imported for a value, so the names live
// here, in a file both sides can import.

/** View-mode token. Swipe sideways between screens. */
export const LAUNCHER_VIEW = 'launcher'

/** Decoration a cell wears when the launcher is its face. */
export const LAUNCHER_KIND = 'visual:launcher:view'

/** How a screen draws its tiles. `icons` is a phone home screen.
 *  `square` is the larger square-tile plates. */
export type LauncherStyle = 'square' | 'icons'

export interface LauncherPayload {
  readonly version: 1
  readonly style?: LauncherStyle
}

/** Lit once, on a hive that already keeps an on-list, so the new face is
 *  not born dark. */
export const LAUNCHER_COHORT = 'launcher-view'

export const isLauncherStyle = (value: string): value is LauncherStyle =>
  value === 'square' || value === 'icons'

/** The style chosen this session, from the toggle or from `/launcher icons`.
 *  Null until someone picks — the mark, then the phone icons, fill in. */
let preferred: LauncherStyle | null = null

export const launcherStylePreference = (): LauncherStyle | null => preferred

export const setLauncherStylePreference = (style: LauncherStyle): void => {
  preferred = style
}
