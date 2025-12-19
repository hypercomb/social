// src/app/state/core/hypercomb-state.ts

import { Injectable, computed, inject, signal } from '@angular/core'
import { HiveScout } from 'src/app/hive/hive-scout'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { ParentContext } from 'src/app/core/controller/context-stack'

@Injectable({ providedIn: 'root' })
export class HypercombState {

  // ─────────────────────────────────────────────
  // core signals
  // ─────────────────────────────────────────────

  private _mode = signal<HypercombMode>(HypercombMode.Normal)
  public readonly mode = this._mode.asReadonly()

  private _lastChangedMode = signal<HypercombMode>(HypercombMode.Normal)
  public readonly lastChangedMode = this._lastChangedMode.asReadonly()

  private _lastRemovedMode = signal<HypercombMode | undefined>(undefined)
  public readonly lastRemovedMode = this._lastRemovedMode.asReadonly()

  private _lastResetMode = signal<HypercombMode | undefined>(undefined)
  public readonly lastResetMode = this._lastResetMode.asReadonly()

  private _lastSetMode = signal<HypercombMode | undefined>(undefined)
  public readonly lastSetMode = this._lastSetMode.asReadonly()

  // ─────────────────────────────────────────────
  // viewing state (presentation only)
  // ─────────────────────────────────────────────

  public readonly viewing = {
    clipboard: signal(false),
    googleDocument: signal(false),
    help: signal(false),
    preferences: signal(false)
  }

  // ─────────────────────────────────────────────
  // structural state
  // ─────────────────────────────────────────────

  private _hive = signal<string | null>(null)
  public readonly hive = this._hive.asReadonly()

  private _lineage = signal<string>('Hypercomb')
  public readonly lineage = this._lineage.asReadonly()

  private _hasCells = signal(false)
  public readonly hasCells = this._hasCells.asReadonly()

  private _emptyHoneycomb = signal(false)
  public readonly emptyHoneycomb = this._emptyHoneycomb.asReadonly()

  private _scout = signal<HiveScout | null>(null)
  public readonly scout = this._scout.asReadonly()

  // ─────────────────────────────────────────────
  // misc / lifecycle
  // ─────────────────────────────────────────────

  private _batchCompleteSeq = signal(0)
  public readonly batchCompleteSeq = this._batchCompleteSeq.asReadonly()

  private _cancelled = signal(false)
  public readonly cancelled = this._cancelled.asReadonly()

  private _isContextActive = signal(false)
  public readonly isContextActive = this._isContextActive.asReadonly()

  private _log = signal('')
  public readonly logOutput = this._log.asReadonly()

  // ─────────────────────────────────────────────
  // plain fields (ephemeral, non-reactive)
  // ─────────────────────────────────────────────

  public awake = false
  public isAuthenticated = false
  public isBuildMode = true
  public loading = false
  public panning = false
  public username = ''
  public uniqueIdentifier = Date.now().toString()

  // ─────────────────────────────────────────────
  // dependencies
  // ─────────────────────────────────────────────

  private readonly stack = inject(ParentContext)

  // ─────────────────────────────────────────────
  // computed (intent)
  // ─────────────────────────────────────────────

  public readonly isCommandMode = computed(() =>
    (this.mode() & HypercombMode.CommandModes) !== 0
  )

  public readonly isEditMode = computed(() =>
    (this.mode() & HypercombMode.EditMode) !== 0
  )
  public ignoreShortcuts: boolean = false

  // ─────────────────────────────────────────────
  // intent getters (tools only)
  // ─────────────────────────────────────────────

  public get isSelectMode() { return this.hasMode(HypercombMode.Select) }
  public get isMoveMode() { return this.hasMode(HypercombMode.Move) }
  public get isEditTool() { return this.hasMode(HypercombMode.EditMode) }
  public get isCutMode() { return this.hasMode(HypercombMode.Cut) }
  public get isCopyMode() { return this.hasMode(HypercombMode.Copy) }
  public get isHiveCreation() { return this.hasMode(HypercombMode.HiveCreation) }
  public get isEditingCaption() { return this.hasMode(HypercombMode.EditingCaption) }
  public get isTransport() { return this.hasMode(HypercombMode.Transport) }

