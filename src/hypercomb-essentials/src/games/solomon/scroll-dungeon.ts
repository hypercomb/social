// These ruins have their own rules: walk, read, interpret, and attune. They
// deliberately share no platformer engine, jumps, block magic, or life meter.
import type { SigilRequirement } from './labyrinth.js'
import { CavernPainter, type CavernCamera, type CavernLight } from './cavern-paint.js'
import { canvasContext } from './island-paint.js'
import { drawPlace, type PlaceGlow, type PlaceSprite } from './island-places.js'
import { PLAYER_LOOK, drawWalker, type WalkerFacing } from './island-sprites.js'

type Cell = { col: number; row: number }
export interface DungeonInput { up: boolean; down: boolean; left: boolean; right: boolean }
interface Rune { id: string; glyph: string; label: string }
export interface InscriptionGate extends Cell {
  id: string
  name: string
  clue: Cell
  inscription: string
  question: string
  options: Rune[]
  answer: string[]
}
export interface ScrollDungeonDef {
  id: string
  name: string
  cols: number
  rows: number
  tiles: string[]
  spawn: Cell
  exit: Cell
  gates: InscriptionGate[]
  artifact: Cell
  lore: string
  knowledgeId: string
  alcove: Cell
}
export interface DungeonDialog {
  kind: 'clue' | 'gate' | 'artifact' | 'exit' | 'hint'
  title: string
  text: string
  gateId?: string
}
export interface DungeonSnapshot {
  version: 1
  dungeonId: string
  player: { x: number; y: number }
  readClues: string[]
  openGates: string[]
  progress: Array<[string, string[]]>
  discovered: Array<[string, string]>
  complete: boolean
}
const CENTER_MEMORY = 'The center is a meeting place, never a payment. Carry it through every doorway; its light belongs to you.'

export function createScrollDungeon(index: number): ScrollDungeonDef {
  const highland = index >= 2
  const cols = 46, rows = 13
  const tiles: string[][] = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) =>
    col === 0 || col === cols - 1 || row === 0 || row === rows - 1 ? '#' : '.'))
  // Two complete cross-walls make interpretation necessary. Their single
  // openings are the rune gates; side pools give the rooms a wandering path.
  for (const col of [14, 30]) for (let row = 1; row < rows - 1; row++) tiles[row][col] = '#'
  tiles[6][14] = '.'
  tiles[6][30] = '.'
  for (let col = 4; col <= 8; col++) for (let row = 2; row <= 4; row++) tiles[row][col] = '~'
  for (let col = 20; col <= 24; col++) for (let row = 8; row <= 10; row++) tiles[row][col] = '~'
  for (let col = 35; col <= 39; col++) for (let row = 2; row <= 4; row++) tiles[row][col] = '~'
  const cycle = highland
    ? [{ id: 'dawn', glyph: '◔', label: 'Dawn' }, { id: 'noon', glyph: '☀', label: 'Noon' }, { id: 'dusk', glyph: '◕', label: 'Dusk' }]
    : [{ id: 'rain', glyph: '≋', label: 'Rain' }, { id: 'sun', glyph: '☀', label: 'Sun' }, { id: 'bloom', glyph: '✿', label: 'Bloom' }]
  return {
    id: highland ? 'highland-cavern' : 'wayfarer-cavern',
    name: highland ? 'Highland Cavern' : 'Wayfarer Cavern', cols, rows,
    tiles: tiles.map(row => row.join('')), spawn: { col: 3, row: 6 }, exit: { col: 2, row: 6 },
    gates: [
      {
        id: 'cycle', name: highland ? 'Gate of Hours' : 'Gate of the Garden', col: 14, row: 6,
        clue: { col: 11, row: 5 }, options: [cycle[2], cycle[0], cycle[1]], answer: cycle.map(rune => rune.id),
        inscription: highland ? 'Dawn opens the eye. Noon fills it with light. Dusk lets it rest. Give the gate one whole day.'
          : 'First the rain wakes the seed. Then the sun warms its leaves. Last the bloom greets the traveller. Let the garden grow.',
        question: highland ? 'Touch the hours in their natural order.' : 'Touch the garden’s gifts in the order the inscription teaches.',
      },
      {
        id: 'meaning', name: highland ? 'Gate of the Center' : 'Gate of Returning Water', col: 30, row: 6,
        clue: { col: 27, row: 7 },
        options: [
          { id: 'triangle', glyph: '△', label: 'Triangle' },
          { id: 'circle', glyph: '○', label: 'Circle' },
          { id: 'hexagon', glyph: '⬡', label: 'Hexagon' },
        ],
        answer: [highland ? 'hexagon' : 'circle'],
        inscription: highland ? 'Six roads surround the courtyard. Each face meets its neighbour; each road returns to one center. Which shape holds them together?'
          : 'The stream bends home. Its end greets its beginning, without a corner or a break. Which mark remembers its journey?',
        question: 'Choose the mark that carries the inscription’s meaning.',
      },
    ],
    artifact: { col: 42, row: 6 }, alcove: { col: 37, row: 9 },
    knowledgeId: highland ? 'highland-accord' : 'wayfarer-spring',
    lore: highland
      ? 'Above Tideglass Porch’s highest left shelf, a memory waits in the empty square over the shelf’s left end. Make a stone there, then break that same stone: the hidden treasure will appear.'
      : 'Above Sunseed Porch’s highest left shelf, a memory waits in the empty square over the shelf’s left end. Make a stone there, then break that same stone: the hidden treasure will appear.',
  }
}

