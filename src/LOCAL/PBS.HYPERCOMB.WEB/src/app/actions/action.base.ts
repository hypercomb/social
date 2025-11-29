// action-base.ts
import { inject, Signal } from "@angular/core"
import { Action } from "./action-models"
import { CoordinateDetector } from "../helper/detection/coordinate-detector"
import { ContextStack } from "../core/controller/context-stack"
import { Cell } from "../cells/cell"
import { HypercombState } from "../state/core/hypercomb-state"
import { PolicyService } from "../navigation/menus/policy-service"
import { PointerState } from "../state/input/pointer-state"
import { ACTION_REGISTRY, CONTEXT_MENU } from "../shared/tokens/i-hypercomb.token"
import { HONEYCOMB_STORE } from "../shared/tokens/i-comb-store.token"
import { MODIFY_COMB_SVC } from "../shared/tokens/i-comb-service.token"
import { HIVE_STORE } from "../shared/tokens/i-hive-store.token"
import { ImageService } from "../database/images/image-service"
import { DebugService } from "../core/diagnostics/debug-service"
import { LinkNavigationService } from "../navigation/link-navigation-service"

export abstract class ActionBase<TPayload = unknown> implements Action<TPayload> {
  protected readonly debug = inject(DebugService)
  protected readonly menu = inject(CONTEXT_MENU)
  protected readonly registry = inject(ACTION_REGISTRY)
  protected readonly detector = inject(CoordinateDetector)
  protected readonly stack = inject(ContextStack)
  protected readonly combstore = inject(HONEYCOMB_STORE)
  protected readonly hivestore = inject(HIVE_STORE)
  protected readonly modify = inject(MODIFY_COMB_SVC)
  protected readonly policy = inject(PolicyService)
  protected readonly ps = inject(PointerState)
  protected readonly state = inject(HypercombState)
  protected readonly images = inject(ImageService)
  protected readonly navigation = inject(LinkNavigationService)

  protected combCell: Cell | undefined = undefined
  protected focused: Cell | undefined = undefined

  public abstract id: string
  public abstract run: (payload: TPayload) => Promise<void>

  constructor() {
    // delay to let DI resolve fully
    queueMicrotask(() => this.registry.register(this))
  }

  label?: string
  category?: string
  description?: string
  risk?: "none" | "danger" | "warning"

  /**
   * Override if your action needs to control availability.
   * Default = always enabled.
   */
  public enabled?:
    | boolean
    | Signal<boolean>
    | ((payload: TPayload) => boolean | Promise<boolean>) = true

  /**
 * Called automatically by ActionRegistry before enabled/run
 * so actions have a fresh snapshot of hover + hive context.
 */
  public snapshot(): void {
    // the "active" cell from the stack
    this.combCell = this.stack.cell() ?? undefined

    // the "hovered" tile from detector, converted to a real Cell
    const tile = this.detector.activeTile() ?? undefined
    if (tile) {
      this.focused = this.combstore.lookupData(tile.cellId!) ?? undefined
    }
  }
}
