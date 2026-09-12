/** The story table: the one reshuffle surface (`STORY`), and the one set of
 *  reveal/progress boards (`STORY_BOARDS`) every attainment in `attainments.ts`
 *  flies into. Pure content; the only imports are types. A `StoryBoard`'s
 *  `slots` are DATA, not code — moving a piece from one board to another, or
 *  changing what fills a slot, never touches a renderer. */

import type { StorySeat } from './place.js'
import type { StoryWhen } from './story-when.js'
import type { TreasureKind } from './island-treasure.js'

export const ROOT_PLACE = 'island'

/** The only reshuffle surface. Rows are relations ("place P sits in entrance
 *  E"), grouped by the part (the entrance), never by the parent. */
export const STORY: readonly StorySeat[] = [
  { entrance: 'island/dawn-shrine',        place: 'labyrinth', arrive: 'sunseed' },
  { entrance: 'island/tide-shrine',        place: 'labyrinth', arrive: 'tideglass' },
  { entrance: 'island/pyramid-shrine',     place: 'labyrinth', arrive: 'starbloom' },
  { entrance: 'island/wayfarer-cavern',    place: 'wet-steps' },
  { entrance: 'wet-steps/stairs-down',     place: 'cistern' },
  { entrance: 'cistern/stairs-down',       place: 'spring-heart' },
  { entrance: 'island/highland-cavern',    place: 'hall-of-hours' },
  { entrance: 'hall-of-hours/stairs-down', place: 'six-roads' },
  { entrance: 'six-roads/stairs-down',     place: 'accord-sanctum' },
  { entrance: 'island/chandler-door',      place: 'chandler-house' },
  { entrance: 'chandler-house/trapdoor',   place: 'chandler-cellar' },
  { entrance: 'island/valley-grove',       place: 'hollow-grove' },
]

export type StorySlotLook = TreasureKind | 'triangle' | 'hexagon' | 'star' | 'socket' | 'place' | 'task' | 'plot' | 'memory'

export interface StorySlot {
  readonly id: string
  readonly name: string
  readonly look: StorySlotLook
  readonly fills: StoryWhen
  /** absent = always shown */
  readonly shows?: StoryWhen
  readonly hint?: string | { readonly text: string; readonly when: StoryWhen }
  /** the attainment id whose reveal flies into this slot */
  readonly attainment?: string
}

export interface StoryBoard {
  readonly id: string
  readonly title: string
  readonly kind: 'relics' | 'items' | 'knowledge' | 'places' | 'tasks' | 'contributions'
  readonly shows?: StoryWhen
  readonly slots: readonly StorySlot[]
}

// Sigil pieces: the six triangle points, the hexagon and the star, each
// filled the instant `journey.has(...)` holds (a `piece:` attainment, §
// attainments.ts). One board; a shrine's own socket state is tracked
// separately by RpgOverworld (`filledSockets`), never mirrored here.
const RELIC_SLOTS: readonly StorySlot[] = [
  { id: 'triangle:0', name: 'Dawn triangle', look: 'triangle', fills: { has: { kind: 'triangle', point: 0 } }, attainment: 'piece:triangle:0' },
  { id: 'triangle:1', name: 'Tide triangle', look: 'triangle', fills: { has: { kind: 'triangle', point: 1 } }, attainment: 'piece:triangle:1' },
  { id: 'triangle:2', name: 'Root triangle', look: 'triangle', fills: { has: { kind: 'triangle', point: 2 } }, attainment: 'piece:triangle:2' },
  { id: 'triangle:3', name: 'Ember triangle', look: 'triangle', fills: { has: { kind: 'triangle', point: 3 } }, attainment: 'piece:triangle:3' },
  { id: 'triangle:4', name: 'Wind triangle', look: 'triangle', fills: { has: { kind: 'triangle', point: 4 } }, attainment: 'piece:triangle:4' },
  { id: 'triangle:5', name: 'Dusk triangle', look: 'triangle', fills: { has: { kind: 'triangle', point: 5 } }, attainment: 'piece:triangle:5' },
  { id: 'hexagon', name: 'Heart hexagon', look: 'hexagon', fills: { has: { kind: 'hexagon' } }, attainment: 'piece:hexagon' },
  { id: 'star', name: 'Star of David', look: 'star', fills: { has: { kind: 'star' } }, attainment: 'piece:star' },
]

