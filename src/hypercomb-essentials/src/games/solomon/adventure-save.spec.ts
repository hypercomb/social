// Phase 0 (saves role) — final-spec.md §2.1's "adventure-save.spec.ts (fixture
// section only)" row, §2.2's Phase-0 dependency note, and §7.7's fixture list.
//
// This file captures REAL v1/v2 overlay-save and dungeon-v1 payloads exactly
// as TODAY's running code produces or reads them, as literal JS objects —
// ground truth for the v3 migration work `adventure-save.ts` will add in
// Phase 2. No production code lives here yet: `adventure-save.ts` does not
// exist until Phase 2, and this file adds no `describe`/`it` block that
// exercises it. The `describe` block below only proves the fixtures
// themselves have the shape today's real code reads/writes, by re-deriving
// what a fresh construction of the same real classes produces right now —
// so a drift in the classes this merge depends on shows up here first.
//
// Provenance, file and line refs as read on 2026-09-12 (pre-merge):
//
// - OVERLAY_V1 mirrors `labyrinth-overlay.ts` `#restoreSlot`'s `version === 1`
//   branch (today ~lines 564-570): the only fields it ever reads off a v1
//   slot are `progress`, `sockets`, `met`, `solved`, `knowledge` — there is
//   no `world`, no `player`, no `wand`. Nothing in today's code still WRITES
//   this shape (`#snapshot()` always writes version 2), so this literal is
//   built by hand from those exact field names, using real sub-values
//   (`journey.exportProgress()`'s real output; real relic/shrine/person ids
//   read from `rpg-overworld.ts`'s `WORLD_PEOPLE`/`WORLD_SHRINES` tables;
//   `RELIC_LORE['triangle:0']`'s real title/text) rather than invented ones.
//
// - OVERLAY_V2_FRESH / OVERLAY_V2_DEVELOPED mirror `#snapshot()` itself
//   (today ~lines 527-533): `{ version: 2, journey, world, knowledge,
//   dungeons, location }`, where `journey` is exactly `LabyrinthJourney
//   .exportState()`'s real return value, `world` is exactly `RpgOverworld
//   .exportState()`'s real return value, and `dungeons` is exactly
//   `[...this.#dungeons].map(([index, view]) => [index, view.exportState()])`
//   — captured for real index 0 (Wayfarer Cavern) and index 2 (Highland
//   Cavern), the only two indices `#restoreSlot` ever restores (its dungeons
//   loop only accepts `pair[0] === 0 || pair[0] === 2`).
//
//   Both were produced by actually running the real, unmodified classes
//   through real public methods (never by hand-typing engine internals):
//   - FRESH: `new LabyrinthJourney()` untouched; `new RpgOverworld(hooks)`
//     untouched.
//   - DEVELOPED: a `LabyrinthJourney` that entered `sunseed`, collected
//     `sunseed-point-1`, and travelled through the `deeper` door into
//     `sunseed-steps` (the same route `labyrinth.spec.ts`'s own
//     `start()`/`collect()`/`travel()` helpers walk); an `RpgOverworld` that
//     answered Mira correctly (`answer('mira', 1)`), filled the Dawn
//     Shrine's one socket (`fillSocket('dawn-shrine', 0)`), and opened the
//     Brick Garden's cache (`interact('court-cache')`).
//   `location` is not produced by either class — it is the overlay's own
//   `{ mode, dungeon }` pair (today ~line 531); DEVELOPED's `mode: 'room'`
//   matches a journey mid-labyrinth exactly as `#restoreSlot` expects
//   (today ~lines 610-618).
//
// - DUNGEON_V1_WAYFARER / DUNGEON_V1_HIGHLAND are real `ScrollDungeonModel
//   .exportState()` output (`scroll-dungeon.ts`, `DungeonSnapshot`, today
//   ~lines 123-131): WAYFARER read the first gate's clue and chose one
//   correct rune (partial progress, `complete: false`); HIGHLAND (built
//   with `has: () => true`, so its center-memory discovery holds the real,
//   non-forged prose) read and solved both gates in full, then read the
//   alcove and the artifact (`complete: true`) — the same route
//   `scroll-dungeon.snapshot.spec.ts`'s own `read()`/`completed()` helpers
//   walk. These are the real per-dungeon halves `migrateDungeonV1` (Phase 2)
//   will read out of an overlay v2's `dungeons` array.

import { describe, expect, it } from 'vitest'
import {
  ADVENTURE_BOUNDS, migrateDungeonV1, readAdventureSave, writeAdventureSave,
  type AdventureRestorePlan, type CarriedEntry,
} from './adventure-save.js'
import type { StorySeat } from './place.js'

/** A real `LabyrinthJourney.exportState()` on a brand-new journey — nothing
 *  entered, nothing collected. */
