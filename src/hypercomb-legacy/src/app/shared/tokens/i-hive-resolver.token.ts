// src/app/inversion-of-control/tokens/hive-resolvers.token.ts
import { InjectionToken } from '@angular/core'
import { IHiveGuide } from 'src/app/hive/resolvers/i-hive-resolver'
import { IHiveLoader } from 'src/app/hive/loaders/hive-loader.base'

export const HIVE_RESOLVERS = new InjectionToken<IHiveGuide[]>('HIVE_RESOLVERS')
export const HIVE_LOADERS = new InjectionToken<IHiveLoader[]>('HIVE_LOADERS')
