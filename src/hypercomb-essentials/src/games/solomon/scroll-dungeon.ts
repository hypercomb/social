// These ruins have their own rules: walk, read, interpret, and attune. They
// deliberately share no platformer engine, jumps, block magic, or life meter.
import type { SigilRequirement } from './labyrinth.js'

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

export class ScrollDungeonView {
  readonly model: ScrollDungeonModel
  readonly #element = document.createElement('section')
  readonly #viewport = document.createElement('div')
  readonly #board = document.createElement('div')
  readonly #player = document.createElement('div')
  readonly #status = document.createElement('p')
  readonly #sentKnowledge = new Set<string>()
  readonly #gateButtons = new Map<string, HTMLButtonElement>()
  #dialog: HTMLElement | null = null
  #completionSent = false
  #tile = 40
  #disposed = false

  constructor(private readonly options: ScrollDungeonOptions) {
    this.model = new ScrollDungeonModel(options.index, options.has)
  }

  get isDialogOpen(): boolean { return this.#dialog !== null }
  exportState(): DungeonSnapshot { return this.model.exportState() }
  restoreState(raw: unknown): void {
    this.closeDialog()
    this.model.restoreState(raw)
    this.#sentKnowledge.clear()
    for (const id of this.model.discovered.keys()) this.#sentKnowledge.add(id)
    this.#completionSent = this.model.complete
    this.#status.textContent = this.model.complete ? 'Your discovery is remembered. Continue exploring or return to the meadow.'
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
    subtitle.textContent = 'Walk • read the stones • attune the runes'
    heading.append(title, subtitle)
    this.#viewport.className = 'sd-viewport'
    this.#viewport.setAttribute('data-consumes-wheel', '')
    this.#viewport.setAttribute('aria-label', `${def.name}, a scrolling exploration dungeon`)
    this.#board.className = 'sd-board'
    this.#board.style.setProperty('--cols', String(def.cols))
    this.#board.style.setProperty('--rows', String(def.rows))
    for (let row = 0; row < def.rows; row++) for (let col = 0; col < def.cols; col++) {
      const tile = document.createElement('div')
      const code = def.tiles[row][col]
      tile.className = `sd-tile ${code === '#' ? 'sd-wall' : code === '~' ? 'sd-water' : 'sd-path'}`
      if (code === '.' && (col * 13 + row * 7) % 17 === 0) tile.classList.add('sd-flower')
      this.#board.append(tile)
    }
    const feature = (id: string, cell: Cell, glyph: string, label: string, kind: string): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `sd-feature ${kind}`
      button.style.left = `calc(${cell.col} * var(--tile))`
      button.style.top = `calc(${cell.row} * var(--tile))`
      button.textContent = glyph
      button.setAttribute('aria-label', label)
      button.title = label
      button.addEventListener('click', () => this.#interact(id))
      this.#board.append(button)
      return button
    }
    for (const gate of def.gates) {
      feature(`clue-${gate.id}`, gate.clue, '▤', `${gate.name} inscription`, 'sd-inscription')
      this.#gateButtons.set(gate.id, feature(gate.id, gate, '◇', gate.name, 'sd-gate'))
    }
    feature('exit', def.exit, '↩', 'Return to the meadow', 'sd-exit')
    feature('artifact', def.artifact, '✧', 'Knowledge artifact', 'sd-artifact')
    feature('alcove', def.alcove, '⬡', 'Memory alcove', 'sd-alcove')
    this.#player.className = 'sd-explorer'
    this.#player.textContent = '✦'
    this.#player.setAttribute('role', 'img')
    this.#player.setAttribute('aria-label', 'Your explorer')
    this.#board.append(this.#player)
    this.#viewport.append(this.#board)
    this.#status.className = 'sd-status'
    this.#status.textContent = 'Follow the tiled path. Arrow keys / WASD walk; E / Enter interacts. The arch returns to the meadow.'
    this.#element.append(heading, this.#viewport, this.#status)
    host.append(this.#element)
    this.#render()
  }

  update(dt: number, input: DungeonInput): void {
    if (this.#disposed) return
    if (!this.#dialog) this.model.update(dt, input)
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
    const title = document.createElement('h3')
    title.textContent = result.title
    const text = document.createElement('p')
    text.textContent = result.text
    dialog.append(title, text)
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
        choices.append(button)
      }
      dialog.append(remembered, choices)
    }
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'sd-continue'
    close.textContent = 'Continue exploring'
    close.addEventListener('click', () => this.closeDialog())
    dialog.append(close)
    dialog.addEventListener('keydown', event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); this.closeDialog(); return }
      if (event.key !== 'Tab') return
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const first = buttons[0], last = buttons.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    })
    shade.append(dialog)
    this.#element.append(shade)
    this.#dialog = shade
    ;(dialog.querySelector('button') as HTMLButtonElement | null)?.focus()
  }

  closeDialog(): void { this.#dialog?.remove(); this.#dialog = null }

  #render(): void {
    const height = this.#viewport.clientHeight
    const tile = height > 0 ? Math.max(22, Math.min(48, Math.floor(height / this.model.definition.rows))) : 40
    if (tile !== this.#tile || !this.#board.style.getPropertyValue('--tile')) {
      this.#tile = tile
      this.#board.style.setProperty('--tile', `${tile}px`)
    }
    this.#player.style.transform = `translate(${(this.model.x - 0.36) * tile}px, ${(this.model.y - 0.36) * tile}px)`
    this.#player.classList.toggle('sd-walking', this.model.moving && !this.#dialog)
    // Direct camera placement follows sustained walking without queued smooth
    // scroll animations. The entire dungeon remains a two-dimensional plane.
    this.#viewport.scrollLeft = Math.max(0, this.model.x * tile - this.#viewport.clientWidth / 2)
    for (const [id, button] of this.#gateButtons) {
      button.classList.toggle('sd-open', this.model.openGates.has(id))
      button.textContent = this.model.openGates.has(id) ? '·' : '◇'
    }
  }

  dispose(): void {
    this.#disposed = true
    this.closeDialog()
    this.#element.remove()
    this.#gateButtons.clear()
  }
}

