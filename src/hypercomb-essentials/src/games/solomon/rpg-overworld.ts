/** The world above the rooms: walking, conversation, knowledge and shrine assembly.
 * The model has no DOM or storage dependency; inventory belongs to the journey. */

export type ShrineComponent = { kind: 'triangle'; point: number } | { kind: 'hexagon' } | { kind: 'star' }
export type WorldRelic = ShrineComponent & { id: string }
export interface WorldInput { up?: boolean; down?: boolean; left?: boolean; right?: boolean }
export interface WorldHooks {
  has(requirement: ShrineComponent): boolean
  grantRelic(relic: WorldRelic): unknown
  onEnter(labyrinthId: string): void
  onDungeon?(levelIndex: number): void
  onJournal?(): void
  onMessage?(message: string): void
}
export interface WorldPlace { id: string; name: string; x: number; y: number }
export interface WorldShrine extends WorldPlace {
  kind: 'shrine'; labyrinthId: string; subtitle: string; components: readonly ShrineComponent[]
}
export interface WorldPerson extends WorldPlace {
  kind: 'person'; role: string; color: string; clue: string; question: string
  answers: readonly string[]; correct: number; insight: string; retry: string; reward?: WorldRelic
}
export interface WorldDungeon extends WorldPlace {
  kind: 'dungeon'; levelIndex: number; subtitle: string; clue: string
}
export type WorldEncounter = WorldShrine | WorldPerson | WorldDungeon
export type ShrineState = 'missing' | 'ready' | 'open'
export interface WorldResult { ok: boolean; message: string; encounter?: WorldEncounter }
export interface WorldSnapshot {
  version: 1
  player: { x: number; y: number; facing: 'up' | 'down' | 'left' | 'right' }
  met: string[]
  solved: string[]
  journal: string[]
  filledSockets: string[]
}

export const WORLD_COLS = 24
export const WORLD_ROWS = 16
const REACH = 1.8
const SPEED = 4.2

export const RELIC_LORE: Readonly<Record<string, { title: string; text: string }>> = {
  'triangle:0': { title: 'Dawn triangle', text: 'The first point answers the sun. Set it into the Dawn shrine; Sunseed’s amber shelves hide two more points. Seek the central hexagon beyond the turning loft.' },
  'triangle:1': { title: 'Tide triangle', text: 'Passages join places as well as depths. A door marked with the tide point reveals another part of the same labyrinth.' },
  'triangle:2': { title: 'Root triangle', text: 'Returning is part of discovery. A room you have visited may hold a passage that a later piece can open.' },
  'triangle:3': { title: 'Ember triangle', text: 'The fourth point belongs to the Pyramid star. Its glow records your knowledge even after you place its image in a shrine.' },
  'triangle:4': { title: 'Wind triangle', text: 'The fifth point belongs to the Pyramid star. Look across a room before changing its blocks; the way onward may be above you.' },
  'triangle:5': { title: 'Dusk triangle', text: 'The last point completes the outer star. The six points still need the central hexagon before the whole star is complete.' },
  hexagon: { title: 'Heart hexagon', text: 'The hollow heart opens Tideglass alongside the Tide and Root triangles. Knowledge lives in its high shelves. Six outer triangles and this central hexagon form a complete star.' },
  star: { title: 'Star of David', text: 'Six triangles and their central hexagon form one complete star. Its knowledge opens the Pyramid shrine and the final star-marked passages.' },
}

export const WORLD_SHRINES: readonly WorldShrine[] = [
  { kind: 'shrine', id: 'dawn-shrine', name: 'Dawn Shrine', subtitle: 'Sunseed · the first labyrinth', x: 8, y: 4, labyrinthId: 'sunseed', components: [{ kind: 'triangle', point: 0 }] },
  { kind: 'shrine', id: 'tide-shrine', name: 'Tide Observatory', subtitle: 'Tideglass · connected depths', x: 16, y: 4, labyrinthId: 'tideglass', components: [{ kind: 'triangle', point: 1 }, { kind: 'triangle', point: 2 }, { kind: 'hexagon' }] },
  { kind: 'shrine', id: 'pyramid-shrine', name: 'Pyramid of Accord', subtitle: 'Complete the star to uncover its rooms', x: 20, y: 8, labyrinthId: 'starbloom', components: [...Array.from({ length: 6 }, (_, point) => ({ kind: 'triangle' as const, point })), { kind: 'hexagon' }] },
]

