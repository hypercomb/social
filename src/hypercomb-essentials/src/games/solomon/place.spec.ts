import { describe, expect, it } from 'vitest'
import {
  MAX_PATH_DEPTH, PlacePath, entranceKey, levelsBelow, routeTo, seatAt, seatsOf, splitEntranceKey, stepToward, validateStory,
  type PlaceCatalog, type PlaceDefinition, type StorySeat,
} from './place.js'

// A small fixture graph, reused across tests:
//   island --shrine-a--> labyrinth (arrive: sunseed)
//   island --shrine-b--> labyrinth (arrive: tideglass)     ← one place, three arrivals
//   island --shrine-c--> labyrinth (arrive: starbloom)
//   island --cave------> cavern
//   cavern --deeper----> cellar
function place(id: string, kind: PlaceDefinition['kind'], entrances: readonly string[], arrivals: readonly string[]): PlaceDefinition {
  return { id, name: id, subtitle: '', kind, entrances, arrivals: arrivals.map(a => ({ id: a, name: a })) }
}

function fixture(): { places: PlaceCatalog; story: StorySeat[] } {
  const places: PlaceCatalog = new Map([
    ['island', place('island', 'island', ['shrine-a', 'shrine-b', 'shrine-c', 'cave'], ['main'])],
    ['labyrinth', place('labyrinth', 'labyrinth', [], ['sunseed', 'tideglass', 'starbloom'])],
    ['cavern', place('cavern', 'chamber', ['deeper'], ['main'])],
    ['cellar', place('cellar', 'chamber', [], ['main'])],
  ])
  const story: StorySeat[] = [
    { entrance: 'island/shrine-a', place: 'labyrinth', arrive: 'sunseed' },
    { entrance: 'island/shrine-b', place: 'labyrinth', arrive: 'tideglass' },
    { entrance: 'island/shrine-c', place: 'labyrinth', arrive: 'starbloom' },
    { entrance: 'island/cave', place: 'cavern' },
    { entrance: 'cavern/deeper', place: 'cellar' },
  ]
  return { places, story }
}

describe('entrance keys', () => {
  it('joins and splits at the first slash', () => {
    expect(entranceKey('island', 'cave')).toBe('island/cave')
    expect(splitEntranceKey('island/cave')).toEqual({ place: 'island', entrance: 'cave' })
    expect(splitEntranceKey('island/cave/deeper')).toEqual({ place: 'island', entrance: 'cave/deeper' })
  })

  it('is null with no slash, or an empty side', () => {
    expect(splitEntranceKey('island')).toBeNull()
    expect(splitEntranceKey('/cave')).toBeNull()
    expect(splitEntranceKey('island/')).toBeNull()
    expect(splitEntranceKey('')).toBeNull()
  })
})

describe('seat queries', () => {
  it('seatAt finds the one seat holding an entrance', () => {
    const { story } = fixture()
    expect(seatAt(story, 'island/cave')?.place).toBe('cavern')
    expect(seatAt(story, 'island/nowhere')).toBeNull()
  })

  it('seatsOf finds every seat holding a place — more than one for a shared place', () => {
    const { story } = fixture()
    const labyrinthSeats = seatsOf(story, 'labyrinth')
    expect(labyrinthSeats).toHaveLength(3)
    expect(labyrinthSeats.map(s => s.arrive)).toEqual(['sunseed', 'tideglass', 'starbloom'])
    expect(seatsOf(story, 'cellar')).toHaveLength(1)
    expect(seatsOf(story, 'nowhere')).toHaveLength(0)
  })
})

describe('levelsBelow', () => {
  it('counts every place transitively below, once each', () => {
    const { places, story } = fixture()
    expect(levelsBelow(story, places, 'island')).toBe(3) // labyrinth, cavern, cellar
    expect(levelsBelow(story, places, 'cavern')).toBe(1) // cellar
    expect(levelsBelow(story, places, 'cellar')).toBe(0)
    expect(levelsBelow(story, places, 'labyrinth')).toBe(0)
  })
})

