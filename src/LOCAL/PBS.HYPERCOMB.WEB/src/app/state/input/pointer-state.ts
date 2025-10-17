    import { Injectable, signal, computed, effect } from "@angular/core"
    import { Point, Container } from "pixi.js"

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

        // position signals
        public readonly position = signal(new Point(0, 0))   // global screen coords
        public readonly localPosition = signal(new Point(0, 0)) // local to container

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

        public initialize(canvas: HTMLCanvasElement) {
            if (this.initialized) return
            this.initialized = true
            canvas.addEventListener("pointerdown", this.handlePointerDown)
            canvas.addEventListener("pointerup", this.handlePointerUp)
            canvas.addEventListener("pointercancel", this.handlePointerCancel)
            canvas.addEventListener("pointermove", this.handlePointerMove)
            canvas.addEventListener("mouseenter", this.handlePointerEnter)
            canvas.addEventListener("mouseleave", this.handlePointerLeave)
            window.addEventListener("blur", this.handleWindowBlur)
        }

        // still keep utility for ad-hoc local transforms
        public getLocalPosition(globalPoint?: Point): Point {
            const g = globalPoint ?? this.position()
            const out = new Point()
            this.container()!.worldTransform.applyInverse(g, out)
            return out
        }

        private handlePointerDown = (e: PointerEvent) => {
            (   e.target as Element | null)?.setPointerCapture?.(e.pointerId)
            this.updatePointerPositions(e.pointerId, e.clientX, e.clientY)
            this.updateActivePointers(s => s.add(e.pointerId))

            const global = new Point(e.clientX, e.clientY)
            this.position.set(global)
            this.triggerDetect()
            this.pointerDownEvent.set(e)
            this.downSeq.update(v => v + 1)
        }

        private handlePointerMove = (e: PointerEvent) => {
            this.updatePointerPositions(e.pointerId, e.clientX, e.clientY)
            this.pointerMoveEvent.set(e)
            this.moveSeq.update(v => v + 1)

            const global = new Point(e.clientX, e.clientY)
            this.position.set(global)

            if (this.container()) {
                const out = new Point()
                this.container()!.worldTransform.applyInverse(global, out)
                this.localPosition.set(out)
            }
        }

        private handlePointerUp = (e: PointerEvent) => {
            this.releaseCapture(e)
            const global = new Point(e.clientX, e.clientY)
            this.position.set(global)

            this.updateActivePointers(s => {
                const next = new Set(s)
                next.delete(e.pointerId)
                return next
            })
            this.updatePointerPositions(e.pointerId, undefined)

            this.pointerUpEvent.set(e)
            this.upSeq.update(v => v + 1)
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

        public computeLocalFromGlobal(): Point | null {
            const g = this.position()
            const c = this.container()
            if (!g || !c) return null
            const out = new Point()
            c.worldTransform.applyInverse(g, out)
            return out
        }

        public setContainer(container: Container) {
            this._container.set(container)
            queueMicrotask(() => this.computeLocalFromGlobal())
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
            canvas.removeEventListener("mouseenter", this.handlePointerEnter)
            canvas.removeEventListener("mouseleave", this.handlePointerLeave)
            window.removeEventListener("blur", this.handleWindowBlur)
            this.initialized = false
            this._activePointers.set(new Set())
        }
    }