export const WORLD_PEOPLE: readonly WorldPerson[] = [
  {
    kind: 'person', id: 'mira', name: 'Mira', role: 'Keeper of beginnings', x: 5, y: 11, color: '#d589bf',
    clue: 'Mira shows a mosaic: six triangle points around one hexagon. “The stone marked DAWN faces the sunrise. Knowledge stays yours when you share it with a shrine.”',
    question: 'Which direction should the Dawn point face?', answers: ['West, toward sunset', 'East, toward sunrise', 'Down, into the earth'], correct: 1,
    retry: 'Read the inscription again: DAWN faces the sunrise. The sun rises in the east. Try again whenever you are ready.',
    insight: 'Yes: east, toward the sunrise. Take the Dawn triangle. Walk north to the Dawn Shrine and fill its matching socket. Every piece also records a clue in your journal.',
    reward: { id: 'mira-dawn-triangle', kind: 'triangle', point: 0 },
  },
  {
    kind: 'person', id: 'oren', name: 'Oren', role: 'Cartographer of depths', x: 12, y: 9, color: '#80bbd9',
    clue: 'Oren draws two rooms at different depths, linked by a pair of doors. “The return door leads back to the room you left. Your changes wait there for you.”',
    question: 'After finding a new piece at another depth, where might a new path appear?', answers: ['In a room I visited earlier', 'Only outside the labyrinth', 'Nowhere; doors work once'], correct: 0,
    retry: 'Oren taps the return arrow. A piece can open a matching object in a room you already know; returning is useful.',
    insight: 'Exactly. Doors connect the depths in both directions. Collect pieces, revisit the matching marks, and build a mental map of the rooms.',
  },
  {
    kind: 'person', id: 'sela', name: 'Sela', role: 'Reader of the stars', x: 18, y: 12, color: '#e2b36f',
    clue: 'Sela lays out six triangular points with an empty hexagon in the middle. “The outline is only part of the star. Every chamber has a place in its pattern.”',
    question: 'What does the six-pointed outline still need to form the complete shrine?', answers: ['A seventh triangle', 'A central hexagon', 'Another doorway'], correct: 1,
    retry: 'Look at the center of the pattern: the empty space has six sides. The central hexagon completes the star.',
    insight: 'The central hexagon. Gather every point and the heart, then fill all seven sockets at the Pyramid. Your abilities remain yours after every placement.',
  },
]

export const WORLD_DUNGEONS: readonly WorldDungeon[] = [
  { kind: 'dungeon', id: 'wayfarer-cavern', name: 'Wayfarer Cavern', x: 9, y: 12, levelIndex: 0, subtitle: 'A scrolling dungeon', clue: 'An expedition through longer ruins. Read its inscriptions, interpret the rune sequence, and open the way onward. Return to the world with what you have learned.' },
  { kind: 'dungeon', id: 'highland-cavern', name: 'Highland Cavern', x: 20, y: 4, levelIndex: 2, subtitle: 'A deeper scrolling expedition', clue: 'An optional expedition through a larger cavern. Search for inscriptions and gather the information that explains its rune gate.' },
]
export const WORLD_ENCOUNTERS: readonly WorldEncounter[] = [...WORLD_SHRINES, ...WORLD_PEOPLE, ...WORLD_DUNGEONS]

export function componentKey(component: ShrineComponent): string {
  return component.kind === 'triangle' ? `triangle:${component.point}` : component.kind
}
export function componentName(component: ShrineComponent): string {
  return RELIC_LORE[componentKey(component)]?.title ?? 'Unknown piece'
}

/** Coordinates refer to cell centers. Grass and paths are both walkable. */
export function worldTerrain(col: number, row: number): 'grass' | 'path' | 'water' | 'tree' | 'rock' {
  if (col < 1 || col >= WORLD_COLS - 1 || row < 1 || row >= WORLD_ROWS - 1) return 'tree'
  if (col >= 2 && col <= 5 && row >= 3 && row <= 6) return 'water'
  if ((col >= 2 && col <= 3 && row >= 8 && row <= 9) || (col >= 12 && col <= 14 && row >= 2 && row <= 4)) return 'tree'
  if (col >= 19 && row <= 2) return 'rock'
  if ((row === 12 && col >= 3 && col <= 20) || (col === 8 && row >= 4 && row <= 12)
    || (row === 7 && col >= 8 && col <= 20) || (col === 16 && row >= 4 && row <= 12)
    || (col === 20 && row >= 4 && row <= 12) || (col === 12 && row >= 7 && row <= 12)
    || (row === 11 && col >= 4 && col <= 8)) return 'path'
  return 'grass'
}

export class RpgOverworld {
  readonly player = { x: 4, y: 12, facing: 'down' as 'up' | 'down' | 'left' | 'right' }
  readonly filledSockets = new Set<string>()
  readonly journal = new Set<string>()
  readonly met = new Set<string>()
  readonly solved = new Set<string>()
  readonly hooks: WorldHooks
  constructor(hooks: WorldHooks) { this.hooks = hooks }

  exportState(): WorldSnapshot {
    return {
      version: 1, player: { ...this.player }, met: [...this.met].sort(), solved: [...this.solved].sort(),
      journal: [...this.journal].sort(), filledSockets: [...this.filledSockets].sort(),
    }
  }

  /** Inventory is restored by the journey first. Only owned components can
   *  reappear in a shrine; a different slot replaces every local collection. */
  restoreState(raw: unknown): void {
    Object.assign(this.player, { x: 4, y: 12, facing: 'down' })
    this.met.clear(); this.solved.clear(); this.journal.clear(); this.filledSockets.clear()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    const saved = raw as Record<string, unknown>
    if (saved['version'] !== 1) return
    const includes = (field: string, id: string): boolean => Array.isArray(saved[field]) && (saved[field] as unknown[]).includes(id)
    for (const person of WORLD_PEOPLE) {
      const solved = includes('solved', person.id) && (!person.reward || this.owns(person.reward))
      if (includes('met', person.id) || solved) {
        this.met.add(person.id)
        this.journal.add(`person:${person.id}`)
      }
      if (solved) this.solved.add(person.id)
    }
    for (const shrine of WORLD_SHRINES) shrine.components.forEach((piece, index) => {
      const key = `${shrine.id}:${index}`
      if (includes('filledSockets', key) && this.owns(piece)) {
        this.filledSockets.add(key)
        this.journal.add(componentKey(piece))
      }
    })
    for (const key of Object.keys(RELIC_LORE)) {
      const piece: ShrineComponent = key.startsWith('triangle:')
        ? { kind: 'triangle', point: Number(key.slice('triangle:'.length)) }
        : { kind: key as 'hexagon' | 'star' }
      if (includes('journal', key) && this.owns(piece)) this.journal.add(key)
    }
    const player = saved['player']
    if (player && typeof player === 'object' && !Array.isArray(player)) {
      const position = player as Record<string, unknown>
      const x = position['x'], y = position['y'], facing = position['facing']
      if (typeof x === 'number' && typeof y === 'number' && this.walkable(x, y)) {
        this.player.x = x; this.player.y = y
      }
      if (facing === 'up' || facing === 'down' || facing === 'left' || facing === 'right') this.player.facing = facing
    }
  }

