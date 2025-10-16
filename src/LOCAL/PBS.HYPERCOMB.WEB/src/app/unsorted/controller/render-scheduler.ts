import { Injectable, inject, NgZone } from "@angular/core"
import { Application } from "pixi.js"
import { DebugService } from "src/app/core/diagnostics/debug-service"
import { Cell } from "src/app/cells/cell"
import { CellContext } from "src/app/actions/action-contexts"
import { RenderTileAction } from "src/app/hive/rendering/render-tile.action"
import { HIVE_HYDRATION } from "src/app/shared/tokens/i-comb-service.token"

@Injectable({ providedIn: "root" })
export class RenderScheduler {
    private readonly zone = inject(NgZone)
    private readonly debug = inject(DebugService)
    private readonly hydration = inject(HIVE_HYDRATION)
    private readonly pending = new Map<number, Cell>()
    private readonly pendingDelete = new Set<number>()
    private readonly inFlight = new Set<number>()
    private readonly renderAction = inject(RenderTileAction)

    private budgetPerFrame = 4
    private renderJob: Promise<void> | null = null

    private readonly batchQueue: { hot: Cell[]; cold: Cell[] }[] = []
    private activeBatch: { hot: Cell[]; cold: Cell[] } | null = null


    /** mark a tile for removal */
    public cull(cellId: number): void {
        if (cellId == null) return
        if (this.pendingDelete.has(cellId)) return

        this.pending.delete(cellId)
        this.inFlight.delete(cellId)
        this.pendingDelete.add(cellId)
    }

    /** hook scheduler into pixi ticker */
    public hook(app: Application): void {
        this.zone.runOutsideAngular(() => {
            app.ticker.add(() => void this.tick())
        })

    }

    /** enqueue tiles to render */
    public queue(cell: Cell | Cell[]): void {
        const arr = Array.isArray(cell) ? cell : [cell]
        for (const t of arr) {
            if (t?.cellId == null) continue
            this.pending.set(t.cellId, t)
        }
    }

    private processNext = async (): Promise<void> => {
        if (this.renderJob) {
            await this.renderJob
            return
        }

        // drain hot/cold once per frame
        const { hot, cold } = this.hydration.flush()

        const snapshotCold = [...cold] // single-frame snapshot

        // enqueue hot cells for rendering
        hot.forEach(cell => this.queue(cell))
        
        // process removals (in parallel for speed)
        if (snapshotCold.length > 0) {
            await Promise.all(snapshotCold.map(cell => {
                if (!cell?.cellId) return Promise.resolve()
                this.debug.log("render", `culling tile=${cell.cellId}`)
                return this.renderAction.cull(cell.cellId)
            }))
        }

        hot.forEach(cell => this.queue(cell))
        cold.forEach(cell => this.cull(cell.cellId))

        if (this.pending.size === 0 && this.pendingDelete.size === 0) return

        this.renderJob = (async () => {
            try {
                let budget = this.budgetPerFrame

                // process removals
                for (const id of this.pendingDelete) {
                    this.debug.log("render", `culling tile=${id}`)
                    await this.renderAction.cull(id)
                }
                this.pendingDelete.clear()

                // process adds/updates
                let processed = 0
                while (budget-- > 0 && this.pending.size > 0) {
                    const [id, cell] = this.pending.entries().next().value as [number, Cell]
                    this.pending.delete(id)

                    if (this.inFlight.has(id)) continue
                    this.inFlight.add(id)

                    // const cmd = inClipboard ? renderClipboardAction : this.renderAction
                    const cmd = this.renderAction
                    const payload = <CellContext>{ kind: "cell", cell }

                    try {
                        await cmd.run(payload)
                    } finally {
                        this.inFlight.delete(id)
                    }
                    processed++
                }

                this.debug.log(
                    "render",
                    `tick processed=${processed}, pending=${this.pending.size}, deleting=${this.pendingDelete.size}, inFlight=${this.inFlight.size}`
                )

                if (this.pending.size > 0 || this.pendingDelete.size > 0) {
                    setTimeout(() => void this.processNext(), 40)
                }
            } finally {
                this.renderJob = null
            }
        })()

        await this.renderJob
    }

    private tick = async (): Promise<void> => {
        await this.processNext()
    }
}
