// src/app/pixi/hex-grid/hex-grid.bootstrap.ts

import { HexGridStage } from './hex-grid.stage'
import { buildHexGrid } from './hex-grid.math'
import { HexGridRenderer } from './hex-grid.renderer'

export const createLandingGrid = async (host: HTMLElement): Promise<HexGridStage> => {

  const stage = await HexGridStage.create(host)

  const radius = 40
  const points = buildHexGrid(radius, 20, 20)

  const grid = new HexGridRenderer(points, radius)
  stage.world.addChild(grid.container)

  return stage
}
