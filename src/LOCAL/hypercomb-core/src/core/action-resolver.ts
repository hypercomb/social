// src/app/core/action-resolver.ts

import { InjectionToken } from '@angular/core'
import { Action } from '@hypercomb/core/src/action.base.js'


export interface ActionResolver {
  find(input: string): Promise<Action | null>
}

export const ACTION_RESOLVER =
  new InjectionToken<ActionResolver>('ACTION_RESOLVER')
