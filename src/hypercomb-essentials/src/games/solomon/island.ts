/** The island above the rooms.
 *
 * ONE small definition — a seed, a size, a mountain spine and the places
 * people made (the valley, towns, plots and the roads between them) — and
 * everything else is DERIVED from it: height, coast, forest, lakes, rivers,
 * bridges. The grid is a recomputable projection of that definition, never
 * saved and never truth, so a cold client rebuilds the same island from the
 * same definition. Pure: no DOM, no storage. */

export type IslandTerrain =
  | 'deep' | 'water' | 'sand' | 'grass' | 'path' | 'bridge'
  | 'tree' | 'hill' | 'rock' | 'snow' | 'plaza' | 'house'
  // Brickwork the wand answers. `brick` is solid; a `crack` crumbles to
  // `rubble`; a `rune` plate takes a `laid` brick; a rune `spring` takes a
  // stepping `stone`; a `seal` stands until every plate of its place holds a
  // brick, and then it is rubble too. `rubble`, `laid` and `stone` are never
  // built — they are what the wand makes of the others.
  | 'brick' | 'crack' | 'rubble' | 'rune' | 'laid' | 'spring' | 'stone' | 'seal'

/** Terrain codes index this list; the grid stores one code per cell. */
export const ISLAND_TERRAINS: readonly IslandTerrain[] = [
  'deep', 'water', 'sand', 'grass', 'path', 'bridge', 'tree', 'hill', 'rock', 'snow', 'plaza', 'house',
  'brick', 'crack', 'rubble', 'rune', 'laid', 'spring', 'stone', 'seal',
]
const CODE = Object.fromEntries(ISLAND_TERRAINS.map((terrain, code) => [terrain, code])) as Record<IslandTerrain, number>
const WALKABLE: ReadonlySet<IslandTerrain> = new Set<IslandTerrain>(['sand', 'grass', 'path', 'bridge', 'hill', 'plaza', 'rubble', 'rune', 'stone'])
export function isWalkableTerrain(terrain: IslandTerrain): boolean { return WALKABLE.has(terrain) }

export interface IslandPoint { x: number; y: number }
export interface IslandCircle extends IslandPoint { r: number }
export interface IslandTown extends IslandPoint { id: string; name: string; plaza: { w: number; h: number } }
export interface IslandClearing extends IslandCircle { id: string }
export interface IslandRegion extends IslandCircle { name: string }
/** A hand-made place set into the island tile for tile, as the valley is. */
export interface IslandStamp {
  id: string
  name: string
  col: number
  row: number
  /** One string per row, one character per cell; see STAMP_LEGEND. */
  map: readonly string[]
  /** Border cells where roads meet the place, in its own coordinates. */
  gates: readonly { id: string; col: number; row: number }[]
}
export const STAMP_LEGEND: Readonly<Record<string, IslandTerrain>> = {
  '.': 'grass', 's': 'sand', '#': 'path', 'P': 'plaza', 'T': 'tree', '~': 'water', 'h': 'hill', 'A': 'rock',
  'W': 'brick', 'B': 'crack', 'r': 'rune', 'm': 'spring', 'S': 'seal',
}
export interface IslandDef {
  seed: number
  cols: number
  rows: number
  /** The hand-authored starting valley; its local (0, 0) sits at this cell. */
  valley: { col: number; row: number; name: string }
  /** The mountain range: the land rises toward this line. */
  spine: { name: string; points: readonly IslandPoint[] }
  forests: readonly IslandCircle[]
  lakes: readonly IslandCircle[]
  /** Each river runs source → mouth through its points, meandering between them. */
  rivers: readonly (readonly IslandPoint[])[]
  towns: readonly IslandTown[]
  /** Flat open ground kept for a place — a shrine plot, for instance. */
  clearings: readonly IslandClearing[]
  stamps: readonly IslandStamp[]
  /** Names announced as the player walks in; the first containing circle wins. */
  regions: readonly IslandRegion[]
  /** Pairs of place ids joined by a road: `valley-east|south|north`, a town,
   *  a clearing, or a stamp gate as `<stamp>-<gate>`. */
  roads: readonly (readonly [string, string])[]
  /** The name of everywhere no region names. */
  wilds: string
}
export interface IslandHouse { x: number; y: number; w: number; h: number; roof: number }
export interface Island {
  readonly def: IslandDef
  readonly cols: number
  readonly rows: number
  readonly grid: Uint8Array
  readonly houses: readonly IslandHouse[]
  /** The index of the stamp each cell belongs to, or -1. */
  readonly stampOf: Int16Array
}

