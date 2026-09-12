// The chamber model: caverns, the interior chain, and the Hollow Grove. A
// walked, torchlit puzzle space — blocks, plates, gates, chests, doors,
// shutters, levers, lamp sets, a wand, settling stones, an alcove and an
// artifact — entered and left through portals that are PUSHED, never walked
// onto. Zero enemies, zero combat, ever: that lives entirely in engine.ts's
// separate labyrinth substrate. Pure: no DOM, no storage, no randomness.
import type { SigilRequirement } from './labyrinth.js'
import type { TreasureKind } from './island-treasure.js'
import type { PlaceSeed } from './place.js'
import { WAND_CELLS, WAND_MADE, WAND_WALKABLE, WAND_REFUSALS, WAND_WORDS, WAND_SEAL_WORDS } from './wand-rules.js'

export type Facing = 'up' | 'down' | 'left' | 'right'
export interface MoveInput { up: boolean; down: boolean; left: boolean; right: boolean }
export interface ChamberCell { readonly col: number; readonly row: number }
export type ChamberLook = 'cavern' | 'cellar' | 'house' | 'wood'
export type ChamberTerrain =
  | 'rock' | 'floor' | 'threshold' | 'water' | 'brick' | 'furniture'
  | 'crack' | 'rubble' | 'rune' | 'laid' | 'spring' | 'stone' | 'seal' | 'seal-open'
export interface ChamberItem { readonly kind: TreasureKind; readonly name: string }
export interface RuneOption { readonly id: string; readonly glyph: string; readonly label: string }
/** id matches /^(map|lodestone|keepsake):[a-z0-9-]+$/ */
export interface KnowledgeGrant { readonly id: string; readonly text: string }

export interface ChamberExit extends ChamberCell {
  readonly id: string
  readonly style: 'arch' | 'stairs-up' | 'ladder' | 'house-door'
  readonly label: string
  readonly landing: ChamberCell          // orthogonally adjacent, on '@'
  readonly facing: Facing                // facing on arrival from above
}
export interface ChamberEntrance extends ChamberCell {
  readonly id: string
  readonly style: 'stairs-down' | 'trapdoor' | 'tunnel'
  readonly empty: string
  /** (2) A2.3 — the entrance's one push side, orthogonally adjacent, on '.' or ':'.
   *  Also where a return from below lands, facing away. */
  readonly landing: ChamberCell
}
export interface ChamberTablet extends ChamberCell {
  readonly id: string
  readonly title: string
  readonly text: string                  // at most 45 words
  readonly knowledgeId?: string          // default `${chamber.id}-${tablet.id}`
  readonly pointsAt?: readonly string[]
}
export interface ChamberGate extends ChamberCell {
  readonly id: string
  readonly name: string
  readonly tablet: string
  readonly question: string
  readonly options: readonly RuneOption[]
  readonly answer: readonly string[]
}
export interface ChamberChest extends ChamberCell {
  readonly id: string
  readonly name: string
  readonly subtitle: string
  readonly items: readonly ChamberItem[]
  readonly lore: string
  readonly hiddenUntil?: string
  readonly grants?: readonly KnowledgeGrant[]
  readonly pointsAt?: readonly string[]
}
export interface ChamberDoor extends ChamberCell { readonly id: string; readonly name: string; readonly lock: 'small' | 'great' }
export interface ChamberShutter extends ChamberCell {
  readonly id: string
  readonly name: string
  readonly plates?: readonly string[]
  readonly lever?: string
}
export interface ChamberPlate extends ChamberCell { readonly id: string }
export interface ChamberBlock extends ChamberCell { readonly id: string; readonly look: 'stone' | 'barrel' }
export interface ChamberLever extends ChamberCell { readonly id: string; readonly name: string; readonly shutter: string }
export interface ChamberLamp extends ChamberCell { readonly id: string; readonly name: string }
export interface ChamberLampSet {
  readonly id: string
  readonly lamps: readonly string[]
  readonly ordered: boolean
  readonly decoys?: readonly string[]
  readonly wrong?: string
}
export interface ChamberSigil extends ChamberCell {
  readonly id: string
  readonly blocks: readonly string[]
  readonly shutters: readonly string[]
}
export interface ChamberAlcove extends ChamberCell { readonly id: string; readonly memoryId: string; readonly text: string; readonly locked: string }
export interface ChamberArtifact extends ChamberCell {
  readonly id: string
  readonly name: string
  readonly knowledgeId: string
  readonly lore: string
  readonly appearsWith?: string
  readonly pointsAt?: readonly string[]
}
export interface ChamberResident extends ChamberCell {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly color: string
  readonly lines: readonly string[]
  readonly linesWith?: { readonly knowledge: string; readonly lines: readonly string[] }
}
export interface ChamberFurniture extends ChamberCell { readonly look: 'shelf' | 'table' | 'counter' | 'bed' | 'barrels' | 'rack' }
export interface ChamberEffect extends ChamberCell { readonly kind: 'drip' | 'daylight' | 'draught' }
export interface ChamberFinale {
  readonly when: { readonly set: string } | { readonly seal: true }
  readonly fills?: readonly ChamberCell[]
}
/** (2) A2.3 — gains its own `landing`, the push side, symmetric with ChamberEntrance. */
export interface ChamberRisingLight extends ChamberCell { readonly id: string; readonly landing: ChamberCell }

export interface ChamberDefinition {
  readonly id: string
  readonly name: string
  readonly subtitle: string
  readonly look: ChamberLook
  readonly torch: number
  readonly sconces: boolean
  readonly group?: string
  readonly heart?: boolean
  readonly map: readonly string[]
  readonly exits: readonly ChamberExit[]
  readonly entrances: readonly ChamberEntrance[]
  readonly tablets: readonly ChamberTablet[]
  readonly gates: readonly ChamberGate[]
  readonly chests: readonly ChamberChest[]
  readonly doors: readonly ChamberDoor[]
  readonly shutters: readonly ChamberShutter[]
  readonly plates: readonly ChamberPlate[]
  readonly blocks: readonly ChamberBlock[]
  readonly levers: readonly ChamberLever[]
  readonly lamps: readonly ChamberLamp[]
  readonly lampSets: readonly ChamberLampSet[]
  readonly sigils: readonly ChamberSigil[]
  readonly alcoves: readonly ChamberAlcove[]
  readonly residents: readonly ChamberResident[]
  readonly furniture: readonly ChamberFurniture[]
  readonly effects: readonly ChamberEffect[]
  readonly artifact?: ChamberArtifact
  readonly risingLight?: ChamberRisingLight
  readonly finale?: ChamberFinale
}

export interface ChamberBuilt {
  readonly definition: ChamberDefinition
  readonly cols: number
  readonly rows: number
  readonly terrain: readonly ChamberTerrain[]
  featureAt(col: number, row: number): string | undefined
  readonly liveSquares: ReadonlyMap<string, ReadonlySet<number>>
}

export const CHAMBER_SPEED = 3.8
export const CHAMBER_RADIUS = 0.25
export const PUSH_DELAY = 0.3
export const TABLET_REACH = 1.9
export const TABLET_DWELL = 0.4
export const TARGET_REACH = 1.25
export const LAMP_LIGHT = 3.2
export const LANTERN_BONUS = 1.2
/** (2) A2.3 — replaces WALK_ON_REACH (deleted): a portal that just delivered the
 *  traveller re-arms once the centre is this far from where they landed. */
export const REARM_DISTANCE = 0.75
/** Distance (tiles, click-through) within which a click reads a tablet immediately. */
const TABLET_CLICK_REACH = 4

export interface ChamberHooks {
  has(requirement: SigilRequirement): boolean
  knows(knowledgeId: string): boolean
}

export type ChamberTargetKind =
  | 'exit' | 'entrance' | 'rising-light' | 'chest' | 'door' | 'gate' | 'shutter'
  | 'lever' | 'lamp' | 'sigil' | 'alcove' | 'artifact' | 'resident'

export type ChamberEvent =
  | { readonly kind: 'pushed'; readonly block: string; readonly from: ChamberCell; readonly to: ChamberCell }
  | { readonly kind: 'push-refused'; readonly block?: string; readonly portal?: string }   // (2) A2.3 — exactly one of the two
  | { readonly kind: 'latched'; readonly shutter: string }
  | { readonly kind: 'read'; readonly tablet: string }
  | { readonly kind: 'knowledge'; readonly id: string; readonly text: string }
  | { readonly kind: 'lit'; readonly lamp: string }
  | { readonly kind: 'guttered'; readonly set: string }
  | { readonly kind: 'completed'; readonly set: string }
  | { readonly kind: 'revealed'; readonly feature: string }
  | { readonly kind: 'unlocked'; readonly door: string }
  | { readonly kind: 'pulled'; readonly lever: string }
  | { readonly kind: 'wand'; readonly col: number; readonly row: number; readonly terrain: ChamberTerrain }
  | { readonly kind: 'seal'; readonly open: boolean }
  | { readonly kind: 'settled'; readonly sigil: string }
  | { readonly kind: 'opened'; readonly chest: string; readonly fresh: boolean }
  | { readonly kind: 'claimed'; readonly artifact: string; readonly fresh: boolean }
  | { readonly kind: 'finale' }
  // (2) A2.3 — portal crossings are now events emitted from update(), not a separate interact()-only result:
  | { readonly kind: 'navigate'; readonly to: 'up'; readonly exit: string }
  | { readonly kind: 'navigate'; readonly to: 'down'; readonly entrance: string }
  | { readonly kind: 'navigate'; readonly to: 'surface'; readonly light: string }

export type ChamberDialog =
  | { readonly kind: 'gate'; readonly gate: string; readonly title: string; readonly question: string; readonly inscription: string }
  | { readonly kind: 'chest'; readonly chest: string; readonly title: string; readonly subtitle: string; readonly items: readonly ChamberItem[]; readonly lore: string; readonly fresh: boolean }
  | { readonly kind: 'alcove'; readonly alcove: string; readonly title: string; readonly text: string }
  | { readonly kind: 'artifact'; readonly artifact: string; readonly title: string; readonly lore: string; readonly fresh: boolean }

export type ChamberResult =
  | { readonly kind: 'message'; readonly text: string; readonly events: readonly ChamberEvent[] }
  | { readonly kind: 'dialog'; readonly dialog: ChamberDialog; readonly events: readonly ChamberEvent[] }
  | { readonly kind: 'speech'; readonly resident: string; readonly text: string; readonly events: readonly ChamberEvent[] }
  // (2) A2.3 — 'navigate' results from interact() survive ONLY for a click on a portal's
  // feature button (mouse/touch), reusing the same event shape emitted by update()'s push detector:
  | { readonly kind: 'navigate'; readonly to: 'up'; readonly exit: string; readonly events: readonly ChamberEvent[] }
  | { readonly kind: 'navigate'; readonly to: 'down'; readonly entrance: string; readonly events: readonly ChamberEvent[] }
  | { readonly kind: 'navigate'; readonly to: 'surface'; readonly events: readonly ChamberEvent[] }

