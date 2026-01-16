  // src/app/hypercomb.ts

  import { inject } from '@angular/core'
  import { ActIntent, web } from './hypercomb.web.js'
  import { ACTION_RESOLVER } from './action-resolver.js'

  export class hypercomb extends web {
    private readonly resolver = inject(ACTION_RESOLVER)
    public readonly active = (): string => this.segments()[this.index] ?? ''
    public readonly path = (): string => window.location.pathname
    public readonly segments = (): readonly string[] => this.path().split('/').filter(Boolean)
    public readonly depth = (): number => this.segments().length
    public index: number = 0

    public override act = async (grammar: string): Promise<ActIntent> => {
      const clean = grammar.replace(/[\\?:\s]+/g, '-').trim()
      if (!clean) return { kind: 'error', name: 'input-invalid' }

      const actions = await this.resolver.find(clean)

      if (actions.length) {
        this.index++
        for (const action of actions) {
          await action.execute()
        }
        return { kind: 'action', name: clean }
      }

      return { kind: 'seed', name: clean }
    }

  }

