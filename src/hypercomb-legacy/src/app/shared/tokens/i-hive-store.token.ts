// src/app/inversion-of-control/tokens/hive-store.tokens.ts
import { InjectionToken, Signal } from "@angular/core"
import { Tile } from "src/app/cells/models/tile"
import { HiveScout } from "src/app/hive/hive-scout"
import { IHiveInfo } from "src/app/hive/i-hive-info"
import { HivePortal } from "src/app/models/hive-portal"


// --------------------
// modify: commands/mutations
// --------------------
export interface IControlHives {
    setHive(name: string)
    hydrate(hiveNames: string[] | IHiveInfo[]): void
    setActive(hiveName: string): void
    replace: (oldName: string, updated: IHiveInfo) => void
    remove: (name: string) => void
}

// --------------------
// state: reactive selectors
// --------------------
export interface IHiveState {
    filteredHives: Signal<IHiveInfo[] | []>
    isHydrated(name: string): boolean
    tiles: Signal<Tile[]>
    cellcount: Signal<number>
    first: Signal<IHiveInfo | undefined>
    hasItems: Signal<boolean>
    hive: Signal<HivePortal | undefined>
    items: Signal<IHiveInfo[] | []>
    activeIndex: Signal<number>
    active: Signal<IHiveInfo | undefined>
    lastCreated: Signal<IHiveInfo | undefined>
}


// --------------------
// lookup
// --------------------
export interface IHiveLookup {
    lookupDexieHive(name: string): IHiveInfo | null
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