export type ChamberPrompt =
  | { readonly kind: 'walled' }
  // (2) A2.3 — gains `action`: 'act' for a normal E-target, 'tag' for a portal or a shutter (name-only, no key hint)
  | { readonly kind: 'feature'; readonly id: string; readonly target: ChamberTargetKind; readonly text: string; readonly action: 'act' | 'tag' }
  | { readonly kind: 'stuck'; readonly sigil: string }
  | { readonly kind: 'idle' }

/** (2) A3.1 — the pure prompt contract a cue bubble renders. cue() below wraps prompt(). */
export interface ChamberCue {
  readonly id: string
  readonly target: ChamberTargetKind
  readonly anchor: ChamberCell
  readonly words: string
  readonly action: 'act' | 'tag'
}

export interface ChamberSnapshot {
  version: 1
  place: string
  player: { x: number; y: number; facing: Facing }
  read: string[]
  attuned: string[]
  runes: [gate: string, sequence: string[]][]
  opened: string[]
  unlocked: string[]
  latched: string[]
  pulled: string[]
  lit: string[]
  wand: string[]
  blocks: [block: string, col: number, row: number][]
  memories: string[]
  claimed: boolean
  explored: string
}

// ---------------------------------------------------------------------------
// Legend: map glyph -> built (pre-wand) terrain. §3.5.2's final merged table.
// ---------------------------------------------------------------------------
const BUILT_TERRAIN_FOR_CHAR: Readonly<Record<string, ChamberTerrain>> = {
  '#': 'rock', '.': 'floor', ':': 'threshold', '~': 'water', 'W': 'brick',
  'B': 'crack', 'r': 'rune', 'm': 'spring', 'S': 'seal', '=': 'furniture',
  '@': 'floor', '<': 'floor', '>': 'floor', 'u': 'floor', 't': 'floor',
  'R': 'floor', 'K': 'floor', 'k': 'floor', 'D': 'floor', 'G': 'floor',
  '|': 'floor', 'P': 'floor', 'o': 'floor', 'q': 'rune', 'L': 'floor',
  'f': 'floor', 'A': 'floor', 'h': 'floor', 's': 'floor', 'n': 'floor',
}
const LEGEND_CHARS = new Set(Object.keys(BUILT_TERRAIN_FOR_CHAR))

const DIR_VECTOR: Readonly<Record<Facing, ChamberCell>> = {
  up: { col: 0, row: -1 }, down: { col: 0, row: 1 }, left: { col: -1, row: 0 }, right: { col: 1, row: 0 },
}
function directionBetween(from: ChamberCell, to: ChamberCell): Facing | null {
  const dc = to.col - from.col, dr = to.row - from.row
  if (dc === 0 && dr === -1) return 'up'
  if (dc === 0 && dr === 1) return 'down'
  if (dc === -1 && dr === 0) return 'left'
  if (dc === 1 && dr === 0) return 'right'
  return null
}
const cellKey = (col: number, row: number): string => `${col},${row}`
const centerDist = (x: number, y: number, cell: ChamberCell): number => Math.hypot(x - cell.col - 0.5, y - cell.row - 0.5)

// ---------------------------------------------------------------------------
// buildChamber — validates seventeen invariants and derives the static board.
// ---------------------------------------------------------------------------
const builtCache = new WeakMap<ChamberDefinition, ChamberBuilt>()

/**
 * Validates (build checks below) and throws Error(`${definition.id}: ${problem}`).
 * Memoised per definition object.
 *
 * Seventeen checks — 1-14 structural (this module's own numbering; no earlier
 * numbering survives to check against, so this is a fresh, self-consistent
 * set covering every invariant the mechanics in §5.2 depend on), 15-17 are
 * (2) A2.3's portal-landing invariants (6b/6c/6d):
 *
 *  1. the map is a non-empty rectangle (every row the same length)
 *  2. every map character is a recognised legend glyph
 *  3. the outer border is closed: no plain '.' or ':' cell touches the edge
 *  4. there is at least one exit
 *  5. every feature id is unique across the whole definition
 *  6. every feature's cell is in bounds
 *  7. every feature's cell carries the legend glyph its kind requires
 *  8. every exit's landing is on '@', in bounds, orthogonally adjacent to the exit
 *  9. every shutter names at least one control (plates and/or a lever) and every
 *     id it names (plates, lever) resolves; a named lever's own .shutter agrees
 * 10. every sigil's blocks and shutters resolve to real blocks/shutters
 * 11. every lamp set's lamps (>=1), decoys and wrong id all resolve and stay disjoint
 * 12. every gate's tablet resolves, its options carry unique ids, and its answer is
 *     a non-empty sequence drawn from those ids
 * 13. every pointsAt (tablet/chest/artifact) resolves to a real feature id
 * 14. a finale's `set` resolves to a real lamp set; every block's starting cell is
 *     a block-home glyph ('o' or 'q')
 * 15. (6b) every exit's facing equals the compass direction from the exit to its landing
 * 16. (6c) every entrance's / the rising light's landing is orthogonally adjacent, in
 *     bounds, and sits on '.' or ':' -- never '@', never a feature
 * 17. (6d) no two portals share a landing, and no landing is another portal's own cell
 */
