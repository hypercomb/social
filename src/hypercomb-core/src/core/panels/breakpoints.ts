// hypercomb-core/src/core/panels/breakpoints.ts
//
// The phone breakpoint, in TypeScript — the twin of `_breakpoints.scss`.
//
// Seventeen places in the shell already spell the phone query inline as
// `(max-width: 599px), (max-height: 449px)`. Two numbers, one meaning: the shell
// is in SHEET mode, where a tool window takes the whole screen rather than
// docking to an edge. Anything that has to reason about that in code — not just
// style against it — needs the same two numbers, and copying them a eighteenth
// time is how they drift apart.
//
// NOTE the SHORT axis. A landscape phone (932×430) is wide by any desktop
// measure and still has no room for a docked panel; a rule that only asks about
// width calls it roomy and lays two full-bleed sheets on top of each other.
//
// Numeric, deliberately, NOT `matchMedia`: jsdom reports `matches: false` for
// every query, so a matchMedia-based lane would silently behave as if no phone
// existed and could not be tested at all — while a numeric one is exercised by
// stubbing `innerWidth`/`innerHeight`, which the lane spec already does.

/** Widths at or below this are phone-shaped. Mirrors `$bp-phone-max`. */
export const PHONE_MAX_WIDTH = 599

/** Heights at or below this are phone-shaped too — a landscape phone is wide
 *  and short, and the short axis is what leaves no room for a docked panel. */
export const PHONE_MAX_HEIGHT = 449

/** The query the stylesheets use, for anything that genuinely wants a listener
 *  rather than a measurement. Keep it identical to `@mixin phone` in
 *  `_breakpoints.scss`. */
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px), (max-height: ${PHONE_MAX_HEIGHT}px)`

/** Is the shell in sheet mode — either axis phone-shaped? */
export const isPhoneViewport = (): boolean => {
  if (typeof window === 'undefined') return false
  return window.innerWidth <= PHONE_MAX_WIDTH || window.innerHeight <= PHONE_MAX_HEIGHT
}