const JOURNEY_V1_FRESH = {
  version: 1,
  roomIds: [],
  activeRoomId: null,
  rooms: [],
  progress: { version: 1, relicIds: [], score: 0, fairyCount: 0 },
  visited: [],
  lastRooms: [],
  arrivalDoorId: null,
  stats: { score: 0, lives: 3, fairyCount: 0, sealCount: 0, pageTime: false, pageSpace: false, ammo: [], ammoCap: 3 },
} as const

/** A real `LabyrinthJourney.exportState()` after entering Sunseed, collecting
 *  its porch relic, and stepping through the `deeper` door into the steps
 *  room (which holds the pinned playthrough's own goblin). */
const JOURNEY_V1_MID_LABYRINTH = {
  version: 1,
  roomIds: ['sunseed-porch', 'sunseed-steps'],
  activeRoomId: 'sunseed-steps',
  rooms: [
    {
      id: 'sunseed-porch',
      topologyKey: '["sunseed-porch","sunseed",0,[["deeper",14,10,"sunseed-steps","return",["triangle",1,null]],["loop",1,10,"sunseed-heart","home",["hexagon"]]],[["sunseed-point-1",5,8,"triangle",1]],[[10,9,["triangle",1,null]],[10,10,["triangle",1,null]]]]',
      state: {
        version: 1,
        definitionKey: '530:10df08e',
        terrain: [[154, 1, 0], [170, 1, 0]],
        runtime: {
          player: { x: 452.8, y: 320, w: 22.4, h: 32, vx: 0, vy: 0 },
          facing: 1, onGround: false, ducking: false, doorOpen: true,
          ammo: [], ammoCap: 3, fairyCount: 0, sealCount: 0, zodiacHeld: false, wingsHeld: false,
          pageTime: false, pageSpace: false, life: 18000, lives: 3, score: 2000, state: 'playing', coyote: 0,
          enemies: [], fairies: [], fireballs: [], shots: [],
          items: [{ taken: false, hidden: false, reveal: 0 }, { taken: false, hidden: false, reveal: 0 }, { taken: false, hidden: true, reveal: 0 }],
          mirrors: [],
        },
        collectedSeals: [], groundRow: 10, fireCooldown: 0,
      },
    },
    {
      id: 'sunseed-steps',
      topologyKey: '["sunseed-steps","sunseed",1,[["deeper",14,10,"sunseed-loft","return",null],["fold",7,4,"sunseed-heart","fold",["triangle",2,null]],["return",1,10,"sunseed-porch","deeper",["triangle",1,null]]],[["sunseed-point-2",8,6,"triangle",2]],[]]',
      state: {
        version: 1,
        definitionKey: '475:79b8b3b0',
        terrain: [],
        runtime: {
          player: { x: 68.8, y: 320, w: 22.4, h: 32, vx: 0, vy: 0 },
          facing: 1, onGround: true, ducking: false, doorOpen: true,
          ammo: [], ammoCap: 3, fairyCount: 0, sealCount: 0, zodiacHeld: false, wingsHeld: false,
          pageTime: false, pageSpace: false, life: 18000, lives: 3, score: 2000, state: 'playing', coyote: 0,
          enemies: [{
            kind: 'goblin', dir: -1, alive: true, squash: 0, anim: 0, x: 388.48, y: 325.12, w: 23.04, h: 26.88,
            vx: 0, vy: 0, fireCd: 1.2, smashCd: 0, ttl: 0, airY: null, state: 'patrol', stateT: 0,
            telegraph: 0, lockX: 0, lockY: 0, homeY: 325.12, bounces: 0,
          }],
          fairies: [], fireballs: [], shots: [],
          items: [{ taken: false, hidden: false, reveal: 0 }],
          mirrors: [],
        },
        collectedSeals: [], groundRow: 10, fireCooldown: 0,
      },
    },
  ],
  progress: { version: 1, relicIds: ['elder-first-point', 'sunseed-point-1'], score: 2000, fairyCount: 0 },
  visited: ['sunseed-porch', 'sunseed-steps'],
  lastRooms: [['sunseed', 'sunseed-steps']],
  arrivalDoorId: 'return',
  stats: { score: 2000, lives: 3, fairyCount: 0, sealCount: 0, pageTime: false, pageSpace: false, ammo: [], ammoCap: 3 },
} as const

/** A real `RpgOverworld.exportState()` on a brand-new world. */
const WORLD_V2_FRESH = {
  version: 2,
  player: { x: 56, y: 122, facing: 'down' },
  met: [], solved: [], journal: [], filledSockets: [], wand: [], opened: [],
} as const

/** A real `RpgOverworld.exportState()` after answering Mira correctly,
 *  filling the Dawn Shrine's one socket, and opening the Brick Garden's
 *  Brickwright's Coffer. */
const WORLD_V2_DEVELOPED = {
  version: 2,
  player: { x: 85.5, y: 111.5, facing: 'down' },
  met: ['mira'],
  solved: ['mira'],
  journal: ['cache:court-cache', 'person:mira', 'triangle:0'],
  filledSockets: ['dawn-shrine:0'],
  wand: [],
  opened: ['court-cache'],
} as const

