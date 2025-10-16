import { signal, isDevMode } from '@angular/core'
import { CellOptions } from './cell-options'

export abstract class CellFlags {
  public options = signal(CellOptions.Active)

  // ── one-time warning helper per property
  private _warned: Record<string, boolean> = {}
  private warnOnce = (prop: string) => {
    if (!isDevMode()) return
    if (this._warned[prop]) return
    this._warned[prop] = true
    // use your debug logger if you prefer
    console.warn(`[CellFlags] ignored external write to '${prop}'. flags are derived from 'options'.`)
  }

  // ── getters (unchanged)
  get isActive(): boolean { return (this.options() & CellOptions.Active) !== 0 }
  get isBranch(): boolean { return (this.options() & CellOptions.Branch) !== 0 }
  get isDeleted(): boolean { return (this.options() & CellOptions.Deleted) !== 0 }
  get isHidden(): boolean { return (this.options() & CellOptions.Hidden) !== 0 }
  get ignoreBackground(): boolean { return (this.options() & CellOptions.IgnoreBackground) !== 0 }
  get isSelected(): boolean { return (this.options() & CellOptions.Selected) !== 0 }
  get isFocusedMode(): boolean { return (this.options() & CellOptions.FocusedMode) !== 0 }
  get isLocked(): boolean { return (this.options() & CellOptions.Locked) !== 0 }
  get hasNoImage(): boolean { return (this.options() & CellOptions.NoImage) !== 0 }
  get isNew(): boolean { return (this.options() & CellOptions.New) !== 0 }

  // ── empty setters (no-op) to avoid assignment errors from Object.assign
  set isActive(_: boolean) { this.warnOnce('isActive') }
  set isBranch(_: boolean) { this.warnOnce('isBranch') }
  set isDeleted(_: boolean) { this.warnOnce('isDeleted') }
  set isHidden(_: boolean) { this.warnOnce('isHidden') }
  set ignoreBackground(_: boolean) { this.warnOnce('ignoreBackground') }
  set isSelected(_: boolean) { this.warnOnce('isSelected') }
  set isFocusedMode(_: boolean) { this.warnOnce('isFocusedMode') }
  set isLocked(_: boolean) { this.warnOnce('isLocked') }
  set hasNoImage(_: boolean) { this.warnOnce('hasNoImage') }
  set isNew(_: boolean) { this.warnOnce('isNew') }
}
