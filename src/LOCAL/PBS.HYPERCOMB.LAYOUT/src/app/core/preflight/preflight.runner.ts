// src/app/core/preflight/preflight.runner.ts
import { Injectable, inject } from '@angular/core'
import { CAPABILITIES, SUPPORTIVE_OPERATIONS } from './preflight.tokens'
import { Capability } from '../capabilities/capability.model'
import { SupportiveOperation } from '../supportive/supportive-operation.model'
import { DiamondCommit } from '../diamond-core/diamond-core.model'
import { PreflightResult } from './preflight-result.model'

@Injectable({ providedIn: 'root' })
export class PreflightRunner {

  private readonly capabilities = inject<Capability[]>(CAPABILITIES)
  private readonly supportiveOps = inject<SupportiveOperation[]>(SUPPORTIVE_OPERATIONS)

  public run = (commit: DiamondCommit): PreflightResult => {

    // capability gating (eligibility)
    for (const cap of this.capabilities) {
      if (!cap.allows(commit)) {
        return {
          allowed: false,
          reason: cap.key,
          targets: []
        }
      }
    }

    // supportive shaping (pure)
    let shapedCommit = commit
    const operationKey = commit.intent.dominantIntent

    if (operationKey) {
      for (const sop of this.supportiveOps) {
        if (sop.appliesTo(operationKey)) {
          shapedCommit = sop.apply(shapedCommit)
        }
      }
    }

    // lineage-safe targets
    const targets = shapedCommit.selection?.seeds ?? []

    return {
      allowed: true,
      targets
    }
  }
}