/** A real `ScrollDungeonModel.exportState()` (index 0, Wayfarer Cavern):
 *  read the "cycle" gate's clue, then chose its first (correct) rune. */
const DUNGEON_V1_WAYFARER = {
  version: 1,
  dungeonId: 'wayfarer-cavern',
  player: { x: 13.5, y: 6.5 },
  readClues: ['cycle'],
  openGates: [],
  progress: [['cycle', ['rain']]],
  discovered: [['wayfarer-cavern-cycle', 'First the rain wakes the seed. Then the sun warms its leaves. Last the bloom greets the traveller. Let the garden grow.']],
  complete: false,
} as const

/** A real `ScrollDungeonModel.exportState()` (index 2, Highland Cavern,
 *  built with every sigil owned): both gates solved in full, the alcove and
 *  the artifact both read. */
const DUNGEON_V1_HIGHLAND = {
  version: 1,
  dungeonId: 'highland-cavern',
  player: { x: 42.5, y: 6.5 },
  readClues: ['cycle', 'meaning'],
  openGates: ['cycle', 'meaning'],
  progress: [['cycle', ['dawn', 'noon', 'dusk']], ['meaning', ['hexagon']]],
  discovered: [
    ['highland-accord', 'Above Tideglass Porch’s highest left shelf, a memory waits in the empty square over the shelf’s left end. Make a stone there, then break that same stone: the hidden treasure will appear.'],
    ['highland-cavern-center-memory', 'The center is a meeting place, never a payment. Carry it through every doorway; its light belongs to you.'],
    ['highland-cavern-cycle', 'Dawn opens the eye. Noon fills it with light. Dusk lets it rest. Give the gate one whole day.'],
    ['highland-cavern-meaning', 'Six roads surround the courtyard. Each face meets its neighbour; each road returns to one center. Which shape holds them together?'],
  ],
  complete: true,
} as const

/** A legacy overlay v1 slot — the shape `#restoreSlot`'s `version === 1`
 *  branch reads today. Nothing in the running code still writes this shape;
 *  it survives only as a read path this merge's v3 migration must keep
 *  honouring. `progress` is `JOURNEY_V1_FRESH`'s progress with one real
 *  relic granted (`mira-dawn-triangle`, Mira's real reward id), matching a
 *  `sockets`/`met`/`solved` state that actually agrees with it: the Dawn
 *  Shrine's one socket filled, Mira met and solved. */
const OVERLAY_V1 = {
  version: 1,
  progress: { version: 1, relicIds: ['mira-dawn-triangle'], score: 1000, fairyCount: 0 },
  sockets: ['dawn-shrine:0'],
  met: ['mira'],
  solved: ['mira'],
  knowledge: [['triangle:0', 'The first point answers the sun. Set it into the Dawn shrine; Sunseed’s amber shelves hide two more points. Seek the central hexagon beyond the turning loft.']],
} as const

/** A real overlay v2 slot on a brand-new adventure — today's `#snapshot()`
 *  shape, `{ version, journey, world, knowledge, dungeons, location }`,
 *  every sub-value the real, untouched classes' own export. */
const OVERLAY_V2_FRESH = {
  version: 2,
  journey: JOURNEY_V1_FRESH,
  world: WORLD_V2_FRESH,
  knowledge: [],
  dungeons: [],
  location: { mode: 'world', dungeon: null },
} as const

/** A real overlay v2 slot mid-adventure: Dana stands inside a labyrinth room
 *  (`sunseed-steps`), has met and solved Mira and opened the Brick Garden's
 *  cache on the island, and has partial/complete progress in both scrolling
 *  caverns. `knowledge` mixes both real sources `#recordRelic`/`onKnowledge`
 *  ever write from: a room-relic's own lore, and a cavern gate's inscription
 *  text, plus a cavern's completion lore under its `dungeon-<index>` key. */
const OVERLAY_V2_DEVELOPED = {
  version: 2,
  journey: JOURNEY_V1_MID_LABYRINTH,
  world: WORLD_V2_DEVELOPED,
  knowledge: [
    ['sunseed-point-1', 'The amber shelves lead to another point above the steps.'],
    ['wayfarer-cavern-cycle', 'First the rain wakes the seed. Then the sun warms its leaves. Last the bloom greets the traveller. Let the garden grow.'],
    ['dungeon-2', 'Above Tideglass Porch’s highest left shelf, a memory waits in the empty square over the shelf’s left end. Make a stone there, then break that same stone: the hidden treasure will appear.'],
  ],
  dungeons: [[0, DUNGEON_V1_WAYFARER], [2, DUNGEON_V1_HIGHLAND]],
  location: { mode: 'room', dungeon: null },
} as const

