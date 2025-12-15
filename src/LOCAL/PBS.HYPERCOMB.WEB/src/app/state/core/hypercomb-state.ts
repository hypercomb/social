import { Injectable, Signal, computed, inject, signal } from "@angular/core"
import { Cell } from "src/app/models/cell"
import { HiveScout } from "src/app/hive/hive-scout"
import { HypercombMode } from "src/app/core/models/enumerations"

@Injectable({ providedIn: "root" })
export class HypercombState {

  // ─────────────────────────────────────────────
  // event handlers and subjects (public → alphabetized)
  // ─────────────────────────────────────────────
  public awake = false
  public checkMouseLock = false
  public controlsHovered: any
  public debugJson: any = undefined
  public hiveUser: any
  public ignoreShortcuts: any
  public isAuthenticated = false
  public isBuildMode = true
  public loading = false
  public panning = false
  public uniqueIdentifier = new Date().getTime().toString()
  public username = ""

  private _batchCompleteSeq = signal(0)
  public readonly batchCompleteSeq = this._batchCompleteSeq.asReadonly()

  private _cancelled = signal(false)
  public readonly cancelled = this._cancelled.asReadonly()

  private _emptyHoneycomb = signal(false)
  public readonly emptyHoneycomb = this._emptyHoneycomb.asReadonly()

  private _hive = signal<string | null>(null)
  public readonly hive = this._hive.asReadonly()

  private _isContextActive = signal(false)
  public readonly isContextActive = this._isContextActive.asReadonly()

  public readonly isLocked = computed(() => { 
    // !!(this.stack.top() && this.stack.top()?.cell?.isLocked)
    throw new Error("replace with actual cell reference source of truth")
  })

  private _lastChangedMode = signal<HypercombMode>(HypercombMode.Normal)
  public readonly lastChangedMode = this._lastChangedMode.asReadonly()

  private _lastRemovedMode = signal<HypercombMode | undefined>(undefined)
  public readonly lastRemovedMode = this._lastRemovedMode.asReadonly()

  private _lastResetMode = signal<HypercombMode | undefined>(undefined)
  public readonly lastResetMode = this._lastResetMode.asReadonly()

  private _lastSetMode = signal<HypercombMode | undefined>(undefined)
  public readonly lastSetMode = this._lastSetMode.asReadonly()

  private _log = signal("")
  public readonly logOutput = this._log.asReadonly()

  private _mode = signal<HypercombMode>(HypercombMode.Normal)
  public readonly mode = this._mode.asReadonly()

  public readonly modes = signal<Set<HypercombMode>>(new Set())

  private _scout = signal<HiveScout | null>(null)
  public readonly scout = this._scout.asReadonly()

  public readonly startupHive = signal<string | undefined>(undefined)


  // ─────────────────────────────────────────────
  // private fields (alphabetized)
  // ─────────────────────────────────────────────
  private readonly _modeSignals: Record<ModeName, () => boolean>
  private readonly stack = inject(ContextStack)


  public get scoutName() {
  return this.scout()?.name
}


// ─────────────────────────────────────────────
// constructor
// ─────────────────────────────────────────────
constructor() {
  this._modeSignals = {} as any
  this.initializeModeSignals()
}


  // ─────────────────────────────────────────────
  // initialization methods
  // ─────────────────────────────────────────────
  private initializeModeSignals() {
  for (const key of Object.keys(MODE_MAP) as ModeName[]) {
    if (key === "isChatWindowMode") {
      this._modeSignals[key] = computed(
        () => this.hasMode(HypercombMode.ShowChat) && !this.isMobile
      )
    } else {
      const flag = MODE_MAP[key]
      this._modeSignals[key] = computed(() => this.hasMode(flag))
    }

    Object.defineProperty(this, key, {
      get: () => this._modeSignals[key](),
      enumerable: true,
      configurable: false
    })
  }
}


  // ─────────────────────────────────────────────
  // methods (alphabetized)
  // ─────────────────────────────────────────────
  public cacheId(cell: Cell) {
  return `${this.scout()?.name}-${cell.gene}`
}

  public clearToolMode() {
  this.setToolMode(HypercombMode.Normal)
}

  public hasMode(mode: HypercombMode) {
  return (this.mode() & mode) === mode
}

  public log(output: string) {
  this._log.set(output)
}

  public removeMode(mode: HypercombMode) {
  const prev = this._mode()
  const next = prev & ~mode
  if (next !== prev) {
    this._mode.set(next)
    this._lastRemovedMode.set(mode)
    this._lastChangedMode.set(next)
  }
}

