// tile-factory.token.ts

import { CellEntity } from 'src/app/database/model/i-tile-entity'
import { createEntityFactoryToken } from './entity-factory.token'
import { Cell } from 'src/app/cells/cell'

export const CELL_FACTORY = createEntityFactoryToken<CellEntity, Cell>('CELL_FACTORY')


