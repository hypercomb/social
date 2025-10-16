import { Injectable, inject, signal, computed, effect } from "@angular/core"
import { PixiServiceBase } from "src/app/pixi/pixi-service-base"
import { PointerState } from "src/app/state/input/pointer-state"
import { EditorService } from "src/app/state/interactivity/editor-service"
import { TileImageState } from "src/app/cells/models/cell-image-state"

@Injectable({ providedIn: 'root' })
export class HexagonPanningService extends PixiServiceBase {
    private readonly es = inject(EditorService)
    private readonly tis = inject(TileImageState)
    private readonly ps = inject(PointerState)

    private startPosition = signal<{ x: number, y: number } | null>(null)

    private readonly isPanning = computed(() =>
        this.ps.isDragging() && this.es.isEditing()
    )

    constructor() {
        super()

        effect(() => {
            const move = this.ps.pointerMove()
            if (!move || !this.isPanning()) return

            const pos = { x: move.clientX, y: move.clientY }

            if (!this.startPosition()) {
                this.startPosition.set(pos)
                return
            }

            const scale = this.tis.scale || 1 // safeguard if 0
            const dx = (pos.x - this.startPosition()!.x) / scale
            const dy = (pos.y - this.startPosition()!.y) / scale

            this.tis.x += dx
            this.tis.y += dy

            this.startPosition.set(pos)
        })

        // reset when editing stops as well
        effect(() => {
            if (this.ps.pointerUp() || !this.es.isEditing()) {
                this.startPosition.set(null)
            }
        })

    }

}