/** Framework-free exploration state. Coordinates are tile centers, movement
 *  is four-direction walking, and puzzle progress never consumes an ability. */
export class ScrollDungeonModel {
  readonly definition: ScrollDungeonDef
  readonly openGates = new Set<string>()
  readonly readClues = new Set<string>()
  readonly discovered = new Map<string, string>()
  readonly progress = new Map<string, string[]>()
  x: number
  y: number
  complete = false
  moving = false

  constructor(index: number, private readonly has: (requirement: SigilRequirement) => boolean = () => false) {
    this.definition = createScrollDungeon(index)
    this.x = this.definition.spawn.col + 0.5
    this.y = this.definition.spawn.row + 0.5
  }

  exportState(): DungeonSnapshot {
    return {
      version: 1, dungeonId: this.definition.id, player: { x: this.x, y: this.y },
      readClues: [...this.readClues].sort(), openGates: [...this.openGates].sort(),
      progress: [...this.progress].sort(([a], [b]) => a.localeCompare(b)).map(([id, sequence]) => [id, [...sequence]]),
      discovered: [...this.discovered].sort(([a], [b]) => a.localeCompare(b)).map(([id, lore]) => [id, lore]),
      complete: this.complete,
    }
  }

  /** Restore puzzle facts, never the authored map or prose supplied by a save.
   *  Replacing a slot also resets motion and any facts absent from that slot. */
  restoreState(raw: unknown): void {
    this.openGates.clear(); this.readClues.clear(); this.discovered.clear(); this.progress.clear()
    this.x = this.definition.spawn.col + 0.5; this.y = this.definition.spawn.row + 0.5
    this.complete = false; this.moving = false
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    const saved = raw as Record<string, unknown>, def = this.definition
    if (saved['version'] !== 1 || saved['dungeonId'] !== def.id) return
    const includes = (field: string, id: string): boolean => Array.isArray(saved[field]) && (saved[field] as unknown[]).includes(id)
    const discoveries = Array.isArray(saved['discovered']) ? saved['discovered'] as unknown[] : []
    const discovered = (id: string): boolean => discoveries.some(pair => Array.isArray(pair) && pair.length === 2
      && pair[0] === id && typeof pair[1] === 'string')
    const sequences = Array.isArray(saved['progress']) ? saved['progress'] as unknown[] : []
    for (const gate of def.gates) {
      if (!includes('readClues', gate.id)) continue
      this.readClues.add(gate.id)
      this.discovered.set(`${def.id}-${gate.id}`, gate.inscription)
      if (includes('openGates', gate.id)) {
        this.openGates.add(gate.id)
        this.progress.set(gate.id, [...gate.answer])
        continue
      }
      const pair = sequences.find(entry => Array.isArray(entry) && entry.length === 2 && entry[0] === gate.id)
      if (!Array.isArray(pair) || !Array.isArray(pair[1])) continue
      const sequence: unknown[] = pair[1]
      if (sequence.length < gate.answer.length && sequence.every((rune, index) => rune === gate.answer[index])) {
        this.progress.set(gate.id, [...sequence] as string[])
      }
    }
    if (discovered(`${def.id}-center-memory`) && this.has({ kind: 'hexagon' })) this.discovered.set(`${def.id}-center-memory`, CENTER_MEMORY)
    if (saved['complete'] === true && discovered(def.knowledgeId)) {
      this.complete = true
      this.discovered.set(def.knowledgeId, def.lore)
    }
    const player = saved['player']
    if (player && typeof player === 'object' && !Array.isArray(player)) {
      const position = player as Record<string, unknown>, x = position['x'], y = position['y']
      if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) && this.#fits(x, y)) {
        this.x = x; this.y = y
      }
    }
  }

  near(cell: Cell): boolean { return Math.hypot(this.x - cell.col - 0.5, this.y - cell.row - 0.5) < 1.65 }

  walkable(col: number, row: number): boolean {
    if (this.definition.tiles[row]?.[col] !== '.') return false
    return !this.definition.gates.some(gate => gate.col === col && gate.row === row && !this.openGates.has(gate.id))
  }

  update(dt: number, input: DungeonInput): void {
    if (!Number.isFinite(dt) || dt <= 0) return
    let dx = Number(input.right) - Number(input.left), dy = Number(input.down) - Number(input.up)
    const length = Math.hypot(dx, dy)
    this.moving = length > 0
    if (!length) return
    const distance = Math.min(dt, 0.1) * 3.8
    dx = dx / length * distance
    dy = dy / length * distance
    // Small substeps and corner checks prevent tunnelling or cutting a
    // diagonal corner through a pool/closed gate at a slow frame rate.
    const steps = Math.max(1, Math.ceil(distance / 0.1))
    for (let step = 0; step < steps; step++) {
      if (this.#fits(this.x + dx / steps, this.y)) this.x += dx / steps
      if (this.#fits(this.x, this.y + dy / steps)) this.y += dy / steps
    }
  }

  #fits(x: number, y: number): boolean {
    const radius = 0.25
    return [x - radius, x + radius].every(cx => [y - radius, y + radius]
      .every(cy => this.walkable(Math.floor(cx), Math.floor(cy))))
  }

  interact(targetId?: string): DungeonDialog {
    const def = this.definition
    const targets = [
      { id: 'exit', cell: def.exit }, { id: 'artifact', cell: def.artifact }, { id: 'alcove', cell: def.alcove },
      ...def.gates.flatMap(gate => [{ id: `clue-${gate.id}`, cell: gate.clue }, { id: gate.id, cell: gate }]),
    ].filter(target => (!targetId || targetId === target.id) && this.near(target.cell))
      .sort((a, b) => Math.hypot(this.x - a.cell.col - 0.5, this.y - a.cell.row - 0.5)
        - Math.hypot(this.x - b.cell.col - 0.5, this.y - b.cell.row - 0.5))
    const target = targets[0]
    if (!target) return { kind: 'hint', title: 'Explore the ruins', text: 'Walk beside an inscription, a rune gate, or a shining artifact, then interact.' }
    if (target.id === 'exit') return { kind: 'exit', title: 'Back to the meadow', text: 'The sunlight waits just beyond this arch.' }
    if (target.id === 'artifact') {
      const already = this.complete
      this.complete = true
      this.discovered.set(def.knowledgeId, def.lore)
      return { kind: 'artifact', title: already ? 'A remembered discovery' : 'Knowledge recovered', text: def.lore }
    }
    if (target.id === 'alcove') {
      const open = this.has({ kind: 'hexagon' })
      const text = open ? CENTER_MEMORY
        : 'A tiny hexagon rests in the carving. Return with the central hexagon to hear this quiet memory.'
      if (open) this.discovered.set(`${def.id}-center-memory`, text)
      return { kind: 'clue', title: 'Memory alcove', text }
    }
    const clue = def.gates.find(gate => `clue-${gate.id}` === target.id)
    if (clue) {
      this.readClues.add(clue.id)
      this.discovered.set(`${def.id}-${clue.id}`, clue.inscription)
      return { kind: 'clue', title: clue.name, text: clue.inscription }
    }
    const gate = def.gates.find(candidate => candidate.id === target.id)!
    if (this.openGates.has(gate.id)) return { kind: 'hint', title: gate.name, text: 'The runes remember your understanding. This passage stays open.' }
    if (!this.readClues.has(gate.id)) return { kind: 'hint', title: gate.name, text: 'These runes answer an inscription. Read the nearby stone before attuning the gate.' }
    return { kind: 'gate', title: gate.name, text: gate.question, gateId: gate.id }
  }

  choose(gateId: string, runeId: string): { opened: boolean; text: string } {
    const gate = this.definition.gates.find(candidate => candidate.id === gateId)
    if (!gate || !this.near(gate) || !this.readClues.has(gateId) || this.openGates.has(gateId)
      || !gate.options.some(option => option.id === runeId)) {
      return { opened: false, text: 'Read the inscription and stand beside its gate to attune the runes.' }
    }
    const progress = [...(this.progress.get(gateId) ?? []), runeId]
    if (gate.answer[progress.length - 1] !== runeId) {
      this.progress.set(gateId, [])
      return { opened: false, text: 'The marks settle again. Consider the inscription and begin a fresh sequence.' }
    }
    this.progress.set(gateId, progress)
    if (progress.length < gate.answer.length) return { opened: false, text: `${progress.length} of ${gate.answer.length} runes are singing. Choose the next.` }
    this.openGates.add(gateId)
    return { opened: true, text: 'The stone opens with a gentle chime. Your understanding stays with the passage.' }
  }
}

