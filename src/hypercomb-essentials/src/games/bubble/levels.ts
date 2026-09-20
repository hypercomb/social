import type { EnemyKind, EnemySpawn, LevelDef } from './engine.js'
import { CAVE_LEFT, TILE } from './dos-geometry.js'
import { DOS_AIRBLOCK_RECORDS, DOS_AIRFLOW_RECORDS, DOS_AIRFLOW_SETTINGS } from './dos-air-data.js'
import { DOS_ROUND_ENEMIES } from './dos-enemy-data.js'
import { DOS_ROUND_ROWS } from './dos-level-data.js'

const WIDTH = 32
const DATA_ROWS = 25
const WORK_COLUMNS = 40
const WORK_ROWS = 32

function bytes(encoded: string): number[] {
  if (encoded.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(encoded)) throw new Error('Invalid DOS byte data')
  return Array.from({ length: encoded.length / 2 }, (_, index) =>
    Number.parseInt(encoded.slice(index * 2, index * 2 + 2), 16))
}

function expandCells(encoded: string): number[][] {
  if (encoded.length !== DATA_ROWS * 8) throw new Error('Invalid DOS Bubble Bobble round data')
  const cells = Array.from({ length: WORK_ROWS }, () => Array<number>(WORK_COLUMNS).fill(0))
  for (let row = 0; row < DATA_ROWS; row++) {
    const word = Number.parseInt(encoded.slice(row * 8, row * 8 + 8), 16) >>> 0
    const rowFlags = word & 0x03
    for (let column = 0; column < WIDTH; column++) {
      const occupied = (word & (2 ** (31 - column))) !== 0
      cells[row][column] = (rowFlags << 1) | Number(occupied)
    }
    // After expanding 32 bits, the native routine writes the row airflow to
    // scratch column 32 before advancing eight more bytes to the next row.
    cells[row][WIDTH] = rowFlags << 1
    // The DOS expander overwrites cells 0/1 with type 3 and cells 30/31
    // with type 7 after reading each 32-bit row.
    cells[row][0] = 3; cells[row][1] = 3; cells[row][30] = 7; cells[row][31] = 7
  }
  return cells
}

interface Rectangle { x: number; y: number; width: number; height: number }
function rectangle(record: readonly number[], offset: number): Rectangle {
  const byte0 = record[offset], byte1 = record[offset + 1], byte2 = record[offset + 2]
  if (byte1 === undefined || byte2 === undefined) throw new Error('Truncated DOS air rectangle')
  const packed = (byte2 << 8) | byte1
  const rotated = ((packed << 2) | (packed >>> 14)) & 0xffff
  return {
    x: byte0 & 0x1f,
    y: (packed >>> 3) & 0x1f,
    width: (rotated & 0x1f) + 1,
    height: (byte2 & 0x1f) + 1,
  }
}

function paint(cells: number[][], area: Rectangle, update: (cell: number) => number): void {
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      if (cells[y]?.[x] === undefined) throw new Error('DOS air rectangle exceeds the native cave')
      cells[y][x] = update(cells[y][x])
    }
  }
}

function paintFlow(cells: number[][], record: readonly number[], offset: number): void {
  const flow = (record[offset] >>> 5) & 0x03
  paint(cells, rectangle(record, offset), cell => (cell & 0x01) | (flow << 1))
}

function mirrorFlow(cells: number[][]): void {
  for (const row of cells.slice(0, DATA_ROWS)) {
    for (let x = 0; x < WIDTH / 2; x++) {
      let flow = row[x]
      if (flow & 0x02) flow ^= 0x04
      row[WIDTH - 1 - x] = (row[WIDTH - 1 - x] & 0x01) | (flow & 0x06)
    }
  }
}

function airflowRecord(round: number): number[] {
  const record = bytes(DOS_AIRFLOW_RECORDS[round])
  if (record[0] & 0x80) return airflowRecord(record[0] & 0x7f)
  return record
}

function applyAirflow(cells: number[][], round: number): void {
  const record = airflowRecord(round)
  if (record[0] === 0) return
  if (record[0] !== record.length) throw new Error('Invalid DOS airflow record length')
  for (let cursor = 1; cursor < record.length;) {
    if (record[cursor] & 0x80) { paintFlow(cells, record, cursor); cursor += 3 }
    else { mirrorFlow(cells); cursor++ }
  }
}

