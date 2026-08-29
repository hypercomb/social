// diamondcoreprocessor.com/presentation/avatars/resting-bees.spec.ts
//
// A TILE THAT HAS BEEN TALKED TO KEEPS ITS BEE. What this pins:
//
//   1. one bee per TILE, never one per conversation
//   2. branded by the NEWEST thread's model — the tier you are in now
//   3. archived threads do not count, which is how a bee goes away again
//   4. the id is the chat window's own, so resting and working are ONE sprite
//   5. no targets for the hive's own conversation — how the drone spells
//      "hive-wide"
//   6. the id reads back as the conversation, so a press can open the talk

import { describe, it, expect } from 'vitest'
import { restingBees, restingConvoId, type RestingSource } from './resting-bees.js'

const chat = (over: Partial<RestingSource> & { path: string; convoId: string }): RestingSource => ({
  title: 'what is this', lastAt: 1_000, archived: false, ...over,
})

const noModels = (): string => ''

describe('resting bees — one per talked-to tile', () => {

  it('gives a tile ONE bee however many conversations it holds', () => {
    const bees = restingBees([
      chat({ path: '/diagrams', convoId: 'chat:tile:/diagrams', lastAt: 10 }),
      chat({ path: '/diagrams', convoId: 'chat:tile:/diagrams::b', lastAt: 30 }),
      chat({ path: '/diagrams', convoId: 'chat:tile:/diagrams::c', lastAt: 20 }),
    ], noModels)

    expect(bees.size).toBe(1)
    // …and it is the NEWEST thread's, because that is the one you are in.
    expect([...bees.keys()]).toEqual(['chat:chat:tile:/diagrams::b'])
  })

  it('one per tile, across tiles', () => {
    const bees = restingBees([
      chat({ path: '/diagrams', convoId: 'a' }),
      chat({ path: '/revolucion', convoId: 'b' }),
      chat({ path: '/behaviors', convoId: 'c' }),
    ], noModels)
    expect(bees.size).toBe(3)
  })

  it('brands from the model the newest thread was last held in', () => {
    const models: Record<string, string> = { old: 'opus', newest: 'haiku' }
    const bees = restingBees([
      chat({ path: '/diagrams', convoId: 'old', lastAt: 10 }),
      chat({ path: '/diagrams', convoId: 'newest', lastAt: 99 }),
    ], id => models[id] ?? '')

    const bee = bees.get('chat:newest')
    expect(bee?.model).toBe('haiku')
    expect(bee?.vendor).toBe('anthropic')
    expect(bee?.tier).toBe('fast')
  })

  it('falls back to the composer’s default when no tier was ever chosen', () => {
    const bee = restingBees([chat({ path: '/diagrams', convoId: 'a' })], noModels).get('chat:a')
    expect(bee?.model).toBe('opus')
    expect(bee?.tier).toBe('deep')
  })

  it('ARCHIVED threads do not count — and a tile with only archived ones loses its bee', () => {
    const bees = restingBees([
      chat({ path: '/diagrams', convoId: 'live', lastAt: 10 }),
      chat({ path: '/diagrams', convoId: 'filed', lastAt: 99, archived: true }),
      chat({ path: '/ai-videos', convoId: 'gone', lastAt: 99, archived: true }),
    ], noModels)

    // The archived one is newer, and still not the one the tile wears.
    expect([...bees.keys()]).toEqual(['chat:live'])
    expect(bees.size).toBe(1)
  })

  it('the id is the chat window’s own, so resting and working are one sprite', () => {
    // chat-window's #beeId is `chat:${convoId}` — same string, so the
    // registry's working agent SHADOWS this record rather than adding a
    // second bee over the same tile.
    const bee = restingBees([chat({ path: '/diagrams', convoId: 'chat:tile:/diagrams' })], noModels)
    expect([...bee.keys()]).toEqual(['chat:chat:tile:/diagrams'])
  })

  it('sits on the tile, with the rest of the path as segments', () => {
    const bee = restingBees([chat({ path: '/dolphin/site', convoId: 'a' })], noModels).get('chat:a')
    expect(bee?.targets).toEqual(['site'])
    expect(bee?.segments).toEqual(['dolphin'])
  })

  it('the hive’s own conversation has NO targets — that is how hive-wide is spelled', () => {
    const bee = restingBees([chat({ path: '/', convoId: 'a' })], noModels).get('chat:a')
    expect(bee?.targets).toEqual([])
    expect(bee?.segments).toEqual([])
  })

  it('nothing talked to is no bees', () => {
    expect(restingBees([], noModels).size).toBe(0)
  })
})

describe('restingConvoId', () => {
  it('reads the conversation back out of the bee id', () => {
    const [id] = [...restingBees([{
      path: '/diagrams', convoId: 'chat:tile:/diagrams',
      title: 't', lastAt: 1, archived: false,
    }], noModels).keys()]
    expect(restingConvoId(id!)).toBe('chat:tile:/diagrams')
  })

  it('is empty for an id that is not a conversation — an agent’s report stays its own', () => {
    expect(restingConvoId('folder-sync-1')).toBe('')
  })
})
