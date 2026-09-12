import { describe, expect, it } from 'vitest'
import { ROOT_PLACE, STORY, STORY_BOARDS } from './story.js'
import {
  ISLAND_PLACE, LABYRINTH_PLACE, LEGACY_DUNGEON_ARTIFACT, LEGACY_DUNGEON_INDEX, LEGACY_KNOWLEDGE_GROUPS, PLACES,
  authoredItemName, crumbLabel, floorLabel, groupEntry, groupFloors, groupOfPlace, knowledgeGroup, placeName, seatLabel,
} from './places.js'
import { entranceKey, splitEntranceKey, validateStory, type PlaceStep } from './place.js'
import { ATTAINMENTS } from './attainments.js'
import { storyRefs } from './story-when.js'
import { COMBAT_SKILLS } from './engine.js'

describe('STORY', () => {
  it('has exactly the twelve seats the spec pins, in order', () => {
    expect(STORY.map(seat => seat.entrance)).toEqual([
      'island/dawn-shrine', 'island/tide-shrine', 'island/pyramid-shrine',
      'island/wayfarer-cavern', 'wet-steps/stairs-down', 'cistern/stairs-down',
      'island/highland-cavern', 'hall-of-hours/stairs-down', 'six-roads/stairs-down',
      'island/chandler-door', 'chandler-house/trapdoor', 'island/valley-grove',
    ])
  })

  it('seats the labyrinth three times, once per shrine, with the three arrivals', () => {
    const shrines = STORY.filter(seat => seat.place === 'labyrinth')
    expect(shrines.map(seat => seat.arrive)).toEqual(['sunseed', 'tideglass', 'starbloom'])
  })

  it('the Hollow Grove is seated exactly once, off the island, with no arrive override', () => {
    const grove = STORY.find(seat => seat.place === 'hollow-grove')
    expect(grove).toEqual({ entrance: 'island/valley-grove', place: 'hollow-grove' })
  })

  it('validates clean against PLACES, rooted at ROOT_PLACE', () => {
    expect(ROOT_PLACE).toBe('island')
    expect(validateStory(STORY, PLACES, ROOT_PLACE)).toEqual([])
  })

  it('every seat splits into a real entrance key', () => {
    for (const seat of STORY) {
      const split = splitEntranceKey(seat.entrance)
      expect(split, seat.entrance).not.toBeNull()
      expect(entranceKey(split!.place, split!.entrance)).toBe(seat.entrance)
    }
  })
})

describe('PLACES', () => {
  it('opens with island, then labyrinth, then every chamber in CHAMBERS\' own order', () => {
    expect([...PLACES.keys()]).toEqual([
      'island', 'labyrinth',
      'wet-steps', 'cistern', 'spring-heart', 'hall-of-hours', 'six-roads', 'accord-sanctum',
      'chandler-house', 'chandler-cellar', 'hollow-grove',
    ])
  })

  it('ISLAND_PLACE lists every shrine, dungeon, door, area and plot as an entrance', () => {
    for (const id of ['dawn-shrine', 'tide-shrine', 'pyramid-shrine', 'wayfarer-cavern', 'highland-cavern', 'chandler-door', 'valley-grove', 'grove-plot', 'lakeside-plot', 'cliff-plot', 'tidewater-plot']) {
      expect(ISLAND_PLACE.entrances, id).toContain(id)
    }
  })

  it('LABYRINTH_PLACE hosts nothing below it and offers the three shrine arrivals', () => {
    expect(LABYRINTH_PLACE.entrances).toEqual([])
    expect(LABYRINTH_PLACE.arrivals.map(a => a.id).sort()).toEqual(['starbloom', 'sunseed', 'tideglass'])
  })

  it('every chamber place carries its ChamberDefinition\'s own group and heart marks', () => {
    expect(PLACES.get('wet-steps')?.group).toBe('wayfarer-cavern')
    expect(PLACES.get('spring-heart')?.heart).toBe(true)
    expect(PLACES.get('accord-sanctum')?.heart).toBe(true)
    expect(PLACES.get('hollow-grove')?.group).toBeUndefined()
  })
})