describe('adventure-save fixtures (Phase 0 — captured from real running code, ground truth for Phase 2)', () => {
  it('OVERLAY_V1 matches the shape #restoreSlot\'s version-1 branch actually reads', () => {
    expect(OVERLAY_V1.version).toBe(1)
    expect(OVERLAY_V1).not.toHaveProperty('world')
    expect(OVERLAY_V1).not.toHaveProperty('player')
    for (const key of ['progress', 'sockets', 'met', 'solved', 'knowledge']) expect(OVERLAY_V1).toHaveProperty(key)
  })

  it('OVERLAY_V2_FRESH and OVERLAY_V2_DEVELOPED match today\'s real #snapshot() shape', () => {
    for (const overlay of [OVERLAY_V2_FRESH, OVERLAY_V2_DEVELOPED]) {
      expect(overlay.version).toBe(2)
      for (const key of ['journey', 'world', 'knowledge', 'dungeons', 'location']) expect(overlay).toHaveProperty(key)
      expect((overlay.journey as { version: number }).version).toBe(1)
      expect((overlay.world as { version: number }).version).toBe(2)
    }
  })

  it('the two DUNGEON_V1 fixtures are the only two indices an overlay v2 ever restores (0 and 2)', () => {
    expect(OVERLAY_V2_DEVELOPED.dungeons.map(([index]) => index)).toEqual([0, 2])
    expect(DUNGEON_V1_WAYFARER.dungeonId).toBe('wayfarer-cavern')
    expect(DUNGEON_V1_HIGHLAND.dungeonId).toBe('highland-cavern')
    expect(DUNGEON_V1_WAYFARER.complete).toBe(false)
    expect(DUNGEON_V1_HIGHLAND.complete).toBe(true)
  })

  it('every knowledge/discovered pair is a two-string tuple, matching AdventureRestorePlan\'s CarriedEntry-free knowledge contract', () => {
    for (const pair of [...OVERLAY_V1.knowledge, ...OVERLAY_V2_DEVELOPED.knowledge, ...DUNGEON_V1_WAYFARER.discovered, ...DUNGEON_V1_HIGHLAND.discovered]) {
      expect(pair).toHaveLength(2)
      expect(typeof pair[0]).toBe('string')
      expect(typeof pair[1]).toBe('string')
    }
  })
})

// -----------------------------------------------------------------------
// Phase 2 (saves role) — final-spec.md §3.7's contract and §7.7's test
// plan, exercised against the Phase 0 fixtures above (real v1/v2/dungeon-v1
// shapes) plus synthetic data for the bounds/refusal/round-trip behaviour
// the fixtures alone cannot exercise.
// -----------------------------------------------------------------------

/** A minimal, self-consistent story: the labyrinth seated behind the
 *  island's east shrine, and both legacy caverns seated behind their own
 *  island entrances — enough for `legacyPath`'s routing without needing
 *  `places.ts`'s real `STORY` (a Phase-2 sibling this file does not, and
 *  per §3.7 must not, import). */
const STORY: readonly StorySeat[] = [
  { entrance: 'island/east-shrine', place: 'labyrinth' },
  { entrance: 'island/wayfarer-mouth', place: 'wayfarer-cavern' },
  { entrance: 'island/highland-mouth', place: 'highland-cavern' },
]

/** A story where the two caverns have been RESHUFFLED onto different
 *  entrances than `STORY` above — same identities, different seating —
 *  proving `legacyPath` routes by querying live seating rather than
 *  assuming a fixed entrance name (the "reshuffled-story routing" §7.7
 *  asks for). */
const RESHUFFLED_STORY: readonly StorySeat[] = [
  { entrance: 'island/west-shrine', place: 'labyrinth' },
  { entrance: 'island/second-mouth', place: 'highland-cavern' },
  { entrance: 'island/first-mouth', place: 'wayfarer-cavern' },
]

describe('readAdventureSave — v1 overlay (legacy, never refused)', () => {
  const plan = readAdventureSave(OVERLAY_V1, STORY) as AdventureRestorePlan

  it('dispatches to source 1, journey null, progress the raw top-level progress', () => {
    expect(plan).not.toBeNull()
    expect(plan.source).toBe(1)
    expect(plan.journey).toBeNull()
    expect(plan.progress).toBe(OVERLAY_V1.progress)
  })

  it('always resumes at the island root (v1 never persisted a room/dungeon location)', () => {
    expect(plan.path).toEqual([{ place: 'island', via: null }])
  })

  it('folds sockets/met/solved into an island facts row under "places"', () => {
    expect(plan.places.get('island')).toEqual({ version: 1, filledSockets: OVERLAY_V1.sockets, met: OVERLAY_V1.met, solved: OVERLAY_V1.solved })
    expect(plan.places.size).toBe(1)
  })

  it('carries the v1 knowledge straight through', () => {
    expect(plan.knowledge).toEqual(OVERLAY_V1.knowledge)
  })

  it('has no carried/extra items and seeds revealed/found fresh (null / [])', () => {
    expect(plan.carried).toEqual([])
    expect(plan.extra).toEqual([])
    expect(plan.revealed).toBeNull()
    expect(plan.found).toEqual([])
  })

  it('is never refused, even with every optional field missing', () => {
    expect(readAdventureSave({ version: 1 })).not.toBeNull()
  })
})

