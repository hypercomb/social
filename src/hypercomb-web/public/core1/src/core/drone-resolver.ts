// src/app/core/drone-resolver.ts

import { InjectionToken } from '@angular/core'
import { Drone } from '../drone.base.js'

export interface DroneResolver {
  find(input: string): Promise<Drone[]>
}

export const DRONE_RESOLVER = new InjectionToken<DroneResolver>('DRONE_RESOLVER')