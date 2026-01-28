// src/app/hypercomb.ts

import { inject } from '@angular/core'
import { web } from './hypercomb.web.js'
import { DRONE_RESOLVER } from './drone-resolver.js'

export class hypercomb extends web {
  private readonly resolver = inject(DRONE_RESOLVER)
  
  /**
   * activate a grammar at the current scope.
   * empty or '/' means root grammar.
   * always executes, always returns.
   */
  public override act = async (grammar: string = '') => {
    const drones = await this.resolver.find(grammar) || []

    for (const drone of drones) {
      await drone.encounter(grammar)
    }
  }
}