export function stampWidth(stamp: IslandStamp): number { return stamp.map[0]?.length ?? 0 }

// ── the valley ─────────────────────────────────────────────

export const VALLEY_COLS = 24
export const VALLEY_ROWS = 16
/** Border cells of the valley's tree ring that open onto island roads. */
export const VALLEY_EXITS = {
  east: { col: 23, row: 7 }, south: { col: 12, row: 15 }, north: { col: 16, row: 0 },
} as const

/** The original Sevenfold Valley, tile for tile, in its own coordinates. The
 *  only change is three gaps in the tree ring where its paths run on out
 *  into the island. */
export function valleyTerrain(col: number, row: number): IslandTerrain {
  if ((row === VALLEY_EXITS.east.row && col >= 21 && col <= 23)
    || (col === VALLEY_EXITS.south.col && row >= 13 && row <= 15)
    || (col === VALLEY_EXITS.north.col && row >= 0 && row <= 3)) return 'path'
  if (col < 1 || col >= VALLEY_COLS - 1 || row < 1 || row >= VALLEY_ROWS - 1) return 'tree'
  if (col >= 2 && col <= 5 && row >= 3 && row <= 6) return 'water'
  if ((col >= 2 && col <= 3 && row >= 8 && row <= 9) || (col >= 12 && col <= 14 && row >= 2 && row <= 4)) return 'tree'
  if (col >= 19 && row <= 2) return 'rock'
  if ((row === 12 && col >= 3 && col <= 20) || (col === 8 && row >= 4 && row <= 12)
    || (row === 7 && col >= 8 && col <= 20) || (col === 16 && row >= 4 && row <= 12)
    || (col === 20 && row >= 4 && row <= 12) || (col === 12 && row >= 7 && row <= 12)
    || (row === 11 && col >= 4 && col <= 8)) return 'path'
  return 'grass'
}

// ── lookups ────────────────────────────────────────────────

const SPINE_REACH = 15

export function islandTerrainAt(island: Island, col: number, row: number): IslandTerrain {
  if (col < 0 || row < 0 || col >= island.cols || row >= island.rows) return 'deep'
  return ISLAND_TERRAINS[island.grid[row * island.cols + col]] ?? 'deep'
}

export function islandRegionAt(island: Island, x: number, y: number): string {
  const { valley, regions, spine, wilds } = island.def
  if (x >= valley.col && x < valley.col + VALLEY_COLS && y >= valley.row && y < valley.row + VALLEY_ROWS) return valley.name
  for (const stamp of island.def.stamps) {
    if (x >= stamp.col && x < stamp.col + stampWidth(stamp) && y >= stamp.row && y < stamp.row + stamp.map.length) return stamp.name
  }
  for (const region of regions) if (Math.hypot(x - region.x, y - region.y) <= region.r) return region.name
  return distanceToPolyline(x, y, spine.points) <= SPINE_REACH ? spine.name : wilds
}

/** Integer hash → [0, 1). Math.imul only, so every platform agrees. */
export function islandHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x3c6ef372)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// ── generation ─────────────────────────────────────────────

