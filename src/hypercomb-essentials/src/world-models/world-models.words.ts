// world-models/world-models.words.ts
//
// The entrance's words and copy, in a file of their own. The behaviour
// (world-models.drone.ts) declares them and the page (entrance.view.ts) draws
// them; neither imports the other, because one bee never reaches into another
// (the module build stubs that import as empty).

import type { TraitDeclaration } from '@hypercomb/core'

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
