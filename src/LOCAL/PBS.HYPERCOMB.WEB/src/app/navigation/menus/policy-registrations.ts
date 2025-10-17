// core-wiring.service.ts

import { Injectable, inject, computed } from "@angular/core"
import { HypercombMode, POLICY } from "src/app/core/models/enumerations"
import { ServiceBase } from "src/app/core/mixins/abstraction/service-base"
import { EditorService } from "src/app/state/interactivity/editor-service"
import { ContextMenuService } from "./context-menu-service"

@Injectable({ providedIn: 'root' })
export class PolicyRegistrations extends ServiceBase {
  private readonly es = inject(EditorService)
  private readonly contextmenu = inject(ContextMenuService)
  public initialize = () => {
    // viewing clipboard
    const isViewingClipboard = computed(
      () => (this.state.mode() & HypercombMode.ViewingClipboard) !== 0
    )
    this.policy.registerSignal(POLICY.ViewingClipboard, isViewingClipboard, this.injector)

    // moving tiles
    const isMoveMode = computed(
      () => (this.state.mode() & HypercombMode.Move) !== 0
    )
    this.policy.registerSignal(POLICY.MovingTiles, isMoveMode, this.injector)

    // keyboard blocked
    const isKeyboardBlocked = computed(
      () => (this.state.mode() & HypercombMode.KeyboardBlockedCommands) !== 0
    )
    this.policy.registerSignal(POLICY.KeyboardBlocked, isKeyboardBlocked, this.injector)

    // edit in progress (direct from editor state signal)
    this.policy.registerSignal(POLICY.EditInProgress, this.es.isEditing, this.injector)

    // normal mode
    const isNormalMode = computed(
      () => (this.state.mode() & HypercombMode.Normal) === 0
    )
    this.policy.registerSignal(POLICY.NormalMode, isNormalMode, this.injector)

    // shift not pressed
    const shiftNotPressed = computed(() => !this.ks.shift())
    this.policy.registerSignal(POLICY.ShiftNotPressed, shiftNotPressed, this.injector)

    // control key
    const controlDown = computed(() => this.ks.ctrl()) // ensure this.ks.ctrl is a signal
    this.policy.registerSignal(POLICY.ControlDown, controlDown, this.injector)

    // no active tile (fix inversion)
    const noActiveTile = computed(() => !this.stack.cell())
    this.policy.registerSignal(POLICY.NoActiveTile, noActiveTile, this.injector)


    // showing context menu
    const isContextMenuVisible = computed(() => this.contextmenu.isVisible())
    this.policy.registerSignal(POLICY.ShowingContextMenu, isContextMenuVisible, this.injector)
  
    // Register CommbandModeActive policy: true if any command mode is active
    this.policy.registerSignal(
      POLICY.CommbandModeActive,
      computed(() => (this.state.mode() & HypercombMode.CommandModes) !== 0),
      this.injector
    )
  }
}


