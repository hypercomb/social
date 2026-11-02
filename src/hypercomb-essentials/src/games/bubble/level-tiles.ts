// A Bubble Bobble level, as people read it.
//
// The campaign is decoded from the DOS release as 800 raw cell bytes per round
// (tile-surface.ts keeps that form as the seed). This is the same level in
// words and pictures a person can edit:
//
//   map     25 rows of 32 characters   '#' side wall  '=' platform  '.' air
//   flow    25 rows of 32 characters   which way a bubble drifts: ^ > v <
//   enemies one tile each              what it is, where it stands, when it
//                                      comes in, which way it faces
//
// A cell byte is only `solid | flow << 1`, so map + flow carry every bit of it.
// Nothing here touches the hive: it turns a LevelDef into records and back, and
// says how the enemy tiles are laid out so a layer never lists a long flat set.

import type { EnemyKind, EnemySpawn, LevelDef } from './engine.js'
import { CAVE_COLUMNS, CAVE_LEFT, CAVE_ROWS, TILE } from './dos-geometry.js'

export const LEVEL_GROUP = 'levels'
export const LEVEL_VERSION = 2
/** The columns after the cave the DOS work area keeps per row. Play never addresses them. */
export const WORK_COLUMNS = 8
/** More enemies than this in a level are grouped by kind, so no layer lists a long flat set. */
export const GROUP_ABOVE = 8

export const ENEMY_KINDS: readonly EnemyKind[] = [
  'zenchan', 'hidegons', 'banebou', 'pulpul', 'monsta', 'drunk', 'mighta', 'invader',
]

/** Bubble drift for flow 0..3, in the order the cell bits count: up, right, down, left. */
export const FLOW_GLYPHS = ['^', '>', 'v', '<'] as const

export interface LevelRecord {
  version: typeof LEVEL_VERSION
  index: number
  name: string
  /** Terrain, one string per row. */
  map: string[]
  /** Bubble drift, one string per row. */
  flow: string[]
  /** The DOS work columns beside the cave, digits 0-7 per row. Not used by play. */
  work: string[]
  player: { col: number; row: number }
  /** The three native airflow settings for the round. */
  airflowSettings: [number, number, number]
  sourceSha256: string
}

export interface EnemyRecord {
  version: typeof LEVEL_VERSION
  kind: EnemyKind
  col: number
  row: number
  /** Native delay before it comes in (0-63). */
  enters: number
  faces: 'left' | 'right'
  /** The native heading code; `faces` wins where they disagree. */
  heading: number
  variant: number
  /** Its place in the level's enemy list; the list order is play order. */
  order: number
}

