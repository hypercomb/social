// The worlds a traveller can walk. The Sevenfold Valley is the first; every
// other world sits behind an entrance in another one — a grove you push
// into, a cave mouth, a door, a found thing that opens — and has entrances
// of its own, worlds all the way down (jwize, 2026-09-22: "a lot of the time
// we want to actually enter a whole new world … new little areas where they
// also have their own little nested entrances and side terrain like
// mountains and trees and towns, caves and caverns"). A world is one
// `WorldDefinition`: plain data from which the whole place is derived, so a
// participant's world can arrive as a signed resource and be seated into an
// open entrance by their own story, with nothing in the game rewritten.

import { buildIsland, isWalkableTerrain, islandTerrainAt, STAMP_LEGEND, type IslandDef, type IslandEdge, type IslandStamp } from './island.js'
import {
  SEVENFOLD_VALLEY,
  type WorldArea, type WorldAreaFacing, type WorldCache, type WorldDefinition, type WorldDoor, type WorldPlot, type WorldResident, type WorldSign,
} from './rpg-overworld.js'
import type { TreasureKind } from './island-treasure.js'

// ── the Greenwood ────────────────────────────────────────────────────────

/** Behind the dense grove in the heart of the valley: a whole wood, ringed
 *  by old trees, with a hamlet, a pond and its stream, the Mossback ridge
 *  running up to a snowy crown, and entrances of its own — the old hollow
 *  that was once the whole of the grove, and two more that wait for whoever
 *  makes what lies behind them. */
export const GREENWOOD: WorldDefinition = {
  id: 'greenwood', name: 'The Greenwood', subtitle: 'A whole wood inside the valley’s grove',
  island: {
    seed: 23, cols: 72, rows: 56, edge: 'wood',
    spine: { name: 'The Mossback', points: [{ x: 50, y: 12 }, { x: 58, y: 20 }, { x: 60, y: 30 }] },
    forests: [{ x: 18, y: 18, r: 12 }, { x: 16, y: 40, r: 10 }, { x: 54, y: 42, r: 10 }],
    lakes: [{ x: 26, y: 32, r: 3 }],
    rivers: [[{ x: 52, y: 22 }, { x: 40, y: 26 }, { x: 28, y: 31 }]],
    towns: [{ id: 'fernhollow', name: 'Fernhollow', x: 38, y: 34, plaza: { w: 6, h: 4 } }],
    clearings: [
      { id: 'grove-gate', x: 36, y: 48, r: 3 },
      { id: 'hollow-clearing', x: 20, y: 24, r: 3 },
      { id: 'root-clearing', x: 54, y: 32, r: 3 },
      { id: 'burrow-clearing', x: 14, y: 42, r: 3 },
    ],
    stamps: [],
    regions: [
      { name: 'Fernhollow', x: 38, y: 34, r: 8 },
      { name: 'The Mossback', x: 56, y: 20, r: 10 },
      { name: 'Still Pond', x: 26, y: 32, r: 5 },
      { name: 'The Old Hollow', x: 20, y: 23, r: 5 },
    ],
    roads: [['grove-gate', 'fernhollow'], ['fernhollow', 'hollow-clearing'], ['fernhollow', 'root-clearing'], ['fernhollow', 'burrow-clearing']],
    wilds: 'The Greenwood',
  },
  start: { x: 36.5, y: 47.5 },
  shrines: [], people: [], dungeons: [],
  residents: [
    {
      kind: 'resident', id: 'moss', name: 'Moss', role: 'Keeper of Fernhollow', x: 36.5, y: 33.5, color: '#6f9a4a',
      lines: [
        'You came in through the grove? Most folk in the valley think it is a clump of trees and nothing more.',
        'The wood is bigger on the inside than the grove on the outside. Everything worth finding is.',
      ],
      later: [{ when: { done: 'hollow-grove' }, text: 'So the old hollow let you in. It was all anyone knew of this wood, once.' }],
    },
    {
      kind: 'resident', id: 'tamsin', name: 'Tamsin', role: 'Forager', x: 40.5, y: 34.5, color: '#b0874f',
      lines: [
        'West of Still Pond the trees stand so close they make a room. That is the old hollow.',
        'Up on the Mossback there is a cache the climbers left. Mind the rock — the hills take you, the crags do not.',
        'Under the Mossback’s roots a cave runs east a long way. The burrow by the western trees goes straight down. Mind the gaps: some have no bottom.',
      ],
    },
  ] satisfies WorldResident[],
  plots: [],
  caches: [
    {
      kind: 'cache', id: 'climbers-cache', name: 'Climbers’ Cache', subtitle: 'High on the Mossback', x: 47.5, y: 14.5,
      lore: 'Whoever reaches the Mossback’s shoulder can see the whole Greenwood — and how much bigger it is than the grove that holds it.',
      items: [{ kind: 'note', name: 'Climber’s map' }, { kind: 'feather', name: 'Ridge-kite feather' }],
    },
  ] satisfies WorldCache[],
  signs: [
    { kind: 'sign', id: 'grove-gate-sign', name: 'Signpost', subtitle: 'Inside the grove', x: 35.5, y: 46.5, text: 'THE GREENWOOD. North: Fernhollow. West of Still Pond: the old hollow. East: the roots of the Mossback.' },
    { kind: 'sign', id: 'pond-sign', name: 'Signpost', subtitle: 'By Still Pond', x: 27.5, y: 28.5, text: 'Still Pond. The stream comes down from the Mossback; the old hollow is a little way west.' },
  ] satisfies WorldSign[],
  doors: [
    { kind: 'door', id: 'root-cave', name: 'A cave under the roots', subtitle: 'The Root Run, running east', x: 55.5, y: 31.5, empty: 'A cold draught comes out between the roots, but the way in is not made yet.' },
    { kind: 'door', id: 'burrow', name: 'A burrow', subtitle: 'The Burrow, going down', x: 12.5, y: 42.5, empty: 'Something has dug deep here. Whatever it dug toward, nobody has made it yet.' },
  ] satisfies WorldDoor[],
  areas: [
    {
      kind: 'area', id: 'old-hollow', name: 'The old hollow', subtitle: 'Trees so close they make a room', x: 19.5, y: 22.5,
      cells: [[18, 21], [19, 21], [20, 21], [18, 22], [19, 22], [20, 22], [18, 23], [19, 23], [20, 23]],
      landings: {
        south: { x: 19.5, y: 24.5, facing: 'up' },
        east: { x: 21.5, y: 22.5, facing: 'left' },
        north: { x: 21.5, y: 22.5, facing: 'left' },
        west: { x: 19.5, y: 24.5, facing: 'up' },
      },
      empty: 'The trees close ranks; there’s no way through yet.',
    },
  ] satisfies WorldArea[],
}