export function buildIsland(def: IslandDef): Island {
  const { cols, rows, seed, valley } = def
  const grid = new Uint8Array(cols * rows)
  // Settled ground — the valley and its margin, towns, clearings — is flat
  // and dry, and rivers pass around the people living on it.
  const settledGround = new Uint8Array(cols * rows)
  const settlements: IslandCircle[] = [
    ...def.towns.map(town => ({ x: town.x, y: town.y, r: Math.max(town.plaza.w, town.plaza.h) / 2 + 6 })),
    ...def.clearings,
  ]
  const places = def.stamps.map(stamp => ({ stamp, width: stampWidth(stamp), height: stamp.map.length }))
  for (const { stamp, width } of places) for (const line of stamp.map) {
    if (line.length !== width) throw new Error(`Island stamp ${stamp.id} has rows of different lengths`)
    for (const cell of line) if (!(cell in STAMP_LEGEND)) throw new Error(`Island stamp ${stamp.id} uses an unknown cell: ${cell}`)
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const index = y * cols + x
    const nx = (x + 0.5) / cols * 2 - 1, ny = (y + 0.5) / rows * 2 - 1
    const distance = Math.hypot(nx, ny) * (1 + (fbm(x * 0.03, y * 0.03, seed + 7) - 0.5) * 0.9)
    const land = 1 - smoothstep(0.62, 0.95, distance)
    let height = land * (0.42 + (fbm(x * 0.045, y * 0.045, seed) - 0.5) * 0.3) - (1 - land) * 0.1
    const hollows = fbm(x * 0.02, y * 0.02, seed + 3, 3)
    if (hollows < 0.36) height -= (0.36 - hollows) * 1.6 * land
    const spine = distanceToPolyline(x, y, def.spine.points)
    if (spine < SPINE_REACH) height += 0.42 * Math.pow(1 - spine / SPINE_REACH, 1.5) * (0.75 + fbm(x * 0.09, y * 0.09, seed + 11, 3) * 0.5)
    for (const lake of def.lakes) {
      const t = Math.hypot(x - lake.x, y - lake.y) / lake.r
      if (t < 1.6) height = Math.min(height, 0.2 + Math.max(0, t - 1) * 0.25)
    }
    let settled = x >= valley.col - 3 && x < valley.col + VALLEY_COLS + 3 && y >= valley.row - 3 && y < valley.row + VALLEY_ROWS + 3
    for (const { stamp, width, height } of places) {
      if (x >= stamp.col - 3 && x < stamp.col + width + 3 && y >= stamp.row - 3 && y < stamp.row + height + 3) settled = true
    }
    for (const place of settlements) {
      const d = Math.hypot(x - place.x, y - place.y)
      if (d <= place.r) settled = true
      else if (d <= place.r + 3) height = Math.max(height, 0.31)
    }
    if (settled) { height = Math.min(Math.max(height, 0.36), 0.55); settledGround[index] = 1 }
    if (x < 2 || y < 2 || x >= cols - 2 || y >= rows - 2) height = Math.min(height, 0.1)
    let moisture = fbm(x * 0.035, y * 0.035, seed + 5)
    for (const forest of def.forests) {
      const t = Math.hypot(x - forest.x, y - forest.y) / forest.r
      if (t < 1) moisture += 0.2 * (1 - t * t)
    }
    grid[index] = CODE[classify(height, moisture, islandHash(x, y, seed + 9), settled)]
  }
  for (const river of def.rivers) carveRiver(grid, settledGround, cols, rows, river, seed)
  for (let row = 0; row < VALLEY_ROWS; row++) for (let col = 0; col < VALLEY_COLS; col++) {
    grid[(valley.row + row) * cols + valley.col + col] = CODE[valleyTerrain(col, row)]
  }
  const stampOf = new Int16Array(cols * rows).fill(-1)
  places.forEach(({ stamp, width, height }, index) => {
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const cell = (stamp.row + row) * cols + stamp.col + col
      grid[cell] = CODE[STAMP_LEGEND[stamp.map[row]![col]!]!]
      stampOf[cell] = index
    }
  })
  const houses = buildTowns(def, grid)
  carveRoads(def, grid, stampOf)
  return { def, cols, rows, grid, houses, stampOf }
}

function classify(height: number, moisture: number, grain: number, settled: boolean): IslandTerrain {
  if (height < 0.18) return 'deep'
  if (height < 0.26) return 'water'
  if (height < 0.3) return 'sand'
  if (height >= 0.82) return 'snow'
  if (height >= 0.7) return 'rock'
  if (height >= 0.6) return 'hill'
  if (settled) return 'grass'
  if (moisture > 0.6 && grain > 0.2) return 'tree'
  if (moisture > 0.54 && grain > 0.92) return 'tree'
  return 'grass'
}

/** A band two or three cells wide, thick enough that nothing slips through
 *  it diagonally. It bends between its points and is straight at them, so
 *  consecutive stretches always meet. */
