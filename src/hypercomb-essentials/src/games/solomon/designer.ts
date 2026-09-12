// games/solomon/designer.ts
//
// Level designer logic. Holds the LevelDef being edited and a paint tool; the
// overlay owns the DOM toolbar + canvas events and calls in here. Kept separate
// from rendering so the same LevelDef can be handed straight to the engine for a
// playtest. Tools cover the full NES vocabulary — grey/orange blocks, the player
// + door singletons, every item pickup (incl. seals / constellation panels /
// wings), every foe kind, and both demon-mirror flavours.

import { EMPTY, WALL, BRICK, type LevelDef, type Cell, type CombatSkillId, type EnemyKind, type ItemKind, type MirrorKind } from './engine.js'
import {
  cloneLevel, emptyLevel, sanitizeLevel, saveCreation, loadDesignerDraft, saveDesignerDraft, type Creation,
} from './levels.js'

const ITEM_TOOLS = {
  key: 'key', bell: 'bell', jewel: 'jewel', treasure: 'treasure', jar: 'jar', scroll: 'scroll',
  hourglass: 'hourglass', life: 'life', seal: 'seal', zodiac: 'zodiac', wings: 'wings',
  pageTime: 'pageTime', pageSpace: 'pageSpace', princess: 'princess',
} as const
const ENEMY_TOOLS = {
  goblin: 'goblin', gargoil: 'gargoil', dragon: 'dragon', saramandor: 'saramandor', ghost: 'ghost',
  neul: 'neul', sparkball: 'sparkball', demonhead: 'demonhead', panel: 'panel',
} as const
/** The Hush's own six tools (§5.3) — a stele teaches the stance/a spell, a
 *  chest hands over a weapon. Keyed by the exact `CombatSkillId` each one
 *  grants, so `paint()` never needs a second lookup to know which id to
 *  write; a seventh tool, 'barrier', is a sibling literal below (its `needs`
 *  is picked separately — see `barrierNeeds` — since one tool paints a
 *  barrier requiring any of the six, not six barrier tools). */
export const STELE_CHEST_TOOLS: Readonly<Record<CombatSkillId, 'stele' | 'chest'>> = {
  stand: 'stele', ward: 'stele', ember: 'stele', hold: 'stele', sickle: 'chest', sling: 'chest',
}

export type Tool =
  | 'erase' | 'wall' | 'brick' | 'player' | 'door' | 'mirror' | 'firemirror'
  | keyof typeof ITEM_TOOLS | keyof typeof ENEMY_TOOLS
  | keyof typeof STELE_CHEST_TOOLS | 'barrier'

