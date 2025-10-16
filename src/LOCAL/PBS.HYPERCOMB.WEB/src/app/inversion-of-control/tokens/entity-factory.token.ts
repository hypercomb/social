// entity-factory.token.ts
import { InjectionToken } from '@angular/core'
import { IEntityFactoryPort } from '../ports/i-entity-factory-port'
import { CellEntity } from 'src/app/database/model/i-tile-entity'
import { Cell } from 'src/app/cells/cell'

export function createEntityFactoryToken<TEntity extends CellEntity, TDomain extends Cell>(name: string) {
    return new InjectionToken<IEntityFactoryPort<TEntity, TDomain>>(name)
}