describe('routeTo', () => {
  it('is the trivial single step when already there', () => {
    const { places, story } = fixture()
    expect(routeTo(story, places, 'island', 'island')).toEqual([{ place: 'island', via: null }])
  })

  it('routes down through nested entrances', () => {
    const { places, story } = fixture()
    expect(routeTo(story, places, 'island', 'cellar')).toEqual([
      { place: 'island', via: null },
      { place: 'cavern', via: 'island/cave' },
      { place: 'cellar', via: 'cavern/deeper' },
    ])
  })

  it('never routes upward or across to an unrelated branch', () => {
    const { places, story } = fixture()
    expect(routeTo(story, places, 'cavern', 'island')).toBeNull()
    expect(routeTo(story, places, 'cellar', 'labyrinth')).toBeNull()
  })

  it('is null for an unknown place on either side', () => {
    const { places, story } = fixture()
    expect(routeTo(story, places, 'island', 'nowhere')).toBeNull()
    expect(routeTo(story, places, 'nowhere', 'island')).toBeNull()
  })

  it('picks the shallowest route to a place seated more than once, story order breaking ties', () => {
    const { places, story } = fixture()
    const route = routeTo(story, places, 'island', 'labyrinth')
    expect(route).toEqual([{ place: 'island', via: null }, { place: 'labyrinth', via: 'island/shrine-a' }])
  })

  it('prefers the seat whose arrive matches, at the same depth', () => {
    const { places, story } = fixture()
    const route = routeTo(story, places, 'island', 'labyrinth', 'tideglass')
    expect(route).toEqual([{ place: 'island', via: null }, { place: 'labyrinth', via: 'island/shrine-b' }])
    const starbloom = routeTo(story, places, 'island', 'labyrinth', 'starbloom')
    expect(starbloom?.[1]).toEqual({ place: 'labyrinth', via: 'island/shrine-c' })
  })
})

describe('stepToward', () => {
  it('is "here" at the target, an entrance one hop down, or "up" otherwise', () => {
    const { places, story } = fixture()
    expect(stepToward(story, places, 'island', 'island')).toBe('here')
    expect(stepToward(story, places, 'island', 'cellar')).toEqual({ entrance: 'island/cave' })
    expect(stepToward(story, places, 'cavern', 'cellar')).toEqual({ entrance: 'cavern/deeper' })
    expect(stepToward(story, places, 'cavern', 'island')).toBe('up')
    expect(stepToward(story, places, 'cellar', 'labyrinth')).toBe('up')
  })
})