export const TOOLS: { tool: Tool; label: string; glyph: string }[] = [
  { tool: 'wall', label: 'Grey wall (permanent)', glyph: '▦' },
  { tool: 'brick', label: 'Orange brick (breakable)', glyph: '▥' },
  { tool: 'player', label: 'Dana start', glyph: 'P' },
  { tool: 'door', label: 'Exit door', glyph: '🚪' },
  { tool: 'key', label: 'Key', glyph: '🔑' },
  { tool: 'bell', label: 'Bell (frees a fairy)', glyph: '🔔' },
  { tool: 'jewel', label: 'Jewel', glyph: '◆' },
  { tool: 'treasure', label: 'Treasure', glyph: '💰' },
  { tool: 'jar', label: 'Fireball jar', glyph: '🔥' },
  { tool: 'scroll', label: 'Scroll (wider fireball stock)', glyph: '📜' },
  { tool: 'hourglass', label: 'Hourglass (refill time)', glyph: '⌛' },
  { tool: 'life', label: 'Extra Dana', glyph: '★' },
  { tool: 'seal', label: "Solomon's Seal", glyph: '✡' },
  { tool: 'zodiac', label: 'Constellation panel (→ bonus room)', glyph: '♈' },
  { tool: 'wings', label: 'Golden Wings (→ warp)', glyph: '🪽' },
  { tool: 'pageTime', label: 'Page of Time', glyph: '🕰' },
  { tool: 'pageSpace', label: 'Page of Space', glyph: '🌌' },
  { tool: 'princess', label: 'Princess (true-ending goal)', glyph: '👸' },
  { tool: 'goblin', label: 'Goblin (chaser)', glyph: '👺' },
  { tool: 'gargoil', label: 'Gargoil (spits fire)', glyph: '🦅' },
  { tool: 'dragon', label: 'Dragon', glyph: '🐉' },
  { tool: 'saramandor', label: 'Saramandor (fire-walker)', glyph: '🦎' },
  { tool: 'ghost', label: 'Ghost (horizontal flyer)', glyph: '👻' },
  { tool: 'neul', label: 'Neul (vertical flyer)', glyph: '🦇' },
  { tool: 'sparkball', label: 'Sparkball (bouncer)', glyph: '⚡' },
  { tool: 'demonhead', label: 'Demonhead', glyph: '💀' },
  { tool: 'panel', label: 'Panel monster (turret)', glyph: '🗿' },
  { tool: 'mirror', label: 'Demon mirror (spawns demonheads)', glyph: '🪞' },
  { tool: 'firemirror', label: 'Fire mirror (spawns saramandors)', glyph: '🌋' },
  { tool: 'stand', label: 'Stele of the Stand', glyph: '🧘' },
  { tool: 'ward', label: 'Ward of Solomon (stele)', glyph: '🛡' },
  { tool: 'ember', label: 'Ember Sigil (stele)', glyph: '🔥' },
  { tool: 'hold', label: 'Hourglass Hold (stele)', glyph: '⏳' },
  { tool: 'sickle', label: 'Sickle of the Sun (chest)', glyph: '🌙' },
  { tool: 'sling', label: 'Tideglass Sling (chest)', glyph: '🌊' },
  { tool: 'barrier', label: "Sealed barrier — needs the designer's picked skill", glyph: '🚧' },
  { tool: 'erase', label: 'Erase', glyph: '⌫' },
]

export class Designer {
  level: LevelDef
  tool: Tool = 'wall'
  /** The saved creation this canvas is filed as — null while it is new. */
  editingId: string | null = null
  /** Which skill the NEXT painted barrier needs — one 'barrier' tool, not six
   *  (§5.3); a picker beside the palette sets this, `paint()` reads it. */
  barrierNeeds: CombatSkillId = 'stand'

  constructor(level?: LevelDef) {
    this.level = level ? cloneLevel(level) : emptyLevel('My Level')
  }

  /** The canvas exactly as it was left — sticky across closes and reloads. */
  static restore(): Designer {
    const designer = new Designer()
    const draft = loadDesignerDraft()
    if (!draft) return designer
    designer.level = draft.level
    designer.editingId = draft.editingId
    if (TOOLS.some(t => t.tool === draft.tool)) designer.tool = draft.tool as Tool
    return designer
  }

  /** Remember the canvas. Called after every change the overlay makes. */
  persist(): void { saveDesignerDraft({ level: this.level, editingId: this.editingId, tool: this.tool }) }

  setTool(tool: Tool): void { this.tool = tool }
  setBarrierNeeds(id: CombatSkillId): void { this.barrierNeeds = id }
  newLevel(name = 'My Level'): void { this.level = emptyLevel(name); this.editingId = null }

  /** Continue editing a saved creation — Save files over it. */
  edit(creation: Creation): void { this.level = cloneLevel(creation.level); this.editingId = creation.id }

  /** Start a NEW creation from a copy of any level, saved or built-in. */
  duplicate(level: LevelDef, name: string): void {
    this.level = cloneLevel(level)
    this.level.name = name
    this.editingId = null
  }

  /** File the canvas: over the creation it came from, or as a new one. */
  save(name: string): Creation { return saveCreation(this.named(name), this.editingId) }

  /** Would replacing the canvas lose work? True when it differs from what it is
   *  filed as — or, never filed, from a blank canvas of the same size. */
  unsaved(saved: readonly Creation[]): boolean {
    const filed = this.editingId ? saved.find(c => c.id === this.editingId) : undefined
    const base = filed ? filed.level : emptyLevel(this.level.name, this.level.cols, this.level.rows)
    return JSON.stringify(sanitizeLevel(this.level)) !== JSON.stringify(sanitizeLevel(base))
  }

