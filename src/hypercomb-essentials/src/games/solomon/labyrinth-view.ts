import { TILE, WALL, BRICK, CRACKED, type Cell, type LevelDef } from './engine.js'
import { LABYRINTHS, LabyrinthJourney, ROOMS, describeRequirement, type RoomDef } from './labyrinth.js'
import { PlaceVeil, VEIL_ZOOM, veilGridPicture, type VeilDirection, type VeilLeg, type VeilRgb } from './place-veil.js'
import { Renderer } from './renderer.js'
import { type LoadedTileRoom, syncTerrain } from './tile-surface.js'

// ── a door is WHERE IT LEADS ─────────────────────────────────────────────
//
// Jaime, 2026-09-11: "there's not like a right or left up or down … there's
// just a door that you go through. Remove the symbols and keep the door; you
// can change the colours … and even the shapes so we can add some elements
// that make it easier to navigate." So a door wears no glyph. Its colour and
// its shape are hashed from the room it leads TO, and the same room's own
// door back wears the colour of where IT leads — so "the green round door"
// always means the same place, from either side.

export const DOOR_SHAPES = ['arch', 'round', 'peak', 'gate', 'keyhole'] as const
export type DoorShape = typeof DOOR_SHAPES[number]

const hashWord = (word: string): number => {
  let h = 2166136261
  for (let i = 0; i < word.length; i++) { h ^= word.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h
}
const hexHue = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (!d) return 0
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return Math.round(h * 60) % 360
}
/** Every authored room's hue: its labyrinth's own colour, turned by the
 *  room's place among its siblings, so no two doors of one labyrinth can
 *  look alike. A room the authored set does not know is hashed instead. */
const ROOM_HUES = new Map<string, number>()
for (const labyrinth of LABYRINTHS) {
  const siblings = ROOMS.filter(room => room.labyrinthId === labyrinth.id)
  siblings.forEach((room, index) => ROOM_HUES.set(room.id, Math.round(hexHue(labyrinth.color) + index * 360 / siblings.length) % 360))
}
/** A hue in [0, 360) for the room a door leads to. */
export const doorHue = (targetRoomId: string): number =>
  ROOM_HUES.get(targetRoomId) ?? Math.round((hashWord(targetRoomId) % 360 + (hashWord(targetRoomId) >>> 9) * 137.508) % 360)
export const doorShape = (targetRoomId: string): DoorShape => DOOR_SHAPES[(hashWord(targetRoomId) >>> 4) % DOOR_SHAPES.length]!

// ── the room as the veil sees it ─────────────────────────────────────────
//
// Warps between rooms go through the shell's PlaceVeil (place-veil.ts), the
// one way into any place. A room describes itself to it as one colour per
// tile: its terrain as it stands now, its doors in their own hues, its
// uncollected relics gold. The same colours seed the doors.

type VeilTile = { readonly col: number; readonly row: number; readonly color: VeilRgb }
const rgb = (hex: string): VeilRgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const AIR = rgb('#263b5c'), STONE = rgb('#c9d3e6'), CLAY = rgb('#e9b56c'), GOLD = rgb('#ffe599')
const hslToRgb = (h: number, s: number, l: number): VeilRgb => {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}
const mix = (a: VeilRgb, b: VeilRgb, t: number): VeilRgb => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]
const doorOrigin = (door: Cell | undefined, level: LevelDef): readonly [number, number] =>
  door ? [(door.col + 0.5) / level.cols, (door.row + 0.5) / level.rows] : [0.5, 0.5]

/** One plate per native child layer. The transparent canvas contains actors
 *  only; collision and plate terrain share the hydrated room's tile grid. */
