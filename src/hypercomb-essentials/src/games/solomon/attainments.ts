/** The ONE reveal/progress/use registry. Every permanent thing a traveller
 *  can hold — a sigil piece, a treasure, a fact, a place, a solved gate, a
 *  conversation, a boon, and (folded in here rather than built twice) the
 *  labyrinth's own stance/weapons/spells — is one row of `ATTAINMENTS`,
 *  keyed by a `kind`-prefixed id (`piece:`, `item:`, `know:`, `place:`,
 *  `way:`, `plot:`, `task:`, `contribution:`, `ability:`, `skill:`). The
 *  `when` a row asks of `StoryFacts` names its OWN underlying fact — never
 *  the prefixed attainment id — so `piece:hexagon` and `ability:hear-
 *  memories` can share one `when` while remaining two distinct rows: one
 *  card for the pickup, one for the narrative boon it happens to unlock.
 *  Pure: no DOM, no storage. */

import { storyHolds, type StoryFacts, type StoryWhen } from './story-when.js'
import { STORY_BOARDS, type StoryBoard } from './story.js'
import type { TreasureKind } from './island-treasure.js'
import type { PlaceSprite } from './island-places.js'
import type { CombatSkillId, SpellKind, WeaponKind } from './engine.js'

export type AttainmentKind = 'item' | 'piece' | 'knowledge' | 'place' | 'task' | 'contribution' | 'ability' | 'weapon' | 'spell'
export type AttainmentArt =
  | { readonly kind: 'item'; readonly item: TreasureKind }
  | { readonly kind: 'piece'; readonly piece: 'triangle' | 'hexagon' | 'star'; readonly point?: number }
  | { readonly kind: 'place'; readonly sprite: PlaceSprite }
  | { readonly kind: 'glyph'; readonly glyph: string }
  | { readonly kind: 'skill'; readonly skill: CombatSkillId }
export type AttainmentUse = 'read' | 'map' | 'lodestone' | 'place' | 'lantern' | 'crystal' | 'weapon' | 'spell'
export interface AttainmentSlot { readonly board: string; readonly slot: string }
export interface AttainmentDef {
  readonly id: string
  readonly kind: AttainmentKind
  readonly title: string
  readonly words: string
  readonly art: AttainmentArt
  readonly when: StoryWhen
  readonly slot?: AttainmentSlot
  readonly use?: AttainmentUse
  readonly group?: string
}

// ---------------------------------------------------------------------------
// Sigil pieces — the six triangle points, the hexagon and the star. `use:
// 'place'` — the ItemsTable's "Place" button fills a shrine socket standing
// at it; away from a shrine the row shows words-only (useVerb → null).
// ---------------------------------------------------------------------------
const PIECES: readonly AttainmentDef[] = [
  { id: 'piece:triangle:0', kind: 'piece', title: 'Dawn triangle', words: 'The first point answers the sun.', art: { kind: 'piece', piece: 'triangle', point: 0 }, when: { has: { kind: 'triangle', point: 0 } }, slot: { board: 'relics', slot: 'triangle:0' }, use: 'place' },
  { id: 'piece:triangle:1', kind: 'piece', title: 'Tide triangle', words: 'A door marked with this point reveals another part of the same labyrinth.', art: { kind: 'piece', piece: 'triangle', point: 1 }, when: { has: { kind: 'triangle', point: 1 } }, slot: { board: 'relics', slot: 'triangle:1' }, use: 'place' },
  { id: 'piece:triangle:2', kind: 'piece', title: 'Root triangle', words: 'Returning is part of discovery. A room already seen may hold a passage a later piece opens.', art: { kind: 'piece', piece: 'triangle', point: 2 }, when: { has: { kind: 'triangle', point: 2 } }, slot: { board: 'relics', slot: 'triangle:2' }, use: 'place' },
  { id: 'piece:triangle:3', kind: 'piece', title: 'Ember triangle', words: 'Its glow records what is known, even after its image is placed in a shrine.', art: { kind: 'piece', piece: 'triangle', point: 3 }, when: { has: { kind: 'triangle', point: 3 } }, slot: { board: 'relics', slot: 'triangle:3' }, use: 'place' },
  { id: 'piece:triangle:4', kind: 'piece', title: 'Wind triangle', words: 'Look across a room before changing its blocks; the way onward may be above.', art: { kind: 'piece', piece: 'triangle', point: 4 }, when: { has: { kind: 'triangle', point: 4 } }, slot: { board: 'relics', slot: 'triangle:4' }, use: 'place' },
  { id: 'piece:triangle:5', kind: 'piece', title: 'Dusk triangle', words: 'The last outer point. The six still need the central hexagon before the star is complete.', art: { kind: 'piece', piece: 'triangle', point: 5 }, when: { has: { kind: 'triangle', point: 5 } }, slot: { board: 'relics', slot: 'triangle:5' }, use: 'place' },
  { id: 'piece:hexagon', kind: 'piece', title: 'Heart hexagon', words: 'The hollow heart, waiting at the center of six points.', art: { kind: 'piece', piece: 'hexagon' }, when: { has: { kind: 'hexagon' } }, slot: { board: 'relics', slot: 'hexagon' }, use: 'place' },
  { id: 'piece:star', kind: 'piece', title: 'Star of David', words: 'Six triangles and their hexagon, complete. Its knowledge opens the Pyramid.', art: { kind: 'piece', piece: 'star' }, when: { has: { kind: 'star' } }, slot: { board: 'relics', slot: 'star' }, use: 'place' },
]