describe('readAdventureSave — v2 overlay, fresh', () => {
  it('dispatches to source 2, extracts progress out of the whole journey blob, resumes at the island', () => {
    const plan = readAdventureSave(OVERLAY_V2_FRESH, STORY) as AdventureRestorePlan
    expect(plan.source).toBe(2)
    expect(plan.journey).toBe(OVERLAY_V2_FRESH.journey)
    expect(plan.progress).toBe(OVERLAY_V2_FRESH.journey.progress)
    expect(plan.path).toEqual([{ place: 'island', via: null }])
    expect(plan.places.get('island')).toBe(OVERLAY_V2_FRESH.world)
    expect(plan.knowledge).toEqual([])
  })

  it('mode "world" with no story at all still resumes at the island (story defaults to [])', () => {
    const plan = readAdventureSave(OVERLAY_V2_FRESH) as AdventureRestorePlan
    expect(plan.path).toEqual([{ place: 'island', via: null }])
  })
})

describe('readAdventureSave — v2 overlay, developed (room location, merged knowledge, migrated dungeons)', () => {
  const plan = readAdventureSave(OVERLAY_V2_DEVELOPED, STORY) as AdventureRestorePlan

  it('routes a "room" location through the current story seating to the labyrinth', () => {
    expect(plan.path).toEqual([{ place: 'island', via: null }, { place: 'labyrinth', via: 'island/east-shrine' }])
  })

  it('routes through a RESHUFFLED story just as correctly — same identity, different entrance', () => {
    const reshuffled = readAdventureSave(OVERLAY_V2_DEVELOPED, RESHUFFLED_STORY) as AdventureRestorePlan
    expect(reshuffled.path).toEqual([{ place: 'island', via: null }, { place: 'labyrinth', via: 'island/west-shrine' }])
  })

  it('falls back to the bare root when the target place has no seat in story at all', () => {
    const noSeat = readAdventureSave(OVERLAY_V2_DEVELOPED, []) as AdventureRestorePlan
    expect(noSeat.path).toEqual([{ place: 'island', via: null }])
  })

  it('folds every dungeon\'s migrated chamber into "places", keyed by its own content id', () => {
    expect(plan.places.get('island')).toBe(OVERLAY_V2_DEVELOPED.world)
    expect(plan.places.get('wayfarer-cavern')).toEqual({ version: 1, place: 'wayfarer-cavern', read: ['cycle'], attuned: [], runes: [['cycle', ['rain']]], claimed: false })
    expect(plan.places.get('highland-cavern')).toEqual({
      version: 1, place: 'highland-cavern', read: ['cycle', 'meaning'], attuned: ['cycle', 'meaning'],
      runes: [['cycle', ['dawn', 'noon', 'dusk']], ['meaning', ['hexagon']]], claimed: true,
    })
    expect(plan.places.size).toBe(3)
  })

  it('merges the overlay\'s own top-level knowledge with every dungeon\'s discovered pairs, the overlay\'s own entries winning on a duplicate id, in stable order', () => {
    expect(plan.knowledge).toEqual([
      ['sunseed-point-1', 'The amber shelves lead to another point above the steps.'],
      ['wayfarer-cavern-cycle', 'First the rain wakes the seed. Then the sun warms its leaves. Last the bloom greets the traveller. Let the garden grow.'],
      ['dungeon-2', 'Above Tideglass Porch’s highest left shelf, a memory waits in the empty square over the shelf’s left end. Make a stone there, then break that same stone: the hidden treasure will appear.'],
      ['highland-accord', 'Above Tideglass Porch’s highest left shelf, a memory waits in the empty square over the shelf’s left end. Make a stone there, then break that same stone: the hidden treasure will appear.'],
      ['highland-cavern-center-memory', 'The center is a meeting place, never a payment. Carry it through every doorway; its light belongs to you.'],
      ['highland-cavern-cycle', 'Dawn opens the eye. Noon fills it with light. Dusk lets it rest. Give the gate one whole day.'],
      ['highland-cavern-meaning', 'Six roads surround the courtyard. Each face meets its neighbour; each road returns to one center. Which shape holds them together?'],
    ])
    // wayfarer-cavern's own single discovered pair duplicates an id already
    // present from the overlay's own top-level knowledge, so it contributes
    // no new entry — proving the "overlay wins" dedupe rule, not just a
    // union.
    expect(plan.knowledge.filter(([id]) => id === 'wayfarer-cavern-cycle')).toHaveLength(1)
  })

  it('mode "dungeon" routes to the migrated chamber\'s own content id', () => {
    const atDungeon = readAdventureSave({ ...OVERLAY_V2_DEVELOPED, location: { mode: 'dungeon', dungeon: 2 } }, STORY) as AdventureRestorePlan
    expect(atDungeon.path).toEqual([{ place: 'island', via: null }, { place: 'highland-cavern', via: 'island/highland-mouth' }])
  })
})