// Treasures: the two cavern crystals, the four grants a chest reads into the
// journal (map/lodestone × two caverns, one keepsake), the island's three
// caches, and the grove's one note-and-feather chest.
const ITEM_SLOTS: readonly StorySlot[] = [
  { id: 'spring-crystal', name: 'Spring crystal', look: 'gem', fills: { knows: 'wayfarer-spring' }, attainment: 'item:spring-crystal',
    hint: { text: 'Light the braziers bloom, sun, then rain, in the Spring Heart.', when: { done: 'spring-heart/tablet:way-home' } } },
  { id: 'accord-crystal', name: 'Accord crystal', look: 'gem', fills: { knows: 'highland-accord' }, attainment: 'item:accord-crystal',
    hint: { text: 'The seal beneath the sanctum opens on six casts, not a key.', when: { done: 'accord-sanctum/tablet:six-plates' } } },
  { id: 'map-wayfarer-cavern', name: 'Map of Wayfarer Cavern', look: 'map', fills: { knows: 'map:wayfarer-cavern' }, attainment: 'item:map-wayfarer-cavern' },
  { id: 'map-highland-cavern', name: 'Climber’s map', look: 'map', fills: { knows: 'map:highland-cavern' }, attainment: 'item:map-highland-cavern' },
  { id: 'lodestone-wayfarer-cavern', name: 'Lodestone', look: 'lodestone', fills: { knows: 'lodestone:wayfarer-cavern' }, attainment: 'item:lodestone-wayfarer-cavern' },
  { id: 'lodestone-highland-cavern', name: 'Lodestone', look: 'lodestone', fills: { knows: 'lodestone:highland-cavern' }, attainment: 'item:lodestone-highland-cavern' },
  { id: 'keepsake-lantern', name: 'Wenna’s lantern', look: 'lantern', fills: { knows: 'keepsake:lantern' }, attainment: 'item:keepsake-lantern' },
  { id: 'court-cache', name: 'Brickwright’s coffer', look: 'coins', fills: { done: 'island/cache:court-cache' }, attainment: 'item:court-cache' },
  { id: 'pond-cache', name: 'Stone-Ferry chest', look: 'feather', fills: { done: 'island/cache:pond-cache' }, attainment: 'item:pond-cache' },
  { id: 'nook-cache', name: 'Hidden nook', look: 'gem', fills: { done: 'island/cache:nook-cache' }, attainment: 'item:nook-cache' },
  { id: 'hollow-grove-pool-chest', name: 'Gatherer’s list', look: 'note', fills: { done: 'hollow-grove/chest:pool-chest' }, attainment: 'item:hollow-grove-pool-chest' },
]

const KNOWLEDGE_SLOTS: readonly StorySlot[] = [
  { id: 'wet-steps-drip-line', name: 'The Drip-Line', look: 'memory', fills: { knows: 'wet-steps-drip-line' }, attainment: 'know:wet-steps-drip-line' },
  { id: 'wayfarer-cavern-cycle', name: 'Gate of the Garden', look: 'memory', fills: { knows: 'wayfarer-cavern-cycle' }, attainment: 'know:wayfarer-cavern-cycle' },
  { id: 'wayfarer-cavern-meaning', name: 'Gate of Returning Water', look: 'memory', fills: { knows: 'wayfarer-cavern-meaning' }, attainment: 'know:wayfarer-cavern-meaning' },
  { id: 'highland-cavern-cycle', name: 'The Stair Lamps', look: 'memory', fills: { knows: 'highland-cavern-cycle' }, attainment: 'know:highland-cavern-cycle' },
  { id: 'highland-cavern-meaning', name: 'The Six Roads', look: 'memory', fills: { knows: 'highland-cavern-meaning' }, attainment: 'know:highland-cavern-meaning' },
  { id: 'hollow-grove-bark-marks', name: 'Bark Marks', look: 'memory', fills: { knows: 'hollow-grove-bark-marks' }, attainment: 'know:hollow-grove-bark-marks' },
]