// ---------------------------------------------------------------------------
// Treasures — the cavern crystals, the grant a chest reads straight into the
// journal (map/lodestone/keepsake), and the loose caches.
// ---------------------------------------------------------------------------
const ITEMS: readonly AttainmentDef[] = [
  { id: 'item:spring-crystal', kind: 'item', title: 'Spring crystal', words: 'Held since the Wayfarer’s spring first ran. Its glow points toward Sunseed Porch.', art: { kind: 'place', sprite: 'crystal' }, when: { knows: 'wayfarer-spring' }, slot: { board: 'items', slot: 'spring-crystal' }, use: 'crystal', group: 'wayfarer-cavern' },
  { id: 'item:accord-crystal', kind: 'item', title: 'Accord crystal', words: 'Present in the sanctum since before memory. Its glow points toward Tideglass Porch.', art: { kind: 'place', sprite: 'crystal' }, when: { knows: 'highland-accord' }, slot: { board: 'items', slot: 'accord-crystal' }, use: 'crystal', group: 'highland-cavern' },
  { id: 'item:map-wayfarer-cavern', kind: 'item', title: 'Map of Wayfarer Cavern', words: 'A surveyor’s sketch of every hall below the wet steps.', art: { kind: 'item', item: 'map' }, when: { knows: 'map:wayfarer-cavern' }, slot: { board: 'items', slot: 'map-wayfarer-cavern' }, use: 'map', group: 'wayfarer-cavern' },
  { id: 'item:map-highland-cavern', kind: 'item', title: 'Climber’s map', words: 'A climber’s sketch of the Highland Cavern’s roads and roofs.', art: { kind: 'item', item: 'map' }, when: { knows: 'map:highland-cavern' }, slot: { board: 'items', slot: 'map-highland-cavern' }, use: 'map', group: 'highland-cavern' },
  { id: 'item:lodestone-wayfarer-cavern', kind: 'item', title: 'Lodestone', words: 'Held loose, it leans toward whatever the Wayfarer’s keeper still hides.', art: { kind: 'item', item: 'lodestone' }, when: { knows: 'lodestone:wayfarer-cavern' }, slot: { board: 'items', slot: 'lodestone-wayfarer-cavern' }, use: 'lodestone', group: 'wayfarer-cavern' },
  { id: 'item:lodestone-highland-cavern', kind: 'item', title: 'Lodestone', words: 'Held loose, it leans toward whatever the Highland roads still hide.', art: { kind: 'item', item: 'lodestone' }, when: { knows: 'lodestone:highland-cavern' }, slot: { board: 'items', slot: 'lodestone-highland-cavern' }, use: 'lodestone', group: 'highland-cavern' },
  { id: 'item:keepsake-lantern', kind: 'item', title: 'Wenna’s lantern', words: 'Widens the reach of every torch, everywhere dark.', art: { kind: 'item', item: 'lantern' }, when: { knows: 'keepsake:lantern' }, slot: { board: 'items', slot: 'keepsake-lantern' }, use: 'lantern', group: 'chandlery' },
  { id: 'item:court-cache', kind: 'item', title: 'Brickwright’s coffer', words: 'A note, old garden coins, and an amber brick-gem, behind the court’s own seal.', art: { kind: 'item', item: 'coins' }, when: { done: 'island/cache:court-cache' }, slot: { board: 'items', slot: 'court-cache' }, use: 'read' },
  { id: 'item:pond-cache', kind: 'item', title: 'Stone-Ferry chest', words: 'A ferryman’s note and a heron feather, on the islet in the rune pond.', art: { kind: 'item', item: 'feather' }, when: { done: 'island/cache:pond-cache' }, slot: { board: 'items', slot: 'pond-cache' }, use: 'read' },
  { id: 'item:nook-cache', kind: 'item', title: 'Hidden nook', words: 'A builder’s scrap and a violet rune-gem, behind a cracked brick.', art: { kind: 'item', item: 'gem' }, when: { done: 'island/cache:nook-cache' }, slot: { board: 'items', slot: 'nook-cache' }, use: 'read' },
  { id: 'item:hollow-grove-pool-chest', kind: 'item', title: 'Gatherer’s list', words: 'A feather tucked in a gatherer’s list of what the grove offers, by season.', art: { kind: 'item', item: 'note' }, when: { done: 'hollow-grove/chest:pool-chest' }, slot: { board: 'items', slot: 'hollow-grove-pool-chest' }, use: 'read' },
]

