import { Injectable, Signal, computed, inject, signal } from "@angular/core"
import { single } from "rxjs"
import { Cell } from "src/app/cells/cell"
// import { AuthState } from "src/app/auth/auth-state"
import { HypercombMode } from "src/app/core/models/enumerations"
import { HiveScout } from "src/app/hive/hive-scout"
import { ContextStack } from "src/app/core/controller/context-stack"


@Injectable({ providedIn: 'root' })
export class HypercombState {
  private _batchCompleteSeq = signal(0)
  public readonly batchCompleteSeq = this._batchCompleteSeq.asReadonly()

  public setBatchComplete(): void {
    // bump value to always change, triggering dependent effects
    this._batchCompleteSeq.update(v => v + 1)
  }

  private readonly stack = inject(ContextStack)
  public awake = false
  public controlsHovered: any
  public hiveUser: any
  public isBuildMode = true
  public checkMouseLock: boolean = false
  public _cancelled = signal(false)
  public readonly cancelled = this._cancelled.asReadonly()
  public get scoutName(): string | undefined { return this.scout()?.name }
  public get isMobile(): boolean {
    const ua = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    const touchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    const smallScreen = window.innerWidth <= 768
    return ua || (touchCapable && smallScreen)
  }

  public uniqueIdentifier: string = new Date().getTime().toString()

  // public readonly authState = signal<AuthState>({
  //   isAuthenticated: false,
  //   username: '',
  //   userId: ''
  // })

  public isAuthenticated = false
  public loading = false
  public username = ''

  public readonly isLocked = computed(() =>
    !!(this.stack.top() && this.stack.top()?.cell?.isLocked)
  )

  // signals: core state
  private readonly _mode = signal<HypercombMode>(HypercombMode.Normal)
  public readonly mode = this._mode.asReadonly()

  // fire-once trigger for initial hive navigation
  public readonly startupHive = signal<string | undefined>(undefined)

  // log / output
  private readonly _log = signal<string>('')
  public readonly logOutput = this._log.asReadonly()

  // track last mode events
  private readonly _lastSetMode = signal<HypercombMode | undefined>(undefined)
  private readonly _lastRemovedMode = signal<HypercombMode | undefined>(undefined)
  private readonly _lastResetMode = signal<HypercombMode | undefined>(undefined)
  private readonly _lastChangedMode = signal<HypercombMode>(HypercombMode.Normal)

  public readonly lastSetMode = this._lastSetMode.asReadonly()
  public readonly lastRemovedMode = this._lastRemovedMode.asReadonly()
  public readonly lastResetMode = this._lastResetMode.asReadonly()
  public readonly lastChangedMode = this._lastChangedMode.asReadonly()
  private readonly _modeSignals: Record<ModeName, () => boolean>

  private readonly _scout = signal<HiveScout | null>(null)
  public readonly scout = this._scout.asReadonly()


  // debug
  public debugJson: any = undefined

  // derived state
  public readonly modes = signal<Set<HypercombMode>>(new Set())
  public readonly isCommandMode = computed(() => (this.mode() & HypercombMode.CommandModes) !== 0)

  // per-mode convenience getters (kept for template ergonomics)
  // convenience boolean getters for templates
  public get isNormal() { return this._modeSignals.isNormal() }
  public get isHiveCreation() { return this._modeSignals.isHiveCreation() }
  public get isChoosingEditContext() { return this._modeSignals.isChoosingEditContext() }
  public get isChatWindowMode() { return this._modeSignals.isChatWindowMode() }
  public get isCopyMode() { return this._modeSignals.isCopyMode() }
  public get isCutMode() { return this._modeSignals.isCutMode() }
  public get isMoveMode() { return this._modeSignals.isMoveMode() }
  public get isTransport() { return this._modeSignals.isTransport() }
  public get isViewingClipboard() { return this._modeSignals.isViewingClipboard() }
  public get isCollaboration() { return this._modeSignals.isCollaboration() }
  public get isSelectMode() { return this._modeSignals.isSelectMode() }
  public get isShowPreferences() { return this._modeSignals.isShowPreferences() }
  public get isViewHelp() { return this._modeSignals.isViewHelp() }
  public get isAiPrompt() { return this._modeSignals.isAiPrompt() }
  public get isEditingCaption() { return this._modeSignals.isEditingCaption() }
  public get isViewingGoogleDocument() { return this._modeSignals.isViewingGoogleDocument() }


  // check a flag as a computed
  public hasModeSig = (flag: HypercombMode) =>
    computed(() => (this._mode() & flag) !== 0)


  constructor() {
    this._modeSignals = {} as any

    // generate computed signals
    for (const key of Object.keys(MODE_MAP) as ModeName[]) {
      if (key === 'isChatWindowMode') {
        this._modeSignals[key] = computed(
          () => this.hasMode(HypercombMode.ShowChat) && !this.isMobile
        )
      } else {
        const flag = MODE_MAP[key]
        this._modeSignals[key] = computed(() => this.hasMode(flag))
      }

      // dynamically define a template-friendly getter
      Object.defineProperty(this, key, {
        get: () => this._modeSignals[key](),
        enumerable: true,
        configurable: false,
      })
    }
  }


  public log(output: string) {
    this._log.set(output)
  }

  public clearToolMode() {
    this.setToolMode(HypercombMode.Normal)
  }

  public overwriteMode(mode: HypercombMode) {
    this._mode.set(mode)
  }

  public setToolMode(mode: HypercombMode) {
    this.removeMode(HypercombMode.Copy)
    this.removeMode(HypercombMode.Cut)
    this.removeMode(HypercombMode.ChoosingEditContext)
    this.removeMode(HypercombMode.Move)
    this.removeMode(HypercombMode.Select)
    this.removeMode(HypercombMode.ShowChat)
    this.removeMode(HypercombMode.Transport)
    this.removeMode(HypercombMode.ViewHelp)
    this.removeMode(HypercombMode.ShowPreferences)
    this.removeMode(HypercombMode.ViewingClipboard)
    this.setMode(mode)
  }

  public hasMode(mode: HypercombMode): boolean {
    return (this.mode() & mode) === mode
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

  public cancelOperation() {
    this._cancelled.set(true)
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

  public toggle(mode: HypercombMode) {
    this.hasMode(mode) ? this.removeMode(mode) : this.setMode(mode)
  }

  public toggleToolMode(mode: HypercombMode) {
    this.hasMode(mode) ? this.removeMode(mode) : this.setToolMode(mode)
  }



  public cacheId(cell: Cell): string {
    return `${this.scout.name}-${cell.cellId}`
  }
}

const MODE_MAP = {
  isNormal: HypercombMode.Normal,
  isHiveCreation: HypercombMode.HiveCreation,
  isChoosingEditContext: HypercombMode.ChoosingEditContext,
  isChatWindowMode: HypercombMode.ShowChat, // extra condition handled below
  isCopyMode: HypercombMode.Copy,
  isCutMode: HypercombMode.Cut,
  isMoveMode: HypercombMode.Move,
  isTransport: HypercombMode.Transport,
  isViewingClipboard: HypercombMode.ViewingClipboard,
  isCollaboration: HypercombMode.Collaboration,
  isSelectMode: HypercombMode.Select,
  isShowPreferences: HypercombMode.ShowPreferences,
  isViewHelp: HypercombMode.ViewHelp,
  isAiPrompt: HypercombMode.AiPrompt,
  isEditingCaption: HypercombMode.EditingCaption,
  isViewingGoogleDocument: HypercombMode.ViewingGoogleDocument,
} as const
type ModeName = keyof typeof MODE_MAP


