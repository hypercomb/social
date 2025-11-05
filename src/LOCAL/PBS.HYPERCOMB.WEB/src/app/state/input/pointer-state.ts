// src/app/state/input/pointer-state.ts (Fixed: subtract rect in getLocalPosition/computeLocalFromGlobal to prevent jump on scroll)
import { Injectable, signal, computed, effect } from "@angular/core"
import { Point, Container } from "pixi.js"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base" // Not injected, just for type if needed; no pixi access here

@Injectable({ providedIn: "root" })
export class PointerState {
    // raw event signals
    public readonly pointerDownEvent = signal<PointerEvent | null>(null)
    public readonly pointerUpEvent = signal<PointerEvent | null>(null)
    public readonly pointerMoveEvent = signal<PointerEvent | null>(null)
    public readonly pointerCancelEvent = signal<PointerEvent | null>(null)

    // in PointerState
    private readonly _detectSeq = signal(0)
    public readonly detectSeq = this._detectSeq.asReadonly()

    public triggerDetect(): void {
        this._detectSeq.update(v => v + 1)
    }

    // sequence counters (edge triggers)
    public readonly downSeq = signal(0)
    public readonly upSeq = signal(0)
    public readonly moveSeq = signal(0)
    public readonly cancelSeq = signal(0)
    public readonly pointerPositions = signal<Map<number, { x: number; y: number }>>(new Map())

    // position signals (raw CSS pixels for global screen; scaled canvas-relative computed on use)
    public readonly position = signal(new Point(0, 0))   // raw clientX/Y (CSS pixels, viewport-relative)
    public readonly localPosition = signal(new Point(0, 0)) // local to container (requires scaling)

    // Resolution signal (set by PanningServiceBase onPixiReady)
    public readonly resolution = signal<number>(1)

    // Current mouse for scroll refresh (raw clientX/Y)
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

    public readonly isDragging = computed(() => {
        const down = this.pointerDownEvent()
        const up = this.pointerUpEvent()
        const move = this.pointerMoveEvent()
        if (!down || down.button !== 0) return false
        if (this.activePointers().size !== 1) return false
        if (up && up.timeStamp > down.timeStamp) return false
        const d = move ? Math.hypot(move.clientX - down.clientX, move.clientY - down.clientY) : 0
        return d >= 3
    })

    private initialized = false
    private readonly _container = signal<Container | null>(null)
    public readonly container = this._container.asReadonly()

    // Refs for scroll/wheel
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

        // was: mouseenter / mouseleave (mouse only) → use pointerenter / pointerleave (mouse + touch + pen)
        canvas.addEventListener("pointerenter", this.handlePointerEnter)
        canvas.addEventListener("pointerleave", this.handlePointerLeave)

        window.addEventListener("blur", this.handleWindowBlur)

        // Wheel prevention during drag
        canvas.addEventListener('wheel', this.handleWheel, { passive: false })

        // Scroll listener for refresh (updates position/local with current mouse and new rect)
        this.scrollUpdateHandler = () => this.refreshOnScroll()
        window.addEventListener('scroll', this.scrollUpdateHandler, { passive: true })
    }

    // still keep utility for ad-hoc local transforms (now subtracts rect for canvas-relative)
    public getLocalPosition(globalPoint?: Point): Point {
        const g = globalPoint ?? this.position()
        const c = this.container()
        if (!c || !this.canvasRef) return new Point(0, 0)
        const rect = this.canvasRef.getBoundingClientRect()
        const res = this.resolution()
        // Convert CSS viewport to canvas-relative renderer coords
        const canvasX = (g.x - rect.left) * res
        const canvasY = (g.y - rect.top) * res
        const out = new Point()
        c.worldTransform.applyInverse(new Point(canvasX, canvasY), out)
        return out
    }

    private handlePointerDown = (e: PointerEvent) => {
        (e.target as Element | null)?.setPointerCapture?.(e.pointerId)
        this.updatePointerPositions(e.pointerId, e.clientX, e.clientY)
        this.updateActivePointers(s => s.add(e.pointerId))

        this.updateRawPosition(e)
        this.triggerDetect()
        this.pointerDownEvent.set(e)
        this.downSeq.update(v => v + 1)
        // Force dragOver for touch
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

        // Update local (now correctly canvas-relative)
        this.localPosition.set(this.getLocalPosition())

        // Update current mouse
        this._currentMouse.set(new Point(e.clientX, e.clientY))

        // Force dragOver for touch
        if (e.pointerType === 'touch') {
            this._dragOver.set(true)
            console.debug('[PointerState] Touch pointerMove: dragOver forced true')
        }
    }

    // Set raw CSS position (no scaling here; scale on use)
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
        // Clear dragOver for touch
        if (e.pointerType === 'touch') {
            this._dragOver.set(false)
            this._activePointers.set(new Set()) // ensure all pointers cleared
            console.debug('[PointerState] Touch pointerUp: dragOver forced false, activePointers cleared')
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
        // Clear dragOver for touch
        if (e.pointerType === 'touch') {
            this._dragOver.set(false)
            this._activePointers.set(new Set()) // ensure all pointers cleared
            console.debug('[PointerState] Touch pointerCancel: dragOver forced false, activePointers cleared')
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

    // Wheel handler to prevent during drag
    private handleWheel = (e: WheelEvent) => {
        if (this.isDragging()) {
            e.preventDefault()
            return false
        }
        return undefined
    }

    // Refresh position/local on scroll using current mouse and updated rect
    private refreshOnScroll(): void {
        if (!this.canvasRef) return
        // Don't mutate position (keep raw clientX/Y)
        // Just refresh localPosition with new rect
        this.localPosition.set(this.getLocalPosition())
    }

    // in PointerState
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
        // Convert CSS viewport to canvas-relative renderer coords
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

    private updateActivePointers(mutator: (s: Set<number>) => void) {
        const current = new Set(this._activePointers())
        mutator(current)
        this._activePointers.set(current)
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

        // keep in sync with initialize
        canvas.removeEventListener("pointerenter", this.handlePointerEnter)
        canvas.removeEventListener("pointerleave", this.handlePointerLeave)

        canvas.removeEventListener('wheel', this.handleWheel)

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