  walkable(x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    for (const ox of [-0.2, 0.2]) for (const oy of [-0.2, 0.2]) {
      const terrain = worldTerrain(Math.floor(x + ox), Math.floor(y + oy))
      if (terrain !== 'grass' && terrain !== 'path') return false
    }
    return true
  }

  update(dt: number, input: WorldInput = {}): void {
    if (!Number.isFinite(dt) || dt <= 0) return
    let dx = Number(!!input.right) - Number(!!input.left)
    let dy = Number(!!input.down) - Number(!!input.up)
    if (!dx && !dy) return
    this.player.facing = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down'
    const scale = SPEED * Math.min(dt, 0.25) / Math.hypot(dx, dy)
    dx *= scale; dy *= scale
    // Small collision steps prevent a dropped frame from crossing a lake edge.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.15))
    for (let i = 0; i < steps; i++) {
      if (this.walkable(this.player.x + dx / steps, this.player.y)) this.player.x += dx / steps
      if (this.walkable(this.player.x, this.player.y + dy / steps)) this.player.y += dy / steps
    }
  }

  near(encounter: WorldEncounter): boolean { return Math.hypot(this.player.x - encounter.x, this.player.y - encounter.y) <= REACH }
  nearest(): WorldEncounter | undefined {
    return WORLD_ENCOUNTERS.filter(place => this.near(place)).sort((a, b) =>
      Math.hypot(this.player.x - a.x, this.player.y - a.y) - Math.hypot(this.player.x - b.x, this.player.y - b.y))[0]
  }
  interact(targetId?: string): WorldResult {
    const encounter = targetId ? WORLD_ENCOUNTERS.find(place => place.id === targetId) : this.nearest()
    if (!encounter) return this.result(false, 'Explore the world. Walk close to a person, shrine or cavern and press E to interact.')
    if (!this.near(encounter)) return this.result(false, `Walk closer to ${encounter.name} to interact.`)
    if (encounter.kind === 'dungeon') return this.enterDungeon(encounter.id)
    if (encounter.kind === 'shrine' && this.shrineStatus(encounter.id) === 'open') return this.enter(encounter.id)
    if (encounter.kind === 'person') {
      this.met.add(encounter.id)
      this.journal.add(`person:${encounter.id}`)
    }
    return { ok: true, message: encounter.name, encounter }
  }
  answer(npcId: string, choiceIndex: number): WorldResult {
    const person = WORLD_PEOPLE.find(npc => npc.id === npcId)
    if (!person || !this.near(person)) return this.result(false, 'Walk closer to speak with them.')
    this.met.add(person.id); this.journal.add(`person:${person.id}`)
    if (choiceIndex !== person.correct) return this.result(false, person.retry)
    this.solved.add(person.id)
    if (person.reward) {
      if (!this.hooks.has(person.reward)) this.hooks.grantRelic(person.reward)
      this.journal.add(componentKey(person.reward))
    }
    return this.result(true, person.insight)
  }
  socketFilled(shrineId: string, index: number): boolean { return this.filledSockets.has(`${shrineId}:${index}`) }
  owns(component: ShrineComponent): boolean { return this.hooks.has(component) || this.hooks.has({ kind: 'star' }) }
  shrineStatus(shrineId: string): ShrineState {
    const shrine = WORLD_SHRINES.find(place => place.id === shrineId)
    if (!shrine) return 'missing'
    if (shrine.components.every((_, i) => this.socketFilled(shrineId, i))) return 'open'
    return shrine.components.every(piece => this.owns(piece)) ? 'ready' : 'missing'
  }
  fillSocket(shrineId: string, index: number): WorldResult {
    const shrine = WORLD_SHRINES.find(place => place.id === shrineId)
    if (!shrine || !this.near(shrine)) return this.result(false, 'Walk up to the shrine before placing a piece.')
    const component = shrine.components[index]
    if (!component) return this.result(false, 'That socket is not part of this shrine.')
    if (this.socketFilled(shrineId, index)) return this.result(true, 'This socket already holds its piece. Your ability remains with you.')
    if (!this.owns(component)) return this.result(false, `Find the ${componentName(component)} before filling this socket.`)
    this.filledSockets.add(`${shrineId}:${index}`)
    this.journal.add(componentKey(component))
    return this.result(true, this.shrineStatus(shrineId) === 'open'
      ? `${shrine.name} is complete. The labyrinth is open; your pieces and their knowledge stay with you.`
      : `${componentName(component)} placed. Its ability and knowledge stay with you.`)
  }
  enter(shrineId: string): WorldResult {
    const shrine = WORLD_SHRINES.find(place => place.id === shrineId)
    if (!shrine || !this.near(shrine)) return this.result(false, 'Walk up to the shrine to enter.')
    if (this.shrineStatus(shrineId) !== 'open') return this.result(false, 'Fill every component socket in this shrine before entering.')
    this.hooks.onEnter(shrine.labyrinthId)
    return { ok: true, message: `Entering ${shrine.name}.` }
  }
  enterDungeon(dungeonId: string): WorldResult {
    const dungeon = WORLD_DUNGEONS.find(place => place.id === dungeonId)
    if (!dungeon || !this.near(dungeon)) return this.result(false, 'Walk up to the cavern entrance first.')
    if (!this.hooks.onDungeon) return this.result(false, 'This expedition is not available here yet.')
    this.hooks.onDungeon(dungeon.levelIndex)
    return { ok: true, message: `Entering ${dungeon.name}.` }
  }
  private result(ok: boolean, message: string): WorldResult { this.hooks.onMessage?.(message); return { ok, message } }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
function button(text: string, action: () => void, className = ''): HTMLButtonElement {
  const node = element('button', className, text)
  node.type = 'button'; node.addEventListener('click', action)
  return node
}

/** Six equilateral points share the sides of the central hexagon. */
function shrinePolygon(component: ShrineComponent): { x: number; y: number }[] {
  const point = (angle: number, radius: number) => ({ x: 120 + Math.cos(angle * Math.PI / 180) * radius, y: 120 + Math.sin(angle * Math.PI / 180) * radius })
  if (component.kind === 'hexagon') return Array.from({ length: 6 }, (_, i) => point(-60 + i * 60, 100 / Math.sqrt(3)))
  const angle = -90 + (component.kind === 'triangle' ? component.point : 0) * 60
  return [point(angle - 30, 100 / Math.sqrt(3)), point(angle, 100), point(angle + 30, 100 / Math.sqrt(3))]
}

/** A one-screen, keyboard-walkable map. The shell supplies the animation loop. */
export class RpgOverworldView {
  readonly model: RpgOverworld
  #root: HTMLDivElement | null = null
  #map: HTMLDivElement | null = null
  #resize: ResizeObserver | null = null
  #player: HTMLDivElement | null = null
  #prompt: HTMLButtonElement | null = null
  #dialog: HTMLDivElement | null = null
  #lastFocus: HTMLElement | null = null
  #places = new Map<string, HTMLButtonElement>()
  #notice = ''
  constructor(hooks: WorldHooks) { this.model = new RpgOverworld(hooks) }
  get isDialogOpen(): boolean { return this.#dialog !== null }
  exportState(): WorldSnapshot { return this.model.exportState() }
  restoreState(raw: unknown): void {
    this.closeDialog()
    this.model.restoreState(raw)
    this.#notice = ''
    this.refresh()
  }

  mount(host: HTMLElement): void {
    this.dispose()
    const root = element('div', 'sol-rpg-world')
    root.append(element('style', '', WORLD_STYLE))
    const heading = element('div', 'sol-rpg-world-heading')
    heading.append(element('span', 'sol-rpg-eyebrow', 'THE WORLD ABOVE'), element('h2', '', 'The Sevenfold Valley'), element('p', '', 'Meet its people. Learn the signs. Open the way below.'))
    const journal = button('Knowledge journal', () => {
      if (this.model.hooks.onJournal) this.model.hooks.onJournal()
      else this.openJournal()
    }, 'sol-rpg-journal')
    heading.append(journal); root.append(heading)
    const map = element('div', 'sol-rpg-map')
    this.#map = map
    map.setAttribute('role', 'group'); map.setAttribute('aria-label', 'Valley world map. Move with arrow keys or W A S D. Approach a person or entrance, then press Enter or E, or click, to interact.')
    const terrain = element('div', 'sol-rpg-terrain')
    terrain.setAttribute('aria-hidden', 'true')
    for (let y = 0; y < WORLD_ROWS; y++) for (let x = 0; x < WORLD_COLS; x++) {
      const kind = worldTerrain(x, y)
      const tile = element('span', `sol-rpg-land sol-rpg-land-${kind}`)
      if (kind === 'tree') tile.textContent = '♠'
      else if (kind === 'rock') tile.textContent = '▲'
      else if (kind === 'grass' && (x * 13 + y * 7) % 11 === 0) tile.textContent = '✦'
      terrain.append(tile)
    }
    map.append(terrain)
    for (const place of WORLD_ENCOUNTERS) {
      const marker = button('', () => this.interact(place.id), `sol-rpg-place sol-rpg-place-${place.kind}`)
      marker.style.left = `${place.x / WORLD_COLS * 100}%`; marker.style.top = `${place.y / WORLD_ROWS * 100}%`
      marker.setAttribute('aria-label', `${place.name}, ${place.kind === 'person' ? place.role : place.subtitle}`)
      const icon = element('span', 'sol-rpg-place-icon', place.kind === 'person' ? '●' : place.kind === 'dungeon' ? '◠' : place.id === 'pyramid-shrine' ? '▲' : '✡')
      if (place.kind === 'person') icon.style.setProperty('--person-color', place.color)
      marker.append(icon, element('span', 'sol-rpg-place-label', place.name))
      this.#places.set(place.id, marker); map.append(marker)
    }
    this.#player = element('div', 'sol-rpg-player')
    this.#player.setAttribute('aria-label', 'You')
    this.#player.innerHTML = '<span class="sol-rpg-player-hat"></span><span class="sol-rpg-player-face"></span><span class="sol-rpg-player-coat"></span>'
    map.append(this.#player)
    this.#prompt = button('', () => this.interact(), 'sol-rpg-world-prompt')
    this.#prompt.setAttribute('aria-live', 'polite')
    const controls = element('div', 'sol-rpg-world-controls')
    controls.append(element('span', '', 'WASD / arrows · Walk'), button('E · Interact', () => this.interact()))
    root.append(map, this.#prompt, controls)
    host.append(root); this.#root = root; this.refresh(); this.fit()
    if (typeof ResizeObserver !== 'undefined') {
      this.#resize = new ResizeObserver(() => this.fit())
      this.#resize.observe(root)
    }
  }

  update(dt: number, input: WorldInput = {}): void {
    if (this.isDialogOpen) return
    const beforeX = this.model.player.x, beforeY = this.model.player.y
    this.model.update(dt, input)
    if (beforeX !== this.model.player.x || beforeY !== this.model.player.y) this.#notice = ''
    this.refresh()
  }
  refresh(): void {
    if (this.#player) {
      this.#player.style.left = `${this.model.player.x / WORLD_COLS * 100}%`
      this.#player.style.top = `${this.model.player.y / WORLD_ROWS * 100}%`
      this.#player.dataset['facing'] = this.model.player.facing
    }
    for (const shrine of WORLD_SHRINES) {
      const marker = this.#places.get(shrine.id)
      if (marker) marker.dataset['state'] = this.model.shrineStatus(shrine.id)
    }
    const nearest = this.model.nearest()
    const accessible = nearest?.kind === 'dungeon' || (nearest?.kind === 'shrine' && this.model.shrineStatus(nearest.id) === 'open')
    const message = this.#notice || (nearest
      ? accessible ? `${nearest.name} · ${nearest.kind === 'dungeon' ? 'Read inscriptions and solve rune gates.' : 'The shrine is complete.'} Enter / E or click to enter`
        : `${nearest.name} · Enter / E or click to ${nearest.kind === 'person' ? 'talk' : 'assemble'}`
      : 'Walk the valley. Mira, by the west path, has your first clue.')
    if (this.#prompt && this.#prompt.textContent !== message) this.#prompt.textContent = message
    if (this.#prompt) this.#prompt.disabled = !nearest
  }
  interact(targetId?: string): void {
    if (this.isDialogOpen) return
    const result = this.model.interact(targetId)
    if (!result.encounter) { this.#notice = result.ok ? '' : result.message; this.refresh(); return }
    this.#notice = ''
    const place = result.encounter
    if (place.kind === 'person') this.openPerson(place)
    else if (place.kind === 'shrine') this.openShrine(place)
  }
  closeDialog(): void {
    this.#dialog?.remove(); this.#dialog = null
    this.#lastFocus?.focus({ preventScroll: true }); this.#lastFocus = null
    this.refresh()
  }
  dispose(): void {
    this.#resize?.disconnect(); this.#resize = null
    this.#dialog = null; this.#lastFocus = null
    this.#root?.remove(); this.#root = null; this.#map = null; this.#player = null; this.#prompt = null; this.#places.clear()
  }
  private fit(): void {
    if (!this.#root || !this.#map || !this.#root.clientHeight) return
    const style = getComputedStyle(this.#root)
    const heading = this.#root.querySelector<HTMLElement>('.sol-rpg-world-heading')!
    const controls = this.#root.querySelector<HTMLElement>('.sol-rpg-world-controls')!
    const width = this.#root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const height = this.#root.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      - heading.getBoundingClientRect().height - parseFloat(getComputedStyle(heading).marginBottom)
      - (this.#prompt?.getBoundingClientRect().height ?? 30) - controls.getBoundingClientRect().height - 4
    const fittedWidth = Math.min(width, 980, Math.max(180, height * WORLD_COLS / WORLD_ROWS))
    this.#map.style.width = `${fittedWidth}px`
    this.#map.style.height = `${fittedWidth * WORLD_ROWS / WORLD_COLS}px`
  }
  private dialog(title: string, subtitle: string): HTMLDivElement {
    const previousFocus = this.#lastFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    this.#dialog?.remove()
    const backdrop = element('div', 'sol-rpg-dialog-backdrop')
    const body = element('div', 'sol-rpg-dialog')
    body.setAttribute('role', 'dialog'); body.setAttribute('aria-modal', 'true'); body.setAttribute('aria-label', title)
    body.tabIndex = -1
    const close = button('×', () => this.closeDialog(), 'sol-rpg-close')
    close.setAttribute('aria-label', 'Close conversation')
    body.append(close, element('span', 'sol-rpg-eyebrow', subtitle), element('h2', '', title))
    backdrop.append(body); this.#root?.append(backdrop); this.#dialog = backdrop; this.#lastFocus = previousFocus
    body.addEventListener('keydown', event => {
      // Enter activates the focused choice; keep the shell's movement keys out
      // of the conversation so a selection cannot also move the player.
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeDialog(); return }
      if (event.key === 'Tab') {
        const actions = Array.from(body.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const first = actions[0], last = actions[actions.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === body)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === body)) { event.preventDefault(); first?.focus() }
      }
      event.stopPropagation()
    })
    body.addEventListener('keyup', event => event.stopPropagation())
    body.focus({ preventScroll: true })
    return body
  }
  private openPerson(person: WorldPerson, reply = ''): void {
    const body = this.dialog(person.name, person.role)
    body.append(element('p', 'sol-rpg-clue', person.clue))
    if (reply) body.append(element('p', 'sol-rpg-reply', reply))
    if (this.model.solved.has(person.id)) {
      if (!reply) body.append(element('p', 'sol-rpg-reply', person.insight))
      body.append(button('Keep exploring', () => this.closeDialog(), 'sol-rpg-primary'))
      return
    }
    body.append(element('h3', '', person.question))
    const choices = element('div', 'sol-rpg-choices')
    person.answers.forEach((answer, index) => choices.append(button(answer, () => {
      const result = this.model.answer(person.id, index)
      this.openPerson(person, result.message)
    })))
    body.append(choices)
  }
  private openShrine(shrine: WorldShrine, reply = ''): void {
    const body = this.dialog(shrine.name, shrine.subtitle)
    body.append(element('p', '', 'Fill each marked socket with its matching piece. Every piece stays with you as a permanent ability, and its information stays in your journal.'))
    const pattern = element('div', 'sol-rpg-shrine-pattern')
    pattern.setAttribute('role', 'group'); pattern.setAttribute('aria-label', 'Star of David shrine: six triangular points surrounding one central hexagon')
    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    outline.setAttribute('viewBox', '0 0 240 240'); outline.setAttribute('aria-hidden', 'true')
    const allPieces: ShrineComponent[] = [...Array.from({ length: 6 }, (_, point) => ({ kind: 'triangle' as const, point })), { kind: 'hexagon' }]
    for (const component of allPieces) {
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
      polygon.setAttribute('points', shrinePolygon(component).map(point => `${point.x},${point.y}`).join(' '))
      outline.append(polygon)
    }
    pattern.append(outline)
    const descriptions = element('dl', 'sol-rpg-shrine-information')
    for (let index = 0; index < shrine.components.length; index++) {
      const piece = shrine.components[index]
      const filled = this.model.socketFilled(shrine.id, index), owned = this.model.owns(piece)
      const socket = button('', () => {
        const result = this.model.fillSocket(shrine.id, index)
        if (result.ok && this.model.shrineStatus(shrine.id) === 'open') {
          this.closeDialog()
          return
        }
        this.openShrine(shrine, result.message); this.refresh()
      }, `sol-rpg-socket${filled ? ' is-filled' : owned ? ' is-owned' : ''}`)
      const vertices = shrinePolygon(piece)
      const minX = Math.min(...vertices.map(point => point.x)), maxX = Math.max(...vertices.map(point => point.x))
      const minY = Math.min(...vertices.map(point => point.y)), maxY = Math.max(...vertices.map(point => point.y))
      socket.style.left = `${minX / 240 * 100}%`; socket.style.top = `${minY / 240 * 100}%`
      socket.style.width = `${(maxX - minX) / 240 * 100}%`; socket.style.height = `${(maxY - minY) / 240 * 100}%`
      socket.style.clipPath = `polygon(${vertices.map(point => `${(point.x - minX) / (maxX - minX) * 100}% ${(point.y - minY) / (maxY - minY) * 100}%`).join(',')})`
      const state = filled ? 'Placed · ability retained' : owned ? 'Place piece' : 'Piece not yet found'
      const label = piece.kind === 'triangle' ? String(piece.point + 1) : 'H'
      const glyph = element('span', 'sol-rpg-socket-glyph', filled ? '✓' : label)
      // The centroid keeps the mark inside diagonal triangular points.
      glyph.style.left = `${(vertices.reduce((sum, point) => sum + point.x, 0) / vertices.length - minX) / (maxX - minX) * 100}%`
      glyph.style.top = `${(vertices.reduce((sum, point) => sum + point.y, 0) / vertices.length - minY) / (maxY - minY) * 100}%`
      socket.append(glyph)
      socket.setAttribute('aria-label', `${componentName(piece)}: ${state}`)
      socket.title = `${componentName(piece)} · ${state}`
      socket.disabled = filled || !owned
      pattern.append(socket)
      descriptions.append(element('dt', '', `${label} · ${componentName(piece)} — ${state}`), element('dd', '', owned
        ? RELIC_LORE[componentKey(piece)]?.text ?? 'This piece remains a permanent ability.'
        : 'Find this piece to learn the information it carries.'))
    }
    body.append(pattern)
    body.append(element('p', 'sol-rpg-pattern-key', 'Lit sockets can be filled. Numbered points surround the heart (H). Unmarked stone is not needed by this shrine.'))
    if (reply) body.append(element('p', 'sol-rpg-reply', reply))
    body.append(element('p', '', 'The way opens when every marked socket is filled.'))
    body.append(descriptions)
  }
  private openJournal(): void {
    const body = this.dialog('Knowledge journal', 'PIECES REMEMBER WHAT YOU LEARN')
    body.append(element('p', '', 'Shrines recognize your permanent collection. Place each component at an entrance, then use its clue to recognize matching objects within the rooms.'))
    for (const person of WORLD_PEOPLE) if (this.model.met.has(person.id)) {
      body.append(element('h3', '', `${person.name} · ${person.role}`), element('p', '', this.model.solved.has(person.id) ? person.insight : person.clue))
    }
    let known = 0
    for (const [key, lore] of Object.entries(RELIC_LORE)) {
      const requirement: ShrineComponent = key.startsWith('triangle:') ? { kind: 'triangle', point: Number(key.split(':')[1]) } : { kind: key as 'hexagon' | 'star' }
      if (!this.model.owns(requirement)) continue
      known++; body.append(element('h3', '', lore.title), element('p', '', lore.text))
    }
    if (!known && !this.model.met.size) body.append(element('p', 'sol-rpg-clue', 'Your first page is waiting. Talk to Mira beside the west path.'))
  }
}

const WORLD_STYLE = `
.sol-rpg-world{position:relative;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;align-items:center;overflow:auto;color:#f5edd9;background:radial-gradient(ellipse at 50% 45%,#233938,#111e25 75%);font-family:system-ui,sans-serif;box-sizing:border-box;padding:18px 24px 12px}
.sol-rpg-world *{box-sizing:border-box}.sol-rpg-world button{font:inherit;color:inherit;cursor:pointer}.sol-rpg-world button:focus-visible{outline:3px solid #ffdd83;outline-offset:4px}.sol-rpg-world button:disabled{cursor:default;opacity:.7}
.sol-rpg-world-heading{position:relative;width:min(100%,980px);padding-right:170px;margin-bottom:13px}.sol-rpg-eyebrow{display:block;font-size:10px;font-weight:750;letter-spacing:.18em;color:#dfbd7a}.sol-rpg-world h2{margin:5px 0 6px;font-size:clamp(18px,2.6vw,28px);font-weight:650}.sol-rpg-world-heading p{margin:0;font-size:12px;color:#b5c8c2}.sol-rpg-journal{position:absolute;right:0;top:17px;border:1px solid #758574;background:#30433d;border-radius:8px;padding:10px 12px;font-size:11px!important}
.sol-rpg-map{position:relative;flex:0 1 auto;aspect-ratio:24/16;width:min(100%,980px);max-height:calc(100% - 130px);min-height:230px;border:1px solid #adba87;border-radius:18px;background:#536d43;box-shadow:0 18px 60px #0005;isolation:isolate;overflow:hidden}
.sol-rpg-terrain{position:absolute;inset:0;display:grid;grid-template-columns:repeat(24,1fr);grid-template-rows:repeat(16,1fr)}.sol-rpg-land{position:relative;text-align:center;font-size:clamp(9px,2vw,22px);line-height:1.5;color:#c8b75e88;background:#587345}.sol-rpg-land:nth-child(3n){filter:brightness(1.025)}.sol-rpg-land-grass{background:linear-gradient(135deg,#63804b,#597546)}.sol-rpg-land-path{background:#baaa72;border:1px solid #b2a46c}.sol-rpg-land-water{background:repeating-linear-gradient(175deg,#568eaa 0,#568eaa 8px,#629bb7 9px,#629bb7 10px);color:#bad9dc}.sol-rpg-land-tree{background:#425c38;color:#294832;font-size:clamp(15px,3vw,34px);line-height:1;text-shadow:1px 3px #263e2b}.sol-rpg-land-rock{color:#a8ae8e;background:#757f68;text-shadow:2px 2px #424f47}
.sol-rpg-place{position:absolute;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;transform:translate(-50%,-65%);width:13%;min-width:65px;border:0;background:transparent;padding:0;filter:drop-shadow(0 3px 2px #13262266)}.sol-rpg-place-icon{display:flex;align-items:center;justify-content:center;width:40px;height:42px;font-size:37px;color:#f1d391;text-shadow:0 2px #7b734b}.sol-rpg-place-label{white-space:nowrap;background:#203126ed;border:1px solid #778866;border-radius:4px;padding:3px 7px;color:#fff2cd;font-size:clamp(8px,1.05vw,12px);letter-spacing:.02em;line-height:1.2}.sol-rpg-place-person .sol-rpg-place-icon{width:26px;height:30px;border-radius:45% 45% 25% 25%;font-size:16px;color:#f4d3a8;background:linear-gradient(to bottom,transparent 25%,var(--person-color) 26%,var(--person-color) 100%);text-shadow:none}.sol-rpg-place-dungeon .sol-rpg-place-icon{height:38px;width:46px;border:6px solid #adac8a;border-bottom:0;border-radius:40px 40px 0 0;background:#273b39;color:#101c22;font-size:40px}.sol-rpg-place-shrine .sol-rpg-place-icon{background:#465858dd;border:2px solid #929e80;border-radius:6px 6px 2px 2px;color:#bdc3a2}.sol-rpg-place-shrine[data-state=ready] .sol-rpg-place-icon{color:#ffd983;border-color:#e0c580;box-shadow:0 0 14px #ffd87855}.sol-rpg-place-shrine[data-state=open] .sol-rpg-place-icon{color:#c0ffe4;border-color:#94e4ba;box-shadow:0 0 18px #75f9b766}.sol-rpg-place-shrine[data-state=open] .sol-rpg-place-label{color:#bbffdc}
.sol-rpg-player{position:absolute;z-index:3;pointer-events:none;transform:translate(-50%,-76%);width:22px;height:34px;filter:drop-shadow(0 3px 2px #17252999)}.sol-rpg-player-hat{position:absolute;z-index:3;left:0;top:0;width:22px;height:16px;background:#f0c86b;clip-path:polygon(50% 0,85% 80%,100% 100%,0 100%,15% 80%)}.sol-rpg-player-face{position:absolute;z-index:2;left:6px;top:12px;width:11px;height:10px;background:#f8d7aa;border-radius:3px}.sol-rpg-player-coat{position:absolute;left:2px;top:20px;width:19px;height:15px;background:#754aac;clip-path:polygon(20% 0,80% 0,100% 100%,0 100%)}
.sol-rpg-world-prompt{min-height:30px;padding-top:10px;font-size:12px;text-align:center;color:#f0dbb4}.sol-rpg-world-controls{display:flex;gap:20px;align-items:center;font-size:10px;color:#c5d1c5}.sol-rpg-world-controls button{border:1px solid #61736a;background:#294137;padding:5px 12px;border-radius:5px}
.sol-rpg-dialog-backdrop{position:absolute;inset:0;z-index:10;background:#09171dcc;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}.sol-rpg-dialog{position:relative;max-width:650px;width:100%;max-height:100%;overflow:auto;padding:26px;border-radius:16px;border:1px solid #a9a17e;background:linear-gradient(145deg,#263d39,#172b2e);box-shadow:0 20px 70px #0008;outline:none}.sol-rpg-dialog h2{font-size:24px;padding-right:28px}.sol-rpg-dialog h3{font-size:14px;color:#f2d799;margin:20px 0 8px}.sol-rpg-dialog p{font-size:13px;line-height:1.65;color:#d5e2d9}.sol-rpg-dialog .sol-rpg-close{position:absolute;right:13px;top:12px;width:30px;height:30px;border:1px solid #657b71;background:#314740;border-radius:50%;font-size:21px}.sol-rpg-clue{background:#b6cdac12;border-left:3px solid #b8ca96;border-radius:3px;padding:12px 15px}.sol-rpg-reply{color:#f9dea1!important}.sol-rpg-choices{display:grid;gap:8px}.sol-rpg-choices button,.sol-rpg-primary{padding:11px 14px;border:1px solid #a5b48e;border-radius:7px;background:#3b5745;text-align:left;font-size:13px!important}.sol-rpg-primary{display:block;margin-top:18px;background:#826f38;border-color:#d5b970;color:#fff4d8!important;font-weight:650!important}.sol-rpg-shrine-pattern{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:9px;margin-top:18px}.sol-rpg-socket{display:flex;flex-direction:column;align-items:center;gap:5px;background:#15272b;border:1px dashed #7b8977;border-radius:9px;padding:10px 6px}.sol-rpg-socket strong{font-size:12px}.sol-rpg-socket small{font-size:10px;color:#b8c7bd}.sol-rpg-socket-glyph{font-size:30px;color:#9eab91}.sol-rpg-socket.is-owned{border:1px solid #d8b769;background:#564d30}.sol-rpg-socket.is-owned .sol-rpg-socket-glyph{color:#ffe19a}.sol-rpg-socket.is-filled{border:1px solid #86ba9b;background:#294c3a;opacity:1!important}.sol-rpg-socket.is-filled .sol-rpg-socket-glyph{color:#bbf7ce}
@media(max-width:600px){.sol-rpg-world{padding:12px 10px 8px}.sol-rpg-world-heading{padding-right:0;margin-bottom:10px}.sol-rpg-world-heading p{max-width:65%;font-size:10px}.sol-rpg-journal{top:20px;padding:7px;font-size:10px!important}.sol-rpg-map{border-radius:10px;min-height:200px}.sol-rpg-place-icon{width:29px;height:31px;font-size:26px}.sol-rpg-place-label{padding:2px 4px}.sol-rpg-place-person .sol-rpg-place-icon{width:19px;height:24px}.sol-rpg-place-dungeon .sol-rpg-place-icon{width:30px;height:28px;border-width:4px}.sol-rpg-player{scale:.8;transform-origin:top left}.sol-rpg-world-prompt{font-size:10px}.sol-rpg-dialog{padding:20px}.sol-rpg-dialog-backdrop{padding:10px}.sol-rpg-dialog p{font-size:12px}.sol-rpg-shrine-pattern{grid-template-columns:repeat(3,1fr)}.sol-rpg-socket strong{font-size:10px}.sol-rpg-socket small{font-size:9px}}
.sol-rpg-shrine-pattern{position:relative;display:block;width:min(100%,280px);aspect-ratio:1;margin:12px auto 0;background:radial-gradient(circle,#8097731c,transparent 68%)}.sol-rpg-shrine-pattern svg{position:absolute;inset:0;width:100%;height:100%;fill:#172d30;stroke:#718571;stroke-width:2;stroke-linejoin:round}.sol-rpg-shrine-pattern .sol-rpg-socket{position:absolute;display:block;padding:0;border:0;border-radius:0;background:#5a6559;opacity:1}.sol-rpg-shrine-pattern .sol-rpg-socket.is-owned{background:#be9f50}.sol-rpg-shrine-pattern .sol-rpg-socket.is-filled{background:#68a787}.sol-rpg-shrine-pattern .sol-rpg-socket:not(:disabled):hover,.sol-rpg-shrine-pattern .sol-rpg-socket:focus-visible{background:#efd087;filter:brightness(1.25);outline:none}.sol-rpg-shrine-pattern .sol-rpg-socket-glyph{position:absolute;transform:translate(-50%,-50%);color:#fff9e5!important;font-size:18px;font-weight:750;text-shadow:0 1px 2px #0005}.sol-rpg-pattern-key{text-align:center;font-size:11px!important;color:#b6c6b7!important;margin:0 0 12px}.sol-rpg-shrine-information{margin:22px 0 0;border-top:1px solid #69816b55;padding-top:3px}.sol-rpg-shrine-information dt{font-size:12px;font-weight:650;color:#f2d799;margin-top:15px}.sol-rpg-shrine-information dd{font-size:12px;line-height:1.6;margin:4px 0 0;color:#c3d4c8}
.sol-rpg-map{flex:none;max-height:none;min-height:0}.sol-rpg-world-heading,.sol-rpg-world-prompt,.sol-rpg-world-controls{flex-shrink:0}
.sol-rpg-world .sol-rpg-world-prompt{max-width:100%;min-height:30px;border:0;background:transparent;padding:8px 6px 3px;line-height:1.5;font-size:12px;color:#f0dbb4}.sol-rpg-world .sol-rpg-world-prompt:disabled{opacity:1;cursor:default}.sol-rpg-world-prompt:not(:disabled):hover{color:#fff0ba;text-decoration:underline}
@media(max-width:600px){.sol-rpg-place-label{max-width:58px;white-space:normal;line-height:1.15;text-align:center}}
`