const PLACE_SLOTS: readonly StorySlot[] = [
  { id: 'wet-steps', name: 'The Wet Steps', look: 'place', fills: { done: 'wet-steps' }, attainment: 'place:wet-steps' },
  { id: 'cistern', name: 'The Cistern', look: 'place', fills: { done: 'cistern' }, attainment: 'place:cistern' },
  { id: 'spring-heart', name: 'The Spring Heart', look: 'place', fills: { done: 'spring-heart' }, attainment: 'place:spring-heart' },
  { id: 'hall-of-hours', name: 'The Hall of Hours', look: 'place', fills: { done: 'hall-of-hours' }, attainment: 'place:hall-of-hours' },
  { id: 'six-roads', name: 'The Six Roads', look: 'place', fills: { done: 'six-roads' }, attainment: 'place:six-roads' },
  { id: 'accord-sanctum', name: 'The Accord Sanctum', look: 'place', fills: { done: 'accord-sanctum' }, attainment: 'place:accord-sanctum' },
  { id: 'chandler-house', name: 'Wenna’s House', look: 'place', fills: { done: 'chandler-house' }, attainment: 'place:chandler-house' },
  { id: 'chandler-cellar', name: 'Wenna’s Cellar', look: 'place', fills: { done: 'chandler-cellar' }, attainment: 'place:chandler-cellar' },
  { id: 'hollow-grove', name: 'The Hollow Grove', look: 'place', fills: { done: 'hollow-grove' }, attainment: 'place:hollow-grove' },
  { id: 'labyrinth', name: 'A labyrinth', look: 'place', fills: { done: 'labyrinth' }, attainment: 'place:labyrinth' },
  { id: 'grove-plot', name: 'Old Grove Plot', look: 'plot', fills: { done: 'island/found:grove-plot' }, attainment: 'plot:grove-plot' },
  { id: 'lakeside-plot', name: 'Lakeside Plot', look: 'plot', fills: { done: 'island/found:lakeside-plot' }, attainment: 'plot:lakeside-plot' },
  { id: 'cliff-plot', name: 'Cliffside Plot', look: 'plot', fills: { done: 'island/found:cliff-plot' }, attainment: 'plot:cliff-plot' },
  { id: 'tidewater-plot', name: 'Tidewater Plot', look: 'plot', fills: { done: 'island/found:tidewater-plot' }, attainment: 'plot:tidewater-plot' },
  { id: 'wet-steps-hall', name: 'Iron-bound door', look: 'place', fills: { done: 'wet-steps/door:hall-door' }, attainment: 'way:wet-steps-hall' },
  { id: 'cistern-shortcut', name: 'Cistern shutter', look: 'place', fills: { done: 'cistern/shutter:shortcut-shutter' }, attainment: 'way:cistern-shortcut' },
  { id: 'six-roads-east', name: 'The east door', look: 'place', fills: { done: 'six-roads/door:east-door' }, attainment: 'way:six-roads-east' },
  { id: 'sanctum-vault', name: 'The Sun Vault', look: 'place', fills: { done: 'accord-sanctum/shutter:sun-shutter' }, attainment: 'way:sanctum-vault' },
]

const TASK_SLOTS: readonly StorySlot[] = [
  { id: 'wet-steps-cycle', name: 'Gate of the Garden', look: 'task', fills: { done: 'wet-steps/gate:cycle' }, attainment: 'task:wet-steps-cycle' },
  { id: 'cistern-meaning', name: 'Gate of Returning Water', look: 'task', fills: { done: 'cistern/gate:meaning' }, attainment: 'task:cistern-meaning' },
  { id: 'hall-of-hours-cycle', name: 'The Hour Gate', look: 'task', fills: { done: 'hall-of-hours/gate:cycle' }, attainment: 'task:hall-of-hours-cycle' },
  { id: 'six-roads-meaning', name: 'The Center Gate', look: 'task', fills: { done: 'six-roads/gate:meaning' }, attainment: 'task:six-roads-meaning' },
]

const CONTRIBUTION_SLOTS: readonly StorySlot[] = [
  { id: 'mira', name: 'Mira', look: 'task', fills: { done: 'island/person:mira' }, attainment: 'contribution:mira' },
  { id: 'oren', name: 'Oren', look: 'task', fills: { done: 'island/person:oren' }, attainment: 'contribution:oren' },
  { id: 'sela', name: 'Sela', look: 'task', fills: { done: 'island/person:sela' }, attainment: 'contribution:sela' },
]

export const STORY_BOARDS: readonly StoryBoard[] = [
  { id: 'relics', title: 'Sigils', kind: 'relics', slots: RELIC_SLOTS },
  { id: 'items', title: 'Treasures', kind: 'items', slots: ITEM_SLOTS },
  { id: 'knowledge', title: 'Knowledge', kind: 'knowledge', slots: KNOWLEDGE_SLOTS },
  { id: 'places', title: 'Places', kind: 'places', slots: PLACE_SLOTS },
  { id: 'tasks', title: 'Tasks', kind: 'tasks', slots: TASK_SLOTS },
  { id: 'contributions', title: 'People', kind: 'contributions', slots: CONTRIBUTION_SLOTS },
]