// ── the catalog ──────────────────────────────────────────────────────────

const worlds = new Map<string, WorldDefinition>([[SEVENFOLD_VALLEY.id, SEVENFOLD_VALLEY], [GREENWOOD.id, GREENWOOD]])

/** Every world by its place id. A place that is a world is walked as one. */
export const WORLDS: ReadonlyMap<string, WorldDefinition> = worlds

/** Adds a world — a participant's, arriving as data — under its own id. A
 *  world already known keeps its definition: a new id is a new world. */
export function registerWorld(world: WorldDefinition): boolean {
  if (worlds.has(world.id)) return false
  worlds.set(world.id, world)
  return true
}

// ── participant worlds ───────────────────────────────────────────────────

const ID = /^[a-z0-9-]{1,64}$/
const MIN_SIDE = 16, MAX_SIDE = 256
const FACINGS: ReadonlySet<string> = new Set<WorldAreaFacing>(['up', 'down', 'left', 'right'])
const EDGES: ReadonlySet<string> = new Set<IslandEdge>(['sea', 'wood', 'cliff'])
const TREASURES: ReadonlySet<string> = new Set<TreasureKind>(['note', 'coins', 'gem', 'feather'])

type Raw = Record<string, unknown>
const record = (value: unknown): Raw | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : null
const text = (value: unknown, max: number): string | null => typeof value === 'string' && value.length <= max ? value : null
const whole = (value: unknown, min: number, max: number): number | null => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null
const within = (value: unknown, max: number): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < max ? value : null
function list<T>(value: unknown, max: number, each: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null
  const out: T[] = []
  for (const item of value) { const read = each(item); if (read === null) return null; out.push(read) }
  return out
}

