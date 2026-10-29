// editor/models/models.ts
//
// A plain lookup. No registry, no plugin machinery, no events: a second model is
// one descriptor file and one line here. This is not the folder's index.ts —
// that file is generated and wiped by the essentials prepare script.

import { HEXAGON } from './hexagon.model.js'
import type { TileModel } from './tile-model.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MODELS: Readonly<Record<string, TileModel<any>>> = { [HEXAGON.id]: HEXAGON }

/** The model with this id; anything unknown (or no id yet) is the hexagon. */
export const modelFor = (id?: string): TileModel => (id && MODELS[id]) || HEXAGON

/** Every model there is; the contract spec runs on this. */
export const allModels = (): readonly TileModel[] => Object.values(MODELS)
