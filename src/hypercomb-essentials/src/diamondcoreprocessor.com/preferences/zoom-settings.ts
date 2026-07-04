// diamondcoreprocessor.com/settings/zoom-settings.ts
export type ZoomSettingsType = {
  minScale: number
  maxScale: number
  defaultScale: number
  pinchJitterPx: number
  pinchForceTakeover: boolean
}

export const ZoomSettings = (): ZoomSettingsType => ({
  // Lowered from 0.2 so the whole canvas can be zoomed out far enough to take
  // in a large spread of tiles at once — e.g. the /help page's labelled
  // islands, which fan much wider than a single spiral. Halved again to 0.04
  // so tiles can shrink to half that floor. Applies everywhere.
  minScale: 0.04,
  maxScale: 8,
  defaultScale: 1,
  pinchJitterPx: 4,
  pinchForceTakeover: true
})

window.ioc.register('@diamondcoreprocessor.com/ZoomSettings', ZoomSettings())
