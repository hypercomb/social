// src/app/core/runtime-libs.ts
import * as PIXI from 'pixi.js'

export type HypercombLibs = {
  pixi: typeof PIXI
}

declare global {
  interface Window {
    __hypercomb_libs__?: HypercombLibs
  }
}

export const provideRuntimeLibs = (): void => {
  window.__hypercomb_libs__ ??= {
    pixi: PIXI
  }
}
    