export function buildChamber(definition: ChamberDefinition): ChamberBuilt {
  const cached = builtCache.get(definition)
  if (cached) return cached
  const fail = (problem: string): never => { throw new Error(`${definition.id}: ${problem}`) }
  const map = definition.map
  if (map.length === 0) fail('map has no rows')
  const cols = map[0].length, rows = map.length
  if (cols === 0) fail('map rows are empty')
  for (const row of map) if (row.length !== cols) fail('map is not a rectangle') // 1
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    if (!LEGEND_CHARS.has(map[row][col])) fail(`unknown map glyph '${map[row][col]}' at (${col},${row})`) // 2
  }
  for (let col = 0; col < cols; col++) {
    if (map[0][col] === '.' || map[0][col] === ':') fail(`open border at (${col},0)`) // 3
    if (map[rows - 1][col] === '.' || map[rows - 1][col] === ':') fail(`open border at (${col},${rows - 1})`)
  }
  for (let row = 0; row < rows; row++) {
    if (map[row][0] === '.' || map[row][0] === ':') fail(`open border at (0,${row})`)
    if (map[row][cols - 1] === '.' || map[row][cols - 1] === ':') fail(`open border at (${cols - 1},${row})`)
  }
  if (definition.exits.length === 0) fail('has no exit') // 4

  const inBounds = (cell: ChamberCell): boolean => cell.col >= 0 && cell.col < cols && cell.row >= 0 && cell.row < rows
  const charAt = (cell: ChamberCell): string => map[cell.row][cell.col]

  const ids = new Set<string>()
  const claimId = (id: string, what: string): void => {
    if (ids.has(id)) fail(`duplicate id '${id}' (${what})`)
    ids.add(id)
  }
  const requireCell = (cell: ChamberCell, what: string): void => { if (!inBounds(cell)) fail(`${what} is out of bounds`) }
  const requireGlyph = (cell: ChamberCell, glyphs: readonly string[], what: string): void => {
    if (!glyphs.includes(charAt(cell))) fail(`${what} does not sit on its required glyph`)
  }

  for (const exit of definition.exits) {
    claimId(exit.id, 'exit') // 5
    requireCell(exit, `exit '${exit.id}'`) // 6
    requireGlyph(exit, ['<'], `exit '${exit.id}'`) // 7
    requireCell(exit.landing, `exit '${exit.id}' landing`) // 8
    if (directionBetween(exit, exit.landing) === null) fail(`exit '${exit.id}' landing is not orthogonally adjacent`)
    requireGlyph(exit.landing, ['@'], `exit '${exit.id}' landing`)
  }
  for (const entrance of definition.entrances) {
    claimId(entrance.id, 'entrance')
    requireCell(entrance, `entrance '${entrance.id}'`)
    requireGlyph(entrance, ['>'], `entrance '${entrance.id}'`)
  }
  if (definition.risingLight) {
    claimId(definition.risingLight.id, 'rising light')
    requireCell(definition.risingLight, 'rising light')
    requireGlyph(definition.risingLight, ['u'], 'rising light')
  }
  const tabletById = new Map(definition.tablets.map(t => [t.id, t]))
  for (const tablet of definition.tablets) {
    claimId(tablet.id, 'tablet')
    requireCell(tablet, `tablet '${tablet.id}'`)
    requireGlyph(tablet, ['t'], `tablet '${tablet.id}'`)
  }
  for (const gate of definition.gates) {
    claimId(gate.id, 'gate')
    requireCell(gate, `gate '${gate.id}'`)
    requireGlyph(gate, ['R'], `gate '${gate.id}'`)
    if (!tabletById.has(gate.tablet)) fail(`gate '${gate.id}' points at unknown tablet '${gate.tablet}'`) // 12
    const optionIds = new Set<string>()
    for (const option of gate.options) {
      if (optionIds.has(option.id)) fail(`gate '${gate.id}' has duplicate rune option '${option.id}'`)
      optionIds.add(option.id)
    }
    if (gate.answer.length === 0) fail(`gate '${gate.id}' has an empty answer`)
    for (const answer of gate.answer) if (!optionIds.has(answer)) fail(`gate '${gate.id}' answer references unknown option '${answer}'`)
  }
  const chestById = new Map(definition.chests.map(c => [c.id, c]))
  for (const chest of definition.chests) {
    claimId(chest.id, 'chest')
    requireCell(chest, `chest '${chest.id}'`)
    requireGlyph(chest, [chest.hiddenUntil ? 'k' : 'K'], `chest '${chest.id}'`)
  }
  const doorById = new Map(definition.doors.map(d => [d.id, d]))
  for (const door of definition.doors) {
    claimId(door.id, 'door')
    requireCell(door, `door '${door.id}'`)
    requireGlyph(door, [door.lock === 'great' ? 'G' : 'D'], `door '${door.id}'`)
  }
  const plateById = new Map(definition.plates.map(p => [p.id, p]))
  for (const plate of definition.plates) {
    claimId(plate.id, 'plate')
    requireCell(plate, `plate '${plate.id}'`)
    requireGlyph(plate, ['P'], `plate '${plate.id}'`)
  }
  const blockById = new Map(definition.blocks.map(b => [b.id, b]))
  for (const block of definition.blocks) {
    claimId(block.id, 'block')
    requireCell(block, `block '${block.id}'`)
    requireGlyph(block, ['o', 'q'], `block '${block.id}'`) // 14 (home glyph)
  }
  const leverById = new Map(definition.levers.map(l => [l.id, l]))
  for (const lever of definition.levers) {
    claimId(lever.id, 'lever')
    requireCell(lever, `lever '${lever.id}'`)
    requireGlyph(lever, ['L'], `lever '${lever.id}'`)
  }
  const lampById = new Map(definition.lamps.map(l => [l.id, l]))
  for (const lamp of definition.lamps) {
    claimId(lamp.id, 'lamp')
    requireCell(lamp, `lamp '${lamp.id}'`)
    requireGlyph(lamp, ['f'], `lamp '${lamp.id}'`)
  }
  const shutterById = new Map(definition.shutters.map(s => [s.id, s]))
  for (const shutter of definition.shutters) {
    claimId(shutter.id, 'shutter')
    requireCell(shutter, `shutter '${shutter.id}'`)
    requireGlyph(shutter, ['|'], `shutter '${shutter.id}'`)
    const hasPlates = !!shutter.plates?.length, hasLever = !!shutter.lever
    if (!hasPlates && !hasLever) fail(`shutter '${shutter.id}' names no control`) // 9
    for (const plateId of shutter.plates ?? []) if (!plateById.has(plateId)) fail(`shutter '${shutter.id}' references unknown plate '${plateId}'`)
    if (shutter.lever) {
      const lever = leverById.get(shutter.lever)
      if (!lever) fail(`shutter '${shutter.id}' references unknown lever '${shutter.lever}'`)
      else if (lever.shutter !== shutter.id) fail(`lever '${lever.id}' does not point back at shutter '${shutter.id}'`)
    }
  }
  for (const lever of definition.levers) if (!shutterById.has(lever.shutter)) fail(`lever '${lever.id}' references unknown shutter '${lever.shutter}'`)
  for (const lampSet of definition.lampSets) {
    if (lampSet.lamps.length === 0) fail(`lamp set '${lampSet.id}' has no lamps`) // 11
    for (const lampId of lampSet.lamps) if (!lampById.has(lampId)) fail(`lamp set '${lampSet.id}' references unknown lamp '${lampId}'`)
    for (const decoy of lampSet.decoys ?? []) {
      if (!lampById.has(decoy)) fail(`lamp set '${lampSet.id}' references unknown decoy '${decoy}'`)
      if (lampSet.lamps.includes(decoy)) fail(`lamp set '${lampSet.id}' decoy '${decoy}' is also a true lamp`)
    }
    if (lampSet.wrong !== undefined && !(lampSet.decoys ?? []).includes(lampSet.wrong)) fail(`lamp set '${lampSet.id}' wrong id is not among its decoys`)
  }
  for (const sigil of definition.sigils) {
    claimId(sigil.id, 'sigil')
    requireCell(sigil, `sigil '${sigil.id}'`)
    requireGlyph(sigil, ['s'], `sigil '${sigil.id}'`)
    for (const blockId of sigil.blocks) if (!blockById.has(blockId)) fail(`sigil '${sigil.id}' references unknown block '${blockId}'`) // 10
    for (const shutterId of sigil.shutters) if (!shutterById.has(shutterId)) fail(`sigil '${sigil.id}' references unknown shutter '${shutterId}'`)
  }
  const alcoveById = new Map(definition.alcoves.map(a => [a.id, a]))
  for (const alcove of definition.alcoves) {
    claimId(alcove.id, 'alcove')
    requireCell(alcove, `alcove '${alcove.id}'`)
    requireGlyph(alcove, ['h'], `alcove '${alcove.id}'`)
  }
  for (const resident of definition.residents) {
    claimId(resident.id, 'resident')
    requireCell(resident, `resident '${resident.id}'`)
    requireGlyph(resident, ['n'], `resident '${resident.id}'`)
  }
  if (definition.artifact) {
    claimId(definition.artifact.id, 'artifact')
    requireCell(definition.artifact, `artifact '${definition.artifact.id}'`)
    requireGlyph(definition.artifact, ['A'], `artifact '${definition.artifact.id}'`)
  }
  for (const furniture of definition.furniture) {
    requireCell(furniture, 'furniture')
    requireGlyph(furniture, ['='], 'furniture')
  }
  const knownTarget = (id: string): boolean => tabletById.has(id) || chestById.has(id) || doorById.has(id) || plateById.has(id)
    || blockById.has(id) || leverById.has(id) || lampById.has(id) || shutterById.has(id) || alcoveById.has(id)
    || definition.gates.some(g => g.id === id) || definition.sigils.some(s => s.id === id) || definition.residents.some(r => r.id === id)
    || definition.artifact?.id === id
  for (const tablet of definition.tablets) for (const ref of tablet.pointsAt ?? []) if (!knownTarget(ref)) fail(`tablet '${tablet.id}' points at unknown '${ref}'`) // 13
  for (const chest of definition.chests) for (const ref of chest.pointsAt ?? []) if (!knownTarget(ref)) fail(`chest '${chest.id}' points at unknown '${ref}'`)
  if (definition.artifact) for (const ref of definition.artifact.pointsAt ?? []) if (!knownTarget(ref)) fail(`artifact points at unknown '${ref}'`)

  if (definition.finale && 'set' in definition.finale.when) {
    const setId = definition.finale.when.set
    if (!definition.lampSets.some(set => set.id === setId)) fail(`finale references unknown lamp set '${setId}'`) // 14 (finale part)
  }
  if (definition.finale?.fills) for (const cell of definition.finale.fills) requireCell(cell, 'finale fill cell')

  // 15 (6b): every exit's facing equals the compass direction from the exit to its landing.
  for (const exit of definition.exits) {
    if (directionBetween(exit, exit.landing) !== exit.facing) fail(`exit '${exit.id}' facing does not match the direction to its landing`)
  }
  // 16 (6c): every entrance's / the rising light's landing is adjacent, in bounds, on '.'/':'.
  const landingOwners: { id: string; kind: 'exit' | 'entrance' | 'rising-light'; cell: ChamberCell; landing: ChamberCell }[] = [
    ...definition.exits.map(e => ({ id: e.id, kind: 'exit' as const, cell: e as ChamberCell, landing: e.landing })),
    ...definition.entrances.map(e => ({ id: e.id, kind: 'entrance' as const, cell: e as ChamberCell, landing: e.landing })),
  ]
  if (definition.risingLight) landingOwners.push({ id: definition.risingLight.id, kind: 'rising-light', cell: definition.risingLight, landing: definition.risingLight.landing })
  for (const owner of landingOwners) {
    if (owner.kind === 'exit') continue // exits validated against '@' above (check 8)
    requireCell(owner.landing, `${owner.kind} '${owner.id}' landing`)
    if (directionBetween(owner.cell, owner.landing) === null) fail(`${owner.kind} '${owner.id}' landing is not orthogonally adjacent`)
    requireGlyph(owner.landing, ['.', ':'], `${owner.kind} '${owner.id}' landing`)
  }
  // 17 (6d): no two portals share a landing; no landing is another portal's own cell.
  const allPortalCells = new Map<string, string>()
  for (const owner of landingOwners) allPortalCells.set(cellKey(owner.cell.col, owner.cell.row), owner.id)
  const seenLandings = new Map<string, string>()
  for (const owner of landingOwners) {
    const key = cellKey(owner.landing.col, owner.landing.row)
    const collidingOwner = seenLandings.get(key)
    if (collidingOwner) fail(`portals '${collidingOwner}' and '${owner.id}' share a landing`)
    seenLandings.set(key, owner.id)
    const otherPortal = allPortalCells.get(key)
    if (otherPortal && otherPortal !== owner.id) fail(`portal '${owner.id}' lands on portal '${otherPortal}'`)
  }

  // Derived static board.
  const terrain: ChamberTerrain[] = new Array(cols * rows)
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) terrain[row * cols + col] = BUILT_TERRAIN_FOR_CHAR[map[row][col]]
  const featureCells = new Map<string, string>()
  const markFeature = (cell: ChamberCell, id: string): void => { featureCells.set(cellKey(cell.col, cell.row), id) }
  for (const exit of definition.exits) markFeature(exit, exit.id)
  for (const entrance of definition.entrances) markFeature(entrance, entrance.id)
  if (definition.risingLight) markFeature(definition.risingLight, definition.risingLight.id)
  for (const tablet of definition.tablets) markFeature(tablet, tablet.id)
  for (const gate of definition.gates) markFeature(gate, gate.id)
  for (const chest of definition.chests) markFeature(chest, chest.id)
  for (const door of definition.doors) markFeature(door, door.id)
  for (const shutter of definition.shutters) markFeature(shutter, shutter.id)
  for (const plate of definition.plates) markFeature(plate, plate.id)
  for (const lever of definition.levers) markFeature(lever, lever.id)
  for (const lamp of definition.lamps) markFeature(lamp, lamp.id)
  for (const sigil of definition.sigils) markFeature(sigil, sigil.id)
  for (const alcove of definition.alcoves) markFeature(alcove, alcove.id)
  for (const resident of definition.residents) markFeature(resident, resident.id)
  if (definition.artifact) markFeature(definition.artifact, definition.artifact.id)

  // liveSquares: per sigil, the connected region (via static, occupancy-free
  // block-enterable adjacency) that contains its blocks' home cells and the
  // plate cells of the shutters it controls. stuck() uses this to flag a
  // sigil once none of its (live) blocks sits inside that region any more.
  const staticBlockEnter = (col: number, row: number): boolean => {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return false
    if (terrain[row * cols + col] !== 'floor') return false
    const feature = featureCells.get(cellKey(col, row))
    if (feature && !plateById.has(feature)) return false
    for (const exit of definition.exits) if (exit.landing.col === col && exit.landing.row === row) return false
    for (const entrance of definition.entrances) if (entrance.landing.col === col && entrance.landing.row === row) return false
    return true
  }
  const liveSquares = new Map<string, Set<number>>()
  for (const sigil of definition.sigils) {
    const seeds: number[] = []
    for (const blockId of sigil.blocks) { const block = blockById.get(blockId); if (block) seeds.push(block.row * cols + block.col) }
    for (const shutterId of sigil.shutters) {
      const shutter = shutterById.get(shutterId)
      for (const plateId of shutter?.plates ?? []) { const plate = plateById.get(plateId); if (plate) seeds.push(plate.row * cols + plate.col) }
    }
    const region = new Set<number>()
    const queue = [...new Set(seeds)]
    for (const index of queue) region.add(index)
    while (queue.length) {
      const index = queue.shift()!
      const col = index % cols, row = Math.floor(index / cols)
      for (const dir of Object.values(DIR_VECTOR)) {
        const nc = col + dir.col, nr = row + dir.row
        if (!staticBlockEnter(nc, nr)) continue
        const nIndex = nr * cols + nc
        if (region.has(nIndex)) continue
        region.add(nIndex)
        queue.push(nIndex)
      }
    }
    liveSquares.set(sigil.id, region)
  }

  const built: ChamberBuilt = {
    definition, cols, rows, terrain,
    featureAt: (col, row) => col < 0 || col >= cols || row < 0 || row >= rows ? undefined : featureCells.get(cellKey(col, row)),
    liveSquares,
  }
  builtCache.set(definition, built)
  return built
}

