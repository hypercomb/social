// src/index.ts
import { HelloWorldAction } from './hello-world.action'
import { ShowCellAction } from './pixi/show-cell.action'
import { PixiHostAction } from './pixi/pixi-host.action'

export const HostedActions = [
  HelloWorldAction,
  PixiHostAction,
  ShowCellAction,
]
