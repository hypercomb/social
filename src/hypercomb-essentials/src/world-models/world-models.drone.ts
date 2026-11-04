// world-models/world-models.drone.ts
//
// THE ENTRANCE. One behaviour, five traits, no fillers. Each trait is a
// reminder that the behaviour works properly once something is provided, and
// the name of the layer that will fill it later. Extruding one is a later
// layer of its own, named that word. The words and the copy live in
// world-models.words.ts.
// The page (entrance.view.ts) draws them. Nothing here reaches a vendor, a
// key, or a store.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { WORLD_MODEL_COPY, WORLD_MODEL_NAMESPACE, WORLD_MODEL_TRAITS, WORLD_MODELS_SURFACE, WORLD_MODELS_WINDOW } from './world-models.words.js'

export { WORLD_MODEL_COPY, WORLD_MODEL_NAMESPACE, WORLD_MODEL_TRAITS, WORLD_MODELS_SURFACE, WORLD_MODELS_WINDOW }

const SURFACE_KEY = '@diamondcoreprocessor.com/WorldModelsDrone'

export class WorldModelsDrone extends Drone {
  readonly namespace = WORLD_MODEL_NAMESPACE

  public override description =
    'The entrance to world models. Five traits are open. Each one is a layer to extrude later.'

  public override readonly traits = WORLD_MODEL_TRAITS

  protected override sense = (): boolean => false
}

const ioc = (globalThis as {
  ioc?: {
    register?: (key: string, value: unknown) => void
    whenReady?: (key: string, callback: (value: unknown) => void) => void
  }
}).ioc

ioc?.whenReady?.(I18N_IOC_KEY, (value: unknown) => {
  ;(value as I18nProvider).registerTranslations(WORLD_MODEL_NAMESPACE, 'en', WORLD_MODEL_COPY)
})

ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value: unknown) => {
  const registry = value as { add(surface: unknown): void }
  try {
    registry.add({
      name: WORLD_MODELS_SURFACE,
      owner: SURFACE_KEY,
      element: WORLD_MODELS_SURFACE,
      order: 180,
    })
  } catch {
    // A second load (hot reload) finds the surface already mounted.
  }
})

ioc?.register?.(SURFACE_KEY, new WorldModelsDrone())

// The page bundle loads with the word, including on a shell that does not
// import every view at boot. A second load is a cache hit.
EffectBus.on('world-models:open', () => {
  void import('./entrance.view.js')
})
