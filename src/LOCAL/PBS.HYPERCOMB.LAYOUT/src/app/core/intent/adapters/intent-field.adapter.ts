import { CoreIntentPlane, IntentFieldPlane } from '../models/intent-field-plane.model'

export function toCorePlane(
  plane: IntentFieldPlane
): CoreIntentPlane | undefined {
  if (plane === 'action' || plane === 'object' || plane === 'focus') {
    return plane
  }
  return undefined
}

