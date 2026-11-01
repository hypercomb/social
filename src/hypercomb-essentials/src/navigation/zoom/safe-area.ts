// navigation/zoom/safe-area.ts
//
// The part of the canvas the participant can actually see: beside the docked
// controls rail and under the header. Fit and the quick menu's flight both
// centre in it, so they agree on where the middle is.

export type SafeArea = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/** The safe area in canvas-local coordinates, `padding` in from each edge. */
export function safeArea(
  screen: { readonly width: number; readonly height: number },
  canvasRect: { readonly top: number } | null,
  padding = 0,
): SafeArea {
  const headerEl = document.querySelector('.header-bar') as HTMLElement | null
  const rootStyle = getComputedStyle(document.documentElement)
  const controlsLeft = Number.parseFloat(rootStyle.getPropertyValue('--hc-controls-left')) || 0
  const controlsRight = Number.parseFloat(rootStyle.getPropertyValue('--hc-controls-right')) || 0
  // Header bottom in canvas-local Y: the header lives in viewport space, the
  // safe area in canvas space, so subtract the canvas's own top offset
  // (0 normally; non-zero only if the host is inset from the viewport top).
  const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 0
  const headerBottomLocal = Math.max(0, canvasRect ? headerBottom - canvasRect.top : headerBottom)
  // With the command line on demand (command-line.component.ts
  // `line-on-demand`) the bar paints no strip, so the hive centres on the
  // whole canvas: the header's height is reserved half above, half below.
  // The scale is the one the normal mode fits — only the centre rises, by
  // half the header — and a summoned line may overlap the top of the content.
  const headerReserve = headerEl?.classList.contains('line-on-demand') ? headerBottomLocal / 2 : 0
  return {
    left: controlsLeft + padding,
    top: headerBottomLocal - headerReserve + padding,
    right: screen.width - controlsRight - padding,
    bottom: screen.height - headerReserve - padding,
  }
}

/** The safe area for something flown to its middle. An area with no size means
 *  the chrome has moved, so the whole canvas stands. */
export function visibleArea(
  screen: { readonly width: number; readonly height: number },
  canvasRect: { readonly top: number } | null,
): SafeArea {
  const area = safeArea(screen, canvasRect)
  return area.right > area.left && area.bottom > area.top
    ? area
    : { left: 0, top: 0, right: screen.width, bottom: screen.height }
}
