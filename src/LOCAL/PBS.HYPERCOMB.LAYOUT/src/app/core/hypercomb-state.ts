// src/app/core/hypercomb-state.ts

import { Injectable, signal } from '@angular/core'
import { SelectionContext } from './selection/selection-context.model'


@Injectable({ providedIn: 'root' })
export class HypercombState {

  private static readonly DEFAULT_LINEAGE = 'hypercomb'

  // ─────────────────────────────────────────────
  // lineage / hive
  // ─────────────────────────────────────────────

  private _lineage = signal<string>(HypercombState.DEFAULT_LINEAGE)
  public readonly lineage = this._lineage.asReadonly()

  private _hive = signal<string | null>(null)
  public readonly hive = this._hive.asReadonly()

  // ─────────────────────────────────────────────
  // selection (multi, visual, durable)
  // ─────────────────────────────────────────────

  private _selection = signal<SelectionContext | null>(null)
  public readonly selection = this._selection.asReadonly()

  // ─────────────────────────────────────────────
  // viewing modes
  // ─────────────────────────────────────────────

  public readonly viewing = {
    clipboard: signal(false),
    googleDocument: signal(false),
    help: signal(false),
    preferences: signal(false)
  }

  // ─────────────────────────────────────────────
  // mutators
  // ─────────────────────────────────────────────

  public setLineage(value: string): void {
    this._lineage.set(value)
  }

  public setHive(value: string | null): void {
    this._hive.set(value)
  }

  public setSelection(value: SelectionContext | null): void {
    this._selection.set(value)
  }

  public clearSelection(): void {
    this._selection.set(null)
  }
}
