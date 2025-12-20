// src/app/core/diamond-core/intent-field.selector.ts

import { toCorePlane } from '../intent/adapters/intent-field.adapter'
import { IntentFieldContext } from '../intent/models/intent-field-content.model'
import { IntentFieldSnapshot } from '../intent/models/intent-field.model'

export function selectIntentFieldContext(
  snapshot: IntentFieldSnapshot
): IntentFieldContext {

  if (!snapshot.particles.length) return {}

  const strongest = [...snapshot.particles]
    .sort((a, b) => b.weight - a.weight)[0]

  return {
    dominantIntent: strongest.intent.key,
    dominantPlane: toCorePlane(strongest.plane),
    dominantWeight: strongest.weight
  }
}