// ---------------------------------------------------------------------------
// Knowledge — the tablets and inscriptions worth carrying into the journal
// on their own, distinct from a chest's own grant (which is an item above).
// ---------------------------------------------------------------------------
const KNOWLEDGE: readonly AttainmentDef[] = [
  { id: 'know:wet-steps-drip-line', kind: 'knowledge', title: 'The Drip-Line', words: 'Water finds the same crack twice. Follow where it has already been.', art: { kind: 'glyph', glyph: '≈' }, when: { knows: 'wet-steps-drip-line' }, slot: { board: 'knowledge', slot: 'wet-steps-drip-line' }, use: 'read', group: 'wayfarer-cavern' },
  { id: 'know:wayfarer-cavern-cycle', kind: 'knowledge', title: 'Gate of the Garden', words: 'First the rain wakes the seed. Then the sun warms its leaves. Last the bloom greets the traveller.', art: { kind: 'glyph', glyph: '✿' }, when: { knows: 'wayfarer-cavern-cycle' }, slot: { board: 'knowledge', slot: 'wayfarer-cavern-cycle' }, use: 'read', group: 'wayfarer-cavern' },
  { id: 'know:wayfarer-cavern-meaning', kind: 'knowledge', title: 'Gate of Returning Water', words: 'The stream bends home. Its end greets its beginning, without a corner or a break.', art: { kind: 'glyph', glyph: '○' }, when: { knows: 'wayfarer-cavern-meaning' }, slot: { board: 'knowledge', slot: 'wayfarer-cavern-meaning' }, use: 'read', group: 'wayfarer-cavern' },
  { id: 'know:highland-cavern-cycle', kind: 'knowledge', title: 'The Stair Lamps', words: 'Dawn opens the eye. Noon fills it with light. Dusk lets it rest.', art: { kind: 'glyph', glyph: '☀' }, when: { knows: 'highland-cavern-cycle' }, slot: { board: 'knowledge', slot: 'highland-cavern-cycle' }, use: 'read', group: 'highland-cavern' },
  { id: 'know:highland-cavern-meaning', kind: 'knowledge', title: 'The Six Roads', words: 'Six roads surround the courtyard. Each meets its neighbour; each returns to one center.', art: { kind: 'glyph', glyph: '⬡' }, when: { knows: 'highland-cavern-meaning' }, slot: { board: 'knowledge', slot: 'highland-cavern-meaning' }, use: 'read', group: 'highland-cavern' },
  { id: 'know:hollow-grove-bark-marks', kind: 'knowledge', title: 'Bark Marks', words: 'Marks cut into bark outlast the seasons: a spring, a stone, a chest, remembered in wood.', art: { kind: 'glyph', glyph: '♣' }, when: { knows: 'hollow-grove-bark-marks' }, slot: { board: 'knowledge', slot: 'hollow-grove-bark-marks' }, use: 'read' },
]

