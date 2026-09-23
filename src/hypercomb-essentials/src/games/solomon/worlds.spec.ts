import { describe, expect, it } from 'vitest'
import { isWalkableTerrain, islandTerrainAt, type Island } from './island.js'
import { ISLAND_DEF, RpgOverworld, SEVENFOLD_VALLEY, islandOf, theIsland, worldEncounters, worldMap, type WorldDefinition, type WorldHooks } from './rpg-overworld.js'
import { GREENWOOD, WORLDS, registerWorld, sanitizeWorld } from './worlds.js'
import { PLACES } from './places.js'
import { STORY, ROOT_PLACE } from './story.js'
import { routeTo, validateStory } from './place.js'

/** Every cell reachable on foot from `from`, four-connected. */
function reach(island: Island, from: { x: number; y: number }): Set<number> {
  const seen = new Set<number>(), stack = [Math.floor(from.y) * island.cols + Math.floor(from.x)]
  while (stack.length) {
    const cell = stack.pop()!
    if (seen.has(cell)) continue
    const col = cell % island.cols, row = Math.floor(cell / island.cols)
    if (!isWalkableTerrain(islandTerrainAt(island, col, row))) continue
    seen.add(cell)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const c = col + dx, r = row + dy
      if (c >= 0 && r >= 0 && c < island.cols && r < island.rows) stack.push(r * island.cols + c)
    }
  }
  return seen
}

const hooks: WorldHooks = { has: () => false, grantRelic: () => undefined, seat: () => false, onEntrance: () => {} }

