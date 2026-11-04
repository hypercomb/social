// hypercomb-essentials/src/quickmenu/quick-menu.alt-held.ts
//
// ALT IS WHAT THE EVENT SAYS IT IS.
//
// The menu tracks Alt from its own keydown/keyup. A keyup that never arrives —
// Windows/Edge takes a bare Alt press-release for the browser menu, Alt+Tab
// hands the release to another window, focus sits in an iframe — leaves the
// tracked flag down for good: the flower rises on every hover, the flight keeps
// the camera in stone, the pointer stays put away, and the right click that
// should go back is kept inside the menu. Every pointer, wheel and key event
// carries the live modifier state, so the flag is reconciled against it: an
// event that says Alt is NOT held outranks a flag that says it is.

/** Should the tracked Alt flag be cleared because this event proves it is up?
 *  `altKey` undefined (a synthetic event with no modifier state) proves nothing. */
export const altProvenUp = (tracked: boolean, ev: { readonly altKey?: boolean }): boolean =>
  tracked && ev.altKey === false