export interface ScrollDungeonOptions {
  index: number
  has(requirement: SigilRequirement): boolean
  onComplete(lore: string): void
  onMessage?(message: string): void
  onKnowledge?(id: string, text: string): void
  onExit?(): void
}

interface Feature {
  button: HTMLButtonElement
  cell: Cell
  art: CanvasRenderingContext2D | null
  look(): readonly [PlaceSprite, PlaceGlow]
  drawn: string
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

/** A cavern walked by torchlight, in the island's three-quarter view: the
 *  explorer and every stone, gate and relic stand up off a painted floor, and
 *  the dark gives way only around your torch and the sconces on the walls. */
export class ScrollDungeonView {
  readonly model: ScrollDungeonModel
  readonly #element = document.createElement('section')
  readonly #viewport = document.createElement('div')
  readonly #ground = document.createElement('canvas')
  readonly #light = document.createElement('canvas')
  readonly #layer = document.createElement('div')
  readonly #player = document.createElement('canvas')
  readonly #status = document.createElement('p')
  readonly #sentKnowledge = new Set<string>()
  readonly #gateButtons = new Map<string, HTMLButtonElement>()
  readonly #features: Feature[] = []
  readonly #painter: CavernPainter
  readonly #camera: CavernCamera = { x: 0, y: 0, width: 0, height: 0, tile: 44, dpr: 1 }
  #groundContext: CanvasRenderingContext2D | null = null
  #lightContext: CanvasRenderingContext2D | null = null
  #sprite: CanvasRenderingContext2D | null = null
  #spriteKey = ''
  #facing: WalkerFacing = 'right'
  #time = 0
  #resize: ResizeObserver | null = null
  #dialog: HTMLElement | null = null
  #completionSent = false
  #disposed = false