/** One tile to write under a level: an enemy, or a group of them. */
export interface EnemyPlacement {
  /** Path below the level tile: [name] or [kind, name]. */
  path: readonly string[]
  record?: EnemyRecord
  group?: EnemyKind
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const whole = (value: unknown, low: number, high: number): value is number =>
  Number.isInteger(value) && Number(value) >= low && Number(value) <= high

export const levelName = (index: number): string => `level-${String(index + 1).padStart(3, '0')}`

/** The '#' / '=' / '.' picture of a set of cells. Also what the engine plays on. */
export const terrain = (rows: readonly (readonly number[])[]): string[] => rows.map(row =>
  row.slice(0, CAVE_COLUMNS).map((value, col) => value & 1
    ? (col < 2 || col >= CAVE_COLUMNS - 2 ? '#' : '=') : '.').join(''))

const enemyCell = (spawn: Pick<EnemySpawn, 'x' | 'y'>): { col: number; row: number } => ({
  col: (spawn.x - CAVE_LEFT) / TILE,
  row: spawn.y / TILE,
})

export function encodeLevel(level: LevelDef, index: number, sourceSha256: string): { level: LevelRecord; enemies: EnemyRecord[] } {
  const cells = level.nativeCells
  if (!cells || cells.length !== CAVE_ROWS || !level.airflowSettings) throw new Error('A level needs its native cells to be written as tiles')
  const player = enemyCell(level.spawn)
  return {
    level: {
      version: LEVEL_VERSION,
      index,
      name: level.name,
      map: terrain(cells),
      flow: cells.map(row => row.slice(0, CAVE_COLUMNS).map(value => FLOW_GLYPHS[(value >> 1) & 3]).join('')),
      work: cells.map(row => row.slice(CAVE_COLUMNS, CAVE_COLUMNS + WORK_COLUMNS).join('')),
      player,
      airflowSettings: [...level.airflowSettings] as [number, number, number],
      sourceSha256,
    },
    enemies: level.enemies.map((spawn, order) => {
      const heading = spawn.headingCode ?? 0
      const { col, row } = enemyCell(spawn)
      return {
        version: LEVEL_VERSION,
        kind: spawn.kind,
        col,
        row,
        enters: spawn.spawnDelay ?? 0,
        faces: heading & 1 ? 'right' : 'left',
        heading,
        variant: spawn.variant ?? 0,
        order,
      } satisfies EnemyRecord
    }),
  }
}

/** Rebuild the level the engine plays from its records. Throws on anything malformed. */
export function decodeLevel(record: unknown, enemies: readonly unknown[]): LevelDef {
  if (!validLevel(record)) throw new Error('The level tile is not a compatible Bubble Bobble level')
  const nativeCells = record.map.map((mapRow, row) => {
    const cells = [...mapRow].map((glyph, col) => (glyph === '.' ? 0 : 1) | (FLOW_GLYPHS.indexOf(record.flow[row][col] as typeof FLOW_GLYPHS[number]) << 1))
    return cells.concat([...record.work[row]].map(Number))
  })
  const list = enemies.map(entry => {
    if (!validEnemy(entry)) throw new Error('A level enemy tile is not a compatible Bubble Bobble enemy')
    return entry
  }).sort((a, b) => a.order - b.order)
  if (new Set(list.map(enemy => enemy.order)).size !== list.length) throw new Error('The level has duplicate enemy order values')
  return {
    name: record.name,
    tiles: terrain(nativeCells),
    nativeCells,
    airflowSettings: [...record.airflowSettings],
    enemies: list.map(enemy => {
      // `faces` is what a person edits; the native code keeps its other bits.
      const heading = enemy.faces === 'right' ? enemy.heading | 1 : enemy.heading & ~1
      return {
        kind: enemy.kind,
        x: CAVE_LEFT + enemy.col * TILE,
        y: enemy.row * TILE,
        spawnDelay: enemy.enters,
        activationDelayTicks: Math.floor((enemy.enters * 5) / 2),
        headingCode: heading,
        variant: enemy.variant,
      }
    }),
    spawn: { x: CAVE_LEFT + record.player.col * TILE, y: record.player.row * TILE },
  }
}

/** Where each enemy tile goes below its level: flat while there are few, one group per kind past that. */
export function placeEnemies(enemies: readonly EnemyRecord[]): EnemyPlacement[] {
  const seen = new Map<EnemyKind, number>()
  const named = enemies.map(record => {
    const n = (seen.get(record.kind) ?? 0) + 1
    seen.set(record.kind, n)
    return { record, name: `${record.kind}-${n}` }
  })
  if (enemies.length <= GROUP_ABOVE) return named.map(({ record, name }) => ({ path: [name], record }))
  const placements: EnemyPlacement[] = [...seen.keys()].map(kind => ({ path: [kind], group: kind }))
  for (const { record, name } of named) placements.push({ path: [record.kind, name], record })
  return placements
}

export function validLevel(value: unknown): value is LevelRecord {
  if (!object(value) || value['version'] !== LEVEL_VERSION || !whole(value['index'], 0, 99)
    || typeof value['name'] !== 'string' || typeof value['sourceSha256'] !== 'string') return false
  const rows = (key: string, pattern: RegExp, width: number): boolean => {
    const part = value[key]
    return Array.isArray(part) && part.length === CAVE_ROWS
      && part.every(row => typeof row === 'string' && row.length === width && pattern.test(row))
  }
  const player = value['player']
  const settings = value['airflowSettings']
  return rows('map', /^[#=.]+$/, CAVE_COLUMNS) && rows('flow', /^[\^>v<]+$/, CAVE_COLUMNS) && rows('work', /^[0-7]+$/, WORK_COLUMNS)
    && object(player) && whole(player['col'], 0, CAVE_COLUMNS - 1) && whole(player['row'], 0, CAVE_ROWS - 1)
    && Array.isArray(settings) && settings.length === 3 && settings.every(setting => whole(setting, 0, 0xff))
}

export function validEnemy(value: unknown): value is EnemyRecord {
  return object(value) && value['version'] === LEVEL_VERSION
    && ENEMY_KINDS.includes(value['kind'] as EnemyKind)
    && whole(value['col'], 0, CAVE_COLUMNS - 1) && whole(value['row'], 0, CAVE_ROWS - 1)
    && whole(value['enters'], 0, 63) && (value['faces'] === 'left' || value['faces'] === 'right')
    && whole(value['heading'], 0, 0xff) && whole(value['variant'], 0, 1) && whole(value['order'], 0, 0xff)
}
