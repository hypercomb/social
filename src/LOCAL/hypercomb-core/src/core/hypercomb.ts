// src/app/hypercomb.ts

import { inject } from '@angular/core'
import { web } from './hypercomb.web.js'
import { ACTION_RESOLVER } from './action-resolver.js'

export class hypercomb extends web {
  private readonly resolver = inject(ACTION_RESOLVER)
  public readonly active = (): string => this.segments()[this.index] ?? ''
  public readonly path = (): string => window.location.pathname
  public readonly segments = (): readonly string[] => this.path().split('/').filter(Boolean)
  public readonly depth = (): number => this.segments().length
  public index: number = 0

  public override act = async (grammar: string): Promise<void> => {
    const clean = grammar.replace(/[\\?:\s]+/g, ' ').trim()
    const next = `${this.path().replace(/\/$/, '')}/${clean}`
    const actions = await this.resolver.find(clean)
    if (actions.length) {
      this.index++
      for (const action of actions) await action.execute()
      return
    }
    window.dispatchEvent(new CustomEvent('synchronize', { detail: grammar }))
    window.history.pushState({ index: this.index }, '', next)

  }
}

