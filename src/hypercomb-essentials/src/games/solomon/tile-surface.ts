// The room is a Hypercomb layer and EVERY square is one of its child layers.
// Canvas/DOM geometry is a projection of these cells, just as the square tile
// view is a projection of ordinary hive children. Nothing writes on a physics
// tick: a journey holds its changed tile projection until that journey ends.

import type { Cell, LevelDef } from './engine.js'
import type { RoomDef } from './labyrinth.js'

export const SOLOMON_MAZE_BRANCH = 'solomon-maze-v1'
const VERSION = 1

export interface NativeTileLayer {
  name?: string
  children?: readonly string[]
  [slot: string]: unknown
}

export interface TileSurfaceHistory {
  sign(lineage: { domain?: unknown; explorerSegments(): readonly string[] }): Promise<string>
  currentLayerAt(sig: string, stats?: { cold: boolean }): Promise<NativeTileLayer | null>
  getLayerBySig(sig: string): Promise<NativeTileLayer | null>
  childrenManifestFor?(layer: NativeTileLayer): Promise<Array<{ sig: string; layer: NativeTileLayer }> | null>
}

export interface TileSurfaceCommitter {
  importTree(updates: { segments: readonly string[]; layer: NativeTileLayer }[]): Promise<void>
}

interface SquareData extends Cell {
  version: number
  code: number
  player?: boolean
  door?: boolean
  enemies: LevelDef['enemies']
  items: LevelDef['items']
  mirrors: LevelDef['mirrors']
  doors: RoomDef['doors']
  relics: RoomDef['relics']
  gates: NonNullable<RoomDef['gates']>
}

interface RoomData {
  version: number
  room: Omit<RoomDef, 'level' | 'doors' | 'relics' | 'gates'>
  level: Omit<LevelDef, 'tiles' | 'player' | 'door' | 'enemies' | 'items' | 'mirrors'>
}

export interface NativeGameTile extends Cell {
  name: string
  segments: readonly string[]
  code: number
  layer: NativeTileLayer
}

export interface LoadedTileRoom {
  room: RoomDef
  level: LevelDef
  roomSegments: readonly string[]
  tiles: NativeGameTile[]
}

const copy = <T>(value: T): T => structuredClone(value)
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const safeName = (value: string): string => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`Invalid Solomon room address: ${value}`)
  }
  return value
}
const cellName = (col: number, row: number): string =>
  `cell-${String(col).padStart(2, '0')}-${String(row).padStart(2, '0')}`
const at = (a: Cell, b: Cell): boolean => a.col === b.col && a.row === b.row
const belongs = (cell: Cell, level: Pick<LevelDef, 'cols' | 'rows'>): boolean =>
  Number.isInteger(cell.col) && Number.isInteger(cell.row)
  && cell.col >= 0 && cell.row >= 0 && cell.col < level.cols && cell.row < level.rows

/** Dependencies are structural so the native projection is testable without a
 *  browser or booting every bee. The runtime factory resolves the actual hive. */
export class SolomonTileSurface {
  readonly baseSegments: readonly string[]
  readonly #history: TileSurfaceHistory
  readonly #committer: TileSurfaceCommitter
  readonly #domain: unknown
  #pending: Promise<unknown> = Promise.resolve()

  constructor(options: {
    history: TileSurfaceHistory
    committer: TileSurfaceCommitter
    parentSegments: readonly string[]
    domain?: unknown
  }) {
    this.baseSegments = [...options.parentSegments, SOLOMON_MAZE_BRANCH]
    this.#history = options.history
    this.#committer = options.committer
    this.#domain = options.domain
  }

  /** The seed is used ONCE. Revisiting/reopening reads native authored cells;
   *  neither a default map nor a new release overwrites an existing room. */
  ensureRoom(room: RoomDef): Promise<LoadedTileRoom> {
    const run = this.#pending.then(() => this.#ensureRoom(room))
    this.#pending = run.catch(() => {})
    return run
  }

