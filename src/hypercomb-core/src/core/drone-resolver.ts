// src/app/core/drone-resolver.ts

import { InjectionToken } from '@angular/core'
import { Honeycomb } from './honeycomb.js'

export interface DroneResolver {
  find(input: string): Promise<Honeycomb>
}

export const DRONE_RESOLVER = new InjectionToken<DroneResolver>('DRONE_RESOLVER')