// ---------------------------------------------------------------------------
// Places, ways and plots — everywhere a traveller has stood, a shortcut now
// open, and an empty plot found but not yet built on. One board, one kind:
// `place`; the id prefix (`place:`/`way:`/`plot:`) is naming only.
// ---------------------------------------------------------------------------
const PLACES_ROWS: readonly AttainmentDef[] = [
  { id: 'place:wet-steps', kind: 'place', title: 'The Wet Steps', words: 'A dripping hall under the hill.', art: { kind: 'place', sprite: 'cavern' }, when: { done: 'wet-steps' }, slot: { board: 'places', slot: 'wet-steps' }, group: 'wayfarer-cavern' },
  { id: 'place:cistern', kind: 'place', title: 'The Cistern', words: 'Still water and a keeper’s court.', art: { kind: 'place', sprite: 'cavern' }, when: { done: 'cistern' }, slot: { board: 'places', slot: 'cistern' }, group: 'wayfarer-cavern' },
  { id: 'place:spring-heart', kind: 'place', title: 'The Spring Heart', words: 'Where the spring begins.', art: { kind: 'place', sprite: 'cavern' }, when: { done: 'spring-heart' }, slot: { board: 'places', slot: 'spring-heart' }, group: 'wayfarer-cavern' },
  { id: 'place:hall-of-hours', kind: 'place', title: 'The Hall of Hours', words: 'A sundial kept by fire.', art: { kind: 'place', sprite: 'cavern' }, when: { done: 'hall-of-hours' }, slot: { board: 'places', slot: 'hall-of-hours' }, group: 'highland-cavern' },
  { id: 'place:six-roads', kind: 'place', title: 'The Six Roads', words: 'Six roads around one courtyard.', art: { kind: 'place', sprite: 'cavern' }, when: { done: 'six-roads' }, slot: { board: 'places', slot: 'six-roads' }, group: 'highland-cavern' },
  { id: 'place:accord-sanctum', kind: 'place', title: 'The Accord Sanctum', words: 'Six plates around one center.', art: { kind: 'place', sprite: 'cavern' }, when: { done: 'accord-sanctum' }, slot: { board: 'places', slot: 'accord-sanctum' }, group: 'highland-cavern' },
  { id: 'place:chandler-house', kind: 'place', title: 'Wenna’s House', words: 'A chandler’s house by the harbour.', art: { kind: 'place', sprite: 'cavern' }, when: { done: 'chandler-house' }, slot: { board: 'places', slot: 'chandler-house' }, group: 'chandlery' },
  { id: 'place:chandler-cellar', kind: 'place', title: 'Wenna’s Cellar', words: 'Barrels, a wine rack, and a cold draught.', art: { kind: 'place', sprite: 'cavern' }, when: { done: 'chandler-cellar' }, slot: { board: 'places', slot: 'chandler-cellar' }, group: 'chandlery' },
  { id: 'place:hollow-grove', kind: 'place', title: 'The Hollow Grove', words: 'Where the valley’s trees close over.', art: { kind: 'place', sprite: 'grove' }, when: { done: 'hollow-grove' }, slot: { board: 'places', slot: 'hollow-grove' } },
  { id: 'place:labyrinth', kind: 'place', title: 'A labyrinth', words: 'Sealed rooms below a shrine, first stepped into.', art: { kind: 'place', sprite: 'shrine' }, when: { done: 'labyrinth' }, slot: { board: 'places', slot: 'labyrinth' } },
  { id: 'plot:grove-plot', kind: 'place', title: 'Old Grove Plot', words: 'Roots have grown over six foundation stones laid in a ring.', art: { kind: 'place', sprite: 'plot' }, when: { done: 'island/found:grove-plot' }, slot: { board: 'places', slot: 'grove-plot' } },
  { id: 'plot:lakeside-plot', kind: 'place', title: 'Lakeside Plot', words: 'A flat terrace over Mirror Lake, its corner stones already set.', art: { kind: 'place', sprite: 'plot' }, when: { done: 'island/found:lakeside-plot' }, slot: { board: 'places', slot: 'lakeside-plot' } },
  { id: 'plot:cliff-plot', kind: 'place', title: 'Cliffside Plot', words: 'A wind-scoured shelf beyond the Spine, a doorway cut into bare rock.', art: { kind: 'place', sprite: 'plot' }, when: { done: 'island/found:cliff-plot' }, slot: { board: 'places', slot: 'cliff-plot' } },
  { id: 'plot:tidewater-plot', kind: 'place', title: 'Tidewater Plot', words: 'Salt-white stones mark a floor just above the tide line.', art: { kind: 'place', sprite: 'plot' }, when: { done: 'island/found:tidewater-plot' }, slot: { board: 'places', slot: 'tidewater-plot' } },
  { id: 'way:wet-steps-hall', kind: 'place', title: 'Iron-bound door', words: 'The hall door stands unlocked now, both ways.', art: { kind: 'place', sprite: 'rune-door-open' }, when: { done: 'wet-steps/door:hall-door' }, slot: { board: 'places', slot: 'wet-steps-hall' }, group: 'wayfarer-cavern' },
  { id: 'way:cistern-shortcut', kind: 'place', title: 'Cistern shutter', words: 'A rusted lever, pulled once, holds the shutter back for good.', art: { kind: 'place', sprite: 'rune-door-open' }, when: { done: 'cistern/shutter:shortcut-shutter' }, slot: { board: 'places', slot: 'cistern-shortcut' }, group: 'wayfarer-cavern' },
  { id: 'way:six-roads-east', kind: 'place', title: 'The east door', words: 'The east door of the courtyard stands open now.', art: { kind: 'place', sprite: 'rune-door-open' }, when: { done: 'six-roads/door:east-door' }, slot: { board: 'places', slot: 'six-roads-east' }, group: 'highland-cavern' },
  { id: 'way:sanctum-vault', kind: 'place', title: 'The Sun Vault', words: 'Both plates hold stone. The shutter over the vault has latched open.', art: { kind: 'place', sprite: 'rune-door-open' }, when: { done: 'accord-sanctum/shutter:sun-shutter' }, slot: { board: 'places', slot: 'sanctum-vault' }, group: 'highland-cavern' },
]