  async #ensureRoom(room: RoomDef): Promise<LoadedTileRoom> {
    const existing = await this.readRoom(room.id)
    if (existing) return existing
    const branch = await this.#resolveAt(this.baseSegments)
    const roomSegments = [...this.baseSegments, safeName(room.id)]
    const { level, doors, relics, gates, ...roomMetadata } = copy(room)
    const { tiles, player, door, enemies, items, mirrors, ...levelMetadata } = level
    this.#validateDimensions(level)
    if (tiles.length !== level.cols * level.rows || tiles.some(code => ![0, 1, 2, 3].includes(code))) {
      throw new Error(`The ${room.id} room has an invalid tile grid`)
    }
    const placements = [player, door, ...enemies, ...items, ...mirrors, ...doors, ...relics, ...(gates ?? [])]
    if (placements.some(cell => !belongs(cell, level))) {
      throw new Error(`The ${room.id} room has a placement outside its playing surface`)
    }
    const updates: { segments: readonly string[]; layer: NativeTileLayer }[] = []
    if (!branch) updates.push({
      segments: this.baseSegments,
      layer: { name: SOLOMON_MAZE_BRANCH, solomonMaze: { version: VERSION } },
    })
    updates.push({
      segments: roomSegments,
      layer: {
        name: room.id,
        solomonRoom: { version: VERSION, room: roomMetadata, level: levelMetadata } satisfies RoomData,
      },
    })
    for (let row = 0; row < level.rows; row++) for (let col = 0; col < level.cols; col++) {
      const cell = { col, row }
      const name = cellName(col, row)
      const square: SquareData = {
        version: VERSION, col, row, code: tiles[row * level.cols + col],
        ...(at(player, cell) ? { player: true } : {}),
        ...(at(door, cell) ? { door: true } : {}),
        enemies: enemies.filter(entity => at(entity, cell)),
        items: items.filter(entity => at(entity, cell)),
        mirrors: mirrors.filter(entity => at(entity, cell)),
        doors: doors.filter(entity => at(entity, cell)),
        relics: relics.filter(entity => at(entity, cell)),
        gates: (gates ?? []).filter(entity => at(entity, cell)),
      }
      updates.push({ segments: [...roomSegments, name], layer: { name, solomonTile: square } })
    }
    // No full children SET: importTree appends this branch and preserves the
    // participant's existing siblings. It serializes through the hive FIFO.
    await this.#committer.importTree(updates)
    const loaded = await this.readRoom(room.id)
    if (!loaded) throw new Error(`Hypercomb did not save the ${room.id} playing surface`)
    return loaded
  }

  async readRoom(roomId: string): Promise<LoadedTileRoom | null> {
    safeName(roomId)
    const branch = await this.#resolveAt(this.baseSegments)
    if (!branch) return null
    if (!object(branch['solomonMaze']) || branch['solomonMaze']['version'] !== VERSION) {
      throw new Error(`The ${SOLOMON_MAZE_BRANCH} tile already belongs to other content`)
    }
    const roomSegments = [...this.baseSegments, roomId]
    const layer = await this.#resolveAt(roomSegments)
    if (!layer) return null
    const data = layer['solomonRoom'] as RoomData | undefined
    if (!object(data) || data.version !== VERSION || !object(data.room) || !object(data.level)
      || data.room.id !== roomId) {
      throw new Error(`The ${roomId} tile is not a compatible Solomon room`)
    }
    this.#validateDimensions(data.level)
    const level: LevelDef = {
      ...copy(data.level), tiles: new Array(data.level.cols * data.level.rows),
      player: { col: -1, row: -1 }, door: { col: -1, row: -1 }, enemies: [], items: [], mirrors: [],
    }
    const room: RoomDef = { ...copy(data.room), level, doors: [], relics: [], gates: [] }
    const tiles: NativeGameTile[] = []
    const seen = new Set<number>()
    let players = 0, exits = 0
    for (const child of await this.#children(layer)) {
      const segments = [...roomSegments, child.name!]
      // A parent's stored child sig can predate an edit to that cell. The
      // child's current head wins, exactly as ordinary hive rendering does.
      const live = await this.#direct(segments) ?? child
      const square = live['solomonTile'] as SquareData | undefined
      if (!object(square) || square.version !== VERSION || !belongs(square, level)
        || ![0, 1, 2, 3].includes(square.code)) {
        throw new Error(`The ${roomId}/${child.name} tile has invalid game content`)
      }
      const index = square.row * level.cols + square.col
      if (seen.has(index)) throw new Error(`The ${roomId} playing surface has duplicate squares`)
      seen.add(index)
      level.tiles[index] = square.code
      const cell = { col: square.col, row: square.row }
      if (square.player) { level.player = cell; players++ }
      if (square.door) { level.door = cell; exits++ }
      for (const key of ['enemies', 'items', 'mirrors', 'doors', 'relics', 'gates'] as const) {
        const entities = square[key]
        if (!Array.isArray(entities) || entities.some(entity => !object(entity) || !at(entity as unknown as Cell, cell))) {
          throw new Error(`The ${roomId}/${child.name} tile has invalid ${key}`)
        }
      }
      level.enemies.push(...copy(square.enemies))
      level.items.push(...copy(square.items))
      level.mirrors.push(...copy(square.mirrors))
      room.doors.push(...copy(square.doors))
      room.relics.push(...copy(square.relics))
      room.gates!.push(...copy(square.gates))
      tiles.push({ ...cell, name: child.name!, segments, code: square.code, layer: copy(live) })
    }
    if (seen.size !== level.cols * level.rows || players !== 1 || exits !== 1) {
      throw new Error(`The ${roomId} playing surface is incomplete; its native tiles were kept unchanged`)
    }
    tiles.sort((a, b) => a.row * level.cols + a.col - (b.row * level.cols + b.col))
    return { room, level, roomSegments, tiles }
  }

  #validateDimensions(level: Pick<LevelDef, 'cols' | 'rows'>): void {
    if (!Number.isInteger(level.cols) || !Number.isInteger(level.rows)
      || level.cols < 1 || level.rows < 1 || level.cols * level.rows > 4096) {
      throw new Error('The native playing surface has invalid dimensions')
    }
  }

  async #direct(segments: readonly string[]): Promise<NativeTileLayer | null> {
    const stats = { cold: false }
    const sig = await this.#history.sign({ domain: this.#domain, explorerSegments: () => segments })
    const layer = await this.#history.currentLayerAt(sig, stats)
    if (stats.cold && !layer) throw new Error('Hypercomb room data is still loading; please open the game again')
    return layer
  }

  async #children(layer: NativeTileLayer): Promise<NativeTileLayer[]> {
    const manifest = await this.#manifest(layer)
    const children = await Promise.all((layer.children ?? []).map(async sig =>
      await this.#history.getLayerBySig(sig) ?? manifest.get(sig) ?? null))
    if (children.some(child => !child || typeof child.name !== 'string')) {
      throw new Error('A native room tile could not be read; existing content was kept unchanged')
    }
    return children as NativeTileLayer[]
  }

  async #manifest(layer: NativeTileLayer): Promise<Map<string, NativeTileLayer>> {
    const entries = await this.#history.childrenManifestFor?.(layer).catch(() => null)
    const members = new Set(layer.children ?? [])
    return new Map((entries ?? []).filter(entry => members.has(entry.sig)
      && typeof entry.layer?.name === 'string').map(entry => [entry.sig, entry.layer]))
  }

  async #childNamed(layer: NativeTileLayer, name: string): Promise<NativeTileLayer | null> {
    // The hive's manifest names every child of this immutable parent. An
    // unrelated cold sibling must not block creating the first game branch
    // when its identity already proves it is not the branch being sought.
    const manifest = await this.#manifest(layer)
    let missing = false
    for (const sig of layer.children ?? []) {
      const known = manifest.get(sig)
      if (known && known.name !== name) continue
      const child = await this.#history.getLayerBySig(sig) ?? known
      if (!child || typeof child.name !== 'string') { missing = true; continue }
      if (child.name === name) return child
    }
    if (missing) throw new Error('A native room tile could not be read; existing content was kept unchanged')
    return null
  }

  async #resolveAt(segments: readonly string[]): Promise<NativeTileLayer | null> {
    const direct = await this.#direct(segments)
    if (direct || segments.length === 0) return direct
    const parent = await this.#resolveAt(segments.slice(0, -1))
    if (!parent) return null
    return this.#childNamed(parent, segments.at(-1)!)
  }
}