const SCROLL_DUNGEON_CSS = `
.sol-scroll-dungeon{height:100%;min-height:0;display:flex;flex-direction:column;position:relative;background:#f5f1d9;color:#354434;color-scheme:light;font:14px/1.45 system-ui,sans-serif;border-radius:16px;overflow:hidden}
.sol-scroll-dungeon header{display:flex;justify-content:space-between;gap:12px;align-items:baseline;padding:14px 20px;background:#fffdf0;border-bottom:1px solid #d5d4b7}.sol-scroll-dungeon header strong{font-size:20px;color:#35534b}.sol-scroll-dungeon header span{font-size:12px;color:#687264}
.sd-viewport{min-height:0;flex:1;overflow:auto;overscroll-behavior:contain;position:relative;background:linear-gradient(#d7eee0,#e9efd3);display:flex;align-items:center;scrollbar-width:thin;scrollbar-color:#99ba9c #e9efd3}
.sd-board{--tile:40px;display:grid;grid-template-columns:repeat(var(--cols),var(--tile));grid-template-rows:repeat(var(--rows),var(--tile));width:calc(var(--cols)*var(--tile));height:calc(var(--rows)*var(--tile));position:relative;flex:none;box-shadow:0 12px 36px #405c4824}
.sd-tile{box-sizing:border-box}.sd-path{background:#edecd4;border:1px solid #d8dec2;box-shadow:inset 0 1px #ffffef}.sd-wall{background:linear-gradient(135deg,#e4cf98,#cabb80);border:1px solid #b7a975;border-bottom:5px solid #ae9f70;border-radius:3px;box-shadow:inset 0 2px #fff1b4}.sd-water{background:repeating-linear-gradient(165deg,#82c7bc 0 9px,#a5d9c7 10px 12px,#82c7bc 13px 22px);border:1px solid #70b5a8;box-shadow:inset 0 2px 7px #3b918326}.sd-flower{background:radial-gradient(ellipse at 60% 65%,#bfd89e 0 12%,transparent 15%),radial-gradient(ellipse at 72% 43%,#f5c4a4 0 8%,transparent 10%),#edecd4}
.sol-scroll-dungeon .sd-feature{position:absolute;width:var(--tile);height:var(--tile);padding:0;border:0;background:transparent;font:700 calc(var(--tile)*.7)/1 Georgia,serif;cursor:pointer;color:#637854;text-shadow:0 2px #fffff0;z-index:2}.sol-scroll-dungeon .sd-feature:focus-visible{outline:3px solid #355f85;outline-offset:-3px}.sol-scroll-dungeon .sd-inscription{color:#7d7655;font-size:calc(var(--tile)*.58);background:#e5dcb5;border:3px solid #b7ae87;border-radius:4px;transform:scale(.84);box-shadow:0 4px #a69d7d}.sol-scroll-dungeon .sd-gate{background:linear-gradient(130deg,#c1d2d4,#749da2);border:3px solid #577e89;color:#ffedb0;box-shadow:0 4px #456c76;transform:scale(.96)}.sol-scroll-dungeon .sd-gate.sd-open{background:#d9e7cc;border-color:#b8d0a1;color:#689368;box-shadow:none;opacity:.7}.sol-scroll-dungeon .sd-artifact{color:#dc9c34;filter:drop-shadow(0 0 9px #fff0a0)}.sol-scroll-dungeon .sd-alcove{color:#9c82af}.sol-scroll-dungeon .sd-exit{color:#639074}
.sd-explorer{position:absolute;left:0;top:0;width:calc(var(--tile)*.72);height:calc(var(--tile)*.72);display:grid;place-items:center;z-index:4;border-radius:40% 40% 35% 35%;background:linear-gradient(#f7d194 0 31%,#448f9b 34% 85%,#335f73 86%);color:#fff3c7;box-shadow:0 3px 0 #334e526b,inset 2px 0 #ffffff33;font-size:calc(var(--tile)*.42);pointer-events:none}
.sd-status{padding:10px 18px;margin:0;background:#fffdf0;border-top:1px solid #d5d4b7;font-size:12px;color:#61735d}.sd-dialog-shade{position:absolute;inset:0;z-index:10;display:grid;place-items:center;padding:18px;background:#28413947;backdrop-filter:blur(3px)}.sd-dialog{width:min(440px,100%);box-sizing:border-box;border:1px solid #cabd91;border-radius:18px;padding:24px;background:#fffced;box-shadow:0 18px 70px #2c4e4940}.sd-dialog h3{margin:0 0 14px;font:600 23px Georgia,serif;color:#486657}.sd-dialog p{margin:10px 0;color:#46574b}.sd-dialog blockquote{margin:16px 0;padding:12px 16px;border-left:3px solid #ccae62;background:#f1efd9;font:italic 15px/1.5 Georgia,serif;color:#646746}.sd-runes{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}.sol-scroll-dungeon .sd-runes button,.sol-scroll-dungeon .sd-continue{min-height:42px;border:1px solid #a7bb9a;border-radius:10px;padding:9px 15px;background:#e7eed6;color:#38574a;font:600 14px system-ui,sans-serif;cursor:pointer}.sol-scroll-dungeon .sd-runes button:hover,.sol-scroll-dungeon .sd-continue:hover{background:#d4e5bc}.sd-runes button:disabled{opacity:.55;cursor:default}.sol-scroll-dungeon .sd-continue{width:100%;background:#527c68;color:#fffdeb;border-color:#527c68}.sol-scroll-dungeon .sd-continue:hover{background:#416a57}.sd-dialog button:focus-visible{outline:3px solid #ad944e;outline-offset:3px}
@media(max-width:600px){.sol-scroll-dungeon header{padding:10px 12px;display:block}.sol-scroll-dungeon header strong{font-size:17px}.sol-scroll-dungeon header span{display:block;margin-top:3px}.sd-status{font-size:11px;padding:7px 10px}.sd-dialog{padding:18px}.sd-dialog h3{font-size:21px}}
`
