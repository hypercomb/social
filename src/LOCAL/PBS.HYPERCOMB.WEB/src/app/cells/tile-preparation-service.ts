// tile-preparation.service.ts
import { Injectable, computed, effect, signal } from '@angular/core'
import { DebugService } from 'src/app/core/diagnostics/debug-service'
import { Cell } from './cell'

export interface PrepareOptions {
    linkChildren?: boolean // if true, attaches .children = Cell[]
}

@Injectable({ providedIn: 'root' })
export class TilePreparationService {
    // external writer sets raw tiles here (e.g., QueryService, import, etc.)
    private readonly _raw = signal<Cell[]>([])
    public readonly raw = this._raw.asReadonly()

    // options can be toggled at runtime if you want
    private readonly _options = signal<PrepareOptions>({ linkChildren: false })

    // prepared tiles (sorted, validated, optionally child-linked)
    public readonly prepared = computed<Cell[]>(() => {
        const items = this._raw()
        const opts = this._options()
        const scrubbed = this.scrub(items)
        const sorted = this.topologicalSort(scrubbed)
        if (opts.linkChildren) this.linkChildren(sorted)
        return sorted
    })

    constructor(private readonly debug: DebugService) {
        effect(() => {
            const count = this._raw().length
            this.debug.log('prep', `TilePreparationService raw count=${count}`)
        })
        effect(() => {
            const count = this.prepared().length
            this.debug.log('prep', `TilePreparationService prepared count=${count}`)
        })
    }

    /** Writer API */
    public setRaw = (items: Cell[], options?: Partial<PrepareOptions>) => {
        if (options) this._options.set({ ...this._options(), ...options })
        this._raw.set(items ?? [])
    }

    /** Ensure IDs exist, filter obvious invalids, shallow normalizations as needed */
    private scrub = (items: Cell[]): Cell[] => {
        if (!Array.isArray(items)) return []
        const scrubbed: Cell[] = []
        for (const t of items) {
            if (!t) continue
            // Ensure basic keys (non-throwing)
            if (typeof t.cellId !== 'number') t.cellId = t.cellId ?? -1 as any
            if (typeof t.sourceId !== 'number') t.sourceId = t.sourceId ?? -1 as any
            if (typeof (t as any).uniqueId !== 'string') (t as any).uniqueId = crypto.randomUUID()
            // drop obviously broken entries (no UniqueId after patch is still impossible, but guard anyway)
            if (!(t as any).uniqueId) continue
            scrubbed.push(t)
        }
        this.debug.log('prep', `scrubbed valid=${scrubbed.length} dropped=${items.length - scrubbed.length}`)
        return scrubbed
    }

    /** Parents before children by following SourceId */
    private topologicalSort = (items: Cell[]): Cell[] => {
        const byId = new Map<number, Cell>()
        for (const t of items) if (typeof t.cellId === 'number') byId.set(t.cellId!, t)

        const visited = new Set<number>()
        const sorted: Cell[] = []

        const visit = (t: Cell) => {
            const id = t.cellId!
            if (visited.has(id)) return
            visited.add(id)
            if (typeof t.sourceId === 'number' && t.sourceId >= 0) {
                const parent = byId.get(t.sourceId)
                if (parent) visit(parent)
            }
            sorted.push(t)
        }

        for (const t of items) {
            if (typeof t.cellId === 'number') visit(t)
        }

        return sorted
    }

    /** Mutates array items to attach children[] for convenience (optional) */
    private linkChildren = (items: Cell[]) => {
        // clear prior links if present
        for (const t of items as any) t.children = undefined

        const byId = new Map<number, Cell>()
        for (const t of items) if (typeof t.cellId === 'number') byId.set(t.cellId!, t)

        for (const t of items) {
            const sid = t.sourceId
            if (typeof sid === 'number' && sid >= 0) {
                const parent = byId.get(sid)
                if (parent) {
                    const p = parent as any
                    if (!p.children) p.children = []
                    p.children.push(t)
                }
            }
        }
    }
}


