// src/index.ts
import { MeshAdapterDrone } from './diamondcoreprocessor.com/core/communication/mesh-adapter.drone.js'
import { HelloWorldDrone } from './diamondcoreprocessor.com/hello-world/hello-world.drone.js'
// import { HelloWorldDrone } from './hello-world/hello-world.drone.js'
import { PixiHostDrone } from './diamondcoreprocessor.com/pixi/pixi-host.drone.js'
import { ShowHoneycombDrone } from './diamondcoreprocessor.com/pixi/show-honeycomb.drone.js'

export * from './diamondcoreprocessor.com/pixi/show-honeycomb.drone.js'
export * from './diamondcoreprocessor.com/pixi/pixi-host.drone.js'
export * from './diamondcoreprocessor.com/hello-world/hello-world.drone.js'
export * from './diamondcoreprocessor.com/core/communication/mesh-adapter.drone.js'

export const HostedDrones = [
  HelloWorldDrone,  
  MeshAdapterDrone,
  PixiHostDrone,
  ShowHoneycombDrone,
]
