// A participant's story: read whole or refused whole, and seated into the
// one story so its places stand like any other.
import { describe, expect, it } from 'vitest'
import { MOSSBACK_STORY } from './mossback.story.js'
import { PLACES } from './places.js'
import { seatAt } from './place.js'
import { SIDE_CAVERNS } from './side-cavern.js'
import { STORY } from './story.js'
import { installStory, installedStories, readStoryBundle, sanitizeCavern, sanitizeChamber, sanitizeLabyrinth, STORY_BUNDLE_BYTES } from './story-addons.js'
import { WORLDS } from './worlds.js'
import { LABYRINTHS, ROOMS, squareEntrance } from './labyrinth.js'
import { fromAscii } from './levels.js'

/** A room as the Designer saves it: a level with Dana's start and a door. */
const level = (name: string): unknown => fromAscii(name, [
  '############',
  '#..........#',
  '#..K....g..#',
  '#..BBBB....#',
  '#..........#',
  '#P........D#',
  '############',
])
const labyrinth = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, name: 'A Warren', rooms: [
    { id: 'porch', level: level('Porch'), doors: [{ id: 'on', col: 10, row: 1, targetRoomId: 'deep', targetDoorId: 'back' }] },
    { id: 'deep', level: level('Deep'), doors: [{ id: 'back', col: 1, row: 1, targetRoomId: 'porch', targetDoorId: 'on' }] },
  ],
  ...over,
})

const raw = MOSSBACK_STORY as Record<string, unknown>
const bundle = (over: Record<string, unknown>): unknown => ({ version: 1, id: 'test', name: 'Test', ...over })

/** A small chamber a participant might write: one stair, one tablet. */
function chamber(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, name: 'A Nook', subtitle: 'Small and dry', look: 'cavern', torch: 3, sconces: false,
    map: [
      '##<######',
      '#.@.....#',
      '#....t..#',
      '#.......#',
      '#########',
    ],
    exits: [{ id: 'stair', col: 2, row: 0, style: 'stairs-up', label: 'Up', landing: { col: 2, row: 1 }, facing: 'down' }],
    tablets: [{ id: 'nook-tablet', col: 5, row: 2, title: 'A Nook', text: 'Somebody carved a nook here.' }],
    ...over,
  }
}

const cavern = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, name: 'A Crawl', subtitle: 'Low and long', theme: 'verdant', meters: 1,
  art: [
    '############',
    '#<.........#',
    '#..........#',
    '#..........#',
    '#....BBB...#',
    '#..........#',
    '############',
  ],
  finds: [],
  ...over,
})

