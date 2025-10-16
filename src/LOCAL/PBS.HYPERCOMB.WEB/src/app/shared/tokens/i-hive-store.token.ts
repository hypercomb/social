// src/app/inversion-of-control/tokens/hive-store.tokens.ts
import { InjectionToken, Signal } from "@angular/core"
import { Cell, Hive } from "src/app/cells/cell"
import { Tile } from "src/app/cells/models/tile"
import { IDexieHive } from "src/app/hive/hive-models"
import { HiveScout } from "src/app/hive/hive-scout"


// --------------------
// modify: commands/mutations
// --------------------
export interface IControlHives {
    setHive(root:Hive)
    markHydrated(dexieHive: IDexieHive)
    hydrate(hiveNames: string[] | IDexieHive[]): void
    setActive(hiveName: string): void
    next(): void
    prev(): void
    addOrUpdate: (hive: IDexieHive) => void
    replace: (oldName: string, updated: IDexieHive) => void
    remove: (name: string) => void
}

// --------------------
// state: reactive selectors
// --------------------
export interface IHiveState {
    isHydrated(name: string): boolean
    combCells: Signal<Cell[]>
    combTiles: Signal<Tile[]>
    cellcount: Signal<number>
    menucount: Signal<number>
    first: Signal<IDexieHive | undefined>
    hasItems: Signal<boolean>
    hive: Signal<Hive | undefined>
    items: Signal<IDexieHive[] | []>
    activeIndex: Signal<number>
    active: Signal<IDexieHive | undefined>
    lastCreated: Signal<IDexieHive | undefined>
}


// --------------------
// lookup
// --------------------
export interface IHiveLookup {
    lookupDexieHive(name: string): IDexieHive | null
}

export interface IResolutionCoordinator {
    resolve(hiveName: string): Promise<HiveScout>
    activate(scout: HiveScout): Promise<void>
}


// --------------------
// façade
// --------------------
export type IHiveStore = IHiveState & IHiveLookup

// --------------------
// tokens
// --------------------
export const LOOKUP_HIVES = new InjectionToken<IHiveLookup>("LOOKUP_HIVES")
export const HIVE_CONTROLLER_ST = new InjectionToken<IControlHives>("HIVE_CONTROLLER_ST")
export const HIVE_STATE = new InjectionToken<IHiveState>("HIVE_STATE")
export const HIVE_STORE = new InjectionToken<IHiveStore>("HIVE_STORE")
export const RESOLUTION_COORDINATOR = new InjectionToken<IResolutionCoordinator>("RESOLUTION_COORDINATOR")