  constructor(private readonly options: ScrollDungeonOptions) {
    this.model = new ScrollDungeonModel(options.index, options.has)
    this.#painter = new CavernPainter(this.model.definition)
  }

  get isDialogOpen(): boolean { return this.#dialog !== null }
  exportState(): DungeonSnapshot { return this.model.exportState() }
  restoreState(raw: unknown): void {
    this.closeDialog()
    this.model.restoreState(raw)
    this.#sentKnowledge.clear()
    for (const id of this.model.discovered.keys()) this.#sentKnowledge.add(id)
    this.#completionSent = this.model.complete
    this.#status.textContent = this.model.complete ? 'Your discovery is remembered. Explore on, or return to the meadow.'
      : 'Explore the ruins. Read inscriptions and attune the rune gates.'
    this.#render()
  }

  mount(host: HTMLElement): void {
    const def = this.model.definition
    this.#element.className = 'sol-scroll-dungeon'
    this.#element.innerHTML = `<style>${SCROLL_DUNGEON_CSS}</style>`
    const heading = document.createElement('header')
    const title = document.createElement('strong')
    title.textContent = def.name
    const subtitle = document.createElement('span')
    subtitle.textContent = 'Walk by torchlight • read the stones • attune the runes'
    heading.append(title, subtitle)
    this.#viewport.className = 'sd-viewport'
    this.#viewport.setAttribute('data-consumes-wheel', '')
    this.#viewport.setAttribute('aria-label', `${def.name}, a cavern explored by torchlight`)
    this.#ground.className = 'sd-ground'
    this.#ground.setAttribute('aria-hidden', 'true')
    this.#light.className = 'sd-light'
    this.#light.setAttribute('aria-hidden', 'true')
    this.#layer.className = 'sd-layer'
    this.#groundContext = canvasContext(this.#ground)
    this.#lightContext = canvasContext(this.#light)
    const feature = (id: string, cell: Cell, label: string, kind: string, look: () => readonly [PlaceSprite, PlaceGlow]): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `sd-feature ${kind}`
      button.setAttribute('aria-label', label)
      button.title = label
      button.addEventListener('click', () => this.#interact(id))
      const art = document.createElement('canvas')
      art.className = 'sd-art'
      art.width = art.height = 96
      art.setAttribute('aria-hidden', 'true')
      button.append(art)
      button.style.zIndex = String(cell.row * 10)
      this.#layer.append(button)
      this.#features.push({ button, cell, art: canvasContext(art), look, drawn: '' })
      return button
    }
    for (const gate of def.gates) {
      feature(`clue-${gate.id}`, gate.clue, `${gate.name} inscription`, 'sd-inscription', () => ['tablet', null])
      this.#gateButtons.set(gate.id, feature(gate.id, gate, gate.name, 'sd-gate',
        () => [this.model.openGates.has(gate.id) ? 'rune-door-open' : 'rune-door', null]))
    }
    feature('exit', def.exit, 'Return to the meadow', 'sd-exit', () => ['cave-exit', null])
    feature('artifact', def.artifact, 'Knowledge artifact', 'sd-artifact', () => ['crystal', this.model.complete ? null : 'ready'])
    feature('alcove', def.alcove, 'Memory alcove', 'sd-alcove', () => ['alcove', null])
    this.#player.className = 'sd-explorer'
    this.#player.width = 64
    this.#player.height = 96
    this.#player.setAttribute('role', 'img')
    this.#player.setAttribute('aria-label', 'Your explorer')
    this.#sprite = canvasContext(this.#player)
    this.#spriteKey = ''
    this.#layer.append(this.#player)
    this.#viewport.append(this.#ground, this.#layer, this.#light)
    this.#status.className = 'sd-status'
    this.#status.textContent = 'Arrow keys / WASD walk; E / Enter reads and attunes, and E closes what it opened. The daylit arch returns to the meadow.'
    this.#element.append(heading, this.#viewport, this.#status)
    host.append(this.#element)
    if (typeof ResizeObserver !== 'undefined') {
      this.#resize = new ResizeObserver(() => this.#fit())
      this.#resize.observe(this.#viewport)
    }
    this.#fit()
    this.#render()
  }