describe('validateStory', () => {
  it('is [] for a sound story', () => {
    const { places, story } = fixture()
    expect(validateStory(story, places, 'island')).toEqual([])
  })

  it('rule 1 — flags an entrance key naming no real placeholder', () => {
    const { places, story } = fixture()
    const broken: StorySeat[] = [...story, { entrance: 'island/nowhere', place: 'cellar' }]
    expect(validateStory(broken, places, 'island').some(m => m.includes('does not name a real entrance'))).toBe(true)
    const malformed: StorySeat[] = [...story, { entrance: 'no-slash-here', place: 'cellar' }]
    expect(validateStory(malformed, places, 'island').some(m => m.includes('does not name a real entrance'))).toBe(true)
    const unknownHost: StorySeat[] = [...story, { entrance: 'nowhere/cave', place: 'cellar' }]
    expect(validateStory(unknownHost, places, 'island').some(m => m.includes('does not name a real entrance'))).toBe(true)
  })

  it('rule 2 — flags two seats sharing one entrance', () => {
    const { places, story } = fixture()
    const dup: StorySeat[] = [...story, { entrance: 'island/cave', place: 'cellar' }]
    const problems = validateStory(dup, places, 'island')
    expect(problems.some(m => m.includes('already seated by seat'))).toBe(true)
  })

  it('rule 3 — flags a seat naming a place absent from the catalog', () => {
    const { places, story } = fixture()
    // a fresh, still-unseated entrance, so this does not also trip rule 2:
    const island = places.get('island') as PlaceDefinition
    const withGate = new Map<string, PlaceDefinition>(places)
    withGate.set('island', { ...island, entrances: [...island.entrances, 'gate'] })
    const withGhost: StorySeat[] = [...story, { entrance: 'island/gate', place: 'ghost' }]
    const problems = validateStory(withGhost, withGate, 'island')
    expect(problems.some(m => m.includes('unknown place "ghost"'))).toBe(true)
  })

  it('rule 4 — flags an arrive not declared by the seated place', () => {
    const { places, story } = fixture()
    const bad: StorySeat[] = story.map(s => (s.entrance === 'island/shrine-a' ? { ...s, arrive: 'nope' } : s))
    const problems = validateStory(bad, places, 'island')
    expect(problems.some(m => m.includes('has no arrival "nope"'))).toBe(true)
  })

  it('rule 5 — flags a place never reached from root', () => {
    const { places, story } = fixture()
    const withOrphan: PlaceCatalog = new Map([...places, ['orphan', place('orphan', 'chamber', [], ['main'])]])
    const problems = validateStory(story, withOrphan, 'island')
    expect(problems.some(m => m.includes('"orphan" is never reached from "island"'))).toBe(true)
  })

  it('rule 5 — flags a place that is its own ancestor', () => {
    const loopPlaces: PlaceCatalog = new Map([
      ['a', place('a', 'chamber', ['toB'], ['main'])],
      ['b', place('b', 'chamber', ['toA'], ['main'])],
    ])
    const loopStory: StorySeat[] = [
      { entrance: 'a/toB', place: 'b' },
      { entrance: 'b/toA', place: 'a' },
    ]
    const problems = validateStory(loopStory, loopPlaces, 'a')
    expect(problems).toEqual(['"a" is its own ancestor'])
  })

  it('reports an unknown root plainly, rather than crashing', () => {
    const { places, story } = fixture()
    expect(validateStory(story, places, 'nowhere')).toEqual(['root "nowhere" is not a known place'])
  })
})

