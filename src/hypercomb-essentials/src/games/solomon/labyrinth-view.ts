import { TILE, WALL, BRICK, CRACKED } from './engine.js'
import { LabyrinthJourney, describeRequirement } from './labyrinth.js'
import { Renderer } from './renderer.js'
import { type LoadedTileRoom, syncTerrain } from './tile-surface.js'

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
  #transition: Animation | null = null

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

  show(loaded: LoadedTileRoom, direction: 'in' | 'out' | 'across' = 'in'): void {
    this.#transition?.cancel()
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
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && this.#board.animate) {
      const scale = direction === 'out' ? 1.14 : direction === 'across' ? 0.98 : 0.84
      this.#transition = this.#board.animate([
        { transform: `scale(${scale})`, opacity: 0.1 }, { transform: 'scale(1)', opacity: 1 },
      ], { duration: 380, easing: 'ease-out' })
    }
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
      const description = `${terrain}|${door?.id ?? ''}|${locked}|${relic?.id ?? ''}|${gateLocked}`
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
        const passage = document.createElement('button')
        passage.className = `sol-passage ${delta < 0 ? 'out' : delta === 0 ? 'across' : 'in'}${locked ? ' locked' : ''}`
        passage.dataset['door'] = door.id
        passage.textContent = locked ? '◇' : delta < 0 ? '↥' : delta === 0 ? '↔' : '↧'
        label = `${delta < 0 ? 'Return' : 'Passage'} to ${target?.level.name ?? 'chamber'}, depth ${target?.depth ?? room.depth}${locked ? ` — needs ${describeRequirement(door.requires)}` : ''}`
        passage.title = label
        passage.setAttribute('aria-label', label)
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
    const text = engine.state === 'gameover' ? 'Try again with R. Your knowledge and collected pieces stay with you.'
      : door ? `Enter / E: ${this.journey.has(door.requires) ? 'use passage' : `requires ${describeRequirement(door.requires)}`}`
      : 'Arrows / WASD move · Space jump · Z conjure / dispel · X fire · E passage · M world'
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
    this.#transition?.cancel()
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
.sol-passage{position:absolute;inset:4% 11% 0!important;width:78%;height:96%;border:2px solid #69e6d0!important;border-radius:45% 45% 3px 3px!important;background:radial-gradient(ellipse at center,#5e9ba7,#172c4d 75%)!important;color:#c9fff3!important;padding:0!important;display:grid;place-items:center;font-size:clamp(13px,2vw,26px)!important;box-shadow:inset 0 0 8px #71edd488,0 0 7px #73ead055;cursor:pointer}
.sol-passage.out{border-color:#ffca7f!important;background:radial-gradient(ellipse at center,#9d754e,#302f48 75%)!important;color:#ffe6b5!important}
.sol-passage.across{border-color:#c2a5ff!important}
.sol-passage.locked{filter:saturate(.5);opacity:.85}
.sol-relic{position:absolute;inset:0;display:grid;place-items:center;color:#ffe599;font-size:clamp(14px,2.7vw,34px);text-shadow:0 0 12px #f7d06a;pointer-events:none}
.sol-relic.hexagon{color:#8af2db;text-shadow:0 0 12px #69e5bd}.sol-relic.star{color:#ffc9ff}
.sol-room-status{display:flex;justify-content:space-between;gap:20px;align-items:center;font-size:13px;color:#bfcee5;padding:0 10px}
.sol-room-status progress{height:8px;width:30%;accent-color:#88dac1}
.sol-room-hint{font-size:12px;text-align:center;color:#b5c7dd;padding-bottom:4px}
@media(max-width:650px){.sol-room-heading{gap:7px}.sol-room-caption{font-size:15px}.sol-room-depths{font-size:9px}.sol-room-viewport{padding:10px}.sol-room-hint{font-size:10px}.sol-native-room{gap:8px}}
`