  // ─────────────────────────────────────────────
  // viewing getters (presentation)
  // ─────────────────────────────────────────────

  public get isViewingClipboard() {
    return this.viewing.clipboard()
  }

  public get isViewingGoogleDocument() {
    return this.viewing.googleDocument()
  }

  public get isViewHelp() {
    return this.viewing.help()
  }

  public get isShowPreferences() {
    return this.viewing.preferences()
  }

  // ─────────────────────────────────────────────
  // mobile detection
  // ─────────────────────────────────────────────

  public get isMobile(): boolean {
    const ua = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    const small = window.innerWidth <= 768
    return ua || (touch && small)
  }

  // ─────────────────────────────────────────────
  // mode mutation (intent only)
  // ─────────────────────────────────────────────

  public hasMode(mode: HypercombMode): boolean {
    return (this.mode() & mode) === mode
  }

  public setMode(mode: HypercombMode): void {
    const prev = this._mode()
    const next = prev | mode
    if (next !== prev) {
      this._mode.set(next)
      this._lastSetMode.set(mode)
      this._lastChangedMode.set(next)
    }
  }

  public removeMode(mode: HypercombMode): void {
    const prev = this._mode()
    const next = prev & ~mode
    if (next !== prev) {
      this._mode.set(next)
      this._lastRemovedMode.set(mode)
      this._lastChangedMode.set(next)
    }
  }

  public resetMode(): void {
    const next = HypercombMode.Normal
    this._mode.set(next)
    this._lastResetMode.set(next)
    this._lastChangedMode.set(next)
  }

  public setToolMode(mode: HypercombMode): void {
    this.removeMode(HypercombMode.Copy)
    this.removeMode(HypercombMode.Cut)
    this.removeMode(HypercombMode.EditMode)
    this.removeMode(HypercombMode.Move)
    this.removeMode(HypercombMode.Select)
    this.setMode(mode)
  }

  public toggle(mode: HypercombMode): void {
    this.hasMode(mode) ? this.removeMode(mode) : this.setMode(mode)
  }

  public toggleToolMode(mode: HypercombMode): void {
    this.hasMode(mode) ? this.removeMode(mode) : this.setToolMode(mode)
  }

  // ─────────────────────────────────────────────
  // viewing mutation
  // ─────────────────────────────────────────────

  public openClipboard(): void {
    this.viewing.clipboard.set(true)
  }

  public closeClipboard(): void {
    this.viewing.clipboard.set(false)
  }

  public openGoogleDocument(): void {
    this.viewing.googleDocument.set(true)
  }

  public closeGoogleDocument(): void {
    this.viewing.googleDocument.set(false)
  }

  public clearViewing(): void {
    this.viewing.clipboard.set(false)
    this.viewing.googleDocument.set(false)
    this.viewing.help.set(false)
    this.viewing.preferences.set(false)
  }

  // ─────────────────────────────────────────────
  // misc setters
  // ─────────────────────────────────────────────

  public setHive(value: string | null): void {
    this._hive.set(value)
  }

  public setHasCells(value: boolean): void {
    this._hasCells.set(value)
  }

  public setHoneycombStatus(value: boolean): void {
    this._emptyHoneycomb.set(value)
  }

  public setScout(value: HiveScout): void {
    this._scout.set(value)
  }

  public setCancelled(value: boolean): void {
    this._cancelled.set(value)
  }

  public setContextActive(value: boolean): void {
    this._isContextActive.set(value)
  }

  public setBatchComplete(): void {
    this._batchCompleteSeq.update(v => v + 1)
  }

  public log(value: string): void {
    this._log.set(value)
  }
}
