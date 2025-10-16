import { inject, signal } from '@angular/core'
import { Cell } from 'src/app/cells/cell'
import { ServiceBase } from 'src/app/core/mixins/abstraction/service-base'
import { CELL_REPOSITORY } from 'src/app/shared/tokens/i-cell-repository.token'
import { COMB_STORE, STAGING_ST } from 'src/app/shared/tokens/i-comb-store.token'
import { HIVE_STORE } from 'src/app/shared/tokens/i-hive-store.token'

/**
 * base class for coordinating repository → staging → combstore flow
 * simplified for single-hive repositories
 */
export abstract class DataOrchestratorBase extends ServiceBase {
  protected readonly staging = inject(STAGING_ST)
  protected readonly combStore = inject(COMB_STORE)
  protected readonly hiveStore = inject(HIVE_STORE)
  protected readonly repository = inject(CELL_REPOSITORY)

  private readonly _hydrated = signal(false)
  private readonly _fetching = signal(false)

  public readonly hydrated = this._hydrated.asReadonly()
  public readonly fetching = this._fetching.asReadonly()

  // ─────────────────────────────────────────────
  // state helpers
  // ─────────────────────────────────────────────
  public isHydrated(): boolean {
    return this._hydrated()
  }

  public isFetching(): boolean {
    return this._fetching()
  }

  public markFetching(): void {
    this._fetching.set(true)
  }

  public markHydrated(): void {
    this._fetching.set(false)
    this._hydrated.set(true)
  }

  public resetHydration(): void {
    this._fetching.set(false)
    this._hydrated.set(false)
  }

  // ─────────────────────────────────────────────
  // reusable hydrate pattern
  // ─────────────────────────────────────────────
  protected async hydrateFlow(fetcher: () => Promise<Cell[]>): Promise<Cell[]> {
    if (this.isFetching()) return []
    if (this.isHydrated()) return this.combStore.cells()

    this.markFetching()
    try {
      const rows = await fetcher()
      this.staging.stageCells(rows)
      this.markHydrated()
      return rows
    } catch (err) {
      this.resetHydration()
      throw err
    }
  }

  // ─────────────────────────────────────────────
  // utilities
  // ─────────────────────────────────────────────
  protected groupByHive(cells: Cell[]): Record<string, Cell[]> {
    return cells.reduce<Record<string, Cell[]>>((acc, cell) => {
      (acc[cell.hive] ??= []).push(cell)
      return acc
    }, {})
  }
}