// ---------------------------------------------------------------------------
// ChamberModel
// ---------------------------------------------------------------------------
export class ChamberModel {
  readonly definition: ChamberDefinition
  readonly built: ChamberBuilt
  readonly read = new Set<string>()
  readonly attuned = new Set<string>()
  readonly opened = new Set<string>()
  readonly unlocked = new Set<string>()
  readonly latched = new Set<string>()
  readonly pulled = new Set<string>()
  readonly memories = new Set<string>()
  readonly explored: Uint8Array

  #hooks: ChamberHooks
  #cols: number
  #rows: number
  #x = 0
  #y = 0
  #facing: Facing = 'down'
  #moving = false
  #claimed = false
  #lit = new Set<string>()
  #runes = new Map<string, string[]>()
  #blocks: Map<string, ChamberCell>
  #wand = new Set<string>()
  #sealCells: ChamberCell[]
  #finalePlayed = false
  #talkTurn = 0
  #tabletDwell: { id: string; elapsed: number } | null = null
  #pushKey: string | null = null
  #pushElapsed = 0
  #refusedKey: string | null = null
  #disarmedPortal: string | null = null
  #disarmedAt: { x: number; y: number } | null = null

  readonly #tabletsById: Map<string, ChamberTablet>
  readonly #gatesById: Map<string, ChamberGate>
  readonly #chestsById: Map<string, ChamberChest>
  readonly #doorsById: Map<string, ChamberDoor>
  readonly #shuttersById: Map<string, ChamberShutter>
  readonly #platesById: Map<string, ChamberPlate>
  readonly #blocksById: Map<string, ChamberBlock>
  readonly #leversById: Map<string, ChamberLever>
  readonly #lampsById: Map<string, ChamberLamp>
  readonly #lampSetsById: Map<string, ChamberLampSet>
  readonly #sigilsById: Map<string, ChamberSigil>
  readonly #alcovesById: Map<string, ChamberAlcove>
  readonly #residentsById: Map<string, ChamberResident>
  readonly #exitsById: Map<string, ChamberExit>
  readonly #entrancesById: Map<string, ChamberEntrance>