export class LabyrinthRoomView {
  readonly element = document.createElement('section')
  readonly #board = document.createElement('div')
  readonly #canvas = document.createElement('canvas')
  readonly #caption = document.createElement('div')
  readonly #hint = document.createElement('div')
  readonly #depths = document.createElement('div')
  readonly #meter = document.createElement('progress')
  readonly #stats = document.createElement('span')
  readonly #observer: ResizeObserver
  readonly #ctx: CanvasRenderingContext2D | null
  readonly #renderer: Renderer | null
  #loaded: LoadedTileRoom | null = null
  #tiles: HTMLDivElement[] = []
  #descriptions: string[] = []
  #scale = 1
  #frameKey = ''

  constructor(host: HTMLElement, private readonly journey: LabyrinthJourney, onDoor: (id: string) => void) {
    this.element.className = 'sol-native-room'
    const head = document.createElement('div')
    head.className = 'sol-room-heading'
    this.#caption.className = 'sol-room-caption'
    this.#depths.className = 'sol-room-depths'
    this.#depths.setAttribute('aria-label', 'Chambers and depths')
    head.append(this.#caption, this.#depths)
    const viewport = document.createElement('div')
    viewport.className = 'sol-room-viewport'
    this.#board.className = 'sol-room-board'
    this.#board.setAttribute('role', 'grid')
    this.#board.addEventListener('click', event => {
      const door = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-door]')
      if (door?.dataset['door']) onDoor(door.dataset['door'])
    })
    this.#canvas.className = 'sol-room-actors'
    this.#canvas.setAttribute('aria-hidden', 'true')
    this.#board.append(this.#canvas)
    viewport.append(this.#board)
    const foot = document.createElement('div')
    foot.className = 'sol-room-status'
    this.#meter.max = 10000
    this.#meter.setAttribute('aria-label', 'Room energy')
    foot.append(this.#stats, this.#meter)
    this.#hint.className = 'sol-room-hint'
    this.element.append(head, viewport, foot, this.#hint)
    host.append(this.element)
    this.#ctx = this.#canvas.getContext('2d')
    this.#renderer = this.#ctx ? new Renderer(this.#ctx) : null
    this.#observer = new ResizeObserver(() => this.#fit())
    this.#observer.observe(this.#board)
  }

  /** The board: what the veil scales when a warp leaves or arrives here. */
  get board(): HTMLElement { return this.#board }

  /** The leg that leaves the room on show, scaled around the door Dana took
   *  (the journey has already moved: its arrival door is that door's far
   *  side). Coming out by another way, the room shrinks about its centre. */
  leaveLeg(direction: VeilDirection): VeilLeg | null {
    const loaded = this.#loaded
    if (!loaded) return null
    const next = this.journey.room
    const taken = next ? loaded.room.doors.find(door => door.targetRoomId === next.id && door.targetDoorId === this.journey.arrivalDoor) : undefined
    return { element: this.#board, picture: this.picture(loaded.room), origin: doorOrigin(taken, loaded.level), scale: VEIL_ZOOM[direction].leave }
  }

  /** The leg that arrives in a room, settling from around the door Dana arrives by. */
  arriveLeg(loaded: LoadedTileRoom, direction: VeilDirection): VeilLeg {
    const arrival = loaded.room.doors.find(door => door.id === this.journey.arrivalDoor)
    return { element: this.#board, picture: this.picture(loaded.room), origin: doorOrigin(arrival, loaded.level), scale: VEIL_ZOOM[direction].arrive }
  }

  /** Warps from the room on show to `loaded` through the veil; the board
   *  changes rooms at the swap. */
  warp(veil: PlaceVeil, loaded: LoadedTileRoom, direction: VeilDirection = 'in'): void {
    const leave = this.leaveLeg(direction) ?? { element: this.#board, picture: null, origin: [0.5, 0.5] as const, scale: 1 }
    veil.play({ leave, arrive: this.arriveLeg(loaded, direction), onSwap: () => this.show(loaded) })
  }

  show(loaded: LoadedTileRoom): void {
    this.#board.style.transform = ''
    this.#loaded = loaded
    this.#frameKey = ''
    const { level, room } = loaded
    this.#board.style.setProperty('--cols', String(level.cols))
    this.#board.style.setProperty('--rows', String(level.rows))
    this.#board.style.aspectRatio = `${level.cols} / ${level.rows}`
    this.#board.style.setProperty('--room-ratio', String(level.cols / level.rows))
    this.#board.dataset['room'] = room.id
    this.#board.dataset['depth'] = String(room.depth)
    this.#board.dataset['cell'] = loaded.roomSegments.join('/')
    this.#board.setAttribute('aria-label', `${level.name}, ${level.cols} by ${level.rows} tiles`)
    this.#board.setAttribute('aria-colcount', String(level.cols))
    this.#board.setAttribute('aria-rowcount', String(level.rows))
    for (const tile of this.#tiles) tile.remove()
    this.#tiles = []
    this.#descriptions = []
    for (const tile of loaded.tiles) {
      const plate = document.createElement('div')
      plate.className = 'sol-game-tile'
      plate.dataset['cell'] = tile.segments.join('/')
      plate.setAttribute('role', 'gridcell')
      plate.setAttribute('aria-colindex', String(tile.col + 1))
      plate.setAttribute('aria-rowindex', String(tile.row + 1))
      plate.style.gridColumn = String(tile.col + 1)
      plate.style.gridRow = String(tile.row + 1)
      this.#board.insertBefore(plate, this.#canvas)
      this.#tiles.push(plate)
    }
    this.#caption.textContent = `${level.name} · Depth ${room.depth}`
    this.#depths.replaceChildren()
    for (const known of this.journey.rooms.values()) {
      if (known.labyrinthId !== room.labyrinthId) continue
      const card = document.createElement('span')
      card.textContent = `${known.depth} · ${this.journey.visited.has(known.id) ? known.level.name : 'Unexplored'}`
      card.className = known.id === room.id ? 'current' : ''
      card.style.setProperty('--depth', String(known.depth))
      this.#depths.append(card)
    }
    this.#fit()
  }

  /** The room as the veil sees it: one colour per tile. */
  picture(room: RoomDef): ReturnType<typeof veilGridPicture> {
    const tiles = this.#roomTiles(room), { cols, rows } = room.level
    return veilGridPicture(cols, rows, (col, row) => tiles[row * cols + col]?.color ?? AIR)
  }

  /** The tile colours a room pixelates from, one per tile: its terrain as it
   *  stands now (conjured blocks included), its doors in their own colours,
   *  its uncollected relics gold. */
  #roomTiles(room: RoomDef): VeilTile[] {
    const { cols, rows } = room.level
    const grid = this.journey.engines.get(room.id)?.grid ?? room.level.tiles
    return Array.from({ length: cols * rows }, (_, index) => {
      const col = index % cols, row = Math.floor(index / cols), code = grid[index] ?? 0
      const door = room.doors.find(d => d.col === col && d.row === row)
      const relic = room.relics.find(r => r.col === col && r.row === row && !this.journey.collected(r.id))
      const color = door ? hslToRgb(doorHue(door.targetRoomId), 0.6, 0.5)
        : relic ? GOLD
        : code === WALL ? STONE
        : code === BRICK || code === CRACKED ? CLAY
        : AIR
      return { col, row, color }
    })
  }

  /** THE SEED. Jaime: "an entrance shows a seed of its inside before you
   *  enter, so what you zoom toward is what you arrive in." A door carries a
   *  pixel map of the room beyond, one pixel per tile, tinted its own hue. */
  #seed(room: RoomDef): HTMLCanvasElement {
    const seed = document.createElement('canvas')
    seed.className = 'sol-door-seed'
    seed.width = room.level.cols
    seed.height = room.level.rows
    seed.setAttribute('aria-hidden', 'true')
    const ctx = seed.getContext('2d')
    if (ctx) {
      const tint = hslToRgb(doorHue(room.id), 0.55, 0.45)
      for (const tile of this.#roomTiles(room)) {
        const [r, g, b] = mix(tile.color, tint, 0.3)
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
        ctx.fillRect(tile.col, tile.row, 1, 1)
      }
    }
    return seed
  }

  render(time: number): void {
    const loaded = this.#loaded, engine = this.journey.engine
    if (!loaded || !engine || this.journey.room?.id !== loaded.room.id) return
    const room = loaded.room
    syncTerrain(loaded, engine.grid)
    for (let i = 0; i < loaded.tiles.length; i++) {
      const cell = loaded.tiles[i], plate = this.#tiles[i]
      const door = room.doors.find(d => d.col === cell.col && d.row === cell.row)
      const relic = room.relics.find(r => r.col === cell.col && r.row === cell.row && !this.journey.collected(r.id))
      const gate = room.gates?.find(g => g.col === cell.col && g.row === cell.row)
      const terrain = cell.code === WALL ? 'wall' : cell.code === BRICK ? 'brick' : cell.code === CRACKED ? 'cracked' : 'air'
      const locked = !!door && !this.journey.has(door.requires)
      const gateLocked = !!gate && !this.journey.has(gate.requires)
      const description = `${terrain}|${door?.id ?? ''}|${locked}|${door ? this.journey.visited.has(door.targetRoomId) : ''}|${relic?.id ?? ''}|${gateLocked}`
      if (description === this.#descriptions[i]) continue
      this.#descriptions[i] = description
      plate.dataset['terrain'] = terrain
      plate.classList.toggle('is-gate', gateLocked)
      plate.replaceChildren()
      let label = terrain === 'air' ? 'Open tile' : terrain === 'wall' ? 'Stone tile' : 'Conjurable block'
      if (gateLocked && gate) {
        const mark = document.createElement('span')
        mark.className = 'sol-gate-mark'
        mark.textContent = '◇'
        plate.append(mark)
        label = `Shrine barrier: ${describeRequirement(gate.requires)}`
      }
      if (door) {
        const target = this.journey.rooms.get(door.targetRoomId)
        const delta = (target?.depth ?? room.depth) - room.depth
        const known = this.journey.visited.has(door.targetRoomId)
        const passage = document.createElement('button')
        // No glyph: the door IS its colour and shape (see the header). A door
        // whose far side you have already stood in glows a little — you know
        // that one.
        passage.className = `sol-passage ${delta < 0 ? 'out' : delta === 0 ? 'across' : 'in'}${locked ? ' locked' : ''}${known ? ' known' : ''}`
        passage.dataset['door'] = door.id
        passage.dataset['shape'] = doorShape(door.targetRoomId)
        passage.style.setProperty('--door-h', String(doorHue(door.targetRoomId)))
        label = `Door to ${target?.level.name ?? 'a chamber'}, depth ${target?.depth ?? room.depth}${locked ? ` — needs ${describeRequirement(door.requires)}` : known ? ' — you have been there' : ''}`
        passage.title = label
        passage.setAttribute('aria-label', label)
        if (target) passage.append(this.#seed(target))
        plate.append(passage)
      }
      if (relic) {
        const gem = document.createElement('span')
        gem.className = `sol-relic ${relic.kind}`
        gem.textContent = relic.kind === 'hexagon' ? '⬡' : relic.kind === 'star' ? '✡' : '▲'
        if (relic.kind === 'triangle') gem.style.transform = `rotate(${(relic.point ?? 0) * 60}deg)`
        plate.append(gem)
        label += `, ${relic.kind === 'triangle' ? `triangle ${Number(relic.point) + 1}` : relic.kind}`
      }
      plate.title = label
      plate.setAttribute('aria-label', label)
    }
    if (this.#ctx && this.#renderer) {
      this.#ctx.setTransform(1, 0, 0, 1, 0, 0)
      this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height)
      this.#ctx.setTransform(this.#scale, 0, 0, this.#scale, 0, 0)
      this.#renderer.drawActors(engine, time)
    }
    this.#meter.max = engine.level.lifeStart ?? 10000
    this.#meter.value = engine.life
    const door = this.journey.nearDoor()
    const doorTarget = door ? this.journey.rooms.get(door.targetRoomId) : undefined
    const text = engine.state === 'gameover' ? 'Try again with R. Your knowledge and collected pieces stay with you.'
      : door && door.id === this.journey.arrivalDoor ? 'Step away from this door, and back into it, to return.'
      : door ? (this.journey.has(door.requires) ? `A door to ${doorTarget?.level.name ?? 'another chamber'} — walk through.` : `This door needs ${describeRequirement(door.requires)}.`)
      : 'Arrows / WASD move · Space jump · Z conjure / dispel · X fire · walk into a door to pass through · M world'
    const stats = `Lives ${engine.lives} · Score ${engine.score.toLocaleString()} · Fire ${engine.ammo.length}`
    const frameKey = `${text}|${stats}`
    if (frameKey !== this.#frameKey) {
      this.#frameKey = frameKey
      this.#stats.textContent = stats
      this.#hint.textContent = text
    }
  }

  #fit(): void {
    const loaded = this.#loaded
    if (!loaded) return
    const width = this.#board.getBoundingClientRect().width || loaded.level.cols * TILE
    this.#scale = width / (loaded.level.cols * TILE) * Math.min(window.devicePixelRatio || 1, 2)
    this.#canvas.width = Math.max(1, Math.round(loaded.level.cols * TILE * this.#scale))
    this.#canvas.height = Math.max(1, Math.round(loaded.level.rows * TILE * this.#scale))
  }

  dispose(): void {
    this.#board.style.transform = ''
    this.#observer.disconnect()
    this.element.remove()
  }
}

export const LABYRINTH_ROOM_CSS = `
.sol-native-room{height:100%;min-height:0;display:flex;flex-direction:column;gap:12px;color:#e8edff}
.sol-room-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
.sol-room-caption{font-size:18px;font-weight:600}
.sol-room-depths{display:flex;gap:7px;font-size:11px;flex-wrap:wrap;perspective:400px}
.sol-room-depths span{padding:6px 9px;border:1px solid #7895ca44;border-radius:7px;background:#28426355;transform:translateY(calc(var(--depth)*2px));color:#c1d2e9}
.sol-room-depths .current{border-color:#6ee8cb;background:#255c65;color:#fff}
.sol-room-viewport{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:14px 24px;container-type:size;overflow:hidden}
.sol-room-board{position:relative;isolation:isolate;display:grid;grid-template-columns:repeat(var(--cols),1fr);grid-template-rows:repeat(var(--rows),1fr);width:min(100cqw,calc(100cqh * var(--room-ratio)));flex-shrink:0;background:#253658;border:1px solid #8194bd;border-radius:6px;box-shadow:5px 7px 0 #496a8a,12px 14px 0 #233b60,0 18px 35px #08162c88}
.sol-game-tile{position:relative;min-width:0;min-height:0;background:#263b5c;border:1px solid #7998ca13;box-sizing:border-box}
.sol-game-tile[data-terrain=wall]{background:linear-gradient(135deg,#e4e8f3,#abbad7);border:1px solid #879abc;box-shadow:inset 2px 2px #f2f7ff,inset -3px -3px #8096b8}
.sol-game-tile[data-terrain=brick],.sol-game-tile[data-terrain=cracked]{background:linear-gradient(135deg,#ffda8e,#de9d51);border:1px solid #c28a51;box-shadow:inset 2px 2px #ffedc1,inset -3px -3px #b5824d}
.sol-game-tile[data-terrain=cracked]:after{content:'ϟ';position:absolute;inset:0;display:grid;place-items:center;color:#935730;font-size:24px}
.sol-game-tile.is-gate{background:repeating-linear-gradient(90deg,#739fd477 0 3px,#38638755 3px 8px);box-shadow:inset 0 0 10px #81dded}
.sol-gate-mark{position:absolute;inset:0;display:grid;place-items:center;color:#b8edff;font-size:24px}
.sol-room-actors{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3}
.sol-passage{--door-h:180;position:absolute;inset:4% 11% 0!important;width:78%;height:96%;overflow:hidden;border:2px solid hsl(var(--door-h) 75% 66%)!important;border-radius:45% 45% 3px 3px!important;background:radial-gradient(ellipse at 50% 40%,hsl(var(--door-h) 45% 42%),hsl(var(--door-h) 55% 12%) 78%)!important;color:transparent!important;padding:0!important;box-shadow:inset 0 0 8px hsl(var(--door-h) 80% 70% / .55),0 0 7px hsl(var(--door-h) 80% 60% / .35);cursor:pointer;font-size:0!important}
.sol-door-seed{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;opacity:.85;z-index:0;pointer-events:none}
.sol-passage:hover .sol-door-seed,.sol-passage.known .sol-door-seed{opacity:1}
.sol-passage[data-shape=round]{inset:6% 13% 2%!important;width:74%;height:92%;border-radius:50%!important}
.sol-passage[data-shape=peak]{border-radius:0!important;clip-path:polygon(50% 0,100% 34%,100% 100%,0 100%,0 34%);border-width:0!important;box-shadow:none;background:radial-gradient(ellipse at 50% 55%,hsl(var(--door-h) 45% 42%),hsl(var(--door-h) 55% 12%) 78%),hsl(var(--door-h) 75% 66%)!important;background-clip:content-box,border-box!important;padding:2px!important}
.sol-passage[data-shape=gate]{border-radius:5px!important;background:repeating-linear-gradient(90deg,transparent 0 22%,hsl(var(--door-h) 70% 62% / .55) 22% 30%),radial-gradient(ellipse at 50% 40%,hsl(var(--door-h) 45% 42%),hsl(var(--door-h) 55% 12%) 78%)!important}
.sol-passage[data-shape=keyhole]{inset:2% 16% 0!important;width:68%;height:98%;border-radius:50% 50% 14% 14%!important}
.sol-passage[data-shape=keyhole]:before{content:'';position:absolute;left:50%;top:44%;width:26%;height:44%;transform:translateX(-50%);background:hsl(var(--door-h) 60% 8%);border-radius:50% 50% 12% 12%;z-index:1}
.sol-passage.known{box-shadow:inset 0 0 8px hsl(var(--door-h) 80% 70% / .55),0 0 14px hsl(var(--door-h) 85% 65% / .7)}
.sol-passage.locked{filter:saturate(.35);opacity:.8;border-style:dashed!important}
.sol-passage.locked:after{content:'';position:absolute;inset:0;z-index:2;background:repeating-linear-gradient(-45deg,transparent 0 7px,hsl(var(--door-h) 30% 80% / .28) 7px 9px)}
.sol-relic{position:absolute;inset:0;display:grid;place-items:center;color:#ffe599;font-size:clamp(14px,2.7vw,34px);text-shadow:0 0 12px #f7d06a;pointer-events:none}
.sol-relic.hexagon{color:#8af2db;text-shadow:0 0 12px #69e5bd}.sol-relic.star{color:#ffc9ff}
.sol-room-status{display:flex;justify-content:space-between;gap:20px;align-items:center;font-size:13px;color:#bfcee5;padding:0 10px}
.sol-room-status progress{height:8px;width:30%;accent-color:#88dac1}
.sol-room-hint{font-size:12px;text-align:center;color:#b5c7dd;padding-bottom:4px}
@media(max-width:650px){.sol-room-heading{gap:7px}.sol-room-caption{font-size:15px}.sol-room-depths{font-size:9px}.sol-room-viewport{padding:10px}.sol-room-hint{font-size:10px}.sol-native-room{gap:8px}}
`
