// src/app/hypercomb.ts

import { inject, Injectable, OnDestroy, signal } from '@angular/core'
import { web } from './hypercomb.web.js'
import { ACTION_MANAGER } from './action-manager.js'


export class hypercomb extends web {

  private readonly manager = inject(ACTION_MANAGER)
  public readonly active = (): string => this.segments()[this.index] ?? ''
  public readonly path = (): string => window.location.pathname
  public readonly segments = (): readonly string[] => this.path().split('/').filter(Boolean)
  public readonly depth = (): number => this.segments().length
  public index: number = 0

  public override act = async (text: string): Promise<void> => {
    const clean = text.replace(/[\\?:\s]+/g, ' ').trim()
    const next = `${this.path().replace(/\/$/, '')}/${clean}`
    
    const actions = await this.manager.find(clean)
    this.index = actions.length ? this.index + 1 : this.index
    for (const action of actions) await action.run()

    window.history.pushState(
      { index: this.index },
      '',
      next
    )

    window.dispatchEvent(new Event('synchronize'))
  }
}

