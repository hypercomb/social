// src/app/core/drone-resolver.ts
import { Drone } from '../drone.base.js'

export interface DroneResolver {
  find(input: string): Promise<Drone[]>
}

export const DRONE_RESOLVER_KEY = 'hypercomb:drone-resolver'