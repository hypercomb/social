// presentation/tiles/layout-groups.spec.ts
//
// A GROUP IS A MOLECULE, NOT A FOLDER — pinned.
//
// The claim the shelf rests on is that nothing holds a group. Each creation
// WEARS a word, the group is whatever wears it, and the order is carried by the
// members rather than by a list somewhere. Three things follow, and each of
// them is a test here: a group cannot be empty, the last member leaving IS the
// group ending, and two members can never disagree about which comes first.
//
// No pool. `getPool` answers nothing without a Store, every writer degrades to
// "registered but not persisted" by design, and what is under test is the
// roster — which is what the shelf reads.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  forgetCreation, groupCreation, knownCreations, knownGroups, moveCreation,
  renameCreation, saveCreation,
} from './layout-creations.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

/** The shelf, as names, in the order it is drawn. */
const shelf = (): string[] => knownCreations().map(creation => creation.name)

const wordsOn = (): string[] => knownCreations().map(creation => creation.group)

beforeEach(async () => {
  for (const creation of [...knownCreations()]) await forgetCreation(creation.name)
})

describe('a group is whatever wears the word', () => {

  it('has no existence before a member wears it, and none after the last leaves', async () => {
    await saveCreation('masthead', sig(1))
    expect(knownGroups()).toEqual([])

    await groupCreation('masthead', 'chrome')
    expect(knownGroups().map(group => group.name)).toEqual(['chrome'])

    // Setting it loose is not deleting a group. There was never an object to
    // delete — the word simply stops being worn.
    await groupCreation('masthead', '')
    expect(knownGroups()).toEqual([])
  })

  it('counts the members rather than holding a list of them', async () => {
    await saveCreation('one', sig(1))
    await saveCreation('two', sig(2))
    await groupCreation('one', 'chrome')
    await groupCreation('two', 'chrome')
    expect(knownGroups()).toEqual([{ name: 'chrome', address: expect.any(String), count: 2 }])

    await forgetCreation('two')
    expect(knownGroups()[0]?.count).toBe(1)
  })

  it('folds the word, so two spellings are one molecule and not two rows', async () => {
    await saveCreation('one', sig(1))
    await saveCreation('two', sig(2))
    await groupCreation('one', 'Site Chrome')
    await groupCreation('two', 'site-chrome')
    expect(knownGroups().map(group => group.name)).toEqual(['site-chrome'])
  })
})

describe('the shelf keeps a group together, in the order its members say', () => {

  it('draws the grouped ones first and the loose ones last', async () => {
    await saveCreation('loose-one', sig(1))
    await saveCreation('gathered', sig(2))
    await saveCreation('loose-two', sig(3))
    await groupCreation('gathered', 'chrome')

    expect(shelf()).toEqual(['gathered', 'loose-one', 'loose-two'])
    expect(wordsOn()).toEqual(['chrome', '', ''])
  })

  it('never interleaves two words', async () => {
    for (const n of [1, 2, 3, 4]) await saveCreation(`piece-${n}`, sig(n))
    await groupCreation('piece-1', 'chrome')
    await groupCreation('piece-3', 'chrome')
    await groupCreation('piece-2', 'body')
    await groupCreation('piece-4', 'body')

    expect(wordsOn()).toEqual(['chrome', 'chrome', 'body', 'body'])
  })

  it('moves one place at a time, and moving the first one back does nothing', async () => {
    for (const n of [1, 2, 3]) await saveCreation(`piece-${n}`, sig(n))
    for (const n of [1, 2, 3]) await groupCreation(`piece-${n}`, 'chrome')
    expect(shelf()).toEqual(['piece-1', 'piece-2', 'piece-3'])

    await moveCreation('piece-3', -1)
    expect(shelf()).toEqual(['piece-1', 'piece-3', 'piece-2'])

    // Nothing to move past — the row is the row, and it says so by not moving.
    expect(await moveCreation('piece-1', -1)).toBe(false)
    expect(shelf()).toEqual(['piece-1', 'piece-3', 'piece-2'])
  })

  it('moves within the word only — a group cannot be walked out of', async () => {
    await saveCreation('here', sig(1))
    await saveCreation('elsewhere', sig(2))
    await groupCreation('here', 'chrome')
    await groupCreation('elsewhere', 'body')

    expect(await moveCreation('here', 1)).toBe(false)
    expect(wordsOn()).toEqual(['chrome', 'body'])
  })

  it('joins at the END, so a newcomer moves nothing that was already arranged', async () => {
    for (const n of [1, 2]) await saveCreation(`piece-${n}`, sig(n))
    for (const n of [1, 2]) await groupCreation(`piece-${n}`, 'chrome')
    await moveCreation('piece-2', -1)
    expect(shelf()).toEqual(['piece-2', 'piece-1'])

    await saveCreation('late', sig(3))
    await groupCreation('late', 'chrome')
    expect(shelf()).toEqual(['piece-2', 'piece-1', 'late'])
  })
})

describe('a name is what it is called, never what it is', () => {

  it('keeps the identity across a rename, so what was hidden stays hidden', async () => {
    const made = await saveCreation('draft', sig(1))
    const renamed = await renameCreation('draft', 'masthead')
    expect(renamed?.name).toBe('masthead')
    expect(renamed?.id).toBe(made?.id)
    expect(renamed?.pieceSig).toBe(sig(1))
  })

  it('keeps the word and the place it was in', async () => {
    await saveCreation('one', sig(1))
    await saveCreation('two', sig(2))
    await groupCreation('one', 'chrome')
    await groupCreation('two', 'chrome')
    await moveCreation('two', -1)

    await renameCreation('two', 'header')
    expect(shelf()).toEqual(['header', 'one'])
    expect(wordsOn()).toEqual(['chrome', 'chrome'])
  })

  it('takes the free neighbour rather than the name already answered to', async () => {
    await saveCreation('masthead', sig(1))
    await saveCreation('draft', sig(2))
    expect((await renameCreation('draft', 'masthead'))?.name).toBe('masthead-2')
  })
})
