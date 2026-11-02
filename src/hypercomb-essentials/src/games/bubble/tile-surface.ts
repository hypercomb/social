// A Bubble Bobble round is a Hypercomb layer and every visible 8x8 cave cell
// is one of its child layers. The reconstructed DOS campaign is only a seed:
// once a round exists, reopening reads its live authored cell heads and never
// replaces them with a newer bundled default.

import type { EnemySpawn, LevelDef } from './engine.js'
import { CAVE_COLUMNS, CAVE_LEFT, CAVE_ROWS, TILE } from './dos-geometry.js'
import { BUILTIN_LEVELS } from './levels.js'
import {
  LEVEL_GROUP, LEVEL_VERSION, decodeLevel, encodeLevel, levelName, placeEnemies, terrain, validLevel,
  type EnemyPlacement, type LevelRecord,
} from './level-tiles.js'

export const BUBBLE_DOS_BRANCH = 'bubble-bobble-dos-v1'
export const BUBBLE_DOS_SOURCE_SHA256 = '665bb4b164d710cbfb77c58b97e7b795' + '8668df45b2b1501b2d5af2fa0ce81e64'
const VERSION = 1
const SCRATCH_COLUMNS = 8

export interface BubbleTileLayer {
  name?: string
  children?: readonly string[]
  [slot: string]: unknown
}

export interface BubbleTileHistory {
  sign(lineage: { domain?: unknown; explorerSegments(): readonly string[] }): Promise<string>
  currentLayerAt(sig: string, stats?: { cold: boolean }): Promise<BubbleTileLayer | null>
  getLayerBySig(sig: string): Promise<BubbleTileLayer | null>
  childrenManifestFor?(layer: BubbleTileLayer): Promise<Array<{ sig: string; layer: BubbleTileLayer }> | null>
}

/** What a level's loading is up to, so a loading layer can show the grouped view as it fills. */
export interface BubbleLoadingStep {
  stage: 'level' | 'group' | 'ready'
  round: number
  /** The group being opened (an enemy kind), while stage is 'group'. */
  group?: string
  /** Enemy tiles read so far. */
  loaded: number
}

export interface BubbleTileCommitter {
  importTree(updates: { segments: readonly string[]; layer: BubbleTileLayer }[]): Promise<void>
}

interface CampaignData {
  version: number
  sourceSha256: string
}

interface RoundData {
  version: number
  index: number
  name: string
  columns: number
  rows: number
  airflowSettings: [number, number, number]
  /** Native work columns 32..39. Visible cells remain individual children. */
  scratch: number[][]
  sourceSha256: string
}

interface StoredEnemy extends EnemySpawn { order: number }
interface CellData {
  version: number
  col: number
  row: number
  value: number
  player?: boolean
  enemies: StoredEnemy[]
}

export interface NativeBubbleTile {
  name: string
  segments: readonly string[]
  col: number
  row: number
  value: number
  layer: BubbleTileLayer
}

export interface LoadedBubbleRound {
  index: number
  level: LevelDef
  roundSegments: readonly string[]
  tiles: NativeBubbleTile[]
}

const copy = <T>(value: T): T => structuredClone(value)
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const byte = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 7
const cellName = (col: number, row: number): string =>
  `cell-${String(col).padStart(2, '0')}-${String(row).padStart(2, '0')}`
const roundName = (index: number): string => `round-${String(index + 1).padStart(3, '0')}`
const validRound = (index: number): boolean => Number.isInteger(index) && index >= 0 && index < BUILTIN_LEVELS.length
const cellFor = (spawn: Pick<EnemySpawn, 'x' | 'y'>): { col: number; row: number } => ({
  col: (spawn.x - CAVE_LEFT) / TILE,
  row: spawn.y / TILE,
})
const belongs = (cell: { col: number; row: number }): boolean =>
  Number.isInteger(cell.col) && Number.isInteger(cell.row)
  && cell.col >= 0 && cell.row >= 0 && cell.col < CAVE_COLUMNS && cell.row < CAVE_ROWS
const at = (a: { col: number; row: number }, b: { col: number; row: number }): boolean =>
  a.col === b.col && a.row === b.row
/** A turn for the hive between one group's tiles and the next, so a level never loads in one gulp. */
const breathe = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
const storedEnemy = (spawn: EnemySpawn, order: number): StoredEnemy => ({
  x: spawn.x,
  y: spawn.y,
  kind: spawn.kind,
  ...(spawn.spawnDelay === undefined ? {} : { spawnDelay: spawn.spawnDelay }),
  ...(spawn.activationDelayTicks === undefined ? {} : { activationDelayTicks: spawn.activationDelayTicks }),
  ...(spawn.headingCode === undefined ? {} : { headingCode: spawn.headingCode }),
  ...(spawn.variant === undefined ? {} : { variant: spawn.variant }),
  order,
})

