// presentation/tiles/scroll-gutter.ts
//
// THE GUTTER — a classic scrollbar is a strip of the viewport a fixed corner
// control cannot have.
//
// Every full-viewport view mounts the same shape: a `position:fixed`
// `overflow:auto` host, and a small `position:fixed` control tucked into a
// corner (the × back to hexagons, a ← back one room). Those two disagree
// about where the right edge is. A fixed box is laid out against the VIEWPORT,
// and the browser already keeps the DOCUMENT's own scrollbar out of that box —
// but the host's scrollbar is INSIDE the viewport, so `right: 0.75rem` puts
// the button on top of it. On a platform with overlay scrollbars (a phone, a
// Mac by default) nothing shows and the bug is invisible; on Windows, where
// the strip is a real ~15px of chrome, the control ends up crowded against —
// or sitting under — the scrollbar.
//
// So the view has to MEASURE, not assume: watch the scroll host and publish
// its scrollbar width as `--hc-scroll-gutter` on that host, which every fixed
// child then adds into its own offset:
//
//   right: calc(0.75rem + env(safe-area-inset-right, 0px) + var(--hc-scroll-gutter, 0px))
//
// The fallback of `0px` is the whole compatibility story: a view that has not
// adopted the tracker, or content that does not overflow, reads exactly the
// offset it read before.
//
// GENERIC ON PURPOSE. Nothing here knows what a post-it or a welcome plate is
// — it is one measurement of one element, so any surface with an inner
// scroller and a floating corner control can mount it.

/** The custom property the tracker writes, and fixed children read. */
export const SCROLL_GUTTER_VAR = '--hc-scroll-gutter'

/** Width of `host`'s own vertical scrollbar, in CSS pixels. 0 for an overlay
 *  scrollbar, 0 while the content fits, ~15 for a classic one. Borders are
 *  discounted so a bordered host doesn't report its frame as chrome. */
function gutterOf(host: HTMLElement): number {
  const style = getComputedStyle(host)
  const borders = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0)
  return Math.max(0, Math.round(host.offsetWidth - host.clientWidth - borders))
}

/** Publish `host`'s scrollbar width on `host` as `--hc-scroll-gutter`, and
 *  keep it true while the view lives.
 *
 *  Re-measured when the host resizes AND when any of its children do: content
 *  that arrives late (lazy pictures, a page fetched from the store) is exactly
 *  what makes a scrollbar appear, and it changes a child's height, not the
 *  host's. New children are picked up as they are appended.
 *
 *  Returns the teardown. Calling it is optional when the host is being removed
 *  from the DOM anyway — the observers die with it — but a view that reuses a
 *  host across passes should call it.  */
export function trackScrollGutter(host: HTMLElement): () => void {
  let last = -1
  const measure = (): void => {
    const gutter = gutterOf(host)
    if (gutter === last) return
    last = gutter
    host.style.setProperty(SCROLL_GUTTER_VAR, `${gutter}px`)
  }

  const watched = new WeakSet<Element>()
  const observer = new ResizeObserver(() => measure())
  const watch = (el: Element): void => {
    if (watched.has(el)) return
    watched.add(el)
    observer.observe(el)
  }
  watch(host)
  for (const child of Array.from(host.children)) watch(child)

  const mutations = new MutationObserver(records => {
    for (const record of records) {
      for (const added of Array.from(record.addedNodes)) {
        if (added instanceof Element) watch(added)
      }
    }
    measure()
  })
  mutations.observe(host, { childList: true })

  measure()

  return (): void => {
    observer.disconnect()
    mutations.disconnect()
    host.style.removeProperty(SCROLL_GUTTER_VAR)
  }
}