  constructor(definition: ChamberDefinition, hooks: Partial<ChamberHooks> = {}) {
    this.definition = definition
    this.built = buildChamber(definition)
    this.#hooks = { has: hooks.has ?? (() => false), knows: hooks.knows ?? (() => false) }
    this.#cols = this.built.cols
    this.#rows = this.built.rows
    this.explored = new Uint8Array(this.#cols * this.#rows)
    this.#tabletsById = new Map(definition.tablets.map(t => [t.id, t]))
    this.#gatesById = new Map(definition.gates.map(g => [g.id, g]))
    this.#chestsById = new Map(definition.chests.map(c => [c.id, c]))
    this.#doorsById = new Map(definition.doors.map(d => [d.id, d]))
    this.#shuttersById = new Map(definition.shutters.map(s => [s.id, s]))
    this.#platesById = new Map(definition.plates.map(p => [p.id, p]))
    this.#blocksById = new Map(definition.blocks.map(b => [b.id, b]))
    this.#leversById = new Map(definition.levers.map(l => [l.id, l]))
    this.#lampsById = new Map(definition.lamps.map(l => [l.id, l]))
    this.#lampSetsById = new Map(definition.lampSets.map(s => [s.id, s]))
    this.#sigilsById = new Map(definition.sigils.map(s => [s.id, s]))
    this.#alcovesById = new Map(definition.alcoves.map(a => [a.id, a]))
    this.#residentsById = new Map(definition.residents.map(r => [r.id, r]))
    this.#exitsById = new Map(definition.exits.map(e => [e.id, e]))
    this.#entrancesById = new Map(definition.entrances.map(e => [e.id, e]))
    this.#blocks = new Map(definition.blocks.map(b => [b.id, { col: b.col, row: b.row }]))
    this.#sealCells = []
    for (let row = 0; row < this.#rows; row++) for (let col = 0; col < this.#cols; col++) if (definition.map[row][col] === 'r') this.#sealCells.push({ col, row })
    this.arrive()
  }

  get x(): number { return this.#x }
  get y(): number { return this.#y }
  get facing(): Facing { return this.#facing }
  get moving(): boolean { return this.#moving }
  get claimed(): boolean { return this.#claimed }
  get lit(): readonly string[] { return [...this.#lit] }

  runes(gate: string): readonly string[] { return this.#runes.get(gate) ?? [] }

  #inBounds(col: number, row: number): boolean { return col >= 0 && col < this.#cols && row >= 0 && row < this.#rows }
  #builtTerrainAt(col: number, row: number): ChamberTerrain { return BUILT_TERRAIN_FOR_CHAR[this.definition.map[row][col]] }

  terrainAt(col: number, row: number): ChamberTerrain {
    if (!this.#inBounds(col, row)) return 'rock'
    const built = this.#builtTerrainAt(col, row)
    if (built === 'seal') return this.sealOpen() ? 'seal-open' : 'seal'
    if (WAND_CELLS.has(built) && this.#wand.has(cellKey(col, row))) return (WAND_MADE[built] as ChamberTerrain) ?? built
    return built
  }

  #kindOf(id: string): ChamberTargetKind | undefined {
    if (this.#exitsById.has(id)) return 'exit'
    if (this.#entrancesById.has(id)) return 'entrance'
    if (this.definition.risingLight?.id === id) return 'rising-light'
    if (this.#chestsById.has(id)) return 'chest'
    if (this.#doorsById.has(id)) return 'door'
    if (this.#gatesById.has(id)) return 'gate'
    if (this.#shuttersById.has(id)) return 'shutter'
    if (this.#leversById.has(id)) return 'lever'
    if (this.#lampsById.has(id)) return 'lamp'
    if (this.#sigilsById.has(id)) return 'sigil'
    if (this.#alcovesById.has(id)) return 'alcove'
    if (this.definition.artifact?.id === id) return 'artifact'
    if (this.#residentsById.has(id)) return 'resident'
    return undefined
  }

  /** A hidden chest is present once its lamp set completes; the rising light,
   *  once the artifact is claimed. Everything else is always present. */
  present(feature: string): boolean {
    const chest = this.#chestsById.get(feature)
    if (chest?.hiddenUntil) return this.setComplete(chest.hiddenUntil)
    if (this.definition.risingLight?.id === feature) return this.#claimed
    return true
  }

  blockAt(col: number, row: number): string | null {
    for (const [id, cell] of this.#blocks) if (cell.col === col && cell.row === row) return id
    return null
  }
  blockCell(block: string): ChamberCell {
    const cell = this.#blocks.get(block)
    if (!cell) throw new Error(`${this.definition.id}: unknown block '${block}'`)
    return cell
  }

  pressed(plate: string): boolean {
    const cell = this.#platesById.get(plate)
    return !!cell && this.blockAt(cell.col, cell.row) !== null
  }
  shutterOpen(shutter: string): boolean { return this.latched.has(shutter) }
  sealOpen(): boolean {
    if (this.#sealCells.length === 0) return false
    return this.#sealCells.every(cell => this.#wand.has(cellKey(cell.col, cell.row)))
  }
  setComplete(set: string): boolean {
    const lampSet = this.#lampSetsById.get(set)
    return !!lampSet && lampSet.lamps.every(id => this.#lit.has(id))
  }
  keysHeld(): number {
    const smallOpened = [...this.#chestsById.values()].filter(c => this.opened.has(c.id) && c.items.some(item => item.kind === 'key')).length
    const smallSpent = [...this.#doorsById.values()].filter(d => d.lock === 'small' && this.unlocked.has(d.id)).length
    return Math.max(0, smallOpened - smallSpent)
  }
  hasGreatKey(): boolean {
    const greatChest = [...this.#chestsById.values()].find(c => c.items.some(item => item.kind === 'great-key'))
    if (!greatChest || !this.opened.has(greatChest.id)) return false
    return ![...this.#doorsById.values()].some(d => d.lock === 'great' && this.unlocked.has(d.id))
  }

  #portalAt(col: number, row: number): { id: string; kind: 'exit' | 'entrance' | 'rising-light'; cell: ChamberCell; landing: ChamberCell } | null {
    for (const exit of this.definition.exits) if (exit.col === col && exit.row === row) return { id: exit.id, kind: 'exit', cell: exit, landing: exit.landing }
    for (const entrance of this.definition.entrances) {
      if (entrance.col === col && entrance.row === row && this.present(entrance.id)) return { id: entrance.id, kind: 'entrance', cell: entrance, landing: entrance.landing }
    }
    const rl = this.definition.risingLight
    if (rl && rl.col === col && rl.row === row && this.present(rl.id)) return { id: rl.id, kind: 'rising-light', cell: rl, landing: rl.landing }
    return null
  }

  open(col: number, row: number): boolean {
    if (!this.#inBounds(col, row)) return false
    if (this.blockAt(col, row) !== null) return false
    if (this.#portalAt(col, row)) return false
    const terrain = this.terrainAt(col, row)
    const walkable = terrain === 'floor' || terrain === 'threshold' || terrain === 'seal-open' || WAND_WALKABLE.has(terrain)
    if (!walkable) return false
    const feature = this.built.featureAt(col, row)
    if (!feature) return true
    if (this.#tabletsById.has(feature)) return false // read by proximity, never walked onto
    const kind = this.#kindOf(feature)
    if (kind === 'chest' || kind === 'lever' || kind === 'lamp' || kind === 'alcove' || kind === 'artifact' || kind === 'resident' || kind === 'sigil') return false
    if (kind === 'door') return this.unlocked.has(feature)
    if (kind === 'gate') return this.attuned.has(feature)
    if (kind === 'shutter') return this.latched.has(feature)
    return true // plate, or an unrecognised marker
  }

  canBlockEnter(col: number, row: number): boolean {
    if (!this.#inBounds(col, row)) return false
    if (this.blockAt(col, row) !== null) return false
    if (this.terrainAt(col, row) !== 'floor') return false
    const feature = this.built.featureAt(col, row)
    if (feature && !this.#platesById.has(feature)) return false
    for (const exit of this.definition.exits) if (exit.landing.col === col && exit.landing.row === row) return false
    for (const entrance of this.definition.entrances) if (entrance.landing.col === col && entrance.landing.row === row) return false
    return true
  }

  walledIn(): boolean {
    const startCol = Math.floor(this.#x), startRow = Math.floor(this.#y)
    const seen = new Set<number>([startRow * this.#cols + startCol])
    const queue = [startRow * this.#cols + startCol]
    while (queue.length) {
      const index = queue.shift()!
      const col = index % this.#cols, row = Math.floor(index / this.#cols)
      for (const dir of Object.values(DIR_VECTOR)) {
        const nc = col + dir.col, nr = row + dir.row
        if (!this.#inBounds(nc, nr)) continue
        const nIndex = nr * this.#cols + nc
        if (seen.has(nIndex) || !this.open(nc, nr)) continue
        seen.add(nIndex)
        queue.push(nIndex)
      }
    }
    const region = new Set(seen)
    for (const index of seen) {
      const col = index % this.#cols, row = Math.floor(index / this.#cols)
      for (const dir of Object.values(DIR_VECTOR)) {
        const nc = col + dir.col, nr = row + dir.row
        if (!this.#inBounds(nc, nr)) continue
        const terrain = this.terrainAt(nc, nr)
        if (WAND_CELLS.has(terrain)) region.add(nr * this.#cols + nc)
      }
    }
    for (const index of region) {
      const col = index % this.#cols, row = Math.floor(index / this.#cols)
      for (const dir of Object.values(DIR_VECTOR)) {
        const nc = col + dir.col, nr = row + dir.row
        if (!this.#inBounds(nc, nr)) continue
        const feature = this.built.featureAt(nc, nr)
        if (!feature) continue
        const kind = this.#kindOf(feature)
        if (kind === 'sigil') return false
        if ((kind === 'exit' || kind === 'entrance' || kind === 'rising-light') && this.present(feature)) return false
      }
    }
    return true
  }

  /** A permanent wall, for corner-deadlock purposes only: out of bounds, or
   *  built terrain that never changes and is never block-enterable. Crack/
   *  rune/spring (wand-togglable), doors, gates and shutters (unlockable/
   *  attunable/latchable) are deliberately excluded — flagging those would
   *  produce false positives against content that is still solvable. */
  #isPermanentWall(col: number, row: number): boolean {
    if (!this.#inBounds(col, row)) return true
    const built = this.#builtTerrainAt(col, row)
    return built === 'rock' || built === 'water' || built === 'brick' || built === 'furniture'
  }

  /** A sigil's block is stuck once it sits in a corner formed by two
   *  permanent walls on perpendicular axes — it can never be pushed again in
   *  either axis, so no push sequence can ever return it home. Proved at
   *  zero false flags because only IMMUTABLE geometry counts as a wall here;
   *  `liveSquares` (the flood-filled reachable region) stays available on
   *  `built` for the view's own puzzle-region shading. */
  stuck(): string | null {
    for (const sigil of this.definition.sigils) {
      for (const blockId of sigil.blocks) {
        const cell = this.blockCell(blockId)
        const horizontalWalled = this.#isPermanentWall(cell.col - 1, cell.row) || this.#isPermanentWall(cell.col + 1, cell.row)
        const verticalWalled = this.#isPermanentWall(cell.col, cell.row - 1) || this.#isPermanentWall(cell.col, cell.row + 1)
        if (horizontalWalled && verticalWalled) return sigil.id
      }
    }
    return null
  }

  #nearestFeature(kinds: readonly ChamberTargetKind[], requirePresent: boolean): { id: string; target: ChamberTargetKind; cell: ChamberCell } | null {
    let bestId: string | null = null
    let bestTarget: ChamberTargetKind = 'chest'
    let bestCell: ChamberCell = { col: 0, row: 0 }
    let bestDist = Infinity
    const consider = (id: string, target: ChamberTargetKind, cell: ChamberCell): void => {
      if (requirePresent && !this.present(id)) return
      const dist = centerDist(this.#x, this.#y, cell)
      if (dist <= TARGET_REACH && dist < bestDist) { bestId = id; bestTarget = target; bestCell = cell; bestDist = dist }
    }
    if (kinds.includes('chest')) for (const c of this.#chestsById.values()) consider(c.id, 'chest', c)
    if (kinds.includes('door')) for (const d of this.#doorsById.values()) consider(d.id, 'door', d)
    if (kinds.includes('gate')) for (const g of this.#gatesById.values()) consider(g.id, 'gate', g)
    if (kinds.includes('lever')) for (const l of this.#leversById.values()) consider(l.id, 'lever', l)
    if (kinds.includes('lamp')) for (const l of this.#lampsById.values()) consider(l.id, 'lamp', l)
    if (kinds.includes('sigil')) for (const s of this.#sigilsById.values()) consider(s.id, 'sigil', s)
    if (kinds.includes('alcove')) for (const a of this.#alcovesById.values()) consider(a.id, 'alcove', a)
    if (kinds.includes('artifact') && this.definition.artifact) consider(this.definition.artifact.id, 'artifact', this.definition.artifact)
    if (kinds.includes('resident')) for (const r of this.#residentsById.values()) consider(r.id, 'resident', r)
    return bestId !== null ? { id: bestId, target: bestTarget, cell: bestCell } : null
  }

  /** (2) A2.3 — never returns a portal. */
  nearest(): { id: string; target: ChamberTargetKind } | null {
    const found = this.#nearestFeature(['chest', 'door', 'gate', 'lever', 'lamp', 'sigil', 'alcove', 'artifact', 'resident'], true)
    return found ? { id: found.id, target: found.target } : null
  }

  #nearestPortal(): { id: string; kind: 'exit' | 'entrance' | 'rising-light'; cell: ChamberCell } | null {
    let bestId: string | null = null
    let bestKind: 'exit' | 'entrance' | 'rising-light' = 'exit'
    let bestCell: ChamberCell = { col: 0, row: 0 }
    let bestDist = Infinity
    const consider = (id: string, kind: 'exit' | 'entrance' | 'rising-light', cell: ChamberCell): void => {
      if (!this.present(id)) return
      const dist = centerDist(this.#x, this.#y, cell)
      if (dist <= TARGET_REACH && dist < bestDist) { bestId = id; bestKind = kind; bestCell = cell; bestDist = dist }
    }
    for (const exit of this.definition.exits) consider(exit.id, 'exit', exit)
    for (const entrance of this.definition.entrances) consider(entrance.id, 'entrance', entrance)
    if (this.definition.risingLight) consider(this.definition.risingLight.id, 'rising-light', this.definition.risingLight)
    return bestId !== null ? { id: bestId, kind: bestKind, cell: bestCell } : null
  }

  #portalLabel(kind: 'exit' | 'entrance' | 'rising-light', id: string): string {
    if (kind === 'exit') return this.#exitsById.get(id)?.label ?? ''
    if (kind === 'entrance') return this.#entrancesById.get(id)?.style === 'trapdoor' ? 'Trapdoor' : this.#entrancesById.get(id)?.style === 'tunnel' ? 'Tunnel' : 'Stairs down'
    return 'The Rising Light'
  }

  #actText(target: ChamberTargetKind, id: string): string {
    if (target === 'chest') return `${this.#chestsById.get(id)!.name} · E to open`
    if (target === 'door') { const d = this.#doorsById.get(id)!; return this.unlocked.has(id) ? `${d.name} · open` : `${d.name} · E to unlock` }
    if (target === 'gate') return `${this.#gatesById.get(id)!.name} · E to read`
    if (target === 'lever') return `${this.#leversById.get(id)!.name} · E to pull`
    if (target === 'lamp') return `${this.#lampsById.get(id)!.name} · E to light`
    if (target === 'sigil') return `Settling stone · E to send blocks home`
    if (target === 'alcove') return `Memory alcove · E to listen`
    if (target === 'artifact') return `${this.definition.artifact!.name} · E to claim`
    if (target === 'resident') return `${this.#residentsById.get(id)!.name} · E to talk`
    return ''
  }

  #shutterTagText(shutter: ChamberShutter): string {
    if (this.latched.has(shutter.id)) return `${shutter.name} · latched`
    if (shutter.plates?.length) return `${shutter.name} · ${shutter.plates.filter(p => this.pressed(p)).length} of ${shutter.plates.length} plates hold stone`
    return `${shutter.name} · pull its lever`
  }

  prompt(): ChamberPrompt {
    if (this.walledIn()) return { kind: 'walled' }
    const portal = this.#nearestPortal()
    if (portal) return { kind: 'feature', id: portal.id, target: portal.kind, text: this.#portalLabel(portal.kind, portal.id), action: 'tag' }
    let nearestShutter: ChamberShutter | null = null, nearestShutterDist = Infinity
    for (const shutter of this.#shuttersById.values()) {
      const dist = centerDist(this.#x, this.#y, shutter)
      if (dist <= TARGET_REACH && dist < nearestShutterDist) { nearestShutter = shutter; nearestShutterDist = dist }
    }
    if (nearestShutter) return { kind: 'feature', id: nearestShutter.id, target: 'shutter', text: this.#shutterTagText(nearestShutter), action: 'tag' }
    const near = this.nearest()
    if (near) return { kind: 'feature', id: near.id, target: near.target, text: this.#actText(near.target, near.id), action: 'act' }
    const sigil = this.stuck()
    if (sigil) return { kind: 'stuck', sigil }
    return { kind: 'idle' }
  }

  /** (2) A3.1 — prompt() of kind 'feature' as a cue; null for walled/stuck/idle. */
  cue(): ChamberCue | null {
    const p = this.prompt()
    if (p.kind !== 'feature') return null
    const cell = this.#cellOf(p.id) ?? { col: Math.floor(this.#x), row: Math.floor(this.#y) }
    return { id: p.id, target: p.target, anchor: cell, words: p.text, action: p.action }
  }

  #cellOf(id: string): ChamberCell | null {
    return this.#exitsById.get(id) ?? this.#entrancesById.get(id)
      ?? (this.definition.risingLight?.id === id ? this.definition.risingLight : null)
      ?? this.#chestsById.get(id) ?? this.#doorsById.get(id) ?? this.#gatesById.get(id) ?? this.#shuttersById.get(id)
      ?? this.#leversById.get(id) ?? this.#lampsById.get(id) ?? this.#sigilsById.get(id) ?? this.#alcovesById.get(id)
      ?? (this.definition.artifact?.id === id ? this.definition.artifact : null) ?? this.#residentsById.get(id) ?? null
  }

  tabletInRange(): string | null {
    for (const tablet of this.definition.tablets) if (centerDist(this.#x, this.#y, tablet) <= TABLET_REACH) return tablet.id
    return null
  }

  #nearestUnreadTablet(): ChamberTablet | null {
    let best: ChamberTablet | null = null, bestDist = Infinity
    for (const tablet of this.definition.tablets) {
      if (this.read.has(tablet.id)) continue
      const dist = centerDist(this.#x, this.#y, tablet)
      if (dist <= TABLET_REACH && dist < bestDist) { best = tablet; bestDist = dist }
    }
    return best
  }

  #readTablet(id: string, events: ChamberEvent[]): void {
    const tablet = this.#tabletsById.get(id)
    if (!tablet) return
    events.push({ kind: 'read', tablet: id })
    if (!this.read.has(id)) {
      this.read.add(id)
      events.push({ kind: 'knowledge', id: tablet.knowledgeId ?? `${this.definition.id}-${id}`, text: tablet.text })
    }
  }

  #fits(x: number, y: number): boolean {
    const r = CHAMBER_RADIUS
    return [x - r, x + r].every(cx => [y - r, y + r].every(cy => this.open(Math.floor(cx), Math.floor(cy))))
  }

  #navigateEventFor(portal: { id: string; kind: 'exit' | 'entrance' | 'rising-light' }): ChamberEvent {
    if (portal.kind === 'exit') return { kind: 'navigate', to: 'up', exit: portal.id }
    if (portal.kind === 'entrance') return { kind: 'navigate', to: 'down', entrance: portal.id }
    return { kind: 'navigate', to: 'surface', light: portal.id }
  }

  #onLampSetChanged(setId: string, events: ChamberEvent[]): void {
    if (this.setComplete(setId)) {
      events.push({ kind: 'completed', set: setId })
      for (const chest of this.#chestsById.values()) if (chest.hiddenUntil === setId) events.push({ kind: 'revealed', feature: chest.id })
      if (this.definition.finale && 'set' in this.definition.finale.when && this.definition.finale.when.set === setId) this.#fireFinale(events)
    } else {
      events.push({ kind: 'guttered', set: setId })
    }
  }

  #fireFinale(events: ChamberEvent[]): void {
    if (this.#finalePlayed) return
    this.#finalePlayed = true
    events.push({ kind: 'finale' })
  }

  #checkLatches(events: ChamberEvent[]): void {
    for (const shutter of this.#shuttersById.values()) {
      if (this.latched.has(shutter.id) || !shutter.plates?.length) continue
      if (shutter.plates.every(p => this.pressed(p))) { this.latched.add(shutter.id); events.push({ kind: 'latched', shutter: shutter.id }) }
    }
  }

  #handlePush(dir: Facing, substepDt: number, events: ChamberEvent[]): void {
    const cur = { col: Math.floor(this.#x), row: Math.floor(this.#y) }
    const target = { col: cur.col + DIR_VECTOR[dir].col, row: cur.row + DIR_VECTOR[dir].row }
    if (!this.#inBounds(target.col, target.row)) { this.#pushKey = null; this.#refusedKey = null; return }
    const blockId = this.blockAt(target.col, target.row)
    const portal = this.#portalAt(target.col, target.row)
    if (!blockId && !portal) { this.#pushKey = null; this.#refusedKey = null; return }
    const fullKey = portal ? `portal:${portal.id}:${dir}` : `block:${blockId}:${dir}`
    if (this.#pushKey !== fullKey) { this.#pushKey = fullKey; this.#pushElapsed = 0; this.#refusedKey = null }
    if (portal) {
      const onLanding = cur.col === portal.landing.col && cur.row === portal.landing.row
      const correctDir = directionBetween(portal.landing, portal.cell) === dir
      const armed = this.#disarmedPortal !== portal.id
      if (!onLanding || !correctDir || !armed) {
        if (this.#refusedKey !== fullKey) { events.push({ kind: 'push-refused', portal: portal.id }); this.#refusedKey = fullKey }
        return
      }
      this.#pushElapsed += substepDt
      if (this.#pushElapsed >= PUSH_DELAY) {
        events.push(this.#navigateEventFor(portal))
        this.#pushKey = null; this.#pushElapsed = 0; this.#refusedKey = null
      }
      return
    }
    this.#pushElapsed += substepDt
    if (this.#pushElapsed >= PUSH_DELAY) {
      const beyond = { col: target.col + DIR_VECTOR[dir].col, row: target.row + DIR_VECTOR[dir].row }
      if (this.canBlockEnter(beyond.col, beyond.row)) {
        this.#blocks.set(blockId!, beyond)
        events.push({ kind: 'pushed', block: blockId!, from: target, to: beyond })
        this.#checkLatches(events)
        this.#pushKey = null; this.#pushElapsed = 0; this.#refusedKey = null
      } else {
        if (this.#refusedKey !== fullKey) { events.push({ kind: 'push-refused', block: blockId! }); this.#refusedKey = fullKey }
        this.#pushElapsed = 0
      }
    }
  }

  #tryMove(ddx: number, ddy: number, diagonal: boolean, substepDt: number, events: ChamberEvent[]): void {
    if (ddx === 0 && ddy === 0) return
    const nx = this.#x + ddx, ny = this.#y + ddy
    if (this.#fits(nx, ny)) { this.#x = nx; this.#y = ny; return }
    if (diagonal) return
    const dir: Facing = ddx > 0 ? 'right' : ddx < 0 ? 'left' : ddy > 0 ? 'down' : 'up'
    this.#handlePush(dir, substepDt, events)
  }

  update(dt: number, input: MoveInput): ChamberEvent[] {
    const events: ChamberEvent[] = []
    if (!Number.isFinite(dt) || dt <= 0) { this.#moving = false; return events }
    if (this.#disarmedPortal && this.#disarmedAt && Math.hypot(this.#x - this.#disarmedAt.x, this.#y - this.#disarmedAt.y) >= REARM_DISTANCE) {
      this.#disarmedPortal = null; this.#disarmedAt = null
    }
    const dtClamped = Math.min(dt, 0.1)
    if (input.left) this.#facing = 'left'
    else if (input.right) this.#facing = 'right'
    else if (input.up) this.#facing = 'up'
    else if (input.down) this.#facing = 'down'
    let dx = Number(input.right) - Number(input.left), dy = Number(input.down) - Number(input.up)
    const len = Math.hypot(dx, dy)
    this.#moving = len > 0
    if (len > 0) {
      const distance = dtClamped * CHAMBER_SPEED
      dx = dx / len * distance; dy = dy / len * distance
      const steps = Math.max(1, Math.ceil(distance / 0.1))
      const substepDt = dtClamped / steps
      const diagonal = input.left !== input.right && input.up !== input.down && (input.left || input.right) && (input.up || input.down)
      for (let s = 0; s < steps; s++) {
        this.#tryMove(dx / steps, 0, diagonal, substepDt, events)
        this.#tryMove(0, dy / steps, diagonal, substepDt, events)
      }
    }
    const tablet = this.#nearestUnreadTablet()
    if (tablet) {
      if (this.#tabletDwell?.id === tablet.id) this.#tabletDwell.elapsed += dtClamped
      else this.#tabletDwell = { id: tablet.id, elapsed: dtClamped }
      if (this.#tabletDwell.elapsed >= TABLET_DWELL) { this.#readTablet(tablet.id, events); this.#tabletDwell = null }
    } else this.#tabletDwell = null
    return events
  }

  turn(facing: Facing): void { this.#facing = facing }

  arrive(exit?: string): void {
    const target = (exit !== undefined ? this.#exitsById.get(exit) : undefined) ?? this.definition.exits[0]
    if (!target) return
    this.#x = target.landing.col + 0.5; this.#y = target.landing.row + 0.5
    this.#facing = target.facing
    this.#disarmedPortal = target.id; this.#disarmedAt = { x: this.#x, y: this.#y }
  }

  land(entrance: string): void {
    const target = this.#entrancesById.get(entrance)
    if (!target) return
    this.#x = target.landing.col + 0.5; this.#y = target.landing.row + 0.5
    this.#facing = directionBetween(target, target.landing) ?? 'down'
    this.#disarmedPortal = target.id; this.#disarmedAt = { x: this.#x, y: this.#y }
  }

  refuse(id: string): void {
    this.#disarmedPortal = id
    this.#disarmedAt = { x: this.#x, y: this.#y }
  }

  explore(reach: number): void {
    const minCol = Math.max(0, Math.floor(this.#x - reach)), maxCol = Math.min(this.#cols - 1, Math.ceil(this.#x + reach))
    const minRow = Math.max(0, Math.floor(this.#y - reach)), maxRow = Math.min(this.#rows - 1, Math.ceil(this.#y + reach))
    for (let row = minRow; row <= maxRow; row++) for (let col = minCol; col <= maxCol; col++) {
      if (Math.hypot(col + 0.5 - this.#x, row + 0.5 - this.#y) <= reach) this.explored[row * this.#cols + col] = 1
    }
  }

  interact(target?: string): ChamberResult {
    if (target === undefined) {
      const near = this.nearest()
      if (!near) return { kind: 'message', text: this.#idleText(), events: [] }
      return this.#interactFeature(near.id, near.target)
    }
    // Tablets are not a ChamberTargetKind (proximity/dwell reads them, never
    // an ordinary E-target), so they must be checked before #kindOf's lookup.
    if (this.#tabletsById.has(target)) return this.#interactTablet(target)
    const kind = this.#kindOf(target)
    if (!kind) return { kind: 'message', text: this.#idleText(), events: [] }
    if (kind === 'exit' || kind === 'entrance' || kind === 'rising-light') return this.#interactPortal(target, kind)
    return this.#interactFeature(target, kind)
  }

  #idleText(): string { return 'Nothing answers here.' }

  #interactTablet(id: string): ChamberResult {
    const tablet = this.#tabletsById.get(id)!
    const dist = centerDist(this.#x, this.#y, tablet)
    if (dist > TABLET_CLICK_REACH) return { kind: 'message', text: `Walk up to ${tablet.title}.`, events: [] }
    const events: ChamberEvent[] = []
    this.#readTablet(id, events)
    this.#tabletDwell = null
    return { kind: 'message', text: tablet.text, events }
  }

  #interactPortal(id: string, kind: 'exit' | 'entrance' | 'rising-light'): ChamberResult {
    if (!this.present(id)) return { kind: 'message', text: this.#idleText(), events: [] }
    const cell = this.#cellOf(id)!
    const dist = centerDist(this.#x, this.#y, cell)
    if (dist > TARGET_REACH) return { kind: 'message', text: `Walk up to ${this.#portalLabel(kind, id)}.`, events: [] }
    const armed = this.#disarmedPortal !== id
    if (!armed) return { kind: 'message', text: this.#idleText(), events: [] }
    const events: ChamberEvent[] = [this.#navigateEventFor({ id, kind })]
    if (kind === 'exit') return { kind: 'navigate', to: 'up', exit: id, events }
    if (kind === 'entrance') return { kind: 'navigate', to: 'down', entrance: id, events }
    return { kind: 'navigate', to: 'surface', events }
  }

  #interactFeature(id: string, kind: ChamberTargetKind): ChamberResult {
    const cell = this.#cellOf(id)
    if (!cell) return { kind: 'message', text: this.#idleText(), events: [] }
    const dist = centerDist(this.#x, this.#y, cell)
    if (dist > TARGET_REACH) return { kind: 'message', text: `Walk up to ${cell ? this.#labelOf(id, kind) : ''}.`, events: [] }
    if (kind === 'chest') return this.#interactChest(id)
    if (kind === 'door') return this.#interactDoor(id)
    if (kind === 'gate') return this.#interactGate(id)
    if (kind === 'lever') return this.#interactLever(id)
    if (kind === 'lamp') return this.#interactLamp(id)
    if (kind === 'sigil') return this.#interactSigil(id)
    if (kind === 'alcove') return this.#interactAlcove(id)
    if (kind === 'artifact') return this.#interactArtifact(id)
    if (kind === 'resident') return { kind: 'speech', resident: id, text: this.talk(id), events: [] }
    return { kind: 'message', text: this.#idleText(), events: [] }
  }

  #labelOf(id: string, kind: ChamberTargetKind): string {
    if (kind === 'chest') return this.#chestsById.get(id)!.name
    if (kind === 'door') return this.#doorsById.get(id)!.name
    if (kind === 'gate') return this.#gatesById.get(id)!.name
    if (kind === 'lever') return this.#leversById.get(id)!.name
    if (kind === 'lamp') return this.#lampsById.get(id)!.name
    if (kind === 'resident') return this.#residentsById.get(id)!.name
    if (kind === 'artifact') return this.definition.artifact?.name ?? ''
    return ''
  }

  #interactChest(id: string): ChamberResult {
    const chest = this.#chestsById.get(id)!
    if (!this.present(id)) return { kind: 'message', text: this.#idleText(), events: [] }
    const events: ChamberEvent[] = []
    const fresh = !this.opened.has(id)
    if (fresh) {
      this.opened.add(id)
      events.push({ kind: 'opened', chest: id, fresh: true })
      for (const grant of chest.grants ?? []) events.push({ kind: 'knowledge', id: grant.id, text: grant.text })
    }
    return { kind: 'dialog', dialog: { kind: 'chest', chest: id, title: chest.name, subtitle: chest.subtitle, items: chest.items, lore: chest.lore, fresh }, events }
  }

  #interactDoor(id: string): ChamberResult {
    const door = this.#doorsById.get(id)!
    if (this.unlocked.has(id)) return { kind: 'message', text: `${door.name} stands open.`, events: [] }
    const canUnlock = door.lock === 'great' ? this.hasGreatKey() : this.keysHeld() > 0
    if (!canUnlock) return { kind: 'message', text: `${door.name} needs ${door.lock === 'great' ? 'the Great Key' : 'a key'}.`, events: [] }
    this.unlocked.add(id)
    return { kind: 'message', text: `${door.name} swings open.`, events: [{ kind: 'unlocked', door: id }] }
  }

  #interactGate(id: string): ChamberResult {
    const gate = this.#gatesById.get(id)!
    if (this.attuned.has(id)) return { kind: 'message', text: 'The runes remember your understanding. This passage stays open.', events: [] }
    if (!this.read.has(gate.tablet)) return { kind: 'message', text: 'These runes answer an inscription. Read the nearby stone before attuning the gate.', events: [] }
    const tablet = this.#tabletsById.get(gate.tablet)!
    return { kind: 'dialog', dialog: { kind: 'gate', gate: id, title: gate.name, question: gate.question, inscription: tablet.text }, events: [] }
  }

  choose(gate: string, rune: string): { opened: boolean; text: string } {
    const def = this.#gatesById.get(gate)
    if (!def || centerDist(this.#x, this.#y, def) > TARGET_REACH || !this.read.has(def.tablet) || this.attuned.has(gate) || !def.options.some(o => o.id === rune)) {
      return { opened: false, text: 'Read the inscription and stand beside its gate to attune the runes.' }
    }
    const progress = [...(this.#runes.get(gate) ?? []), rune]
    if (def.answer[progress.length - 1] !== rune) {
      this.#runes.set(gate, [])
      return { opened: false, text: 'The marks settle again. Consider the inscription and begin a fresh sequence.' }
    }
    this.#runes.set(gate, progress)
    if (progress.length < def.answer.length) return { opened: false, text: `${progress.length} of ${def.answer.length} runes are singing. Choose the next.` }
    this.attuned.add(gate)
    return { opened: true, text: 'The stone opens with a gentle chime. Your understanding stays with the passage.' }
  }

  #interactLever(id: string): ChamberResult {
    const lever = this.#leversById.get(id)!
    if (this.pulled.has(id)) return { kind: 'message', text: `${lever.name} has already been pulled.`, events: [] }
    this.pulled.add(id)
    const events: ChamberEvent[] = [{ kind: 'pulled', lever: id }]
    if (!this.latched.has(lever.shutter)) { this.latched.add(lever.shutter); events.push({ kind: 'latched', shutter: lever.shutter }) }
    return { kind: 'message', text: `${lever.name} grinds down, and something latches home.`, events }
  }

  #interactLamp(id: string): ChamberResult {
    const lamp = this.#lampsById.get(id)!
    if (this.#lit.has(id)) return { kind: 'message', text: `${lamp.name} burns brightly.`, events: [] }
    const events: ChamberEvent[] = []
    const owningSet = this.definition.lampSets.find(s => s.lamps.includes(id) || (s.decoys ?? []).includes(id))
    if (owningSet?.ordered) {
      const progressCount = owningSet.lamps.filter(l => this.#lit.has(l)).length
      const isDecoy = (owningSet.decoys ?? []).includes(id)
      const correctNext = !isDecoy && owningSet.lamps[progressCount] === id
      if (!correctNext) {
        if (progressCount > 0) { for (const l of owningSet.lamps) this.#lit.delete(l); this.#onLampSetChanged(owningSet.id, events) }
        return { kind: 'message', text: `${lamp.name} flares and gutters out.`, events }
      }
    }
    this.#lit.add(id)
    events.push({ kind: 'lit', lamp: id })
    if (owningSet) this.#onLampSetChanged(owningSet.id, events)
    return { kind: 'message', text: `${lamp.name} catches, warm and steady.`, events }
  }

  #interactSigil(id: string): ChamberResult {
    const sigil = this.#sigilsById.get(id)!
    const onHome = sigil.blocks.some(blockId => {
      const home = this.#blocksById.get(blockId)!
      return this.#playerOnCell(home) || this.terrainAt(home.col, home.row) === 'laid'
    })
    if (onHome) return { kind: 'message', text: 'The stones will not return while you stand on their place, or while a rune bears a brick.', events: [] }
    const events: ChamberEvent[] = []
    for (const blockId of sigil.blocks) {
      const home = this.#blocksById.get(blockId)!, from = this.blockCell(blockId)
      if (from.col === home.col && from.row === home.row) continue
      this.#blocks.set(blockId, { col: home.col, row: home.row })
      events.push({ kind: 'pushed', block: blockId, from, to: { col: home.col, row: home.row } })
    }
    events.push({ kind: 'settled', sigil: id })
    this.#checkLatches(events)
    return { kind: 'message', text: 'The stones return to their places.', events }
  }

  #playerOnCell(cell: ChamberCell): boolean { return Math.floor(this.#x) === cell.col && Math.floor(this.#y) === cell.row }

  #interactAlcove(id: string): ChamberResult {
    const alcove = this.#alcovesById.get(id)!
    const open = this.#hooks.has({ kind: 'hexagon' })
    const events: ChamberEvent[] = []
    if (open && !this.memories.has(id)) { this.memories.add(id); events.push({ kind: 'knowledge', id: alcove.memoryId, text: alcove.text }) }
    return { kind: 'dialog', dialog: { kind: 'alcove', alcove: id, title: 'Memory alcove', text: open ? alcove.text : alcove.locked }, events }
  }

  #interactArtifact(id: string): ChamberResult {
    const artifact = this.definition.artifact!
    const events: ChamberEvent[] = []
    const fresh = !this.#claimed
    if (fresh) {
      this.#claimed = true
      events.push({ kind: 'claimed', artifact: id, fresh: true }, { kind: 'knowledge', id: artifact.knowledgeId, text: artifact.lore })
      if (this.definition.risingLight) events.push({ kind: 'revealed', feature: this.definition.risingLight.id })
    }
    return { kind: 'dialog', dialog: { kind: 'artifact', artifact: id, title: artifact.name, lore: artifact.lore, fresh }, events }
  }

  talk(resident: string): string {
    const npc = this.#residentsById.get(resident)
    if (!npc) return ''
    this.#talkTurn += 1
    if (npc.linesWith && this.#hooks.knows(npc.linesWith.knowledge)) return npc.linesWith.lines[this.#talkTurn % npc.linesWith.lines.length]
    return npc.lines[this.#talkTurn % npc.lines.length]
  }

  cast(): ChamberResult {
    const facedCol = Math.floor(this.#x) + DIR_VECTOR[this.#facing].col
    const facedRow = Math.floor(this.#y) + DIR_VECTOR[this.#facing].row
    if (!this.#inBounds(facedCol, facedRow)) return { kind: 'message', text: WAND_REFUSALS.nothing, events: [] }
    if (this.blockAt(facedCol, facedRow) !== null) return { kind: 'message', text: WAND_REFUSALS.block, events: [] }
    const built = this.#builtTerrainAt(facedCol, facedRow)
    if (!WAND_CELLS.has(built)) return { kind: 'message', text: WAND_REFUSALS.nothing, events: [] }
    const key = cellKey(facedCol, facedRow)
    const toggled = this.#wand.has(key)
    const closing = toggled // reverting an opened cell is a "closing" transition
    const r = CHAMBER_RADIUS
    const overlaps = this.#x + r > facedCol && this.#x - r < facedCol + 1 && this.#y + r > facedRow && this.#y - r < facedRow + 1
    if (closing && overlaps) return { kind: 'message', text: WAND_REFUSALS.standing, events: [] }
    if (built === 'rune' && closing && this.sealOpen()) {
      const overlapsSeal = this.#sealCells.some(cell => this.#x + r > cell.col && this.#x - r < cell.col + 1 && this.#y + r > cell.row && this.#y - r < cell.row + 1)
        || this.#sealBarrierCells().some(cell => this.#playerOnCell(cell))
      if (overlapsSeal) return { kind: 'message', text: WAND_REFUSALS.seal, events: [] }
    }
    const wasOpen = this.sealOpen()
    if (toggled) this.#wand.delete(key); else this.#wand.add(key)
    const newTerrain = this.terrainAt(facedCol, facedRow)
    const events: ChamberEvent[] = [{ kind: 'wand', col: facedCol, row: facedRow, terrain: newTerrain }]
    if (built === 'rune') {
      const isOpen = this.sealOpen()
      if (wasOpen !== isOpen) {
        events.push({ kind: 'seal', open: isOpen })
        if (isOpen && this.definition.finale && 'seal' in this.definition.finale.when) this.#fireFinale(events)
      }
    }
    const text = WAND_WORDS[newTerrain] ?? (built === 'rune' ? (this.sealOpen() ? WAND_SEAL_WORDS.open : WAND_SEAL_WORDS.closed) : '')
    return { kind: 'message', text, events }
  }

  #sealBarrierCells(): ChamberCell[] {
    const cells: ChamberCell[] = []
    for (let row = 0; row < this.#rows; row++) for (let col = 0; col < this.#cols; col++) if (this.definition.map[row][col] === 'S') cells.push({ col, row })
    return cells
  }

  seed(): PlaceSeed {
    const rgb = new Uint8ClampedArray(this.#cols * this.#rows * 3)
    for (let row = 0; row < this.#rows; row++) for (let col = 0; col < this.#cols; col++) {
      const index = (row * this.#cols + col) * 3
      const [r, g, b] = this.#seedColor(col, row)
      rgb[index] = r; rgb[index + 1] = g; rgb[index + 2] = b
    }
    return { cols: this.#cols, rows: this.#rows, rgb }
  }

  #seedColor(col: number, row: number): readonly [number, number, number] {
    const terrain = this.terrainAt(col, row)
    const base: Readonly<Record<ChamberTerrain, readonly [number, number, number]>> = {
      rock: [46, 40, 36], floor: [92, 78, 60], threshold: [102, 88, 68], water: [40, 70, 92],
      brick: [70, 62, 54], furniture: [80, 60, 44], crack: [60, 52, 44], rubble: [110, 96, 74],
      rune: [70, 60, 96], laid: [140, 118, 60], spring: [50, 90, 110], stone: [120, 118, 110],
      seal: [50, 44, 60], 'seal-open': [150, 140, 120],
    }
    let [r, g, b] = base[terrain]
    const feature = this.built.featureAt(col, row)
    if (feature) {
      const kind = this.#kindOf(feature)
      const active = (kind === 'chest' && this.opened.has(feature)) || (kind === 'door' && this.unlocked.has(feature))
        || (kind === 'gate' && this.attuned.has(feature)) || (kind === 'shutter' && this.latched.has(feature))
        || (kind === 'lever' && this.pulled.has(feature)) || (kind === 'lamp' && this.#lit.has(feature))
        || (kind === 'alcove' && this.memories.has(feature)) || (kind === 'artifact' && this.#claimed)
      r = Math.min(255, r + 30); g = Math.min(255, g + (active ? 60 : 10)); b = Math.min(255, b + 10)
    }
    if (this.blockAt(col, row) !== null) { r = Math.min(255, r + 40); g = Math.min(255, g + 40); b = Math.min(255, b + 40) }
    if (this.#playerOnCell({ col, row })) { r = 230; g = 210; b = 120 }
    return [r, g, b]
  }

  exportState(): ChamberSnapshot {
    return {
      version: 1, place: this.definition.id,
      player: { x: this.#x, y: this.#y, facing: this.#facing },
      read: [...this.read].sort(), attuned: [...this.attuned].sort(),
      runes: [...this.#runes].filter(([, seq]) => seq.length > 0).sort(([a], [b]) => a.localeCompare(b)).map(([gate, seq]) => [gate, [...seq]]),
      opened: [...this.opened].sort(), unlocked: [...this.unlocked].sort(), latched: [...this.latched].sort(),
      pulled: [...this.pulled].sort(), lit: [...this.#lit],
      wand: [...this.#wand].sort(),
      blocks: [...this.#blocks].sort(([a], [b]) => a.localeCompare(b)).map(([id, cell]) => [id, cell.col, cell.row]),
      memories: [...this.memories].sort(), claimed: this.#claimed,
      explored: Array.from(this.explored).map(v => v ? '1' : '0').join(''),
    }
  }

  /** 15-step order: (1) header/reset, (2) read, (3) gate runes/attuned, (4) chest
   *  opened, (5) door unlocked (forged unlocks refused via derived keysHeld/
   *  hasGreatKey), (6) shutter latched, (7) lever pulled (+implied latch),
   *  (8) lamp lit (ordered-set longest-valid-prefix, unordered any-subset),
   *  (9) wand, (10) blocks (settle position, invalid landing spots rejected
   *  individually), (11) memories (hexagon-gated), (12) claimed, (13) explored,
   *  (14) player position (falls back to a portal's landing if now-solid),
   *  (15) facing. */
  restoreState(raw: unknown): void {
    this.read.clear(); this.attuned.clear(); this.opened.clear(); this.unlocked.clear(); this.latched.clear()
    this.pulled.clear(); this.memories.clear(); this.#lit.clear(); this.#runes.clear(); this.#wand.clear()
    this.explored.fill(0); this.#claimed = false; this.#finalePlayed = false
    this.#blocks = new Map(this.definition.blocks.map(b => [b.id, { col: b.col, row: b.row }]))
    this.arrive()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    const saved = raw as Record<string, unknown>
    if (saved['version'] !== 1 || saved['place'] !== this.definition.id) return
    const strings = (field: string): string[] => Array.isArray(saved[field]) ? (saved[field] as unknown[]).filter((v): v is string => typeof v === 'string') : []

    // (2) read
    for (const id of strings('read')) if (this.#tabletsById.has(id)) this.read.add(id)
    // (3) gate runes / attuned — a gate whose tablet was never read (per the
    // read set just restored in step 2) can hold no progress at all; this is
    // what stops a forged save from claiming an attunement never earned.
    const runeEntries = Array.isArray(saved['runes']) ? saved['runes'] as unknown[] : []
    for (const entry of runeEntries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) continue
      const gate = this.#gatesById.get(entry[0])
      if (!gate || !this.read.has(gate.tablet)) continue
      const sequence = (entry[1] as unknown[]).filter((v): v is string => typeof v === 'string')
      let prefix: string[] = []
      for (let i = 0; i < sequence.length && i < gate.answer.length; i++) { if (sequence[i] !== gate.answer[i]) break; prefix.push(sequence[i]) }
      if (prefix.length > 0) this.#runes.set(gate.id, prefix)
      if (prefix.length === gate.answer.length) this.attuned.add(gate.id)
    }
    // (4) chest opened
    for (const id of strings('opened')) if (this.#chestsById.has(id)) this.opened.add(id)
    // (5) door unlocked, forged claims rejected via derived keysHeld/hasGreatKey
    for (const id of strings('unlocked')) {
      const door = this.#doorsById.get(id)
      if (!door || this.unlocked.has(id)) continue
      const eligible = door.lock === 'great' ? this.hasGreatKey() : this.keysHeld() > 0
      if (eligible) this.unlocked.add(id)
    }
    // (6) shutter latched
    for (const id of strings('latched')) if (this.#shuttersById.has(id)) this.latched.add(id)
    // (7) lever pulled (+implied latch)
    for (const id of strings('pulled')) {
      const lever = this.#leversById.get(id)
      if (!lever) continue
      this.pulled.add(id)
      this.latched.add(lever.shutter)
    }
    // (8) lamp lit
    const rawLit = new Set(strings('lit'))
    for (const lampSet of this.definition.lampSets) {
      if (lampSet.ordered) {
        for (const lampId of lampSet.lamps) { if (!rawLit.has(lampId)) break; this.#lit.add(lampId) }
      } else {
        for (const lampId of lampSet.lamps) if (rawLit.has(lampId)) this.#lit.add(lampId)
      }
    }
    // A hidden chest can only be validly opened once its lamp set is complete
    // (now that lit has been restored above) — reject the claim otherwise,
    // exactly like a forged unlock, rather than trusting an opened flag whose
    // precondition the save never actually satisfied.
    for (const id of [...this.opened]) { const chest = this.#chestsById.get(id); if (chest?.hiddenUntil && !this.present(id)) this.opened.delete(id) }
    // (9) wand
    for (const key of strings('wand')) {
      const match = /^(\d+),(\d+)$/.exec(key)
      if (!match) continue
      const col = Number(match[1]), row = Number(match[2])
      if (!this.#inBounds(col, row)) continue
      if (WAND_CELLS.has(this.#builtTerrainAt(col, row))) this.#wand.add(key)
    }
    // (10) blocks
    const blockEntries = Array.isArray(saved['blocks']) ? saved['blocks'] as unknown[] : []
    for (const entry of blockEntries) {
      if (!Array.isArray(entry) || entry.length !== 3 || typeof entry[0] !== 'string' || typeof entry[1] !== 'number' || typeof entry[2] !== 'number') continue
      const [id, col, row] = entry as [string, number, number]
      if (!this.#blocksById.has(id) || !Number.isInteger(col) || !Number.isInteger(row)) continue
      if (this.canBlockEnter(col, row) || this.#staticHome(id, col, row)) this.#blocks.set(id, { col, row })
    }
    // (11) memories, hexagon-gated
    const open = this.#hooks.has({ kind: 'hexagon' })
    if (open) for (const id of strings('memories')) if (this.#alcovesById.has(id)) this.memories.add(id)
    // (12) claimed
    this.#claimed = saved['claimed'] === true
    // (13) explored
    const explored = saved['explored']
    if (typeof explored === 'string' && explored.length === this.explored.length && /^[01]*$/.test(explored)) {
      for (let i = 0; i < explored.length; i++) this.explored[i] = explored[i] === '1' ? 1 : 0
    }
    // finale already-resolved flag, derived silently (no event on restore)
    if (this.definition.finale) {
      const holds = 'seal' in this.definition.finale.when ? this.sealOpen() : this.setComplete(this.definition.finale.when.set)
      this.#finalePlayed = holds
    }
    // (14)/(15) player position + facing
    const player = saved['player']
    if (player && typeof player === 'object' && !Array.isArray(player)) {
      const p = player as Record<string, unknown>
      const facingValues: Facing[] = ['up', 'down', 'left', 'right']
      if (typeof p['x'] === 'number' && typeof p['y'] === 'number' && Number.isFinite(p['x']) && Number.isFinite(p['y'])) {
        const col = Math.floor(p['x']), row = Math.floor(p['y'])
        const portal = this.#portalAt(col, row)
        if (portal) { this.#x = portal.landing.col + 0.5; this.#y = portal.landing.row + 0.5 }
        else if (this.#fits(p['x'], p['y'])) { this.#x = p['x']; this.#y = p['y'] }
      }
      if (typeof p['facing'] === 'string' && facingValues.includes(p['facing'] as Facing)) this.#facing = p['facing'] as Facing
    }
  }

  #staticHome(blockId: string, col: number, row: number): boolean {
    const def = this.#blocksById.get(blockId)
    return !!def && def.col === col && def.row === row
  }
}