/** A seed-once projection of the exact DOS campaign into native hive layers. */
export class BubbleTileSurface {
  readonly baseSegments: readonly string[]
  readonly #history: BubbleTileHistory
  readonly #committer: BubbleTileCommitter
  readonly #domain: unknown
  #pending: Promise<unknown> = Promise.resolve()
  readonly #onLoading: ((step: BubbleLoadingStep) => void) | undefined

  constructor(options: {
    history: BubbleTileHistory
    committer: BubbleTileCommitter
    parentSegments: readonly string[]
    domain?: unknown
    onLoading?: (step: BubbleLoadingStep) => void
  }) {
    this.#onLoading = options.onLoading
    this.baseSegments = [...options.parentSegments, BUBBLE_DOS_BRANCH]
    this.#history = options.history
    this.#committer = options.committer
    this.#domain = options.domain
  }

  ensureRound(index: number, seed: LevelDef = BUILTIN_LEVELS[index]): Promise<LoadedBubbleRound> {
    const run = this.#pending.then(() => this.#ensureRound(index, seed))
    this.#pending = run.catch(() => {})
    return run
  }

  /** The round as play would see it, WITHOUT writing: the hive's own round when
   *  it holds one, else the bundled seed it would be created from. A read-ahead
   *  uses this — a round's tiles are written only when the player reaches it. */
  peekRound(index: number, seed: LevelDef = BUILTIN_LEVELS[index]): Promise<{ level: LevelDef; stored: boolean }> {
    const run = this.#pending.then(async () => {
      const existing = await this.readRound(index)
      if (existing) return { level: existing.level, stored: true }
      this.#validateSeed(index, seed)
      return { level: copy(seed), stored: false }
    })
    this.#pending = run.catch(() => {})
    return run
  }

  async #ensureRound(index: number, seed: LevelDef): Promise<LoadedBubbleRound> {
    if (!validRound(index)) throw new Error('Bubble Bobble round index is outside the DOS campaign')
    const existing = await this.readRound(index)
    if (existing) return existing
    this.#validateSeed(index, seed)
    const branch = await this.#resolveAt(this.baseSegments)
    const id = roundName(index)
    const roundSegments = [...this.baseSegments, id]
    const nativeCells = seed.nativeCells!
    const settings = [...seed.airflowSettings!] as [number, number, number]
    const updates: { segments: readonly string[]; layer: BubbleTileLayer }[] = []
    if (!branch) updates.push({
      segments: this.baseSegments,
      layer: {
        name: BUBBLE_DOS_BRANCH,
        bubbleCampaign: {
          version: VERSION,
          sourceSha256: BUBBLE_DOS_SOURCE_SHA256,
        } satisfies CampaignData,
      },
    })
    updates.push({
      segments: roundSegments,
      layer: {
        name: id,
        bubbleRound: {
          version: VERSION,
          index,
          name: seed.name,
          columns: CAVE_COLUMNS,
          rows: CAVE_ROWS,
          airflowSettings: settings,
          scratch: nativeCells.map(row => [...row.slice(CAVE_COLUMNS, CAVE_COLUMNS + SCRATCH_COLUMNS)]),
          sourceSha256: BUBBLE_DOS_SOURCE_SHA256,
        } satisfies RoundData,
      },
    })
    const player = cellFor(seed.spawn)
    for (let row = 0; row < CAVE_ROWS; row++) for (let col = 0; col < CAVE_COLUMNS; col++) {
      const cell = { col, row }
      const name = cellName(col, row)
      const enemies = seed.enemies.flatMap((spawn, order) => at(cellFor(spawn), cell)
        ? [storedEnemy(spawn, order)] : [])
      const data: CellData = {
        version: VERSION,
        col,
        row,
        value: nativeCells[row][col],
        ...(at(player, cell) ? { player: true } : {}),
        enemies,
      }
      updates.push({ segments: [...roundSegments, name], layer: { name, bubbleCell: data } })
    }
    // One FIFO import creates the branch, round, and all 800 cells atomically
    // from the caller's perspective; unrelated siblings are never replaced.
    await this.#committer.importTree(updates)
    const loaded = await this.readRound(index)
    if (!loaded) throw new Error(`Hypercomb did not save Bubble Bobble ${id}`)
    return loaded
  }

  /** The round as play reads it: its level tile when the hive holds one, else the native cells. */
  async readRound(index: number): Promise<LoadedBubbleRound | null> {
    if (!validRound(index)) throw new Error('Bubble Bobble round index is outside the DOS campaign')
    const branch = await this.#resolveAt(this.baseSegments)
    if (!branch) return null
    return await this.#readLevel(index) ?? this.#readNative(index)
  }

  /** Write a round's level tile (map, flow, enemies) beside its native cells, forward only:
   *  the cells stay untouched so an older client keeps working, and once the level tile
   *  exists it is the one play reads. Authored cell edits are carried into it. */
  upgradeRound(index: number): Promise<LoadedBubbleRound> {
    const run = this.#pending.then(() => this.#upgradeRound(index))
    this.#pending = run.catch(() => {})
    return run
  }

  async #upgradeRound(index: number): Promise<LoadedBubbleRound> {
    const logical = await this.#readLevel(index)
    if (logical) return logical
    const native = await this.#readNative(index)
    if (!native) throw new Error('Open the round once before turning it into a level tile')
    const { level, enemies } = encodeLevel(native.level, index, BUBBLE_DOS_SOURCE_SHA256)
    const levelSegments = [...this.baseSegments, LEVEL_GROUP, levelName(index)]
    const updates: { segments: readonly string[]; layer: BubbleTileLayer }[] = []
    if (!await this.#resolveAt([...this.baseSegments, LEVEL_GROUP])) {
      updates.push({ segments: [...this.baseSegments, LEVEL_GROUP], layer: { name: LEVEL_GROUP, bubbleGroup: { version: LEVEL_VERSION } } })
    }
    updates.push({ segments: levelSegments, layer: { name: levelName(index), bubbleLevel: level } })
    for (const place of placeEnemies(enemies)) updates.push(this.#enemyTile(levelSegments, place))
    await this.#committer.importTree(updates)
    const loaded = await this.#readLevel(index)
    if (!loaded) throw new Error(`Hypercomb did not save ${levelName(index)}`)
    return loaded
  }

  #enemyTile(levelSegments: readonly string[], place: EnemyPlacement): { segments: readonly string[]; layer: BubbleTileLayer } {
    const name = place.path[place.path.length - 1]
    return {
      segments: [...levelSegments, ...place.path],
      layer: place.record ? { name, bubbleEnemy: place.record } : { name, bubbleGroup: { version: LEVEL_VERSION, kind: place.group } },
    }
  }

  #loading(step: BubbleLoadingStep): void {
    try { this.#onLoading?.(step) } catch { /* a loading layer's own failure never stops a load */ }
  }

  async #readLevel(index: number): Promise<LoadedBubbleRound | null> {
    const segments = [...this.baseSegments, LEVEL_GROUP, levelName(index)]
    const layer = await this.#resolveAt(segments)
    if (!layer) return null
    const record = layer['bubbleLevel'] as LevelRecord | undefined
    if (!validLevel(record) || record.index !== index) throw new Error(`The ${levelName(index)} tile is not a compatible Bubble Bobble level`)
    const found: unknown[] = []
    this.#loading({ stage: 'level', round: index, loaded: 0 })
    await this.#gather(segments, layer, found, index)
    this.#loading({ stage: 'ready', round: index, loaded: found.length })
    return { index, level: decodeLevel(record, found), roundSegments: segments, tiles: [] }
  }

  /** The level tile is read first; its enemies follow, one group at a time, a turn apart. */
  async #gather(segments: readonly string[], layer: BubbleTileLayer, found: unknown[], round: number): Promise<void> {
    for (const child of await this.#children(layer)) {
      const path = [...segments, child.name!]
      // A current location head wins over the signature the parent retained.
      const live = await this.#direct(path) ?? child
      if (live['bubbleEnemy']) found.push(live['bubbleEnemy'])
      else if (live['bubbleGroup']) {
        this.#loading({ stage: 'group', round, group: child.name, loaded: found.length })
        await breathe()
        await this.#gather(path, live, found, round)
      }
      else throw new Error(`The ${path.join('/')} tile has invalid game content`)
    }
  }

  async #readNative(index: number): Promise<LoadedBubbleRound | null> {
    if (!validRound(index)) throw new Error('Bubble Bobble round index is outside the DOS campaign')
    const branch = await this.#resolveAt(this.baseSegments)
    if (!branch) return null
    const campaign = branch['bubbleCampaign'] as CampaignData | undefined
    if (!object(campaign) || campaign.version !== VERSION
      || campaign.sourceSha256 !== BUBBLE_DOS_SOURCE_SHA256) {
      throw new Error(`The ${BUBBLE_DOS_BRANCH} tile already belongs to other content`)
    }
    const id = roundName(index)
    const roundSegments = [...this.baseSegments, id]
    const layer = await this.#resolveAt(roundSegments)
    if (!layer) return null
    const data = layer['bubbleRound'] as RoundData | undefined
    if (!this.#validRoundData(data, index)) {
      throw new Error(`The ${id} tile is not a compatible Bubble Bobble round`)
    }
    const nativeCells = data.scratch.map(row => Array<number>(CAVE_COLUMNS).fill(-1).concat(row))
    const tiles: NativeBubbleTile[] = []
    const seen = new Set<number>()
    const enemies: StoredEnemy[] = []
    let players = 0
    let spawn = { x: -1, y: -1 }
    for (const child of await this.#children(layer)) {
      const segments = [...roundSegments, child.name!]
      // A current location head wins over the immutable signature retained by
      // the parent, matching the rest of the hive's authored-layer behavior.
      const live = await this.#direct(segments) ?? child
      const square = live['bubbleCell'] as CellData | undefined
      if (!this.#validCell(square)) {
        throw new Error(`The ${id}/${child.name} tile has invalid game content`)
      }
      const cell = { col: square.col, row: square.row }
      const position = square.row * CAVE_COLUMNS + square.col
      if (seen.has(position)) throw new Error(`The ${id} playing surface has duplicate cells`)
      seen.add(position)
      nativeCells[square.row][square.col] = square.value
      if (square.player) {
        players++
        spawn = { x: CAVE_LEFT + square.col * TILE, y: square.row * TILE }
      }
      for (const enemy of square.enemies) {
        if (!object(enemy) || !Number.isInteger(enemy.order) || enemy.order < 0
          || !this.#validEnemy(enemy) || !at(cellFor(enemy), cell)) {
          throw new Error(`The ${id}/${child.name} tile has invalid enemies`)
        }
        enemies.push(storedEnemy(enemy, enemy.order))
      }
      tiles.push({ name: child.name!, segments, ...cell, value: square.value, layer: copy(live) })
    }
    if (seen.size !== CAVE_COLUMNS * CAVE_ROWS || players !== 1
      || nativeCells.some(row => row.some(value => !byte(value)))) {
      throw new Error(`The ${id} playing surface is incomplete; its native cells were kept unchanged`)
    }
    const orders = new Set(enemies.map(enemy => enemy.order))
    if (orders.size !== enemies.length) throw new Error(`The ${id} playing surface has duplicate enemy order values`)
    enemies.sort((a, b) => a.order - b.order)
    tiles.sort((a, b) => a.row * CAVE_COLUMNS + a.col - (b.row * CAVE_COLUMNS + b.col))
    const level: LevelDef = {
      name: data.name,
      tiles: terrain(nativeCells),
      nativeCells,
      airflowSettings: [...data.airflowSettings],
      enemies: enemies.map(({ order: _order, ...enemy }) => enemy),
      spawn,
    }
    return { index, level, roundSegments, tiles }
  }

  #validateSeed(index: number, seed: LevelDef): void {
    if (!seed || seed.name !== `ROUND ${String(index + 1).padStart(2, '0')}`
      || seed.tiles.length !== CAVE_ROWS || seed.tiles.some(row => row.length !== CAVE_COLUMNS)
      || !seed.nativeCells || seed.nativeCells.length !== CAVE_ROWS
      || seed.nativeCells.some(row => row.length !== CAVE_COLUMNS + SCRATCH_COLUMNS || row.some(value => !byte(value)))
      || !seed.airflowSettings || seed.airflowSettings.length !== 3
      || seed.airflowSettings.some(value => !Number.isInteger(value) || value < 0 || value > 0xff)
      || !belongs(cellFor(seed.spawn)) || seed.enemies.some(enemy => !this.#validEnemy(enemy))) {
      throw new Error(`ROUND ${String(index + 1).padStart(2, '0')} is not a valid native DOS seed`)
    }
  }

  #validRoundData(value: unknown, index: number): value is RoundData {
    if (!object(value) || value['version'] !== VERSION || value['index'] !== index
      || value['name'] !== `ROUND ${String(index + 1).padStart(2, '0')}`
      || value['columns'] !== CAVE_COLUMNS || value['rows'] !== CAVE_ROWS
      || value['sourceSha256'] !== BUBBLE_DOS_SOURCE_SHA256
      || !Array.isArray(value['airflowSettings']) || value['airflowSettings'].length !== 3
      || value['airflowSettings'].some(setting => !Number.isInteger(setting) || setting < 0 || setting > 0xff)
      || !Array.isArray(value['scratch']) || value['scratch'].length !== CAVE_ROWS
      || value['scratch'].some(row => !Array.isArray(row) || row.length !== SCRATCH_COLUMNS || row.some(cell => !byte(cell)))) {
      return false
    }
    return true
  }

  #validCell(value: unknown): value is CellData {
    return object(value) && value['version'] === VERSION && belongs(value as unknown as CellData)
      && byte(value['value']) && (value['player'] === undefined || typeof value['player'] === 'boolean')
      && Array.isArray(value['enemies']) && value['enemies'].length <= 0xff
  }

  #validEnemy(value: unknown): value is EnemySpawn {
    if (!object(value) || !Number.isFinite(value['x']) || !Number.isFinite(value['y'])
      || !['zenchan', 'hidegons', 'banebou', 'pulpul', 'monsta', 'drunk', 'mighta', 'invader'].includes(String(value['kind']))) {
      return false
    }
    for (const field of ['spawnDelay', 'activationDelayTicks', 'headingCode', 'variant'] as const) {
      const part = value[field]
      if (part !== undefined && (!Number.isInteger(part) || Number(part) < 0 || Number(part) > 0xff)) return false
    }
    return belongs(cellFor(value as unknown as EnemySpawn))
  }

  async #direct(segments: readonly string[]): Promise<BubbleTileLayer | null> {
    const stats = { cold: false }
    const sig = await this.#history.sign({ domain: this.#domain, explorerSegments: () => segments })
    const layer = await this.#history.currentLayerAt(sig, stats)
    if (stats.cold && !layer) throw new Error('Hypercomb Bubble Bobble data is still loading; please open the game again')
    return layer
  }

  async #children(layer: BubbleTileLayer): Promise<BubbleTileLayer[]> {
    const manifest = await this.#manifest(layer)
    const children = await Promise.all((layer.children ?? []).map(async sig =>
      await this.#history.getLayerBySig(sig) ?? manifest.get(sig) ?? null))
    if (children.some(child => !child || typeof child.name !== 'string')) {
      throw new Error('A native Bubble Bobble cell could not be read; existing content was kept unchanged')
    }
    return children as BubbleTileLayer[]
  }

  async #manifest(layer: BubbleTileLayer): Promise<Map<string, BubbleTileLayer>> {
    const entries = await this.#history.childrenManifestFor?.(layer).catch(() => null)
    const members = new Set(layer.children ?? [])
    return new Map((entries ?? []).filter(entry => members.has(entry.sig)
      && typeof entry.layer?.name === 'string').map(entry => [entry.sig, entry.layer]))
  }

  async #childNamed(layer: BubbleTileLayer, name: string): Promise<BubbleTileLayer | null> {
    const manifest = await this.#manifest(layer)
    let missing = false
    for (const sig of layer.children ?? []) {
      const known = manifest.get(sig)
      if (known && known.name !== name) continue
      const child = await this.#history.getLayerBySig(sig) ?? known
      if (!child || typeof child.name !== 'string') { missing = true; continue }
      if (child.name === name) return child
    }
    if (missing) throw new Error('A native Bubble Bobble cell could not be read; existing content was kept unchanged')
    return null
  }

  async #resolveAt(segments: readonly string[]): Promise<BubbleTileLayer | null> {
    const direct = await this.#direct(segments)
    if (direct || segments.length === 0) return direct
    const parent = await this.#resolveAt(segments.slice(0, -1))
    if (!parent) return null
    return this.#childNamed(parent, segments.at(-1)!)
  }
}

export function createBubbleTileSurface(
  parentSegments?: readonly string[],
  onLoading?: (step: BubbleLoadingStep) => void,
): BubbleTileSurface {
  const ioc = (globalThis as unknown as { window?: { ioc?: { get<T>(key: string): T | undefined } } }).window?.ioc
  const history = ioc?.get<BubbleTileHistory>('@diamondcoreprocessor.com/HistoryService')
  const committer = ioc?.get<BubbleTileCommitter>('@diamondcoreprocessor.com/LayerCommitter')
  const lineage = ioc?.get<{ domain?: unknown; explorerSegments?(): readonly string[] }>('@hypercomb.social/Lineage')
  if (!history?.currentLayerAt || !history.getLayerBySig || !committer?.importTree
    || (!parentSegments && !lineage?.explorerSegments)) {
    throw new Error('Hypercomb tiles are not ready yet; reopen Bubble Bobble when the hive has loaded')
  }
  return new BubbleTileSurface({
    history, committer, parentSegments: parentSegments ?? lineage!.explorerSegments!(), domain: lineage?.domain, onLoading,
  })
}
