// src/app/core/preflight/preflight.tokens.ts
import { InjectionToken } from '@angular/core'
import { Capability } from '../capabilities/capability.model'
import { SupportiveOperation } from '../supportive/supportive-operation.model'

export const CAPABILITIES = new InjectionToken<Capability[]>('CAPABILITIES')
export const SUPPORTIVE_OPERATIONS = new InjectionToken<SupportiveOperation[]>('SUPPORTIVE_OPERATIONS')
