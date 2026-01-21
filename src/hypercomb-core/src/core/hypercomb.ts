// src/app/hypercomb.ts

import { inject } from '@angular/core'
import { web } from './hypercomb.web.js'
import { ACTION_RESOLVER } from './action-resolver.js'

export class hypercomb extends web {
  private readonly resolver = inject(ACTION_RESOLVER)

  /**
   * activate a grammar at the current scope.
   * empty or '/' means root grammar.
   * always executes, always returns.
   */
  public override act = async (grammar: string = '') => {
    const clean = grammar
      .replace(/[\\?:\s]+/g, '-')
      .replace(/^\/+|\/+$/g, '')
      .trim()

    // empty => root grammar
    const resolvedGrammar = clean || '/'

    const actions = await this.resolver.find(resolvedGrammar)

    for (const action of actions) {
      await action.execute(grammar)
    }
  }
}
