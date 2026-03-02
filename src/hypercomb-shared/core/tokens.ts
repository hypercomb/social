// hypercomb-shared/core/tokens.ts
//
// Typed service tokens for the shared IoC bridge.
// These tokens connect Angular DI classes to their window.ioc registration keys.
//
// Duck-type compatible with @hypercomb/core ServiceToken:
// any object with a `.key` string property works with window.ioc.get/register.

import type { Provider } from '@angular/core'
import { CompletionUtility } from './completion-utility'
import { Lineage } from './lineage'
import { MovementService } from './movement.service'
import { Navigation } from './navigation'
import { ResourceCompletionService } from './resource-completion.service'
import { ResourceMessageHandler } from './resource-message-handler'
import { ScriptPreloader } from './script-preloader'

// -------------------------------------------------
// token type (lightweight, no core dependency)
// -------------------------------------------------

export interface SharedToken<T> {
  readonly key: string
  readonly ngType: any
}

function token<T>(key: string, ngType: any): SharedToken<T> {
  return { key, ngType }
}

// -------------------------------------------------
// shared service tokens
// -------------------------------------------------

export const COMPLETION_UTILITY = token<CompletionUtility>('CompletionUtility', CompletionUtility)
export const LINEAGE = token<Lineage>('Lineage', Lineage)
export const MOVEMENT = token<MovementService>('MovementService', MovementService)
export const NAVIGATION = token<Navigation>('Navigation', Navigation)
export const RESOURCE_COMPLETION = token<ResourceCompletionService>('ResourceCompletionService', ResourceCompletionService)
export const RESOURCE_MSG_HANDLER = token<ResourceMessageHandler>('ResourceMessageHandler', ResourceMessageHandler)
export const SCRIPT_PRELOADER = token<ScriptPreloader>('ScriptPreloader', ScriptPreloader)

// -------------------------------------------------
// Angular bridge helper
// -------------------------------------------------

/**
 * Generate Angular providers that bridge window.ioc instances into Angular DI.
 * Each token maps its `ngType` (the Angular class) to a factory that resolves
 * via `window.ioc.get(token.key)`.
 */
export function bridgeProviders(tokens: SharedToken<any>[]): Provider[] {
  return tokens
    .filter(t => t.ngType)
    .map(t => ({
      provide: t.ngType,
      useFactory: () => window.ioc.get(t.key),
    }))
}
