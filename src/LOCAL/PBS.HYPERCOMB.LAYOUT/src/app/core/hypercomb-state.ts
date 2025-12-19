// src/app/core/hypercomb-state.ts

import { Injectable, signal } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class HypercombState {
  private static readonly DEFAULT_LINEAGE = 'hypercomb'
  private _lineage = signal<string>(HypercombState.DEFAULT_LINEAGE)
  public readonly lineage = this._lineage.asReadonly()

  private _hive = signal<string | null>(null)
  public readonly hive = this._hive.asReadonly()

  public readonly viewing = {
    clipboard: signal(false),
    googleDocument: signal(false),
    help: signal(false),
    preferences: signal(false)
  }

  public setLineage(value: string): void {
    this._lineage.set(value)
  }

  public setHive(value: string | null): void {
    this._hive.set(value)
  }
}
