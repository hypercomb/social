// src/app/core/agent/create.agent.ts

import { inject } from '@angular/core'
import { Worker  } from './worker.base'
import { HypercombState } from '../hypercomb-state'
import { CapabilityManager } from '../hive/capability.manager'

export class CreateWorker extends Worker {
  public readonly action = 'create'

  private readonly state = inject(HypercombState)
  private readonly capabilitymgr = inject(CapabilityManager)

  public async act(): Promise<void> {
    // reads lineage from state
    // allocates draft resources
  }
}
