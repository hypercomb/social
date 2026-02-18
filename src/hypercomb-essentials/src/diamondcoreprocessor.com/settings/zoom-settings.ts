// src/<domain>/settings/zoom-settings.ts

export type ZoomSettingsType = {
  minScale: number
  maxScale: number
  defaultScale: number
  pinchJitterPx: number
  pinchForceTakeover: boolean
}

export const ZoomSettings = (): ZoomSettingsType => ({
  minScale: 0.2,
  maxScale: 8,
  defaultScale: 1,
  pinchJitterPx: 4,
  pinchForceTakeover: true
})

window.ioc.register('ZoomSettings', ZoomSettings())
