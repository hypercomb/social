// src/app/hypercomb.ts

import { inject, Injectable, signal } from '@angular/core'
import { web } from './hypercomb.web'
import { ACTION_MANAGER } from './core/action-manager'

@Injectable({ providedIn: 'root' })
export class hypercomb extends web {
  private readonly manager = inject(ACTION_MANAGER)
  public readonly path = (): string => window.location.pathname
  public readonly segments = (): readonly string[] => this.path().split('/').filter(Boolean)
  public readonly depth = (): number => this.segments().length
  public index: number = 0

  public override act = async (text: string): Promise<void> => {
    const clean = text.replace(/[\/\\?:]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!clean) return

    const next =
      this.path() === '/' ? `/${clean}` : `${this.path()}/${clean}`

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

