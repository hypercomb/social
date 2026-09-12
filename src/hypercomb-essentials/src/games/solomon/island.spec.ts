import { describe, expect, it } from 'vitest'
import {
  ISLAND_TERRAINS, STAMP_LEGEND, VALLEY_COLS, VALLEY_ROWS, buildIsland, isWalkableTerrain, islandRegionAt, islandTerrainAt, valleyTerrain,
} from './island.js'
import { ISLAND_DEF, RpgOverworld, WORLD_PLOTS, WORLD_RESIDENTS, theIsland, valleyPoint } from './rpg-overworld.js'

describe('the island above the rooms', () => {
  it('is derived deterministically from its small definition', () => {
    const island = theIsland()
    expect(buildIsland(ISLAND_DEF).grid).toEqual(island.grid)
    expect(island.grid).toHaveLength(ISLAND_DEF.cols * ISLAND_DEF.rows)
  })

  it('is surrounded by open sea', () => {
    const island = theIsland()
    for (let col = 0; col < island.cols; col++) {
      expect(islandTerrainAt(island, col, 0)).toBe('deep')
      expect(islandTerrainAt(island, col, island.rows - 1)).toBe('deep')
    }
    for (let row = 0; row < island.rows; row++) {
      expect(islandTerrainAt(island, 0, row)).toBe('deep')
      expect(islandTerrainAt(island, island.cols - 1, row)).toBe('deep')
    }
    expect(islandTerrainAt(island, -1, 5)).toBe('deep')
  })

  it('keeps the Sevenfold Valley tile for tile', () => {
    const island = theIsland()
    for (let row = 0; row < VALLEY_ROWS; row++) for (let col = 0; col < VALLEY_COLS; col++) {
      const { x, y } = valleyPoint(col, row)
      expect(islandTerrainAt(island, x, y), `${col},${row}`).toBe(valleyTerrain(col, row))
    }
  })

  it('has a coast, forest, lakes and rivers crossed by bridges, a snow-capped range and towns', () => {
    const island = theIsland()
    const count = new Map<string, number>()
    for (const code of island.grid) count.set(ISLAND_TERRAINS[code], (count.get(ISLAND_TERRAINS[code]) ?? 0) + 1)
    expect(count.get('deep')! / island.grid.length).toBeGreaterThan(0.3)
    expect(count.get('deep')! / island.grid.length).toBeLessThan(0.6)
    expect(count.get('sand')).toBeGreaterThan(800)
    expect(count.get('tree')).toBeGreaterThan(2000)
    expect(count.get('water')).toBeGreaterThan(1500)
    expect(count.get('bridge')).toBeGreaterThanOrEqual(2)
    expect(count.get('rock')).toBeGreaterThan(300)
    expect(count.get('snow')).toBeGreaterThan(40)
    expect(island.houses.length).toBeGreaterThanOrEqual(ISLAND_DEF.towns.length * 8)
  })

  it('names the valley, the towns and the mountains', () => {
    const island = theIsland()
    const start = valleyPoint(4, 12)
    expect(islandRegionAt(island, start.x, start.y)).toBe('The Sevenfold Valley')
    for (const town of ISLAND_DEF.towns) expect(islandRegionAt(island, town.x, town.y)).toBe(town.name)
    const peak = ISLAND_DEF.spine.points[2]!
    expect(islandRegionAt(island, peak.x, peak.y)).toBe(ISLAND_DEF.spine.name)
  })

  it('sets hand-made places in tile for tile', () => {
    const island = theIsland()
    expect(ISLAND_DEF.stamps.length).toBeGreaterThan(0)
    for (const stamp of ISLAND_DEF.stamps) stamp.map.forEach((line, row) => [...line].forEach((cell, col) => {
      expect(islandTerrainAt(island, stamp.col + col, stamp.row + row), `${stamp.id} ${col},${row}`).toBe(STAMP_LEGEND[cell])
    }))
  })

  it('stands residents on open ground and plots in their clearings', () => {
    const island = theIsland()
    for (const resident of WORLD_RESIDENTS) {
      expect(isWalkableTerrain(islandTerrainAt(island, Math.floor(resident.x), Math.floor(resident.y))), resident.id).toBe(true)
    }
    for (const plot of WORLD_PLOTS) expect(['grass', 'path'], plot.id).toContain(islandTerrainAt(island, plot.x, plot.y))
  })

  it('scrolls continuously: the valley road walks straight out onto the island', () => {
    const model = new RpgOverworld({ has: () => false, grantRelic: () => undefined, seat: () => false, onEntrance: () => undefined, gain: () => undefined })
    Object.assign(model.player, valleyPoint(22.5, 7.5))
    for (let frame = 0; frame < 60; frame++) model.update(0.05, { right: true })
    expect(model.player.x).toBeGreaterThan(ISLAND_DEF.valley.col + VALLEY_COLS)
    expect(model.regionAt()).not.toBe(ISLAND_DEF.valley.name)
  })

  it('refuses a road it cannot build rather than leaving a place unreachable', () => {
    expect(() => buildIsland({ ...ISLAND_DEF, roads: [['saltmere', 'nowhere']] })).toThrow(/unknown place: nowhere/)
  })
})
