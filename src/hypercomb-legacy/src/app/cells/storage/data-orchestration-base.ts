// hypercomb-legacy/src/app/cells/storage/data-orchestration-base.ts

import { inject } from '@angular/core'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { CELL_CREATOR } from 'src/app/inversion-of-control/tokens/tile-factory.token'
import { CELL_REPOSITORY } from 'src/app/shared/tokens/i-cell-repository.token'
import { HONEYCOMB_STORE, STAGING_ST } from 'src/app/shared/tokens/i-honeycomb-store.token'

/**
 * DataOrchestratorBase (2025)
 * ----------------------------------------
 * Pure repository → staging → store coordinator.
 * NO hydration state.
 * NO reference to HoneycombService.
 * This prevents circular DI between base and service.
 */
export abstract class DataOrchestratorBase extends Hypercomb {

  protected readonly staging = inject(STAGING_ST)
  protected readonly honeycomb = {
    factory: inject(CELL_CREATOR),
    store: inject(HONEYCOMB_STORE)
  }

  protected readonly repository = inject(CELL_REPOSITORY)
  protected readonly hive = { store: inject(HONEYCOMB_STORE) }

}