// ---------------------------------------------------------------------------
// Tasks — the rune gates, attuned.
// ---------------------------------------------------------------------------
const TASKS: readonly AttainmentDef[] = [
  { id: 'task:wet-steps-cycle', kind: 'task', title: 'Gate of the Garden', words: 'Rain, sun, bloom — touched in the order the inscription teaches.', art: { kind: 'glyph', glyph: '✓' }, when: { done: 'wet-steps/gate:cycle' }, slot: { board: 'tasks', slot: 'wet-steps-cycle' }, use: 'read', group: 'wayfarer-cavern' },
  { id: 'task:cistern-meaning', kind: 'task', title: 'Gate of Returning Water', words: 'The circle, chosen: a mark with no corner or break.', art: { kind: 'glyph', glyph: '✓' }, when: { done: 'cistern/gate:meaning' }, slot: { board: 'tasks', slot: 'cistern-meaning' }, use: 'read', group: 'wayfarer-cavern' },
  { id: 'task:hall-of-hours-cycle', kind: 'task', title: 'The Hour Gate', words: 'Dawn, noon, dusk — one whole day, given to the gate.', art: { kind: 'glyph', glyph: '✓' }, when: { done: 'hall-of-hours/gate:cycle' }, slot: { board: 'tasks', slot: 'hall-of-hours-cycle' }, use: 'read', group: 'highland-cavern' },
  { id: 'task:six-roads-meaning', kind: 'task', title: 'The Center Gate', words: 'The hexagon, chosen: six roads, one center.', art: { kind: 'glyph', glyph: '✓' }, when: { done: 'six-roads/gate:meaning' }, slot: { board: 'tasks', slot: 'six-roads-meaning' }, use: 'read', group: 'highland-cavern' },
]

// ---------------------------------------------------------------------------
// Contributions — island conversations, solved.
// ---------------------------------------------------------------------------
const CONTRIBUTIONS: readonly AttainmentDef[] = [
  { id: 'contribution:mira', kind: 'contribution', title: 'Mira', words: 'Keeper of beginnings. East, toward the sunrise.', art: { kind: 'glyph', glyph: '♥' }, when: { done: 'island/person:mira' }, slot: { board: 'contributions', slot: 'mira' }, use: 'read' },
  { id: 'contribution:oren', kind: 'contribution', title: 'Oren', words: 'Cartographer of depths. A piece can open a matching object in a room already known.', art: { kind: 'glyph', glyph: '♥' }, when: { done: 'island/person:oren' }, slot: { board: 'contributions', slot: 'oren' }, use: 'read' },
  { id: 'contribution:sela', kind: 'contribution', title: 'Sela', words: 'Reader of the stars. A central hexagon completes the outline.', art: { kind: 'glyph', glyph: '♥' }, when: { done: 'island/person:sela' }, slot: { board: 'contributions', slot: 'sela' }, use: 'read' },
]

