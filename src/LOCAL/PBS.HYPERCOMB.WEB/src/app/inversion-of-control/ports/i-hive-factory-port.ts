// hive-factory.token.ts
import { InjectionToken } from '@angular/core'
import { Hive } from 'src/app/cells/cell'
import { HiveEntity } from 'src/app/database/model/i-tile-entity'

export interface IHiveFactoryPort {
    map(entity: HiveEntity): Hive
}

export const HIVE_FACTORY = new InjectionToken<IHiveFactoryPort>('HIVE_FACTORY')


