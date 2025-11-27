// src/app/state/input/pointer-state.ts (Fixed: only remove individual pointer on up/cancel)
import { Injectable, signal, computed, effect } from "@angular/core"
import { Point, Container } from "pixi.js"

@Injectable({ providedIn: "root" })
export class PointerState {
    // raw event signals
    public readonly pointerDownEvent = signal<PointerEvent | null>(null)
    public readonly pointerUpEvent = signal<PointerEvent | null>(null)
    public readonly pointerMoveEvent = signal<PointerEvent | null>(null)
    public readonly pointerCancelEvent = signal<PointerEvent | null>(null)

    // detection
    private readonly _detectSeq = signal(0)
    public readonly detectSeq = this._detectSeq.asReadonly()
    public triggerDetect(): void {
        this._detectSeq.update(v => v + 1)
    }

    // sequence counters
    public readonly downSeq = signal(0)
    public readonly upSeq = signal(0)
    public readonly moveSeq = signal(0)
    public readonly cancelSeq = signal(0)

    public readonly pointerPositions = signal<Map<number, { x: number; y: number }>>(new Map())

    // position signals
    public readonly position = signal(new Point(0, 0)) // raw clientX/Y
    public readonly localPosition = signal(new Point(0, 0)) // local to container
    public readonly resolution = signal<number>(1)

    private readonly _currentMouse = signal(new Point(0, 0))
    public readonly currentMouse = this._currentMouse.asReadonly()

    // state signals
    private readonly _dragOver = signal(false)
    public readonly dragOver = this._dragOver.asReadonly()
    private readonly _activePointers = signal<Set<number>>(new Set())
    public readonly activePointers = this._activePointers.asReadonly()

    public readonly leftButtonDown = computed(() => {
        const ev = this.pointerDownEvent()
        return !!ev && ev.button === 0
    })
    public readonly rightButtonDown = computed(() => {
        const ev = this.pointerDownEvent()
        return !!ev && ev.button === 2
    })


    private initialized = false
    private readonly _container = signal<Container | null>(null)
    public readonly container = this._container.asReadonly()

    private canvasRef: HTMLCanvasElement | null = null
    private scrollUpdateHandler: (() => void) | null = null

    public initialize(canvas: HTMLCanvasElement) {
        if (this.initialized) return
        this.canvasRef = canvas
        this.initialized = true

        canvas.addEventListener("pointerdown", this.handlePointerDown)
        canvas.addEventListener("pointerup", this.handlePointerUp)
        canvas.addEventListener("pointercancel", this.handlePointerCancel)
        canvas.addEventListener("pointermove", this.handlePointerMove)
        canvas.addEventListener("pointerenter", this.handlePointerEnter)
        canvas.addEventListener("pointerleave", this.handlePointerLeave)
        window.addEventListener("blur", this.handleWindowBlur)
        this.scrollUpdateHandler = () => this.refreshOnScroll()
        window.addEventListener('scroll', this.scrollUpdateHandler, { passive: true })
    }

    public getLocalPosition(globalPoint?: Point): Point {
        const g = globalPoint ?? this.position()
        const c = this.container()
        if (!c || !this.canvasRef) return new Point(0, 0)
        const rect = this.canvasRef.getBoundingClientRect()
        const res = this.resolution()
        const canvasX = (g.x - rect.left) * res
        const canvasY = (g.y - rect.top) * res
        const out = new Point()
        c.worldTransform.applyInverse(new Point(canvasX, canvasY), out)
        return out
    }

    private handlePointerDown = (e: PointerEvent) => {
        (e.target as Element | null)?.setPointerCapture?.(e.pointerId)
        this.updatePointerPositions(e.pointerId, e.clientX, e.clientY)
        this.updateActivePointers(s => {
            const next = new Set(s)
            next.add(e.pointerId)
            return next
        })
        this.updateRawPosition(e)
        this.triggerDetect()
        this.pointerDownEvent.set(e)
        this.downSeq.update(v => v + 1)

        if (e.pointerType === 'touch') {
            this._dragOver.set(true)
            console.debug('[PointerState] Touch pointerDown: dragOver forced true')
        }
    }

    private handlePointerMove = (e: PointerEvent) => {
        this.updatePointerPositions(e.pointerId, e.clientX, e.clientY)
        this.pointerMoveEvent.set(e)
        this.moveSeq.update(v => v + 1)
        this.updateRawPosition(e)
        this.localPosition.set(this.getLocalPosition())
        this._currentMouse.set(new Point(e.clientX, e.clientY))

        if (e.pointerType === 'touch') {
            this._dragOver.set(true)
            console.debug('[PointerState] Touch pointerMove: dragOver forced true')
        }
    }

    private updateRawPosition(e: PointerEvent): void {
        this.position.set(new Point(e.clientX, e.clientY))
    }

