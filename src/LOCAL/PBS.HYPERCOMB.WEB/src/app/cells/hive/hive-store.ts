// src/app/hives/hive-store.ts
import { Injectable, computed, inject, signal } from "@angular/core"
import { COMB_STORE } from "src/app/shared/tokens/i-comb-store.token"
import { IControlHives, IHiveLookup, IHiveState } from "src/app/shared/tokens/i-hive-store.token"
import { Cell, Hive } from "../cell"
import { Tile } from "../models/tile"
import { ContextStack } from "src/app/core/controller/context-stack"
import { IDexieHive } from "src/app/hive/hive-models"
import { SearchFilterService } from "src/app/common/header/header-bar/search-filter-service"

@Injectable({ providedIn: "root" })
export class HiveStore implements IControlHives, IHiveState, IHiveLookup {
    private readonly search = inject(SearchFilterService)
    private readonly stack = inject(ContextStack)
    private readonly store = inject(COMB_STORE)

    // --- derived signals ---------------------------------------------
    // currently active hive for navigation

    public readonly active = computed(() => this.items()[this._activeIndex()] ?? undefined)

    private readonly _activeIndex = signal<number>(0)    // active index for navigation
    public readonly activeIndex = this._activeIndex.asReadonly()

    // count of cells for the currently active hive
    public readonly cellcount = computed(() => {
        const activeHive = this.active()
        if (!activeHive) return 0
        return this.store.cells().length
    })

    public readonly menucount = computed(() => this.items().length)

    public readonly _first = signal<IDexieHive | undefined>(undefined)
    public readonly first = computed(() => this.items()[0] ?? undefined)

    private readonly _hive = signal<Hive | undefined>(undefined)
    public readonly hive = this._hive.asReadonly()

    private readonly _lastCreated = signal<IDexieHive | undefined>(undefined)
    public readonly lastCreated = this._lastCreated.asReadonly()

    // --- signals ------------------------------------------------------
    private readonly _items = signal<IDexieHive[]>([])         // core list
    public readonly items = this._items.asReadonly()

    // --- readonly views -----------------------------------------------
    public readonly hasItems = computed(() => this._items().length > 0)

    public readonly locateHive = signal<string | null>(null)

    public readonly filteredHives = computed(() => {
        const q = this.search.value().toLowerCase()
        if (!q) return this.items()

        return this.items().filter(h =>
            h.name.toLowerCase().includes(q)
        )
    })

    // state
    public readonly combCells = computed<Cell[]>(() => {
        const cell = this.stack.cell()!
        if (!cell) return []

        const hive = cell.hive
        const cellId = cell.cellId
        if (!hive || cellId == null) return []

        // ensure we only show children from the active hive + parent
        return this.store.cells().filter(c =>
            c.hive === hive && c.sourceId === cellId
        )
    })


    public readonly combTiles = computed<Tile[]>(() => {
        const cells = this.combCells()
        return cells.map(c => this.store.lookupTile(c.cellId!)).filter((t): t is Tile => !!t)
    })

    // lookup
    public lookupDexieHive = (name: string): IDexieHive | null => {
        const n = name.toLowerCase()
        return this.items().find(h => h.name.toLowerCase() === n) ?? null
    }

    public isHydrated = (name: string): boolean => {
        const dexieHive = this.lookupDexieHive(name)
        return !!dexieHive?.file
    }

    // --- mutations ----------------------------------------------------

    public markHydrated = (hive: IDexieHive) => {
        const items = [...this._items()]
        const idx = items.findIndex(h => h.name === hive.name)
        if (idx >= 0) {
            items[idx] = { ...items[idx], file: hive.file }
            this._items.set(items)
        }
    }

    public setActive = (hiveName: string) => {
        if (!hiveName) return
        const items = [...this._items()]
        const idx = items.findIndex(h => h.name === hiveName)
        if (idx < 0) return

        if (this._activeIndex() !== idx) {
            this._activeIndex.set(idx)
        }
    }

    public setHive = (hive: Hive) => {
        if (!hive) return
        console.debug('[HiveStore.setHive] called', { hive })
        this._hive.set(hive)
        this.stack.push(hive)
    }

    public hydrate = async (names: string[] | IDexieHive[]) => {

        const items: IDexieHive[] = Array.isArray(names)
            ? (typeof names[0] === "string"
                ? (names as string[]).map(n => ({ name: n, file: undefined }))
                : (names as IDexieHive[])
            )
            : []

        this._items.set(items)

        // reset active index if out of bounds
        if (this._activeIndex() >= items.length) {
            this._activeIndex.set(items.length - 1)
        }
        if (this._activeIndex() < 0) {
            this._activeIndex.set(0)
        }
    }

    public addOrUpdate = (hive: IDexieHive) => {
        const items = [...this._items()]
        const idx = items.findIndex(h => h.name === hive.name)
        if (idx >= 0) {
            items[idx] = hive
        } else {
            items.push(hive)
        }
        this._items.set(items)
    }

    public replace = (name: string, updated: IDexieHive) => {
        const items = this._items().map(h =>
            h.name === name ? updated : h
        )
        this._items.set(items)
    }

    public remove = (name: string) => {
        const items = this._items().filter(h => h.name !== name)
        this._items.set(items)
    }

    public next = () => {
        const total = this.items().length
        if (total > 0) this._activeIndex.set((this._activeIndex() + 1) % total)
    }

    public prev = () => {
        const total = this.items().length
        if (total > 0) this._activeIndex.set((this._activeIndex() - 1 + total) % total)
    }
}