describe('PlacePath', () => {
  it('starts at the root, one step deep, via null', () => {
    const path = PlacePath.root('island')
    expect(path.steps).toEqual([{ place: 'island', via: null }])
    expect(path.here).toEqual({ place: 'island', via: null })
    expect(path.depth).toBe(1)
    expect(path.includes('island')).toBe(true)
    expect(path.includes('cavern')).toBe(false)
  })

  it('enter() descends, tracking via and place', () => {
    const path = PlacePath.root('island')
    path.enter('island/cave', 'cavern')
    expect(path.depth).toBe(2)
    expect(path.here).toEqual({ place: 'cavern', via: 'island/cave' })
    path.enter('cavern/deeper', 'cellar')
    expect(path.steps).toEqual([
      { place: 'island', via: null },
      { place: 'cavern', via: 'island/cave' },
      { place: 'cellar', via: 'cavern/deeper' },
    ])
  })

  it('throws entering a place already on the path', () => {
    const path = PlacePath.root('island')
    path.enter('island/cave', 'cavern')
    expect(() => path.enter('cavern/back', 'island')).toThrow()
    expect(path.depth).toBe(2) // the failed attempt changed nothing
  })

  it('throws past MAX_PATH_DEPTH — the 17th step', () => {
    const path = PlacePath.root('p0')
    for (let i = 1; i < MAX_PATH_DEPTH; i++) path.enter(`via${i}`, `p${i}`)
    expect(path.depth).toBe(MAX_PATH_DEPTH)
    expect(() => path.enter('viaOver', 'pOver')).toThrow()
    expect(path.depth).toBe(MAX_PATH_DEPTH) // still capped, nothing appended
  })

  it('leaveTo pops back to an index, returning what was removed', () => {
    const path = PlacePath.root('island')
    path.enter('island/cave', 'cavern')
    path.enter('cavern/deeper', 'cellar')
    const removed = path.leaveTo(0)
    expect(removed).toEqual([
      { place: 'cavern', via: 'island/cave' },
      { place: 'cellar', via: 'cavern/deeper' },
    ])
    expect(path.steps).toEqual([{ place: 'island', via: null }])
    expect(path.depth).toBe(1)
  })

  it('leaveTo throws out of range', () => {
    const path = PlacePath.root('island')
    expect(() => path.leaveTo(-1)).toThrow()
    expect(() => path.leaveTo(1)).toThrow()
  })

  it('toJSON round-trips through restore', () => {
    const { places, story } = fixture()
    const path = PlacePath.root('island')
    path.enter('island/cave', 'cavern')
    path.enter('cavern/deeper', 'cellar')
    const json = JSON.parse(JSON.stringify(path.toJSON()))
    const restored = PlacePath.restore(json, story, places, 'island', () => true)
    expect(restored.steps).toEqual(path.steps)
  })

  it('restore falls back to the bare root for garbage input', () => {
    const { places, story } = fixture()
    expect(PlacePath.restore(undefined, story, places, 'island', () => true).steps).toEqual([{ place: 'island', via: null }])
    expect(PlacePath.restore([], story, places, 'island', () => true).steps).toEqual([{ place: 'island', via: null }])
    expect(PlacePath.restore('nonsense', story, places, 'island', () => true).steps).toEqual([{ place: 'island', via: null }])
    expect(PlacePath.restore([{ place: 'cavern', via: null }], story, places, 'island', () => true).steps)
      .toEqual([{ place: 'island', via: null }])
  })

  it('restore keeps only the longest valid prefix — a bad step and everything after it is cut', () => {
    const { places, story } = fixture()
    const raw = [
      { place: 'island', via: null },
      { place: 'cavern', via: 'island/cave' },
      { place: 'cellar', via: 'island/shrine-a' }, // via does not lead from 'cavern'
    ]
    const restored = PlacePath.restore(raw, story, places, 'island', () => true)
    expect(restored.steps).toEqual([{ place: 'island', via: null }, { place: 'cavern', via: 'island/cave' }])
  })

  it('restore stops at the first place canResume refuses', () => {
    const { places, story } = fixture()
    const raw = [
      { place: 'island', via: null },
      { place: 'cavern', via: 'island/cave' },
      { place: 'cellar', via: 'cavern/deeper' },
    ]
    const restored = PlacePath.restore(raw, story, places, 'island', p => p !== 'cellar')
    expect(restored.steps).toEqual([{ place: 'island', via: null }, { place: 'cavern', via: 'island/cave' }])
  })

  it('restore stops before repeating a place, even across a genuine cycle in the story', () => {
    const loopPlaces: PlaceCatalog = new Map([
      ['a', place('a', 'chamber', ['toB'], ['main'])],
      ['b', place('b', 'chamber', ['toA'], ['main'])],
    ])
    const loopStory: StorySeat[] = [
      { entrance: 'a/toB', place: 'b' },
      { entrance: 'b/toA', place: 'a' },
    ]
    const raw = [
      { place: 'a', via: null },
      { place: 'b', via: 'a/toB' },
      { place: 'a', via: 'b/toA' },
    ]
    const restored = PlacePath.restore(raw, loopStory, loopPlaces, 'a', () => true)
    expect(restored.steps).toEqual([{ place: 'a', via: null }, { place: 'b', via: 'a/toB' }])
  })

  it('restore never exceeds MAX_PATH_DEPTH even when the raw chain is longer', () => {
    const chainPlaces = new Map<string, PlaceDefinition>()
    const chainStory: StorySeat[] = []
    const raw: Array<{ place: string; via: string | null }> = [{ place: 'p0', via: null }]
    for (let i = 0; i <= MAX_PATH_DEPTH + 2; i++) chainPlaces.set(`p${i}`, place(`p${i}`, 'chamber', ['next'], ['main']))
    for (let i = 0; i < MAX_PATH_DEPTH + 2; i++) {
      chainStory.push({ entrance: `p${i}/next`, place: `p${i + 1}` })
      raw.push({ place: `p${i + 1}`, via: `p${i}/next` })
    }
    const restored = PlacePath.restore(raw, chainStory, chainPlaces, 'p0', () => true)
    expect(restored.depth).toBe(MAX_PATH_DEPTH)
  })
})
