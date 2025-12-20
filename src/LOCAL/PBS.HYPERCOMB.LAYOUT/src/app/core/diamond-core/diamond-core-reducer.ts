// src/app/core/diamond/diamond-core.reducer.ts

import { DiamondDecision } from '../intent/models/intent-exec.model'
import { Intent, IntentPlane } from '../intent/models/intent.model'

export class DiamondCoreReducer {

  public reduce(intents: Intent[]): DiamondDecision {

    if (!intents.length) {
      return { winner: null, reason: 'no intents' }
    }

    const action = intents
      .filter(i => this.planeOf(i) === 'action')
      .sort((a, b) => b.confidence - a.confidence)[0]

    if (action) {
      return { winner: action, reason: 'action plane dominance' }
    }

    return { winner: null, reason: 'no executable intent' }
  }

  private planeOf(intent: Intent): IntentPlane {
    switch (intent.key) {
      case 'add.cell':
      case 'remove.cell':
        return 'action'
      case 'object.tile':
        return 'object'
      default:
        return 'focus'
    }
  }
}
