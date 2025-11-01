// src/app/inversion-of-control/tokens/hive-resolvers.token.ts
import { InjectionToken } from '@angular/core'
import { IHiveGuide } from 'src/app/hive/name-resolvers/i-hive-resolver'
import { IHiveLoader } from 'src/app/hive/hive-loaders/i-data-resolver'

export const HIVE_NAME_RESOLVERS = new InjectionToken<IHiveGuide[]>('HIVE_NAME_RESOLVERS')
export const HIVE_LOADERS = new InjectionToken<IHiveLoader[]>('HIVE_LOADERS')