// ---------------------------------------------------------------------------
// Abilities — permanent, un-equippable boons. No slot: none of `STORY_BOARDS`
// has a shape for one; they surface only in the ItemsTable's Knowledge /
// Abilities rows.
// ---------------------------------------------------------------------------
const ABILITIES: readonly AttainmentDef[] = [
  { id: 'ability:hear-memories', kind: 'ability', title: 'Hear Memories', words: 'With the hexagon held, an alcove’s memory is yours to hear whenever it is found.', art: { kind: 'glyph', glyph: '♫' }, when: { has: { kind: 'hexagon' } } },
  { id: 'ability:star-passages', kind: 'ability', title: 'Star Passages', words: 'With the star complete, every star-marked passage opens on sight.', art: { kind: 'glyph', glyph: '✦' }, when: { has: { kind: 'star' } } },
  { id: 'ability:lantern-reach', kind: 'ability', title: 'Lantern Reach', words: 'Wenna’s lantern widens every torch’s reach, everywhere dark.', art: { kind: 'glyph', glyph: '☼' }, when: { knows: 'keepsake:lantern' } },
]

// ---------------------------------------------------------------------------
// The stance, two weapons, three spells — folded into this one registry
// rather than a second, parallel system. No slot: none of `STORY_BOARDS`
// has a shape for a weapon/spell/stance; they surface only in the
// ItemsTable's Items section, under its own "Weapons & Spells" group.
// ---------------------------------------------------------------------------
const SKILLS: readonly AttainmentDef[] = [
  { id: 'skill:stand', kind: 'ability', title: 'The Stand', words: 'Meet what’s coming. Time bends around what threatens you; you keep your feet.', art: { kind: 'skill', skill: 'stand' }, when: { done: 'labyrinth/skill:stand' } },
  { id: 'skill:ward', kind: 'spell', title: 'Ward of Solomon', words: 'Cast, and for a moment any touch that would hurt you staggers the thing that gave it instead. A shot caught this way becomes one of your own.', art: { kind: 'skill', skill: 'ward' }, when: { done: 'labyrinth/skill:ward' }, use: 'spell' },
  { id: 'skill:sickle', kind: 'weapon', title: 'Sickle of the Sun', words: 'A gold crescent, swift in close. Every hit that doesn’t finish a foe staggers it instead.', art: { kind: 'skill', skill: 'sickle' }, when: { done: 'labyrinth/skill:sickle' }, use: 'weapon' },
  { id: 'skill:ember', kind: 'spell', title: 'Ember Sigil', words: 'An ink circle at your feet, then flame two tiles wide. Costs sand to cast.', art: { kind: 'skill', skill: 'ember' }, when: { done: 'labyrinth/skill:ember' }, use: 'spell' },
  { id: 'skill:sling', kind: 'weapon', title: 'Tideglass Sling', words: 'A teal disc, thrown and caught. It fetches an item it crosses on the way.', art: { kind: 'skill', skill: 'sling' }, when: { done: 'labyrinth/skill:sling' }, use: 'weapon' },
  { id: 'skill:hold', kind: 'spell', title: 'Hourglass Hold', words: 'Stops the room cold for a few seconds — and whoever you are facing, longer. Costs sand to cast.', art: { kind: 'skill', skill: 'hold' }, when: { done: 'labyrinth/skill:hold' }, use: 'spell' },
]

export const ATTAINMENTS: readonly AttainmentDef[] = [
  ...PIECES, ...ITEMS, ...KNOWLEDGE, ...PLACES_ROWS, ...TASKS, ...CONTRIBUTIONS, ...ABILITIES, ...SKILLS,
]

export function attainmentById(id: string): AttainmentDef | null {
  return ATTAINMENTS.find(def => def.id === id) ?? null
}

export function heldAttainments(facts: StoryFacts): readonly AttainmentDef[] {
  return ATTAINMENTS.filter(def => storyHolds(def.when, facts))
}

