// src/app/ui/elevation/elevation-indicator.state.ts

import { Injectable, computed } from '@angular/core'
import { SafetyPolicy } from '../../core/safety/safety-policy.service'
import { HypercombState } from '../../core/hypercomb-state'

@Injectable({ providedIn: 'root' })
export class ElevationIndicatorState {

  constructor(
    private readonly safetyPolicy: SafetyPolicy,
    private readonly state: HypercombState
  ) {}

  public readonly elevatedOperations = computed(() => {
    const lineage = this.state.lineage()
    return (operationKey: string) =>
      this.safetyPolicy.isElevated(lineage, operationKey)
  })
}
