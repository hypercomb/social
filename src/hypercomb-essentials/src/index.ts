// src/index.ts
import { MeshAdapterDrone } from './core/communication/mesh-adapter.drone'
import { HelloWorldDrone } from './hello-world.drone'
import { PixiHostDrone } from './pixi/pixi-host.drone'
import { ShowCellDrone } from './pixi/show-cell.drone'


export const HostedDrones = [

  HelloWorldDrone,
  MeshAdapterDrone,
  PixiHostDrone,
  ShowCellDrone,

]