describe('worlds inside worlds', () => {
  it('builds the Sevenfold Valley exactly as before worlds could be anything else', () => {
    // A 32-bit FNV-1a over the grid and stamp map, taken before `edge` and an
    // optional valley existed: the first island must not move by one cell.
    let hash = 2166136261
    for (const byte of theIsland().grid) { hash ^= byte; hash = Math.imul(hash, 16777619) >>> 0 }
    for (const stamp of theIsland().stampOf) { hash ^= stamp & 0xff; hash = Math.imul(hash, 16777619) >>> 0 }
    expect(hash).toBe(3656382175)
    expect(theIsland().houses).toHaveLength(28)
    expect(islandOf(ISLAND_DEF)).toBe(theIsland())
  })

  it('rings the Greenwood with old trees instead of sea, and every place in it is reachable from where you come in', () => {
    const island = islandOf(GREENWOOD.island)
    for (let col = 0; col < island.cols; col++) for (const row of [0, 1, island.rows - 2, island.rows - 1]) expect(islandTerrainAt(island, col, row)).toBe('tree')
    for (let row = 0; row < island.rows; row++) for (const col of [0, 1, island.cols - 2, island.cols - 1]) expect(islandTerrainAt(island, col, row)).toBe('tree')
    const walkable = reach(island, GREENWOOD.start)
    const at = (point: { x: number; y: number }): boolean => walkable.has(Math.floor(point.y) * island.cols + Math.floor(point.x))
    expect(at(GREENWOOD.start)).toBe(true)
    // A portal is pushed from beside it, so a cell next to it must be reachable.
    const beside = (point: { x: number; y: number }): boolean =>
      [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at({ x: point.x + dx!, y: point.y + dy! }))
    for (const place of worldEncounters(GREENWOOD)) expect(beside(place), place.id).toBe(true)
    for (const area of GREENWOOD.areas) expect(Object.values(area.landings).every(at), area.id).toBe(true)
    // Mountains, water and a town, not a single room.
    const kinds = new Set(Array.from(island.grid, (_, index) => islandTerrainAt(island, index % island.cols, Math.floor(index / island.cols))))
    for (const terrain of ['rock', 'hill', 'water', 'house', 'plaza', 'path', 'grass', 'tree'] as const) expect(kinds.has(terrain), terrain).toBe(true)
  })

  it('seats the Greenwood behind the valley grove and the one-room Hollow Grove inside it, and the story still validates', () => {
    expect(validateStory(STORY, PLACES, ROOT_PLACE)).toEqual([])
    expect(PLACES.get('greenwood')).toMatchObject({ kind: 'island', entrances: ['moss', 'tamsin', 'climbers-cache', 'grove-gate-sign', 'pond-sign', 'root-cave', 'burrow', 'old-hollow'] })
    expect(routeTo(STORY, PLACES, ROOT_PLACE, 'greenwood')?.map(step => step.via)).toEqual([null, 'island/valley-grove'])
    expect(routeTo(STORY, PLACES, 'greenwood', 'hollow-grove')?.map(step => step.via)).toEqual([null, 'greenwood/old-hollow'])
    expect(WORLDS.get('island')).toBe(SEVENFOLD_VALLEY)
    expect(WORLDS.get('greenwood')).toBe(GREENWOOD)
  })

  it('walks a world like the island: it starts where it says, and pushing into its old hollow enters what is seated there', () => {
    const entered: string[] = []
    const model = new RpgOverworld({ ...hooks, seat: id => id === 'old-hollow', onEntrance: id => entered.push(id) }, GREENWOOD)
    expect(model.player).toMatchObject({ x: GREENWOOD.start.x, y: GREENWOOD.start.y })
    expect(model.island.cols).toBe(72)
    expect(model.regionAt()).toBe('The Greenwood')
    Object.assign(model.player, { x: 36.5, y: 33.5 })
    expect(model.regionAt()).toBe('Fernhollow')
    // Stand on the old hollow's south landing, facing in, and push.
    const landing = GREENWOOD.areas[0]!.landings.south
    Object.assign(model.player, { x: landing.x, y: landing.y, facing: landing.facing })
    for (let i = 0; i < 40 && !entered.length; i++) model.update(1 / 30, { up: true })
    expect(entered).toEqual(['old-hollow'])
    // Coming down into it again starts over at its start.
    model.enterAtStart()
    expect(model.player).toMatchObject({ x: GREENWOOD.start.x, y: GREENWOOD.start.y, facing: 'down' })
  })

  it('makes anything an entrance the moment a story seats a place behind it — and a thing with its own verb keeps it', () => {
    // Any thing in a world may be seated; the story decides, not the kind.
    expect(validateStory([...STORY, { entrance: 'greenwood/climbers-cache', place: 'cistern' }, { entrance: 'greenwood/moss', place: 'chandler-house' }], PLACES, ROOT_PLACE)).toEqual([])
    const seated = new Set(['pond-sign', 'moss'])
    const entered: string[] = []
    const model = new RpgOverworld({ ...hooks, seat: id => seated.has(id), onEntrance: id => entered.push(id) }, GREENWOOD)
    const push = (id: string, dx: number, dy: number): void => {
      const place = worldEncounters(GREENWOOD).find(candidate => candidate.id === id)!
      Object.assign(model.player, { x: place.x - dx, y: place.y - dy })
      for (let i = 0; i < 40 && entered.length === 0; i++) model.update(1 / 30, { right: dx > 0, left: dx < 0, down: dy > 0, up: dy < 0 })
    }
    // The picture by the pond: stand before it, see where it leads, walk in.
    const sign = GREENWOOD.signs.find(candidate => candidate.id === 'pond-sign')!
    Object.assign(model.player, { x: sign.x, y: sign.y + 0.9 })
    expect(model.cue()).toMatchObject({ id: 'pond-sign', action: 'tag', leadsIn: true })
    push('pond-sign', 0, 0.9)
    expect(entered).toEqual(['pond-sign'])
    // Moss still talks when E is pressed, and walking into him goes in.
    entered.length = 0
    const moss = GREENWOOD.residents.find(resident => resident.id === 'moss')!
    Object.assign(model.player, { x: moss.x, y: moss.y + 0.9 })
    expect(model.cue()).toMatchObject({ id: 'moss', action: 'act', leadsIn: true })
    expect(model.cue()!.words).toContain('or walk in')
    expect(model.interact().encounter?.id).toBe('moss')
    push('moss', 0, 0.9)
    expect(entered).toEqual(['moss'])
    // Nothing seated behind it, the other sign is only a sign: walked past, never entered.
    entered.length = 0
    const gateSign = GREENWOOD.signs.find(candidate => candidate.id === 'grove-gate-sign')!
    expect(model.enter(gateSign.id).ok).toBe(false)
  })

  it('keeps a shrine’s own gate: seated or not, it opens only when its sockets are full', () => {
    const entered: string[] = []
    const model = new RpgOverworld({ ...hooks, seat: () => true, onEntrance: id => entered.push(id) })
    const shrine = SEVENFOLD_VALLEY.shrines[0]!
    Object.assign(model.player, { x: shrine.x, y: shrine.y + 0.9 })
    expect(model.enter(shrine.id).ok).toBe(false)
    expect(entered).toEqual([])
  })

  it('shows a whole world as a small map, walked or not', () => {
    const map = worldMap(GREENWOOD)
    expect(map.cols).toBe(36)
    expect(map.rows).toBe(28)
    expect(map.rgb.length).toBe(36 * 28 * 3)
    expect(new Set(Array.from({ length: 36 * 28 }, (_, cell) => map.rgb.slice(cell * 3, cell * 3 + 3).join(','))).size).toBeGreaterThan(4)
  })

  it('reads a participant world back from plain data, and refuses a malformed or unwalkable one', () => {
    const read = sanitizeWorld(JSON.parse(JSON.stringify(GREENWOOD)))
    expect(read).not.toBeNull()
    expect(islandOf(read!.island).grid).toEqual(islandOf(GREENWOOD.island).grid)
    expect(read!.doors).toEqual(GREENWOOD.doors)
    expect(read!.areas).toEqual(GREENWOOD.areas)
    expect(read!.residents.map(resident => resident.id)).toEqual(['moss', 'tamsin'])
    const broken = (patch: (world: Record<string, any>) => void): WorldDefinition | null => {
      const world = JSON.parse(JSON.stringify(GREENWOOD)) as Record<string, any>
      patch(world)
      return sanitizeWorld(world)
    }
    expect(broken(world => { world.id = 'Not An Id' })).toBeNull()
    expect(broken(world => { world.island.cols = 4000 })).toBeNull()
    expect(broken(world => { world.island.edge = 'lava' })).toBeNull()
    expect(broken(world => { world.start = { x: 0.5, y: 0.5 } })).toBeNull() // inside the ring of trees
    expect(broken(world => { world.island.roads = [['grove-gate', 'nowhere']] })).toBeNull()
    expect(broken(world => { world.doors[1].id = world.doors[0].id })).toBeNull()
    expect(broken(world => { world.signs[0].text = 'x'.repeat(5000) })).toBeNull()
    // The valley's own story does not travel with an add-on world.
    expect(broken(world => { world.shrines = [{ kind: 'shrine', id: 'x', name: 'x', x: 1, y: 1 }] })?.shrines).toEqual([])
  })

  it('registers a new world under its own id and never replaces a known one', () => {
    const copy = sanitizeWorld({ ...JSON.parse(JSON.stringify(GREENWOOD)), id: 'greenwood-copy' })!
    expect(registerWorld(copy)).toBe(true)
    expect(WORLDS.get('greenwood-copy')).toBe(copy)
    expect(registerWorld({ ...copy, name: 'Another' })).toBe(false)
    expect(registerWorld({ ...GREENWOOD })).toBe(false)
    expect(WORLDS.get('greenwood')).toBe(GREENWOOD)
  })
})