    private handlePointerUp = (e: PointerEvent) => {
        this.releaseCapture(e)
        this.updateRawPosition(e)

        this.updateActivePointers(s => {
            const next = new Set(s)
            next.delete(e.pointerId)
            return next
        })

        this.updatePointerPositions(e.pointerId, undefined)
        this.pointerUpEvent.set(e)
        this.upSeq.update(v => v + 1)

        // Only clear dragOver when NO touches remain
        if (e.pointerType === 'touch' && this.activePointers().size === 0) {
            this._dragOver.set(false)
            console.debug('[PointerState] Touch pointerUp: all fingers up → dragOver false')
        }
    }

    private handlePointerCancel = (e: PointerEvent) => {
        this.releaseCapture(e)

        this.updateActivePointers(s => {
            const next = new Set(s)
            next.delete(e.pointerId)
            return next
        })

        this.pointerCancelEvent.set(e)
        this.cancelSeq.update(v => v + 1)

        if (e.pointerType === 'touch' && this.activePointers().size === 0) {
            this._dragOver.set(false)
            console.debug('[PointerState] Touch pointerCancel: all fingers up → dragOver false')
        }
    }

    private handlePointerEnter = () => this._dragOver.set(true)
    private handlePointerLeave = () => this._dragOver.set(false)

    private handleWindowBlur = () => {
        this.pointerDownEvent.set(null)
        this.pointerMoveEvent.set(null)
        this.pointerUpEvent.set(null)
        this.pointerCancelEvent.set(
            new PointerEvent("pointercancel", { pointerId: 1, button: 0, buttons: 0, clientX: 0, clientY: 0 })
        )
        this._activePointers.set(new Set())
    }

    private refreshOnScroll(): void {
        if (!this.canvasRef) return
        this.localPosition.set(this.getLocalPosition())
    }

    public onClick(handler: (e: PointerEvent) => void) {
        effect(() => {
            const e = this.pointerUpEvent()
            if (e && e.button === 0) handler(e)
        })
    }

    public onHover(handler: (e: PointerEvent) => void) {
        effect(() => {
            const e = this.pointerMoveEvent()
            if (e) handler(e)
        })
    }

    public onMove(handler: (e: PointerEvent) => void) {
        effect(() => {
            const e = this.pointerMoveEvent()
            if (e) handler(e)
        })
    }

    public onUp(cb: (e: PointerEvent) => void) {
        effect(() => {
            if (this.upSeq() === 0) return
            const e = this.pointerUpEvent()
            if (e) cb(e)
        })
    }

    public refresh = async (): Promise<void> => {
        this.refreshLocal()
    }

    private refreshLocal(): void {
        const location = this.computeLocalFromGlobal() || new Point(0, 0)
        this.localPosition.set(location)
    }

    private releaseCapture(e: PointerEvent, id: number = e.pointerId) {
        const el = e.target as Element | null
        if (el?.hasPointerCapture?.(id)) {
            el.releasePointerCapture(id)
        }
    }

    public computeLocalFromGlobal(globalCSS?: Point): Point | null {
        const gCSS = globalCSS ?? this.position()
        const c = this.container()
        if (!c || !this.canvasRef) return null
        const rect = this.canvasRef.getBoundingClientRect()
        const res = this.resolution()
        const canvasX = (gCSS.x - rect.left) * res
        const canvasY = (gCSS.y - rect.top) * res
        const out = new Point()
        c.worldTransform.applyInverse(new Point(canvasX, canvasY), out)
        return out
    }

    public setContainer(container: Container) {
        this._container.set(container)
        queueMicrotask(() => {
            this.localPosition.set(this.computeLocalFromGlobal() ?? new Point(0, 0))
        })
    }

    private updateActivePointers(mutator: (s: Set<number>) => Set<number>) {
        const current = new Set(this._activePointers())
        const next = mutator(current)
        this._activePointers.set(next)
    }

    private updatePointerPositions(id: number, x?: number, y?: number) {
        const current = new Map(this.pointerPositions())
        if (x !== undefined && y !== undefined) {
            current.set(id, { x, y })
        } else {
            current.delete(id)
        }
        this.pointerPositions.set(current)
    }

    public dispose(canvas: HTMLCanvasElement) {
        canvas.removeEventListener("pointerdown", this.handlePointerDown)
        canvas.removeEventListener("pointerup", this.handlePointerUp)
        canvas.removeEventListener("pointercancel", this.handlePointerCancel)
        canvas.removeEventListener("pointermove", this.handlePointerMove)
        canvas.removeEventListener("pointerenter", this.handlePointerEnter)
        canvas.removeEventListener("pointerleave", this.handlePointerLeave)
        window.removeEventListener("blur", this.handleWindowBlur)
        if (this.scrollUpdateHandler) {
            window.removeEventListener('scroll', this.scrollUpdateHandler)
            this.scrollUpdateHandler = null
        }
        this.canvasRef = null
        this.initialized = false
        this._activePointers.set(new Set())
    }
}