describe('labels', () => {
  it('placeName falls back to the raw id for an unknown place', () => {
    expect(placeName('wet-steps')).toBe('The Wet Steps')
    expect(placeName('not-a-place')).toBe('not-a-place')
  })

  it('groupOfPlace / groupEntry / groupFloors walk the Wayfarer Cavern top to bottom', () => {
    expect(groupOfPlace('cistern')?.name).toBe('Wayfarer Cavern')
    expect(groupEntry('wayfarer-cavern')).toBe('island/wayfarer-cavern')
    expect(groupFloors('wayfarer-cavern')).toEqual(['wet-steps', 'cistern', 'spring-heart'])
    expect(groupFloors('highland-cavern')).toEqual(['hall-of-hours', 'six-roads', 'accord-sanctum'])
    expect(groupFloors('chandlery')).toEqual(['chandler-house', 'chandler-cellar'])
  })

  it('groupFloors is empty for an unknown group', () => {
    expect(groupFloors('not-a-group')).toEqual([])
  })

  it('floorLabel names the floor and the group, and is null off any group', () => {
    expect(floorLabel('wet-steps')).toBe('Floor 1 of 3 · Wayfarer Cavern')
    expect(floorLabel('spring-heart')).toBe('Floor 3 of 3 · Wayfarer Cavern')
    expect(floorLabel('hollow-grove')).toBeNull()
    expect(floorLabel('labyrinth')).toBeNull()
  })

  it('seatLabel reads the seated place\'s own name/subtitle and how much lies below it', () => {
    const cistern = seatLabel('wet-steps/stairs-down')
    expect(cistern).toMatchObject({ name: 'The Cistern' })
    expect(seatLabel('island/wayfarer-cavern')?.levels).toBe(2) // cistern, spring-heart
    expect(seatLabel('island/not-a-real-entrance')).toBeNull()
  })

  it('crumbLabel names the root as the island, and each step after by its place', () => {
    const steps: PlaceStep[] = [{ place: 'island', via: null }, { place: 'wet-steps', via: 'island/wayfarer-cavern' }, { place: 'cistern', via: 'wet-steps/stairs-down' }]
    expect(crumbLabel(steps, 0)).toBe('The Sevenfold Valley')
    expect(crumbLabel(steps, 1)).toContain('The Wet Steps')
    expect(crumbLabel(steps, 2)).toContain('The Cistern')
    expect(crumbLabel(steps, 5)).toBe('')
  })

  it('knowledgeGroup resolves a tablet\'s knowledge id, a chest grant, and the legacy crystal ids', () => {
    expect(knowledgeGroup('wet-steps-drip-line')).toBe('wayfarer-cavern')
    expect(knowledgeGroup('map:wayfarer-cavern')).toBe('wayfarer-cavern')
    expect(knowledgeGroup('lodestone:highland-cavern')).toBe('highland-cavern')
    expect(knowledgeGroup('keepsake:lantern')).toBe('chandlery')
    expect(knowledgeGroup('wayfarer-spring')).toBe('wayfarer-cavern')
    expect(knowledgeGroup('highland-accord')).toBe('highland-cavern')
    expect(knowledgeGroup('hollow-grove-bark-marks')).toBeNull()
    expect(knowledgeGroup('not-a-knowledge-id')).toBeNull()
  })

  it('authoredItemName names a tablet by its title and a grant by its own text', () => {
    expect(authoredItemName('wet-steps-drip-line')).toBe('The Drip-Line')
    expect(authoredItemName('map:wayfarer-cavern')).toBe('A hand-inked map of Wayfarer Cavern. Its halls now show on your minimap wherever you carry it.')
    expect(authoredItemName('wayfarer-spring')).toBe('Spring crystal')
    expect(authoredItemName('not-a-knowledge-id')).toBeNull()
  })
})

describe('legacy identity tables', () => {
  it('LEGACY_DUNGEON_INDEX maps the two scroll-dungeon indices to their new entry floor', () => {
    expect(LEGACY_DUNGEON_INDEX).toEqual({ 0: 'wet-steps', 2: 'hall-of-hours' })
  })

  it('LEGACY_DUNGEON_ARTIFACT maps each legacy dungeon id to the knowledge id its one artifact granted', () => {
    expect(LEGACY_DUNGEON_ARTIFACT['wayfarer-cavern']).toBe('wayfarer-spring')
    expect(LEGACY_DUNGEON_ARTIFACT['highland-cavern']).toBe('highland-accord')
  })

  it('LEGACY_KNOWLEDGE_GROUPS agrees with LEGACY_DUNGEON_ARTIFACT\'s two ids', () => {
    expect(LEGACY_KNOWLEDGE_GROUPS['wayfarer-spring']).toBe('wayfarer-cavern')
    expect(LEGACY_KNOWLEDGE_GROUPS['highland-accord']).toBe('highland-cavern')
  })
})

describe('STORY_BOARDS', () => {
  it('has exactly the six kinds ATTAINMENTS expects, each with unique slot ids', () => {
    expect(STORY_BOARDS.map(board => board.kind).sort()).toEqual(['contributions', 'items', 'knowledge', 'places', 'relics', 'tasks'])
    for (const board of STORY_BOARDS) {
      const ids = board.slots.map(slot => slot.id)
      expect(new Set(ids).size, board.id).toBe(ids.length)
    }
  })

  it('every slot naming an attainment names one that actually claims that board/slot back', () => {
    for (const board of STORY_BOARDS) for (const slot of board.slots) {
      if (!slot.attainment) continue
      const def = ATTAINMENTS.find(candidate => candidate.id === slot.attainment)
      expect(def, `${board.id}/${slot.id} → ${slot.attainment}`).toBeDefined()
      expect(def?.slot).toEqual({ board: board.id, slot: slot.id })
    }
  })

  it('every slot\'s fills condition matches the same-id attainment\'s own when, verbatim', () => {
    for (const board of STORY_BOARDS) for (const slot of board.slots) {
      if (!slot.attainment) continue
      const def = ATTAINMENTS.find(candidate => candidate.id === slot.attainment)
      expect(slot.fills, `${board.id}/${slot.id}`).toEqual(def?.when)
    }
  })

  it('every knows/done ref named by a slot\'s fills or hint is well-formed', () => {
    for (const board of STORY_BOARDS) for (const slot of board.slots) {
      const refs = [storyRefs(slot.fills), storyRefs(slot.shows)]
      if (slot.hint && typeof slot.hint !== 'string') refs.push(storyRefs(slot.hint.when))
      for (const { done } of refs) for (const ref of done) {
        if (/^labyrinth\/skill:/.test(ref)) expect(COMBAT_SKILLS as readonly string[]).toContain(ref.slice('labyrinth/skill:'.length))
        else expect(ref.length).toBeGreaterThan(0)
      }
    }
  })
})
