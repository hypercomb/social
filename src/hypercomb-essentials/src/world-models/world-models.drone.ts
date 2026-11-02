// world-models/world-models.drone.ts
//
// THE ENTRANCE. One behaviour, five traits, no fillers. Each trait is a
// reminder that the behaviour works properly once something is provided, and
// the name of the layer that will fill it later. Extruding one is a later
// layer of its own, named that word. This file holds the words and the copy.
// The page (entrance.view.ts) draws them. Nothing here reaches a vendor, a
// key, or a store.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider, type TraitDeclaration } from '@hypercomb/core'

export const WORLD_MODELS_SURFACE = 'hc-world-models'
export const WORLD_MODELS_WINDOW = 'world-models'
export const WORLD_MODEL_NAMESPACE = 'diamondcoreprocessor.com'

/** The open requirements. Every one is needed: there is no own version. */
export const WORLD_MODEL_TRAITS: readonly TraitDeclaration[] = [
  { word: 'subscription', needs: true },
  { word: 'language-model', needs: true },
  { word: 'world', needs: true },
  { word: 'clip', needs: true },
  { word: 'session', needs: true },
]

/** English copy, registered under the module namespace. The shared catalogs
 *  stay untouched. A missing translation falls back to these strings. */
export const WORLD_MODEL_COPY: Record<string, string> = {
  'world-models.title': 'World models',
  'world-models.lead': 'A world model predicts what a scene does next.',
  'world-models.invitation': 'This door is where you connect a subscription and a language model you already have. The conversation arrives with the door.',
  'world-models.close': 'Close',
  'world-models.unfilled': 'Open',
  'world-models.seat.subscription': 'Connect a subscription you already pay for. It stays on your device.',
  'world-models.seat.language-model': 'Name the language model you bring. The conversation on this door speaks with it.',
  'world-models.seat.world': 'A durable world, kept as its own artifact. A splat, a mesh, a panorama.',
  'world-models.seat.clip': 'A finished video, kept as its own artifact.',
  'world-models.seat.session': 'A live world. What you keep is a recording.',
}

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
