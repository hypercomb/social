import { Injectable, signal, computed, inject } from "@angular/core"
import { Point } from "pixi.js"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base"
import { LinkNavigationService } from "src/app/navigation/link-navigation-service"
import { PointerState } from "src/app/state/input/pointer-state"
import { EventDispatcher } from "../helper/events/event-dispatcher"
import { LayoutManager } from "../core/controller/layout-manager"
import { KeyboardService } from "../interactivity/keyboard/keyboard-service"
import { SELECTIONS } from "../shared/tokens/i-selection.token"

@Injectable()
export abstract class PanningServiceBase extends PixiDataServiceBase {
    protected readonly keyboard = inject(KeyboardService)
    protected readonly ps = inject(PointerState)
    protected readonly events = inject(EventDispatcher)
    protected readonly manager = inject(LayoutManager)
    protected readonly navigation = inject(LinkNavigationService)
    protected readonly selections = inject(SELECTIONS)


    protected readonly enabled = signal(true)
    public readonly isEnabled = this.enabled.asReadonly()

    protected readonly _cancelled = signal(false)
    public readonly cancelled = this._cancelled.asReadonly()
    protected anchored = false
    protected crossed = false

    // 🔹 new: activity tracking
    protected readonly _active = signal(false)
    public readonly active = this._active.asReadonly()
    protected setActive = (value: boolean): void => this._active.set(value)

    protected readonly focused = (() => {
        const s = signal<boolean>(document.hasFocus())
        const on = () => s.set(true)
        const off = () => s.set(false)
        window.addEventListener("focus", on)
        window.addEventListener("blur", off)
        return s.asReadonly()
    })()

    public enable = (): void => this.enabled.set(true)
    public disable = (): void => {
        this.enabled.set(false)
        this.navigation.setResetTimeout()
    }

    protected domToGlobal(e: PointerEvent): Point {
        const app = this.pixi.app!
        const view = app.canvas as HTMLCanvasElement
        const rect = view.getBoundingClientRect()
        const x = (e.clientX - rect.left) * app.renderer.resolution
        const y = (e.clientY - rect.top) * app.renderer.resolution
        return new Point(x, y)
    }

    protected canvasCenterGlobal(): Point {
        const app = this.pixi.app!
        const view = app.canvas as HTMLCanvasElement
        return new Point(view.width * 0.5, view.height * 0.5)
    }

    protected clearAnchor(): void {
        this.anchored = false
        this.crossed = false
        this._cancelled.set(false)
        this.setActive(false)
    }

    protected safeInit(): void {
        const container = this.pixi.container
        if (!container) {
            this.debug.log?.("warning", "panning: no container yet")
            return
        }
        container.eventMode = "static"
        container.hitArea ??= { contains: () => true }
        const canvas = this.pixi.app?.canvas as HTMLCanvasElement
        canvas.style.touchAction = "none"
        canvas.style.userSelect = "none"
    }
}