describe('reading a story add-on', () => {
  it('reads the worked example whole', () => {
    const story = readStoryBundle(MOSSBACK_STORY)
    expect(story).not.toBeNull()
    expect(story!.worlds.map(world => world.id)).toEqual(['mossback'])
    expect(story!.seats).toEqual([
      { entrance: 'greenwood/grove-gate-sign', place: 'mossback' },
      { entrance: 'mossback/old-mine', place: 'mossback-mine' },
    ])
    expect(story!.labyrinths.map(labyrinth => labyrinth.definition.id)).toEqual(['mossback-mine'])
  })

  it('refuses a wrong version, a bad name, an oversized bundle, and a world that does not read', () => {
    expect(readStoryBundle({ ...raw, version: 2 })).toBeNull()
    expect(readStoryBundle({ ...raw, id: 'Not A Name' })).toBeNull()
    expect(readStoryBundle({ ...raw, name: 'x'.repeat(STORY_BUNDLE_BYTES + 1) })).toBeNull()
    expect(readStoryBundle({ ...raw, worlds: [{ id: 'nowhere' }] })).toBeNull()
    expect(readStoryBundle({ ...raw, seats: [{ entrance: 'no-slash', place: 'mossback' }] })).toBeNull()
  })

  it('reads a chamber through the same build every authored chamber goes through', () => {
    expect(sanitizeChamber(chamber('nook'))).not.toBeNull()
    expect(sanitizeChamber(chamber('nook', { exits: [] }))).toBeNull()
    expect(sanitizeChamber(chamber('nook', { map: ['##<#', '#.@#', '####'], tablets: [{ id: 't', col: 40, row: 1, title: '', text: '' }] }))).toBeNull()
    expect(sanitizeChamber(chamber('nook', { map: ['##<######', '#.@..?..#', '#########'] }))).toBeNull() // '?' is no glyph
    expect(sanitizeChamber(chamber('nook', { torch: 99 }))).toBeNull()
  })

  it('reads a labyrinth of rooms: ids namespaced, doors paired, the entry resolved, relics refused', () => {
    const read = sanitizeLabyrinth(labyrinth('warren'))
    expect(read).not.toBeNull()
    expect(read!.rooms.map(room => room.id)).toEqual(['warren-porch', 'warren-deep'])
    expect(read!.rooms[0]!.doors[0]).toMatchObject({ targetRoomId: 'warren-deep', targetDoorId: 'back' })
    expect(read!.rooms.every(room => room.labyrinthId === 'warren' && room.level.interconnected === true)).toBe(true)
    expect(read!.definition).toMatchObject({ id: 'warren', entryRoomId: 'warren-porch', goalRelicId: '' })
    expect(sanitizeLabyrinth(labyrinth('warren', { entryRoomId: 'cellar' }))).toBeNull()
    expect(sanitizeLabyrinth(labyrinth('warren', { rooms: [{ id: 'porch', level: level('Porch'), doors: [{ id: 'on', col: 10, row: 1, targetRoomId: 'nowhere', targetDoorId: 'back' }] }] }))).toBeNull()
    expect(sanitizeLabyrinth(labyrinth('warren', { rooms: [{ id: 'porch', level: level('Porch'), relics: [{ id: 'x', col: 1, row: 1, kind: 'star' }] }] }))).toBeNull()
    expect(sanitizeLabyrinth(labyrinth('warren', { rooms: [{ id: 'porch', level: { cols: 3 } }] }))).toBeNull()
  })

  it('reads a cavern drawn as data, and refuses one with no mouth or ragged lines', () => {
    const drawn = sanitizeCavern(cavern('crawl'))
    expect(drawn).not.toBeNull()
    expect(drawn!.mouth).toEqual({ col: 1, row: 1 })
    expect(sanitizeCavern(cavern('crawl', { art: ['############', '#..........#', '############', '############', '############', '############'] }))).toBeNull()
    expect(sanitizeCavern(cavern('crawl', { art: ['############', '#<....#', '############', '############', '############', '############'] }))).toBeNull()
  })
})

