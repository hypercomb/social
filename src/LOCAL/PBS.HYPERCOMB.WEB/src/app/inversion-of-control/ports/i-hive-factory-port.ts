// hive-factory.token.ts
import { InjectionToken } from '@angular/core'
import { HiveEntity } from 'src/app/database/model/i-tile-entity'
import { HivePortal } from 'src/app/models/hive-portal'

export interface IHiveFactoryPort {
    map(entity: HiveEntity): HivePortal
}

export const HIVE_FACTORY = new InjectionToken<IHiveFactoryPort>('HIVE_FACTORY')