  public resetMode() {
  const next = HypercombMode.Normal
  this._mode.set(next)
  this._lastResetMode.set(next)
  this._lastChangedMode.set(next)
}

  public setBatchComplete() {
  this._batchCompleteSeq.update(v => v + 1)
}

  public setCancelled(cancel: boolean) {
  this._cancelled.set(cancel)
}

  public setContextActive(active: boolean) {
  this._isContextActive.set(active)
}

  public setHive(name: string | null) {
  this._hive.set(name)
}

  public setHoneycombStatus(status: boolean) {
  this._emptyHoneycomb.set(status)
}

  public setMode(mode: HypercombMode) {
  const prev = this._mode()
  const next = prev | mode
  if (next !== prev) {
    this._mode.set(next)
    this._lastSetMode.set(mode)
    this._lastChangedMode.set(next)
  }
}

  public setScout(scout: HiveScout) {
  this._scout.set(scout)
}

  public setToolMode(mode: HypercombMode) {
  this.removeMode(HypercombMode.Copy)
  this.removeMode(HypercombMode.Cut)
  this.removeMode(HypercombMode.EditMode)
  this.removeMode(HypercombMode.Move)
  this.removeMode(HypercombMode.Select)
  this.removeMode(HypercombMode.ShowChat)
  this.removeMode(HypercombMode.Transport)
  this.removeMode(HypercombMode.ViewHelp)
  this.removeMode(HypercombMode.ShowPreferences)
  this.removeMode(HypercombMode.ViewingClipboard)
  this.setMode(mode)
}

  public toggle(mode: HypercombMode) {
  this.hasMode(mode) ? this.removeMode(mode) : this.setMode(mode)
}

  public toggleToolMode(mode: HypercombMode) {
  this.hasMode(mode) ? this.removeMode(mode) : this.setToolMode(mode)
}

  // ─────────────────────────────────────────────
  // getter functions (alphabetized)
  // ─────────────────────────────────────────────
  public get isAiPrompt() {
  return this._modeSignals.isAiPrompt()
}

  public readonly isCommandMode = computed(() =>
  (this.mode() & HypercombMode.CommandModes) !== 0
)

  public readonly isEditMode = computed(() =>
  (this._mode() & HypercombMode.EditMode) !== 0
)

  public get isChatWindowMode() {
  return this._modeSignals.isChatWindowMode()
}

  public get isChoosingEditContext() {
  return this._modeSignals.isChoosingEditContext()
}

  public get isCollaboration() {
  return this._modeSignals.isCollaboration()
}

  public get isCopyMode() {
  return this._modeSignals.isCopyMode()
}

  public get isCutMode() {
  return this._modeSignals.isCutMode()
}

  public get isEditingCaption() {
  return this._modeSignals.isEditingCaption()
}


  public get isHiveCreation() {
  return this._modeSignals.isHiveCreation()
}


  public get isMobile() {
  const ua = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  const small = window.innerWidth <= 768
  return ua || (touch && small)
}
  


  public get isMoveMode() {
  return this._modeSignals.isMoveMode()
}

  public get isNormal() {
  return this._modeSignals.isNormal()
}

  public get isSelectMode() {
  return this._modeSignals.isSelectMode()
}

  public get isShowPreferences() {
  return this._modeSignals.isShowPreferences()
}

  public get isTransport() {
  return this._modeSignals.isTransport()
}

  public get isViewHelp() {
  return this._modeSignals.isViewHelp()
}

  public get isViewingClipboard() {
  return this._modeSignals.isViewingClipboard()
}

  public get isViewingGoogleDocument() {
  return this._modeSignals.isViewingGoogleDocument()
}


}

const MODE_MAP = {
  isAiPrompt: HypercombMode.AiPrompt,
  isChatWindowMode: HypercombMode.ShowChat,
  isChoosingEditContext: HypercombMode.EditMode,
  isCollaboration: HypercombMode.Collaboration,
  isCopyMode: HypercombMode.Copy,
  isCutMode: HypercombMode.Cut,
  isEditingCaption: HypercombMode.EditingCaption,
  isHiveCreation: HypercombMode.HiveCreation,
  isMoveMode: HypercombMode.Move,
  isNormal: HypercombMode.Normal,
  isSelectMode: HypercombMode.Select,
  isShowPreferences: HypercombMode.ShowPreferences,
  isTransport: HypercombMode.Transport,
  isViewHelp: HypercombMode.ViewHelp,
  isViewingClipboard: HypercombMode.ViewingClipboard,
  isViewingGoogleDocument: HypercombMode.ViewingGoogleDocument
} as const

type ModeName = keyof typeof MODE_MAP
