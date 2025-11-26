// src/app/cells/storage/data-orchestration-base.ts
import { inject } from '@angular/core'
import { Cell } from 'src/app/cells/cell'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { CELL_CREATOR } from 'src/app/inversion-of-control/tokens/tile-factory.token'
import { CELL_REPOSITORY } from 'src/app/shared/tokens/i-cell-repository.token'
import { COMB_STORE, STAGING_ST } from 'src/app/shared/tokens/i-comb-store.token'

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
    store: inject(COMB_STORE)
  }

  protected readonly repository = inject(CELL_REPOSITORY)

  // optional hive store accessor (safe)
  protected readonly hive = { store: inject(COMB_STORE) }

  // simple helper: group cells by hive string
  protected groupByHive(cells: Cell[]): Record<string, Cell[]> {
    return cells.reduce<Record<string, Cell[]>>((acc, cell) => {
      (acc[cell.hive] ??= []).push(cell)
      return acc
    }, {})
  }

  protected currentHiveName(): string | null {
    const top = this.stack.top()
    return top?.cell?.hive ?? null
  }
}