  update(dt: number, input: DungeonInput): void {
    if (this.#disposed) return
    if (!this.#dialog) {
      this.model.update(dt, input)
      if (input.left) this.#facing = 'left'
      else if (input.right) this.#facing = 'right'
      else if (input.up) this.#facing = 'up'
      else if (input.down) this.#facing = 'down'
    }
    if (Number.isFinite(dt) && dt > 0) this.#time += Math.min(dt, 0.1)
    this.#render()
  }

  interact(): void { if (!this.#dialog) this.#interact() }

  #interact(targetId?: string): void {
    if (this.#disposed || this.#dialog) return
    const result = this.model.interact(targetId)
    for (const [id, text] of this.model.discovered) {
      if (this.#sentKnowledge.has(id)) continue
      this.#sentKnowledge.add(id)
      this.options.onKnowledge?.(id, text)
    }
    if (result.kind === 'exit' && this.options.onExit) { this.options.onExit(); return }
    this.options.onMessage?.(result.text)
    this.#showDialog(result)
    this.#render()
    if (result.kind === 'artifact' && !this.#completionSent) {
      this.#completionSent = true
      // Notify last: the adventure shell can return to the world and close
      // this dialog synchronously, without a hidden dialog being recreated.
      this.options.onComplete(result.text)
    }
  }

  #showDialog(result: DungeonDialog): void {
    this.closeDialog()
    const shade = document.createElement('div')
    shade.className = 'sd-dialog-shade'
    const dialog = document.createElement('div')
    dialog.className = 'sd-dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-label', result.title)
    dialog.tabIndex = -1
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'sd-close'
    close.textContent = '×'
    close.setAttribute('aria-label', 'Close (E)')
    close.title = 'Close (E)'
    close.addEventListener('click', () => this.closeDialog())
    const title = document.createElement('h3')
    title.textContent = result.title
    const text = document.createElement('p')
    text.textContent = result.text
    dialog.append(close, title, text)
    let firstChoice: HTMLButtonElement | null = null
    if (result.kind === 'gate' && result.gateId) {
      const gate = this.model.definition.gates.find(candidate => candidate.id === result.gateId)!
      const remembered = document.createElement('blockquote')
      remembered.textContent = gate.inscription
      const choices = document.createElement('div')
      choices.className = 'sd-runes'
      for (const rune of gate.options) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = `${rune.glyph} ${rune.label}`
        button.addEventListener('click', () => {
          const answer = this.model.choose(gate.id, rune.id)
          text.textContent = answer.text
          this.#status.textContent = answer.text
          if (answer.opened) for (const choice of choices.querySelectorAll('button')) choice.disabled = true
          this.#render()
        })
        firstChoice ??= button
        choices.append(button)
      }
      dialog.append(remembered, choices)
    }
    dialog.addEventListener('keydown', event => {
      event.stopPropagation()
      // E opened this, so E puts it away again.
      if (event.key === 'Escape' || (event.key.toLowerCase() === 'e' && !event.repeat)) { event.preventDefault(); this.closeDialog(); return }
      if (event.key !== 'Tab') return
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const first = buttons[0], last = buttons.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    })
    shade.append(dialog)
    this.#element.append(shade)
    this.#dialog = shade
    ;(firstChoice ?? dialog).focus()
  }

  closeDialog(): void { this.#dialog?.remove(); this.#dialog = null }

  #fit(): void {
    const width = this.#viewport.clientWidth, height = this.#viewport.clientHeight
    if (!width || !height) return
    const dpr = clamp(globalThis.devicePixelRatio || 1, 1, 2)
    const tile = clamp(Math.round(Math.min(width / 15, height / 9.5)), 30, 64)
    Object.assign(this.#camera, { width, height, dpr, tile })
    for (const canvas of [this.#ground, this.#light]) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }
    this.#viewport.style.setProperty('--sprite-scale', String(Math.round(tile / 42 * 100) / 100))
    for (const { button, cell } of this.#features) {
      button.style.left = `${(cell.col + 0.5) * tile}px`
      button.style.top = `${(cell.row + 0.84) * tile}px`
    }
    this.#render()
  }

  #render(): void {
    for (const [id, button] of this.#gateButtons) button.classList.toggle('sd-open', this.model.openGates.has(id))
    for (const feature of this.#features) {
      if (!feature.art) continue
      const [sprite, glow] = feature.look()
      const drawn = `${sprite}:${glow}`
      if (drawn === feature.drawn) continue
      feature.drawn = drawn
      drawPlace(feature.art, sprite, glow)
    }
    const walking = this.model.moving && !this.#dialog
    this.#player.classList.toggle('sd-walking', walking)
    const step = walking ? Math.floor(this.#time * 8) % 4 : 0
    const key = `${this.#facing}:${step}`
    if (this.#sprite && key !== this.#spriteKey) {
      this.#spriteKey = key
      drawWalker(this.#sprite, PLAYER_LOOK, this.#facing, step)
    }
    const camera = this.#camera, def = this.model.definition
    if (!camera.width || !camera.height) return
    const tile = camera.tile
    const mapWidth = def.cols * tile, mapHeight = def.rows * tile
    camera.x = Math.round(mapWidth <= camera.width ? (mapWidth - camera.width) / 2 : clamp(this.model.x * tile - camera.width / 2, 0, mapWidth - camera.width))
    camera.y = Math.round(mapHeight <= camera.height ? (mapHeight - camera.height) / 2 : clamp(this.model.y * tile - camera.height / 2, 0, mapHeight - camera.height))
    this.#layer.style.transform = `translate3d(${-camera.x}px, ${-camera.y}px, 0)`
    this.#player.style.left = `${this.model.x * tile}px`
    this.#player.style.top = `${(this.model.y + 0.3) * tile}px`
    this.#player.style.zIndex = String(Math.round(this.model.y * 10))
    this.#painter.reveal(this.model.x, this.model.y)
    const lights: CavernLight[] = [
      { x: def.exit.col + 0.5, y: def.exit.row + 0.5, radius: 2.4 },
      { x: def.artifact.col + 0.5, y: def.artifact.row + 0.5, radius: this.model.complete ? 1.2 : 1.9 },
      ...def.gates.filter(gate => this.model.openGates.has(gate.id)).map(gate => ({ x: gate.col + 0.5, y: gate.row + 0.5, radius: 1.3 })),
    ]
    if (this.#groundContext) this.#painter.paintRock(this.#groundContext, camera, this.#time)
    if (this.#lightContext) this.#painter.paintLight(this.#lightContext, camera, { x: this.model.x, y: this.model.y }, this.#time, lights)
  }

  dispose(): void {
    this.#disposed = true
    this.#resize?.disconnect()
    this.#resize = null
    this.closeDialog()
    this.#element.remove()
    this.#gateButtons.clear()
  }
}

const SCROLL_DUNGEON_CSS = `
.sol-scroll-dungeon{height:100%;min-height:0;display:flex;flex-direction:column;position:relative;background:#07080b;color:#e9dfc8;color-scheme:dark;font:14px/1.45 system-ui,sans-serif;border:1px solid #3a3228;border-radius:16px;overflow:hidden}
.sol-scroll-dungeon header{display:flex;justify-content:space-between;gap:12px;align-items:baseline;padding:12px 18px;background:linear-gradient(#1a1612,#100e0b);border-bottom:1px solid #3a3228}.sol-scroll-dungeon header strong{font:600 20px Georgia,serif;letter-spacing:.02em;color:#f1d9a4}.sol-scroll-dungeon header span{font-size:12px;color:#a89a80}
.sd-viewport{position:relative;flex:1;min-height:0;overflow:hidden;background:#060709;--sprite-scale:1}
.sd-ground,.sd-light{position:absolute;inset:0;width:100%;height:100%;display:block}.sd-ground{z-index:0}.sd-light{z-index:2;pointer-events:none}
.sd-layer{position:absolute;z-index:1;left:0;top:0;width:0;height:0;will-change:transform}
.sol-scroll-dungeon .sd-feature{position:absolute;padding:0;border:0;background:transparent;cursor:pointer;transform:translate(-50%,-46px) scale(var(--sprite-scale));transform-origin:50% 46px}.sol-scroll-dungeon .sd-feature:focus-visible{outline:3px solid #f1d9a4;outline-offset:2px;border-radius:6px}
.sd-art{display:block;width:48px;height:48px}
.sd-explorer{position:absolute;pointer-events:none;width:32px;height:48px;transform:translate(-50%,-46px) scale(var(--sprite-scale));transform-origin:50% 46px}
.sd-status{padding:9px 18px;margin:0;background:#100e0b;border-top:1px solid #3a3228;font-size:12px;color:#c9b98f}
.sd-dialog-shade{position:absolute;inset:0;z-index:10;display:grid;place-items:center;padding:18px;background:rgba(3,4,8,.62);backdrop-filter:blur(3px)}.sd-dialog{position:relative;width:min(460px,100%);box-sizing:border-box;border:1px solid #6b5a3e;border-radius:16px;padding:24px;background:linear-gradient(160deg,#2a231b,#17130f);box-shadow:0 18px 70px rgba(0,0,0,.6);color:#eadfc6;outline:none}.sd-dialog h3{margin:0 34px 12px 0;font:600 22px Georgia,serif;color:#f1d9a4}.sd-dialog p{margin:10px 0;color:#d8ccb2}.sd-dialog blockquote{margin:16px 0;padding:12px 16px;border-left:3px solid #c9a15a;background:rgba(255,230,180,.06);font:italic 15px/1.5 Georgia,serif;color:#e6d4a8}
.sd-runes{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 4px}.sol-scroll-dungeon .sd-runes button{min-height:42px;border:1px solid #7d6a48;border-radius:10px;padding:9px 15px;background:#3a3024;color:#f3e2bd;font:600 14px system-ui,sans-serif;cursor:pointer}.sol-scroll-dungeon .sd-runes button:hover{background:#4a3d2c}.sd-runes button:disabled{opacity:.5;cursor:default}
.sol-scroll-dungeon .sd-close{position:absolute;right:12px;top:12px;width:30px;height:30px;border:1px solid #6b5a3e;border-radius:50%;background:#2d261d;color:#eadfc6;font-size:20px;line-height:1;cursor:pointer}.sd-dialog button:focus-visible{outline:3px solid #f1d9a4;outline-offset:3px}
@media(max-width:600px){.sol-scroll-dungeon header{padding:10px 12px;display:block}.sol-scroll-dungeon header strong{font-size:17px}.sol-scroll-dungeon header span{display:block;margin-top:3px}.sd-status{font-size:11px;padding:7px 10px}.sd-dialog{padding:18px}.sd-dialog h3{font-size:20px}}
`
