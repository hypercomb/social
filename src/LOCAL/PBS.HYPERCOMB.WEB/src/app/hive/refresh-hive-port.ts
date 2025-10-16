// refresh-port.ts
import { InjectionToken } from '@angular/core'

export interface IRefreshHivePort {
  refresh()
}

export const REFRESH_HIVE_PORT = new InjectionToken<IRefreshHivePort>('REFRESH_HIVE_PORT')