/** Reads a world a participant made. Everything that makes a world a place
 *  to walk — its ground, its people, its signs and caches, its doors and
 *  groves that open onto further worlds — is kept; what belongs to the
 *  valley's own story (shrines, riddles, the sealed caverns) is not a thing
 *  an add-on world can carry, and neither is the valley's hand-made heart.
 *  Anything malformed, oversized, or that cannot be built and walked from
 *  its start refuses the whole world: null. */
export function sanitizeWorld(raw: unknown): WorldDefinition | null {
  const world = record(raw), ground = record(world?.['island'])
  if (!world || !ground) return null
  const id = text(world['id'], 64), name = text(world['name'], 80), subtitle = text(world['subtitle'], 160)
  if (!id || !ID.test(id) || name === null || subtitle === null) return null
  const cols = whole(ground['cols'], MIN_SIDE, MAX_SIDE), rows = whole(ground['rows'], MIN_SIDE, MAX_SIDE)
  const seed = whole(ground['seed'], 0, 2 ** 31 - 1)
  if (cols === null || rows === null || seed === null) return null
  const edge = ground['edge'] === undefined ? undefined : EDGES.has(ground['edge'] as string) ? ground['edge'] as IslandEdge : null
  if (edge === null) return null
  const point = (value: unknown): { x: number; y: number } | null => {
    const at = record(value), x = within(at?.['x'], cols), y = within(at?.['y'], rows)
    return x === null || y === null ? null : { x, y }
  }
  const circle = (value: unknown): { x: number; y: number; r: number } | null => {
    const at = point(value), r = whole(record(value)?.['r'], 1, 64)
    return at && r !== null ? { ...at, r } : null
  }
  const spine = record(ground['spine'])
  const spineName = text(spine?.['name'], 80), spinePoints = list(spine?.['points'], 12, point)
  const forests = list(ground['forests'], 16, circle), lakes = list(ground['lakes'], 16, circle)
  const rivers = list(ground['rivers'], 8, river => { const points = list(river, 12, point); return points && points.length >= 2 ? points : null })
  const towns = list(ground['towns'], 8, value => {
    const town = record(value), at = point(value), plaza = record(town?.['plaza'])
    const townId = text(town?.['id'], 64), townName = text(town?.['name'], 80)
    const w = whole(plaza?.['w'], 2, 16), h = whole(plaza?.['h'], 2, 16)
    return at && townId && ID.test(townId) && townName !== null && w !== null && h !== null ? { id: townId, name: townName, ...at, plaza: { w, h } } : null
  })
  const clearings = list(ground['clearings'], 16, value => {
    const at = circle(value), clearingId = text(record(value)?.['id'], 64)
    return at && clearingId && ID.test(clearingId) ? { id: clearingId, ...at } : null
  })
  const regions = list(ground['regions'], 16, value => {
    const at = circle(value), regionName = text(record(value)?.['name'], 80)
    return at && regionName !== null ? { name: regionName, ...at } : null
  })
  const stamps = list(ground['stamps'] ?? [], 4, value => {
    const stamp = record(value), stampId = text(stamp?.['id'], 64), stampName = text(stamp?.['name'], 80)
    const col = whole(stamp?.['col'], 0, cols - 1), row = whole(stamp?.['row'], 0, rows - 1)
    const map = list(stamp?.['map'], 32, line => typeof line === 'string' && line.length > 0 && line.length <= 32 && [...line].every(cell => cell in STAMP_LEGEND) ? line : null)
    const gates = list(stamp?.['gates'], 8, gate => {
      const at = record(gate), gateId = text(at?.['id'], 64), gateCol = whole(at?.['col'], 0, 31), gateRow = whole(at?.['row'], 0, 31)
      return gateId && ID.test(gateId) && gateCol !== null && gateRow !== null ? { id: gateId, col: gateCol, row: gateRow } : null
    })
    return stampId && ID.test(stampId) && stampName !== null && col !== null && row !== null && map && map.length && gates
      ? { id: stampId, name: stampName, col, row, map, gates } satisfies IslandStamp : null
  })
  const roads = list(ground['roads'], 32, pair => Array.isArray(pair) && pair.length === 2 && pair.every(end => typeof end === 'string' && end.length <= 64) ? [pair[0] as string, pair[1] as string] as const : null)
  const wilds = text(ground['wilds'], 80)
  if (spineName === null || !spinePoints || !forests || !lakes || !rivers || !towns || !clearings || !regions || !stamps || !roads || wilds === null) return null
  const island: IslandDef = { seed, cols, rows, ...(edge ? { edge } : {}), spine: { name: spineName, points: spinePoints }, forests, lakes, rivers, towns, clearings, stamps, regions, roads, wilds }
  let built: ReturnType<typeof buildIsland>
  try { built = buildIsland(island) } catch { return null }
  const walkable = (at: { x: number; y: number }): boolean => isWalkableTerrain(islandTerrainAt(built, Math.floor(at.x), Math.floor(at.y)))
  const start = point(world['start'])
  if (!start || !walkable(start)) return null

  const ids = new Set<string>()
  const place = (value: unknown): { id: string; name: string; x: number; y: number } | null => {
    const at = point(value), placeId = text(record(value)?.['id'], 64), placeName = text(record(value)?.['name'], 80)
    if (!at || !placeId || !ID.test(placeId) || placeName === null || ids.has(placeId)) return null
    ids.add(placeId)
    return { id: placeId, name: placeName, ...at }
  }
  const residents = list(world['residents'] ?? [], 16, value => {
    const at = place(value), role = text(record(value)?.['role'], 80), color = text(record(value)?.['color'], 16)
    const lines = list(record(value)?.['lines'], 8, line => text(line, 600))
    return at && role !== null && color !== null && /^#[0-9a-f]{6}$/i.test(color) && lines ? { kind: 'resident' as const, ...at, role, color, lines } : null
  })
  const signs = list(world['signs'] ?? [], 16, value => {
    const at = place(value), sub = text(record(value)?.['subtitle'], 160), words = text(record(value)?.['text'], 600)
    return at && sub !== null && words !== null ? { kind: 'sign' as const, ...at, subtitle: sub, text: words } : null
  })
  const caches = list(world['caches'] ?? [], 16, value => {
    const at = place(value), sub = text(record(value)?.['subtitle'], 160), lore = text(record(value)?.['lore'], 600)
    const items = list(record(value)?.['items'], 6, item => {
      const kind = record(item)?.['kind'], itemName = text(record(item)?.['name'], 80)
      return typeof kind === 'string' && TREASURES.has(kind) && itemName !== null ? { kind: kind as TreasureKind, name: itemName } : null
    })
    return at && sub !== null && lore !== null && items ? { kind: 'cache' as const, ...at, subtitle: sub, lore, items } : null
  })
  const doors = list(world['doors'] ?? [], 16, value => {
    const at = place(value), sub = text(record(value)?.['subtitle'], 160), empty = text(record(value)?.['empty'], 600)
    return at && sub !== null && empty !== null ? { kind: 'door' as const, ...at, subtitle: sub, empty } : null
  })
  const plots = list(world['plots'] ?? [], 16, value => {
    const at = place(value), sub = text(record(value)?.['subtitle'], 160), clue = text(record(value)?.['clue'], 600)
    return at && sub !== null && clue !== null ? { kind: 'plot' as const, ...at, subtitle: sub, clue } : null
  })
  const areas = list(world['areas'] ?? [], 8, value => {
    const at = place(value), area = record(value), sub = text(area?.['subtitle'], 160), empty = text(area?.['empty'], 600)
    const cells = list(area?.['cells'], 25, cell => Array.isArray(cell) && cell.length === 2 && whole(cell[0], 0, cols - 1) !== null && whole(cell[1], 0, rows - 1) !== null ? [cell[0] as number, cell[1] as number] as const : null)
    const sides = record(area?.['landings'])
    const landing = (side: string): { x: number; y: number; facing: WorldAreaFacing } | null => {
      const spot = point(sides?.[side]), facing = record(sides?.[side])?.['facing']
      return spot && typeof facing === 'string' && FACINGS.has(facing) ? { ...spot, facing: facing as WorldAreaFacing } : null
    }
    const north = landing('north'), south = landing('south'), east = landing('east'), west = landing('west')
    return at && sub !== null && empty !== null && cells && cells.length && north && south && east && west
      ? { kind: 'area' as const, ...at, subtitle: sub, cells, landings: { north, south, east, west }, empty } : null
  })
  if (!residents || !signs || !caches || !doors || !plots || !areas) return null
  return {
    id, name, subtitle, island, start,
    shrines: [], people: [], dungeons: [],
    residents, plots, caches, signs, doors, areas,
  } satisfies WorldDefinition
}
