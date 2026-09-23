// A participant's story: read whole or refused whole, and seated into the
// one story so its places stand like any other.
import { describe, expect, it } from 'vitest'
import { MOSSBACK_STORY } from './mossback.story.js'
import { PLACES } from './places.js'
import { seatAt } from './place.js'
import { SIDE_CAVERNS } from './side-cavern.js'
import { STORY } from './story.js'
import { installStory, installedStories, readStoryBundle, sanitizeCavern, sanitizeChamber, STORY_BUNDLE_BYTES } from './story-addons.js'
import { WORLDS } from './worlds.js'

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
    expect(story!.seats).toEqual([{ entrance: 'greenwood/grove-gate-sign', place: 'mossback' }])
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
    expect(result).toMatchObject({ ok: true, places: ['mossback'], seats: 1 })
    expect(PLACES.has('mossback')).toBe(true)
    expect(WORLDS.has('mossback')).toBe(true)
    expect(seatAt(STORY, 'greenwood/grove-gate-sign')?.place).toBe('mossback')
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
        { entrance: 'mossback/old-mine', place: 'mine-nook' },
        { entrance: 'mine-nook/nook-tablet', place: 'mine-crawl' },
      ],
    }))!
    expect(installStory(story)).toMatchObject({ ok: true, places: ['mine-nook', 'mine-crawl'], seats: 2 })
    expect(PLACES.get('mine-nook')?.entrances).toContain('nook-tablet')
    expect(SIDE_CAVERNS.some(candidate => candidate.id === 'mine-crawl')).toBe(true)
    expect(seatAt(STORY, 'mine-nook/nook-tablet')?.place).toBe('mine-crawl')
  })
})