function carveRiver(grid: Uint8Array, settledGround: Uint8Array, cols: number, rows: number, points: readonly IslandPoint[], seed: number): void {
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]!, b = points[k]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) continue
    const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length
    for (let s = 0; s <= length; s += 0.25) {
      const bend = (fbm(s * 0.06, k * 7.3, seed + 29, 3) - 0.5) * 7 * Math.min(1, s / 6, (length - s) / 6)
      const cx = a.x + ux * s - uy * bend, cy = a.y + uy * s + ux * bend
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = Math.floor(cx) + ox, gy = Math.floor(cy) + oy
        if (gx < 1 || gy < 1 || gx >= cols - 1 || gy >= rows - 1) continue
        if (Math.hypot(gx + 0.5 - cx, gy + 0.5 - cy) > 1.05) continue
        const index = gy * cols + gx
        if (settledGround[index] || grid[index] === CODE.deep) continue
        grid[index] = CODE.water
      }
    }
  }
}

/** A plaza with a ring of houses around it. The middle of every side stays
 *  open, so there is always a way in. */
function buildTowns(def: IslandDef, grid: Uint8Array): IslandHouse[] {
  const { cols, rows } = def
  const houses: IslandHouse[] = []
  const put = (x: number, y: number, terrain: IslandTerrain): void => {
    if (x >= 0 && y >= 0 && x < cols && y < rows) grid[y * cols + x] = CODE[terrain]
  }
  const house = (x: number, y: number): void => {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) put(x + dx, y + dy, 'house')
    houses.push({ x, y, w: 2, h: 2, roof: Math.floor(islandHash(x, y, def.seed + 13) * 4) })
  }
  const clearOfGate = (start: number, gate: number): boolean => start + 1 < gate - 1 || start > gate + 1
  for (const town of def.towns) {
    const x0 = Math.round(town.x - town.plaza.w / 2), y0 = Math.round(town.y - town.plaza.h / 2)
    const x1 = x0 + town.plaza.w - 1, y1 = y0 + town.plaza.h - 1
    const gateX = Math.round(town.x), gateY = Math.round(town.y)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, 'plaza')
    let next = x0 - 1
    for (let x = x0 - 1; x + 1 <= x1 + 1; x++) if (x >= next && clearOfGate(x, gateX)) {
      house(x, y0 - 3); house(x, y1 + 2); next = x + 3
    }
    next = y0 - 1
    for (let y = y0 - 1; y + 1 <= y1 + 1; y++) if (y >= next && clearOfGate(y, gateY)) {
      house(x0 - 3, y); house(x1 + 2, y); next = y + 3
    }
  }
  return houses
}

// Roads go where walking is easy, but they will bridge a river or climb a
// pass rather than fail: a road that cannot be built is an error in the
// definition, never a silently unreachable place.
const ROAD_COST: Readonly<Record<IslandTerrain, number>> = {
  deep: Infinity, house: Infinity, water: 9, sand: 1.6, grass: 1, path: 0.35, bridge: 0.35,
  tree: 3.5, hill: 2.5, rock: 14, snow: 30, plaza: 0.6,
  // Brickwork only exists inside stamps, which roads never enter (see
  // carveRoads); the entries keep the table total over every terrain.
  brick: Infinity, crack: Infinity, seal: Infinity, laid: Infinity, spring: Infinity,
  rubble: 0.6, rune: 0.6, stone: 0.6,
}
const CHEAPEST_STEP = 0.35

function carveRoads(def: IslandDef, grid: Uint8Array, stampOf: Int16Array): void {
  const { cols, rows, valley } = def
  const anchors = new Map<string, IslandPoint>([
    ['valley-east', { x: valley.col + VALLEY_COLS, y: valley.row + VALLEY_EXITS.east.row }],
    ['valley-south', { x: valley.col + VALLEY_EXITS.south.col, y: valley.row + VALLEY_ROWS }],
    ['valley-north', { x: valley.col + VALLEY_EXITS.north.col, y: valley.row - 1 }],
  ])
  for (const town of def.towns) anchors.set(town.id, { x: Math.round(town.x), y: Math.round(town.y) })
  for (const clearing of def.clearings) anchors.set(clearing.id, { x: Math.round(clearing.x), y: Math.round(clearing.y) })
  for (const stamp of def.stamps) {
    const width = stampWidth(stamp), height = stamp.map.length
    for (const gate of stamp.gates) {
      const dx = gate.col === 0 ? -1 : gate.col === width - 1 ? 1 : 0
      const dy = dx ? 0 : gate.row === 0 ? -1 : gate.row === height - 1 ? 1 : 0
      if (!dx && !dy) throw new Error(`Island stamp ${stamp.id} has a gate off its border: ${gate.id}`)
      anchors.set(`${stamp.id}-${gate.id}`, { x: stamp.col + gate.col + dx, y: stamp.row + gate.row + dy })
    }
  }
  const cost = (index: number): number => {
    const x = index % cols, y = (index - x) / cols
    // Hand-made places keep their own paths; roads meet them at their gates.
    if (stampOf[index]! >= 0) return Infinity
    if (x >= valley.col && x < valley.col + VALLEY_COLS && y >= valley.row && y < valley.row + VALLEY_ROWS) return Infinity
    return ROAD_COST[ISLAND_TERRAINS[grid[index]] ?? 'deep'] + islandHash(x, y, def.seed + 17) * 0.3
  }
  for (const [from, to] of def.roads) {
    const a = anchors.get(from), b = anchors.get(to)
    if (!a || !b) throw new Error(`Island road names an unknown place: ${a ? to : from}`)
    const route = findRoute(cols, rows, a.y * cols + a.x, b.y * cols + b.x, cost)
    if (!route) throw new Error(`Island road ${from} → ${to} cannot be built`)
    for (const index of route) {
      if (grid[index] === CODE.water) grid[index] = CODE.bridge
      else if (grid[index] !== CODE.plaza && grid[index] !== CODE.bridge) grid[index] = CODE.path
    }
  }
}

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