/** Mirror conjured/dispelled terrain onto the SAME addressed square for this
 *  journey, without turning transient play into shared authoring history. */
export function syncTerrain(room: LoadedTileRoom, grid: ArrayLike<number>): void {
  if (grid.length !== room.tiles.length) throw new Error('The room grid no longer matches its native tiles')
  for (const tile of room.tiles) {
    const code = grid[tile.row * room.level.cols + tile.col]
    if (tile.code === code) continue
    tile.code = code
    tile.layer = { ...tile.layer, solomonTile: { ...(tile.layer['solomonTile'] as SquareData), code } }
  }
}

export function createSolomonTileSurface(parentSegments?: readonly string[]): SolomonTileSurface {
  const ioc = (globalThis as unknown as { window?: { ioc?: { get<T>(key: string): T | undefined } } }).window?.ioc
  const history = ioc?.get<TileSurfaceHistory>('@diamondcoreprocessor.com/HistoryService')
  const committer = ioc?.get<TileSurfaceCommitter>('@diamondcoreprocessor.com/LayerCommitter')
  const lineage = ioc?.get<{ domain?: unknown; explorerSegments?(): readonly string[] }>('@hypercomb.social/Lineage')
  if (!history?.currentLayerAt || !history.getLayerBySig || !committer?.importTree
    || (!parentSegments && !lineage?.explorerSegments)) {
    throw new Error('Hypercomb tiles are not ready yet; reopen Solomon’s Key when the hive has loaded')
  }
  return new SolomonTileSurface({
    history, committer, parentSegments: parentSegments ?? lineage!.explorerSegments!(), domain: lineage?.domain,
  })
}