describe('readAdventureSave — v2 refusal table (unchanged from #restoreSlot today)', () => {
  it('refuses when "journey" is not a record', () => {
    expect(readAdventureSave({ version: 2, journey: null, world: {} })).toBeNull()
    expect(readAdventureSave({ version: 2, journey: 'nope', world: {} })).toBeNull()
    expect(readAdventureSave({ version: 2, world: {} })).toBeNull()
  })

  it('refuses when "world" is not a record', () => {
    expect(readAdventureSave({ version: 2, journey: {}, world: null })).toBeNull()
    expect(readAdventureSave({ version: 2, journey: {} })).toBeNull()
  })

  it('never refuses for a malformed "dungeons"/"location"/"knowledge" — those degrade instead', () => {
    const plan = readAdventureSave({ version: 2, journey: {}, world: {}, dungeons: 'garbage', location: 42, knowledge: 'nope' }, STORY)
    expect(plan).not.toBeNull()
    expect(plan!.knowledge).toEqual([])
    expect(plan!.path).toEqual([{ place: 'island', via: null }])
  })
})

describe('migrateDungeonV1 — exact two-record output, content-keyed trust rules', () => {
  it('produces exactly the two known legacy caverns, keyed by their own dungeonId, from the overlay\'s raw dungeons array', () => {
    const migrated = migrateDungeonV1(OVERLAY_V2_DEVELOPED.dungeons)
    expect([...migrated.keys()].sort()).toEqual(['highland-cavern', 'wayfarer-cavern'])
    expect(migrated.get('wayfarer-cavern')).toEqual({ version: 1, place: 'wayfarer-cavern', read: ['cycle'], attuned: [], runes: [['cycle', ['rain']]], claimed: false })
    expect(migrated.get('highland-cavern')?.claimed).toBe(true)
  })

  it('trusts the content\'s own dungeonId, not the array position — a made-up index still migrates', () => {
    const migrated = migrateDungeonV1([[99, DUNGEON_V1_WAYFARER]])
    expect(migrated.get('wayfarer-cavern')).toBeDefined()
  })

  it('skips an entry with no dungeonId, a non-string dungeonId, or a dungeonId outside the place-id pattern, without throwing', () => {
    expect(migrateDungeonV1([[0, { readClues: [] }]]).size).toBe(0)
    expect(migrateDungeonV1([[0, { dungeonId: 42 }]]).size).toBe(0)
    expect(migrateDungeonV1([[0, { dungeonId: 'Not Valid!' }]]).size).toBe(0)
  })

  it('never throws on a garbage top-level value', () => {
    for (const garbage of [null, undefined, 'nope', 42, {}, [1, 2, 3], [[0]], [[0, null]]]) {
      expect(() => migrateDungeonV1(garbage)).not.toThrow()
      expect(migrateDungeonV1(garbage).size).toBe(0)
    }
  })

  it('leaves every chamber-specific mechanic (unlocked/latched/pulled/lit/wand/blocks/memories/explored/player) unset — a Partial, never invented', () => {
    const chamber = migrateDungeonV1(OVERLAY_V2_DEVELOPED.dungeons).get('highland-cavern')!
    for (const field of ['unlocked', 'latched', 'pulled', 'lit', 'wand', 'blocks', 'memories', 'explored', 'player'] as const) {
      expect(chamber).not.toHaveProperty(field)
    }
  })
})

describe('readAdventureSave — v3 refusal table and the "is present, not is an object" journey rule (M6/M15)', () => {
  it('refuses only when raw is not a record at all', () => {
    for (const garbage of [null, undefined, 'nope', 42, [1, 2, 3], true]) expect(readAdventureSave(garbage)).toBeNull()
  })

  it('refuses an unrecognised version', () => {
    expect(readAdventureSave({ version: 4, journey: {} })).toBeNull()
    expect(readAdventureSave({})).toBeNull()
  })

  it('refuses a v3 payload whose journey key is entirely absent', () => {
    expect(readAdventureSave({ version: 3 })).toBeNull()
  })

  it('accepts a v3 payload whose journey is present but not an object — never inspected beyond presence', () => {
    const plan = readAdventureSave({ version: 3, journey: null })
    expect(plan).not.toBeNull()
    expect(plan!.journey).toBeNull()
    expect(plan!.progress).toBeUndefined()

    const scalarJourney = readAdventureSave({ version: 3, journey: 'opaque-blob' })
    expect(scalarJourney!.journey).toBe('opaque-blob')
  })

  it('every other field degrades leniently instead of refusing the plan', () => {
    const plan = readAdventureSave({
      version: 3, journey: {}, knowledge: 'nope', path: 'nope', places: 'nope', carried: 'nope', revealed: 'nope', found: 'nope',
    })
    expect(plan).toEqual({
      source: 3, progress: undefined, journey: {}, knowledge: [], path: [], places: new Map(), carried: [], extra: [], revealed: null, found: [],
    })
  })
})