/** A* over four-connected cells, so every road is walkable edge to edge. */
function findRoute(cols: number, rows: number, start: number, goal: number, cost: (index: number) => number): number[] | null {
  const size = cols * rows
  const best = new Float64Array(size).fill(Infinity)
  const from = new Int32Array(size).fill(-1)
  const closed = new Uint8Array(size)
  const heap: number[] = [], scores: number[] = []
  const goalX = goal % cols, goalY = (goal - goalX) / cols
  const push = (index: number, score: number): void => {
    let i = heap.length
    heap.push(index); scores.push(score)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (scores[parent]! <= score) break
      heap[i] = heap[parent]!; scores[i] = scores[parent]!
      i = parent
    }
    heap[i] = index; scores[i] = score
  }
  const pop = (): number => {
    const top = heap[0]!
    const lastIndex = heap.pop()!, lastScore = scores.pop()!
    const n = heap.length
    if (n) {
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= n) break
        if (child + 1 < n && scores[child + 1]! < scores[child]!) child++
        if (scores[child]! >= lastScore) break
        heap[i] = heap[child]!; scores[i] = scores[child]!
        i = child
      }
      heap[i] = lastIndex; scores[i] = lastScore
    }
    return top
  }
  best[start] = 0
  push(start, 0)
  while (heap.length) {
    const index = pop()
    if (index === goal) break
    if (closed[index]) continue
    closed[index] = 1
    const x = index % cols, y = (index - x) / cols
    for (const [dx, dy] of STEPS) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
      const next = ny * cols + nx
      if (closed[next]) continue
      const step = cost(next)
      if (!Number.isFinite(step)) continue
      const score = best[index]! + step
      if (score < best[next]!) {
        best[next] = score
        from[next] = index
        push(next, score + (Math.abs(nx - goalX) + Math.abs(ny - goalY)) * CHEAPEST_STEP)
      }
    }
  }
  if (start !== goal && from[goal]! < 0) return null
  const route = [goal]
  for (let at = goal; at !== start;) { at = from[at]!; route.push(at) }
  return route.reverse()
}

// ── noise ──────────────────────────────────────────────────

function noise(x: number, y: number, salt: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const a = islandHash(xi, yi, salt), b = islandHash(xi + 1, yi, salt)
  const c = islandHash(xi, yi + 1, salt), d = islandHash(xi + 1, yi + 1, salt)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

function fbm(x: number, y: number, salt: number, octaves = 4): number {
  let sum = 0, amplitude = 0.5, total = 0, frequency = 1
  for (let octave = 0; octave < octaves; octave++) {
    sum += noise(x * frequency, y * frequency, salt + octave * 131) * amplitude
    total += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return sum / total
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function distanceToPolyline(x: number, y: number, points: readonly IslandPoint[]): number {
  if (points.length === 1) return Math.hypot(x - points[0]!.x, y - points[0]!.y)
  let best = Infinity
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]!, b = points[k]!
    const vx = b.x - a.x, vy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy || 1)))
    best = Math.min(best, Math.hypot(x - a.x - vx * t, y - a.y - vy * t))
  }
  return best
}