export function attainmentsOf(kind: AttainmentKind, facts: StoryFacts): readonly AttainmentDef[] {
  return ATTAINMENTS.filter(def => def.kind === kind && storyHolds(def.when, facts))
}

export interface UseContext {
  readonly place: string
  readonly group: string | null
  readonly shrine: string | null
  readonly needle: string | null
  /** Read straight off the labyrinth journey when the top place is the
   *  labyrinth (§4.10); absent everywhere else. Only `useVerb`'s weapon/
   *  spell branch reads these, to decide "Equip" vs. "Equipped". */
  readonly weapon?: WeaponKind | null
  readonly spell?: SpellKind | null
}
export type UseResult =
  | { readonly kind: 'read'; readonly title: string; readonly text: string }
  | { readonly kind: 'map'; readonly group: string }
  | { readonly kind: 'needle'; readonly text: string }
  | { readonly kind: 'shrine'; readonly shrine: string }
  | { readonly kind: 'words'; readonly text: string }
  | { readonly kind: 'equip'; readonly id: CombatSkillId }
  | { readonly kind: 'none' }

export function useAttainment(id: string, facts: StoryFacts, context: UseContext): UseResult {
  const def = attainmentById(id)
  if (!def || !storyHolds(def.when, facts)) return { kind: 'none' }

  if (def.kind === 'weapon' || def.kind === 'spell') {
    return { kind: 'equip', id: (def.art as { kind: 'skill'; skill: CombatSkillId }).skill }
  }
  if (def.use === 'place') {
    if (context.shrine) return { kind: 'shrine', shrine: context.shrine }
    return { kind: 'words', text: `Bring the ${def.title} to a shrine that still needs it.` }
  }
  if (def.use === 'map') return { kind: 'map', group: def.group ?? context.group ?? '' }
  if (def.use === 'lodestone') return { kind: 'needle', text: context.needle ?? def.words }
  if (def.use === 'lantern' || def.use === 'crystal' || def.use === 'read') return { kind: 'read', title: def.title, text: def.words }
  return { kind: 'none' }
}

export function useVerb(def: AttainmentDef, context: UseContext): string | null {
  if (def.kind === 'weapon' || def.kind === 'spell') {
    const skill = (def.art as { kind: 'skill'; skill: CombatSkillId }).skill
    const equipped = def.kind === 'weapon' ? context.weapon : context.spell
    return equipped === skill ? null : 'Equip'
  }
  if (def.use === 'place') return context.shrine ? 'Place' : null
  if (def.use === 'map') return 'View map'
  if (def.use === 'lodestone') return 'Point the way'
  if (def.use === 'lantern' || def.use === 'crystal' || def.use === 'read') return 'Read'
  return null
}

// re-exported from here, not duplicated:
export interface ItemsBoardView {
  readonly id: string
  readonly title: string
  readonly kind: StoryBoard['kind']
  readonly slots: readonly { readonly id: string; readonly name: string; readonly look: string; readonly shown: boolean; readonly filled: boolean; readonly hint: string | null; readonly attainment: string | null }[]
  readonly filled: number
  readonly shown: number
}

export function itemsBoards(facts: StoryFacts, boards: readonly StoryBoard[] = STORY_BOARDS): readonly ItemsBoardView[] {
  const views: ItemsBoardView[] = []
  for (const board of boards) {
    if (board.shows !== undefined && !storyHolds(board.shows, facts)) continue
    let filled = 0, shown = 0
    const slots = board.slots.map(slot => {
      const isShown = slot.shows === undefined || storyHolds(slot.shows, facts)
      const isFilled = storyHolds(slot.fills, facts)
      if (isShown) shown++
      if (isFilled) filled++
      const hint = typeof slot.hint === 'string' ? slot.hint
        : slot.hint && (slot.hint.when === undefined || storyHolds(slot.hint.when, facts)) ? slot.hint.text
        : null
      return { id: slot.id, name: slot.name, look: slot.look, shown: isShown, filled: isFilled, hint, attainment: slot.attainment ?? null }
    })
    views.push({ id: board.id, title: board.title, kind: board.kind, slots, filled, shown })
  }
  return views
}

export function itemsProgress(boards: readonly ItemsBoardView[]): { readonly filled: number; readonly shown: number } {
  return boards.reduce((total, board) => ({ filled: total.filled + board.filled, shown: total.shown + board.shown }), { filled: 0, shown: 0 })
}
