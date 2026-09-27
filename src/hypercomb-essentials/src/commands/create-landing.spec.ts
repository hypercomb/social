import { describe, expect, it } from 'vitest'
import { createLanding, type LandingReader } from './create-landing.js'

/** A hive as routes: `children` lists each page's tile names, `refs` maps a
 *  reference tile's route to the route it points at. */
const hive = (
  children: Record<string, string[]>,
  refs: Record<string, string[]>,
  links: Record<string, string[]> = {},
): LandingReader => ({
  targetAt: async segments => refs[segments.join('/')] ?? null,
  childNames: async page => children[page.join('/')] ?? [],
  groupOf: async page => links[page.join('/')] ?? null,
})

const people = hive(
  {
    '': ['people', 'friends', 'notes'],
    people: ['susan', 'dylan', 'bob'],
    friends: ['susan', 'dylan'],
    notes: ['groceries', 'ideas', 'susan'],
  },
  {
    'friends/susan': ['people', 'susan'],
    'friends/dylan': ['people', 'dylan'],
    'notes/susan': ['people', 'susan'],
  },
  { friends: ['people'] },
)

describe('createLanding', () => {
  it('makes a new tile on a linked page in the group it gathers from, and gathers it back', async () => {
    const landing = await createLanding(['friends'], ['ana'], people)
    expect(landing.base).toEqual(['people'])
    expect(landing.parts).toEqual(['ana'])
    expect(landing.gather).toEqual({ name: 'ana', sourceSegments: ['people', 'ana'], parentSegments: ['friends'] })
  })

  it('keeps the nest whole when the holder gathers a nested make', async () => {
    const landing = await createLanding(['friends'], ['ana', 'phone'], people)
    expect(landing.base).toEqual(['people'])
    expect(landing.parts).toEqual(['ana', 'phone'])
    expect(landing.gather?.sourceSegments).toEqual(['people', 'ana'])
  })

  it('gathers an existing member of the group instead of making a second one', async () => {
    // bob lives in people but friends has not gathered him yet.
    const landing = await createLanding(['friends'], ['bob'], people)
    expect(landing.base).toEqual(['people'])
    expect(landing.gather?.sourceSegments).toEqual(['people', 'bob'])
  })

  it('makes a tile behind a doorway at the target, never in the reference husk', async () => {
    const landing = await createLanding(['friends', 'susan'], ['phone'], people)
    expect(landing).toEqual({ base: ['people', 'susan'], parts: ['phone'], gather: null })
  })

  it('walks a nest through an existing doorway', async () => {
    const landing = await createLanding(['friends'], ['susan', 'phone'], people)
    expect(landing).toEqual({ base: ['people', 'susan'], parts: ['phone'], gather: null })
  })

  it('leaves an existing name alone (no second make, no gather)', async () => {
    const landing = await createLanding(['friends'], ['susan'], people)
    expect(landing).toEqual({ base: ['friends'], parts: ['susan'], gather: null })
  })

  it('never guesses a holder from references: no link, the tile lands where you stand', async () => {
    // Every tile on `crew` is a reference into people, but crew wears no link.
    const unlinked = hive({ crew: ['susan', 'dylan'], people: ['susan', 'dylan'] }, {
      'crew/susan': ['people', 'susan'],
      'crew/dylan': ['people', 'dylan'],
    })
    expect(await createLanding(['crew'], ['ana'], unlinked)).toEqual({ base: ['crew'], parts: ['ana'], gather: null })
    expect(await createLanding(['notes'], ['recipes'], people)).toEqual({ base: ['notes'], parts: ['recipes'], gather: null })
  })

  it('follows a link one hop only, so chained and mutual links terminate', async () => {
    const chain = hive({ friends: [], people: [], contacts: [] }, {}, { friends: ['people'], people: ['friends'] })
    expect((await createLanding(['friends'], ['ana'], chain)).base).toEqual(['people'])
    expect((await createLanding(['people'], ['ana'], chain)).base).toEqual(['friends'])
  })

  it('never turns the hive itself or an empty page into a holder', async () => {
    expect((await createLanding([], ['ana'], people)).gather).toBeNull()
    expect((await createLanding(['empty'], ['ana'], people)).gather).toBeNull()
  })

  it('does not gather a page into itself', async () => {
    const self = hive({ people: ['susan'] }, {}, { people: ['people'] })
    expect(await createLanding(['people'], ['ana'], self)).toEqual({ base: ['people'], parts: ['ana'], gather: null })
  })

  it('makes a tile on a LINKED page in its group even when nothing there is a reference yet', async () => {
    const linked: LandingReader = {
      ...hive({ family: [], people: ['susan'] }, {}),
      groupOf: async page => page.join('/') === 'family' ? ['people'] : null,
    }
    const landing = await createLanding(['family'], ['ana'], linked)
    expect(landing.base).toEqual(['people'])
    expect(landing.gather).toEqual({ name: 'ana', sourceSegments: ['people', 'ana'], parentSegments: ['family'] })
  })

  it('still walks an existing name before asking the link', async () => {
    const linked: LandingReader = { ...people, groupOf: async () => ['colleagues'] }
    expect(await createLanding(['friends'], ['susan', 'phone'], linked))
      .toEqual({ base: ['people', 'susan'], parts: ['phone'], gather: null })
  })

})