describe('readAdventureSave — v3 bounds (§3.7 ADVENTURE_BOUNDS), never refusing the whole plan', () => {
  it('caps knowledge at 256 entries and drops an over-long text, without refusing the plan', () => {
    const many: [string, string][] = Array.from({ length: 300 }, (_, i) => [`k${i}`, 'ok'])
    const tooLong: [string, string] = ['too-long', 'x'.repeat(ADVENTURE_BOUNDS.knowledgeText + 1)]
    const plan = readAdventureSave({ version: 3, journey: {}, knowledge: [...many, tooLong] })!
    expect(plan.knowledge).toHaveLength(ADVENTURE_BOUNDS.knowledge)
    expect(plan.knowledge.some(([id]) => id === 'too-long')).toBe(false)
  })

  it('caps path at 16 steps', () => {
    const longPath = Array.from({ length: 30 }, (_, i) => ({ place: `p${i}`, via: i === 0 ? null : `p${i - 1}/x` }))
    const plan = readAdventureSave({ version: 3, journey: {}, path: longPath })!
    expect(plan.path).toHaveLength(ADVENTURE_BOUNDS.pathSteps)
  })

  it('caps places at 64 entries and drops any single place whose facts alone exceed placeBytes', () => {
    const many: [string, unknown][] = Array.from({ length: 100 }, (_, i) => [`place-${i}`, { n: i }])
    const huge: [string, unknown] = ['huge', { blob: 'x'.repeat(ADVENTURE_BOUNDS.placeBytes + 1) }]
    const plan = readAdventureSave({ version: 3, journey: {}, places: [...many, huge] })!
    expect(plan.places.size).toBe(ADVENTURE_BOUNDS.places)
    expect(plan.places.has('huge')).toBe(false)
  })

  it('caps carried at 8 entries and at carriedBytes total', () => {
    const many: CarriedEntry[] = Array.from({ length: 20 }, (_, i) => ({ from: `slot-${i}`, value: i }))
    const plan = readAdventureSave({ version: 3, journey: {}, carried: many })!
    expect(plan.carried.length).toBeLessThanOrEqual(ADVENTURE_BOUNDS.carried)

    const oneHuge: CarriedEntry[] = [{ from: 'a', value: 'x'.repeat(ADVENTURE_BOUNDS.carriedBytes) }, { from: 'b', value: 'small' }]
    const withHuge = readAdventureSave({ version: 3, journey: {}, carried: oneHuge })!
    expect(withHuge.carried).toHaveLength(0)
  })

  it('caps extra at 8 fields and at extraBytes total, never including a known field name', () => {
    const raw: Record<string, unknown> = { version: 3, journey: {} }
    for (let i = 0; i < 20; i++) raw[`extra-${i}`] = i
    const plan = readAdventureSave(raw)!
    expect(plan.extra.length).toBeLessThanOrEqual(ADVENTURE_BOUNDS.extraFields)
    expect(plan.extra.some(([key]) => key === 'version' || key === 'journey')).toBe(false)
  })

  it('revealed/found: keeps the first N valid entries, sorted and deduped, dropping a malformed entry rather than refusing the plan', () => {
    const raw = {
      version: 3, journey: {},
      revealed: ['skill:sickle', 'triangle:0', 'skill:sickle', 'NOT-LOWER', 42, 'x'.repeat(200), 'court-cache'],
      found: ['island/east-shrine', 'island/east-shrine', 'ALSO-BAD'],
    }
    const plan = readAdventureSave(raw)!
    expect(plan.revealed).toEqual(['court-cache', 'skill:sickle', 'triangle:0'])
    expect(plan.found).toEqual(['island/east-shrine'])
  })

  it('an oversized revealed/found ledger keeps its first 512/128 valid entries instead of refusing the plan', () => {
    const revealed = Array.from({ length: 600 }, (_, i) => `id-${String(i).padStart(4, '0')}`)
    const found = Array.from({ length: 200 }, (_, i) => `island/e-${String(i).padStart(4, '0')}`)
    const plan = readAdventureSave({ version: 3, journey: {}, revealed, found })!
    expect(plan).not.toBeNull()
    expect(plan.revealed).toHaveLength(ADVENTURE_BOUNDS.revealed)
    expect(plan.found).toHaveLength(ADVENTURE_BOUNDS.found)
  })

  it('revealed absent (v1/v2, or an older v3) seeds null; found absent is []', () => {
    expect(readAdventureSave({ version: 3, journey: {} })!.revealed).toBeNull()
    expect(readAdventureSave({ version: 3, journey: {} })!.found).toEqual([])
  })
})