  #idx(col: number, row: number): number { return row * this.level.cols + col }
  #inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.level.cols && row >= 0 && row < this.level.rows
  }
  #same(a: Cell, col: number, row: number): boolean { return a.col === col && a.row === row }

  /** Strip every placeable (item / enemy / mirror) sitting on a cell. */
  #clearCell(col: number, row: number): void {
    this.level.items = this.level.items.filter(i => !this.#same(i, col, row))
    this.level.enemies = this.level.enemies.filter(e => !this.#same(e, col, row))
    this.level.mirrors = this.level.mirrors.filter(m => !this.#same(m, col, row))
  }

  /** Paint one cell with the current tool. Returns true if anything changed. */
  paint(col: number, row: number): boolean {
    if (!this.#inBounds(col, row)) return false
    const L = this.level
    const onPlayer = this.#same(L.player, col, row)
    const onDoor = this.#same(L.door, col, row)
    const tool = this.tool

    if (tool === 'player') { L.tiles[this.#idx(col, row)] = EMPTY; this.#clearCell(col, row); L.player = { col, row }; return true }
    if (tool === 'door') { L.tiles[this.#idx(col, row)] = EMPTY; this.#clearCell(col, row); L.door = { col, row }; return true }

    if (onPlayer || onDoor) return false // required singletons stay put

    if (tool === 'erase') { L.tiles[this.#idx(col, row)] = EMPTY; this.#clearCell(col, row); return true }
    if (tool === 'wall' || tool === 'brick') {
      L.tiles[this.#idx(col, row)] = tool === 'wall' ? WALL : BRICK
      this.#clearCell(col, row)
      return true
    }
    if (tool === 'mirror' || tool === 'firemirror') {
      const kind: MirrorKind = tool === 'firemirror' ? 'saramandor' : 'demonhead'
      const had = L.mirrors.some(m => this.#same(m, col, row) && m.kind === kind)
      this.#clearCell(col, row)
      L.tiles[this.#idx(col, row)] = EMPTY
      if (!had) L.mirrors.push({ col, row, kind })
      return true
    }
    if (tool === 'barrier') {
      const had = L.items.some(i => this.#same(i, col, row) && i.kind === 'barrier' && i.needs === this.barrierNeeds)
      this.#clearCell(col, row)
      L.tiles[this.#idx(col, row)] = WALL   // sealed by default — a barrier never paints EMPTY
      if (!had) L.items.push({ col, row, kind: 'barrier', needs: this.barrierNeeds })
      return true
    }
    if (tool in STELE_CHEST_TOOLS) {
      const skill = tool as CombatSkillId
      const kind = STELE_CHEST_TOOLS[skill]
      const had = L.items.some(i => this.#same(i, col, row) && i.kind === kind && i.gives === skill)
      this.#clearCell(col, row)
      L.tiles[this.#idx(col, row)] = EMPTY
      if (!had) L.items.push({ col, row, kind, gives: skill })
      return true
    }
    if (tool in ENEMY_TOOLS) {
      const kind = tool as EnemyKind
      const existing = L.enemies.find(e => this.#same(e, col, row))
      this.#clearCell(col, row)
      L.tiles[this.#idx(col, row)] = EMPTY
      if (!(existing && existing.kind === kind)) L.enemies.push({ col, row, kind, dir: col < L.cols / 2 ? 1 : -1 })
      return true
    }
    if (tool in ITEM_TOOLS) {
      const kind = tool as ItemKind
      const existing = L.items.find(i => this.#same(i, col, row))
      this.#clearCell(col, row)
      L.tiles[this.#idx(col, row)] = EMPTY
      if (!(existing && existing.kind === kind)) {
        L.items.push({ col, row, kind, value: kind === 'jewel' ? 500 : kind === 'treasure' ? 2000 : undefined })
      }
      return true
    }
    return false
  }

  /** Rename + return the level ready for the store. */
  named(name: string): LevelDef {
    const l = cloneLevel(this.level)
    l.name = name.trim() || 'Untitled'
    this.level.name = l.name
    return l
  }

  exportJson(): string { return JSON.stringify(this.level, null, 2) }

  importJson(text: string): boolean {
    try {
      const lvl = sanitizeLevel(JSON.parse(text))
      if (!lvl) return false
      this.level = lvl
      this.editingId = null
      return true
    } catch { return false }
  }
}
