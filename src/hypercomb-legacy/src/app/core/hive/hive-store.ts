import { Injectable, computed, inject, signal } from "@angular/core"
import { HONEYCOMB_STORE } from "src/app/shared/tokens/i-honeycomb-store.token"
import { IControlHives, IHiveLookup, IHiveState } from "src/app/shared/tokens/i-hive-store.token"
import { Tile } from "../../cells/models/tile"
import { ParentContext } from "src/app/core/controller/context-stack"
import { SearchFilter } from "src/app/common/header/search-filter"
import { Cell } from "src/app/models/cell"
import { HivePortal } from "src/app/models/hive-portal"
import { IHiveInfo } from "src/app/hive/i-hive-info"
import { HashService } from "src/app/hive/storage/hash.service"

@Injectable({ providedIn: "root" })
export class HiveStore implements IControlHives, IHiveState, IHiveLookup {

    private readonly filter = inject(SearchFilter)
    private readonly stack = inject(ParentContext)
    private readonly store = inject(HONEYCOMB_STORE)

    // -------------------------------------------------------
    // core reactive state
    // -------------------------------------------------------
    private readonly _items = signal<IHiveInfo[]>([])
    public readonly items = this._items.asReadonly()

    private readonly _activeIndex = signal(0)
    public readonly activeIndex = this._activeIndex.asReadonly()

    private readonly _hive = signal<HivePortal | undefined>(undefined)
    public readonly hive = this._hive.asReadonly()

    private readonly _lastCreated = signal<IHiveInfo | undefined>(undefined)
    public readonly lastCreated = this._lastCreated.asReadonly()

    public readonly hasItems = computed(() => this._items().length > 0)

    // the active hive metadata (folder-level info)
    public readonly active = computed(() =>
        this.items()[this._activeIndex()] ?? undefined
    )

    public readonly first = computed(() => this.items()[0] ?? undefined)

    public readonly cellcount = computed(() => this.store.cells().length)

    public readonly locateHive = signal<string | null>(null)

    public readonly filteredHives = computed(() => {
        const q = this.filter.delayValue().toLowerCase()
        if (!q) return this.items()
        return this.items().filter(h => h.name.toLowerCase().includes(q))
    })

    // -------------------------------------------------------
    // hierarchy access (no hive filtering anymore!)
    // -------------------------------------------------------
    public readonly honeycombCells = computed<Cell[]>(() => {
        const cell = this.stack.top()!
        if (!cell) return []

        const parentGene = cell.seed
        if (parentGene == null) return []

        return this.store
            .cells()
            .filter(c => c.parentGene === parentGene)
    })

    public readonly tiles = computed<Tile[]>(() => {
        const cells = this.honeycombCells()
        return cells
            .map(c => this.store.lookupTile(c.seed))
            .filter((t): t is Tile => !!t)
    })

    // -------------------------------------------------------
    // lookup
    // -------------------------------------------------------
    public lookupDexieHive = (name: string): IHiveInfo | null => {
        const n = name.toLowerCase()
        return this.items().find(h => h.name.toLowerCase() === n) ?? null
    }

    // no longer needed: hydration is no longer file-based
    public isHydrated = (_name: string): boolean => true

    // -------------------------------------------------------
    // mutations
    // -------------------------------------------------------
    public setHive = async (name: string) => {
        if (!name) return

        const seed = await HashService.hash(name)
        const portal = new HivePortal(seed, name)

        this._hive.set(portal)
        this.stack.push(seed)
    }

    public hydrate = async (input: string[] | IHiveInfo[]) => {
        const items: IHiveInfo[] = Array.isArray(input)
            ? (typeof input[0] === "string"
                ? (input as string[]).map(n => ({ name: n }))
                : (input as IHiveInfo[])
            )
            : []

        this._items.set(items)

        // clamp active index
        if (this._activeIndex() >= items.length) {
            this._activeIndex.set(items.length - 1)
        }
        if (this._activeIndex() < 0) {
            this._activeIndex.set(0)
        }
    }


    public replace = (name: string, updated: IHiveInfo) => {
        this._items.set(
            this._items().map(h => (h.name === name ? updated : h))
        )
    }

    public remove = (name: string) => {
        this._items.set(this._items().filter(h => h.name !== name))
    }

    public setActive = (hiveName: string) => {
        if (!hiveName) return
        const idx = this._items().findIndex(h => h.name === hiveName)
        if (idx >= 0) this._activeIndex.set(idx)
    }
}
    