describe('writeAdventureSave — known-fields-win composition, sorted revealed/found, round-trip stability', () => {
  const parts = {
    journey: { version: 1 as const, roomIds: [] },
    knowledge: [['a', 'A'], ['b', 'B']] as [string, string][],
    path: [{ place: 'island', via: null }] as const,
    places: new Map<string, unknown>([['island', { met: [] }]]),
    carried: [{ from: 'chest:1', value: 'lantern' }] as CarriedEntry[],
    extra: [['mood', 'curious']] as [string, unknown][],
    revealed: ['skill:sickle', 'triangle:0'],
    found: ['island/east-shrine'],
  }

  it('writes version 3 with every named field present', () => {
    const written = writeAdventureSave(parts)
    expect(written.version).toBe(3)
    expect(written.journey).toBe(parts.journey)
    expect(written.knowledge).toEqual(parts.knowledge)
    expect(written.path).toEqual(parts.path)
    expect(written.places).toEqual([['island', { met: [] }]])
    expect(written.carried).toEqual(parts.carried)
  })

  it('writes revealed/found sorted, and never folds them into extra', () => {
    const written = writeAdventureSave(parts)
    expect(written.revealed).toEqual(['skill:sickle', 'triangle:0'])
    expect(written.found).toEqual(['island/east-shrine'])
  })

  it('a known field name inside extra can never win over the real field (known-fields-win, structural not incidental)', () => {
    const written = writeAdventureSave({ ...parts, extra: [['version', 999], ['journey', 'forged'], ['mood', 'curious']] })
    expect(written.version).toBe(3)
    expect(written.journey).toBe(parts.journey)
    expect(written['mood']).toBe('curious')
  })

  it('round-trips through readAdventureSave: extra fields survive, knowledge/path/places/carried/revealed/found reproduce', () => {
    const written = writeAdventureSave(parts)
    const plan = readAdventureSave(written)!
    expect(plan.source).toBe(3)
    expect(plan.journey).toBe(parts.journey)
    expect(plan.knowledge).toEqual(parts.knowledge)
    expect(plan.path).toEqual(parts.path)
    expect([...plan.places]).toEqual([['island', { met: [] }]])
    expect(plan.carried).toEqual(parts.carried)
    expect(plan.revealed).toEqual(['skill:sickle', 'triangle:0'])
    expect(plan.found).toEqual(['island/east-shrine'])
    expect(plan.extra).toEqual([['mood', 'curious']])
  })

  it('caps knowledge/path/places/carried/revealed/found/extra on write, never producing an over-bounds payload', () => {
    const written = writeAdventureSave({
      journey: {},
      knowledge: Array.from({ length: 300 }, (_, i) => [`k${i}`, 'ok'] as [string, string]),
      path: Array.from({ length: 30 }, (_, i) => ({ place: `p${i}`, via: i === 0 ? null : `p${i - 1}/x` })),
      places: new Map(Array.from({ length: 100 }, (_, i) => [`place-${i}`, { n: i }] as [string, unknown])),
      carried: Array.from({ length: 20 }, (_, i) => ({ from: `slot-${i}`, value: i })),
      extra: Array.from({ length: 20 }, (_, i) => [`extra-${i}`, i] as [string, unknown]),
      revealed: Array.from({ length: 600 }, (_, i) => `id-${String(i).padStart(4, '0')}`),
      found: Array.from({ length: 200 }, (_, i) => `island/e-${String(i).padStart(4, '0')}`),
    })
    expect(written.knowledge).toHaveLength(ADVENTURE_BOUNDS.knowledge)
    expect(written.path).toHaveLength(ADVENTURE_BOUNDS.pathSteps)
    expect(written.places).toHaveLength(ADVENTURE_BOUNDS.places)
    expect(written.carried.length).toBeLessThanOrEqual(ADVENTURE_BOUNDS.carried)
    expect(written.revealed).toHaveLength(ADVENTURE_BOUNDS.revealed)
    expect(written.found).toHaveLength(ADVENTURE_BOUNDS.found)
    expect(Object.keys(written).filter(k => k.startsWith('extra-'))).toHaveLength(ADVENTURE_BOUNDS.extraFields)
  })
})

describe('combat rides the opaque journey blob for free (M6/M15) — zero special-casing here', () => {
  it('a journey carrying kit/weapon/spell passes through readAdventureSave and writeAdventureSave completely untouched', () => {
    const combatJourney = { version: 1, stats: { kit: ['sickle', 'ward'], weapon: 'sickle', spell: 'ward' }, progress: { relicIds: [] } }
    const plan = readAdventureSave({ version: 3, journey: combatJourney })!
    expect(plan.journey).toBe(combatJourney)
    expect(plan.progress).toBe(combatJourney.progress)

    const written = writeAdventureSave({
      journey: combatJourney, knowledge: [], path: [{ place: 'island', via: null }], places: new Map(),
      carried: [], extra: [], revealed: [], found: [],
    })
    expect(written.journey).toBe(combatJourney)
  })

  it('a v1/v2 journey with no kit at all is just as opaque — nothing here inspects it either', () => {
    const plan = readAdventureSave(OVERLAY_V2_FRESH, STORY)!
    expect(plan.journey).toBe(OVERLAY_V2_FRESH.journey)
    expect((plan.journey as { stats: { kit?: unknown } }).stats.kit).toBeUndefined()
  })
})
