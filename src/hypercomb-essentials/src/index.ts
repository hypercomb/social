// src/index.ts
import { HelloWorldDrone } from './hello-world.drone'
import { PixiHostDrone } from './pixi/pixi-host.drone'
import { ShowCellDrone } from './pixi/show-cell.drone'


export const HostedDrones = [
  HelloWorldDrone,
  PixiHostDrone,
  ShowCellDrone,
]
