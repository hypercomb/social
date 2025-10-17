// tile-factory.token.ts

import { CellEntity } from 'src/app/database/model/i-tile-entity'
import { createEntityFactoryToken } from './entity-factory.token'
import { Cell, CellKind, ClipboardCell, Ghost, Hive, NewCell, Path } from 'src/app/cells/cell'
import { InjectionToken } from '@angular/core'

export interface ICreateCells {
    create(params: Partial<NewCell> & { cellId: number }, kind: CellKind): Promise<Cell>
    createClipboard(params: Partial<Cell> & { cellId: number }): Promise<ClipboardCell>
    createHive: (params: Partial<Cell> & { cellId: number }) => Promise<Hive>
    createGhost: (params?: Partial<NewCell>) => Promise<Ghost>
    createPathway(params: Partial<Cell> & { cellId: number }): Promise<Path>
    newCell: (params: Partial<NewCell>) => NewCell

}

export const CELL_FACTORY = createEntityFactoryToken<CellEntity, Cell>('CELL_FACTORY')
export const CELL_CREATOR = new InjectionToken<ICreateCells>('CELL_CREATOR')