describe('seating a story add-on', () => {
  it('seats the worked example: the Mossback stands, and the Greenwood’s signpost leads there', () => {
    const story = readStoryBundle(MOSSBACK_STORY)!
    const result = installStory(story)
    expect(result).toMatchObject({ ok: true, places: ['mossback', 'mossback-mine'], labyrinths: ['mossback-mine'], seats: 2 })
    expect(PLACES.has('mossback')).toBe(true)
    expect(WORLDS.has('mossback')).toBe(true)
    expect(seatAt(STORY, 'greenwood/grove-gate-sign')?.place).toBe('mossback')
    // The mine: a room as an add-on — a labyrinth place of its own.
    expect(seatAt(STORY, 'mossback/old-mine')?.place).toBe('mossback-mine')
    expect(LABYRINTHS.some(candidate => candidate.id === 'mossback-mine')).toBe(true)
    expect(ROOMS.some(room => room.id === 'mossback-mine-shaft' && room.labyrinthId === 'mossback-mine')).toBe(true)
    expect(PLACES.get('mossback-mine')).toMatchObject({ kind: 'labyrinth', arrivals: [{ id: 'mossback-mine' }] })
    expect(PLACES.get('mossback-mine')?.entrances).toContain(squareEntrance('mossback-mine-shaft', { col: 1, row: 1 }))
    expect(installedStories()).toContain('mossback')
    expect(installStory(story)).toMatchObject({ ok: true, already: true })
  })

  it('refuses a seat behind an entrance already taken, an entrance the host does not have, and a place that already stands', () => {
    const taken = readStoryBundle(bundle({ id: 'taken', seats: [{ entrance: 'island/dawn-shrine', place: 'greenwood' }] }))!
    expect(installStory(taken)).toMatchObject({ ok: false, problem: expect.stringContaining('already has a place seated') })
    const nothing = readStoryBundle(bundle({ id: 'nothing', seats: [{ entrance: 'greenwood/no-such-thing', place: 'mossback' }] }))!
    expect(installStory(nothing)).toMatchObject({ ok: false, problem: expect.stringContaining('has nothing called') })
    const nowhere = readStoryBundle(bundle({ id: 'nowhere', seats: [{ entrance: 'greenwood/pond-sign', place: 'atlantis' }] }))!
    expect(installStory(nowhere)).toMatchObject({ ok: false, problem: expect.stringContaining('already has a place seated') })
    const twice = readStoryBundle(bundle({ id: 'twice', chambers: [chamber('greenwood')] }))!
    expect(installStory(twice)).toMatchObject({ ok: false, problem: expect.stringContaining('already stands') })
  })

  it('refuses a seat that would put a place inside itself', () => {
    installStory(readStoryBundle(MOSSBACK_STORY)!)
    const loop = readStoryBundle(bundle({ id: 'loop', seats: [{ entrance: 'mossback/crown-cairn', place: 'greenwood' }] }))!
    const result = installStory(loop)
    expect(result.ok).toBe(false)
    expect(seatAt(STORY, 'mossback/crown-cairn')).toBeNull()
  })

  it('seats a chamber and a cavern of a participant’s own, and their things become entrances', () => {
    installStory(readStoryBundle(MOSSBACK_STORY)!)
    const story = readStoryBundle(bundle({
      id: 'under-the-mine', chambers: [chamber('mine-nook')], caverns: [cavern('mine-crawl')],
      seats: [
        { entrance: 'mossback/kite-nest', place: 'mine-nook' },
        { entrance: 'mine-nook/nook-tablet', place: 'mine-crawl' },
      ],
    }))!
    expect(installStory(story)).toMatchObject({ ok: true, places: ['mine-nook', 'mine-crawl'], seats: 2 })
    expect(PLACES.get('mine-nook')?.entrances).toContain('nook-tablet')
    expect(SIDE_CAVERNS.some(candidate => candidate.id === 'mine-crawl')).toBe(true)
    expect(seatAt(STORY, 'mine-nook/nook-tablet')?.place).toBe('mine-crawl')
  })

  it('seats a labyrinth of a participant’s own behind a thing, and refuses a second of the same name', () => {
    installStory(readStoryBundle(MOSSBACK_STORY)!)
    const story = readStoryBundle(bundle({ id: 'warren-story', labyrinths: [labyrinth('warren')], seats: [{ entrance: 'mossback/crown-cairn', place: 'warren' }] }))!
    expect(installStory(story)).toMatchObject({ ok: true, places: ['warren'], labyrinths: ['warren'], seats: 1 })
    expect(seatAt(STORY, 'mossback/crown-cairn')?.place).toBe('warren')
    expect(PLACES.get('warren')?.kind).toBe('labyrinth')
    const again = readStoryBundle(bundle({ id: 'warren-again', labyrinths: [labyrinth('warren')] }))!
    expect(installStory(again)).toMatchObject({ ok: false, problem: expect.stringContaining('"warren" already stands') })
    // Seating the valley's one labyrinth place below a labyrinth room's own seat would put it inside itself.
    const loop = readStoryBundle(bundle({ id: 'loop', seats: [{ entrance: 'mossback/kite-nest', place: 'labyrinth', arrive: 'sunseed' }] }))!
    expect(installStory(loop).ok).toBe(false)
  })
})
