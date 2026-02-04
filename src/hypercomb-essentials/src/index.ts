// src/index.ts
import { MeshAdapterDrone } from './core/communication/mesh-adapter.drone.js'
import { HelloWorldDrone } from './hello-world.drone.js'
import { PixiHostDrone } from './pixi/pixi-host.drone.js'
import { ShowHoneycombDrone } from './pixi/show-honeycomb.drone.js'

export * from './pixi/show-honeycomb.drone.js'
export * from './pixi/pixi-host.drone.js'
export * from './hello-world.drone.js'
export * from './core/communication/mesh-adapter.drone.js'

export const HostedDrones = [
  HelloWorldDrone,  
  MeshAdapterDrone,
  PixiHostDrone,
  ShowHoneycombDrone,
]
