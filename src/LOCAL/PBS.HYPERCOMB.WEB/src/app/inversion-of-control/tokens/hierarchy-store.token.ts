// src/app/hierarchy/hierarchy-store.token.ts
import { InjectionToken } from '@angular/core'
import { Cell } from 'src/app/cells/cell'
export interface IHierarchyStore {
    readonly hive: () => string
    readonly rootId: () => number | null
    readonly nodes: () => Cell[]
    readonly loading: () => boolean

    load(hive: string, rootId: number): Promise<Cell[]>
    refresh(): Promise<Cell[]>
    clear()

    // UI helpers
    childrenOf(id: number): Cell[]
    expand(id: number)
    collapse(id: number)
    isExpanded(id: number): boolean
}

export const HIERARCHY_STORE = new InjectionToken<IHierarchyStore>('HIERARCHY_STORE')