function applyAirblocks(cells: number[][], round: number): void {
  const record = bytes(DOS_AIRBLOCK_RECORDS[round])
  if (record[0] !== record.length) throw new Error('Invalid DOS air-block record length')
  for (let cursor = 1; cursor < record.length; cursor += 3) {
    if (record[cursor] & 0x80) paintFlow(cells, record, cursor)
    else {
      const solid = (record[cursor] >>> 5) & 0x01
      paint(cells, rectangle(record, cursor), cell => (cell & 0x06) | solid)
    }
  }
}

/** Reproduce the native 40x25 workspace's 32 cave columns, stopping before
 * the eight presentation/scratch columns that gameplay does not address. */
export function decodeNativeCells(encoded: string, round: number): number[][] {
  const cells = expandCells(encoded)
  applyAirflow(cells, round)
  applyAirblocks(cells, round)
  return cells.slice(0, DATA_ROWS).map(row => row.slice(0, WORK_COLUMNS))
}

function terrainRows(cells: readonly (readonly number[])[]): string[] {
  return cells.map(row => row.slice(0, WIDTH).map((cell, column) => cell & 0x01
    ? (column < 2 || column >= WIDTH - 2 ? '#' : '=') : '.').join(''))
}

// Native archetype dispatch order at unpacked BUBBOB.DAT offset A81F. The
// identities are corroborated by the round where each behavior first appears.
const ENEMY_KINDS: readonly EnemyKind[] = [
  'zenchan', 'hidegons', 'banebou', 'pulpul',
  'monsta', 'drunk', 'mighta', 'invader',
]

/** Decode one native, zero-terminated descriptor list after its terminator has
 * been removed. The three-byte records are retained as typed spawn metadata. */
export function decodeEnemySpawns(encoded: string): EnemySpawn[] {
  if (encoded.length % 6 !== 0 || !/^[0-9a-f]*$/i.test(encoded)) {
    throw new Error('Invalid DOS Bubble Bobble enemy data')
  }
  const enemies: EnemySpawn[] = []
  for (let offset = 0; offset < encoded.length; offset += 6) {
    const byte0 = Number.parseInt(encoded.slice(offset, offset + 2), 16)
    const byte1 = Number.parseInt(encoded.slice(offset + 2, offset + 4), 16)
    const byte2 = Number.parseInt(encoded.slice(offset + 4, offset + 6), 16)
    const packedHeading = ((byte2 << 8) | byte1) & 0xffff
    const rotated = ((packedHeading << 2) | (packedHeading >>> 14)) & 0xffff
    const nativeY = byte1 & 0xf8
    enemies.push({
      kind: ENEMY_KINDS[byte0 & 0x07],
      x: (byte0 & 0xf8) + CAVE_LEFT,
      y: nativeY === 0 ? 0 : nativeY - TILE,
      spawnDelay: byte2 & 0x3f,
      activationDelayTicks: Math.floor(((byte2 & 0x3f) * 5) / 2),
      headingCode: (rotated & 0x1f) ^ 1,
      variant: (byte2 >>> 6) & 0x01,
    })
  }
  return enemies
}

/** CS:8832 and CS:8951: player one enters at x=0x38 and settles at y=0xb0. */
const playerSpawn = (): LevelDef['spawn'] => ({ x: 0x38, y: 0xb0 })

/** All 100 campaign rounds decoded from the supplied 1989 DOS release. */
export const BUILTIN_LEVELS: readonly LevelDef[] = DOS_ROUND_ROWS.map((encoded, index) => {
  const nativeCells = decodeNativeCells(encoded, index)
  const tiles = terrainRows(nativeCells)
  return {
    name: `ROUND ${String(index + 1).padStart(2, '0')}`,
    spawn: playerSpawn(),
    enemies: decodeEnemySpawns(DOS_ROUND_ENEMIES[index]),
    nativeCells,
    airflowSettings: [
      Number.parseInt(DOS_AIRFLOW_SETTINGS[0].slice(index * 2, index * 2 + 2), 16),
      Number.parseInt(DOS_AIRFLOW_SETTINGS[1].slice(index * 2, index * 2 + 2), 16),
      Number.parseInt(DOS_AIRFLOW_SETTINGS[2].slice(index * 2, index * 2 + 2), 16),
    ],
    tiles,
  }
})
