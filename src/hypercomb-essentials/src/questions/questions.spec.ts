// questions/questions.spec.ts — the pure half of Hypercomb Q and A.

import { describe, expect, it } from 'vitest'
import {
  GAME_NAME, MIN_TO_MATERIALIZE, boardText, gameDepth, gameNameFor, hiveOfGame, inGame, isQuestionTitle, isTallyNote, parseCategoryNames, parsePlacedIndexes, rankAnswers, scoreboard, settlePlan, tallyText,
  type PageTile,
} from './questions.js'

describe('the game is read by name, a question by its title', () => {
  it('a game is named for its hive, and the name says which hive', () => {
    expect(gameNameFor('hypercomb')).toBe('hypercomb q and a')
    expect(gameNameFor('  lecture  hall ')).toBe('lecture hall q and a')
    expect(gameNameFor('')).toBe('')
    expect(hiveOfGame('hypercomb q and a')).toBe('hypercomb')
    expect(hiveOfGame('Hypercomb-Q-And-A')).toBe('hypercomb')
    expect(hiveOfGame('q and a')).toBeNull()
    expect(hiveOfGame('storage')).toBeNull()
  })

  it('a page is in the game when it is inside a layer\'s Q and A', () => {
    expect(inGame([GAME_NAME])).toBe(true)
    expect(inGame(['lecture', 'Hypercomb Q And A', 'storage'])).toBe(true)
    expect(gameDepth(['cells', 'hypercomb q and a', 'storage'])).toBe(1)
    expect(inGame(['lecture'])).toBe(false)
    expect(inGame([])).toBe(false)
  })

  it('a question is a title that asks — the name cannot carry the mark', () => {
    expect(isQuestionTitle('what is a bag?')).toBe(true)
    expect(isQuestionTitle('これは何？ ')).toBe(true)
    expect(isQuestionTitle('what-is-a-bag')).toBe(false)
    expect(isQuestionTitle('storage')).toBe(false)
  })
})

const q = (name: string): PageTile => ({ name, question: true, children: 0, inside: [] })
const cat = (name: string, inside: string[], extra = 0): PageTile => ({ name, question: false, children: inside.length + extra, inside })

describe('settlePlan — categories materialize and retract by count', () => {
  it('a label with enough questions becomes a new category with them inside', () => {
    const plan = settlePlan([q('what is a pool?'), q('what is a bag?'), q('who is dana?')], [
      { question: 'what is a pool?', category: 'Storage' },
      { question: 'what is a bag?', category: 'storage' },
      { question: 'who is dana?', category: 'People' },
    ])
    expect(plan.create).toEqual([{ category: 'Storage', members: ['what is a pool?', 'what is a bag?'] }])
    expect(plan.move).toEqual([])
    expect(plan.retract).toEqual([])
    expect(MIN_TO_MATERIALIZE).toBe(2)
  })

  it('an existing tile under the name receives even one question — a host may lay categories out beforehand', () => {
    const plan = settlePlan([cat('People', []), q('who is dana?')], [{ question: 'who is dana?', category: 'people' }])
    expect(plan.create).toEqual([])
    expect(plan.move).toEqual([{ category: 'People', members: ['who is dana?'] }])
  })

  it('ignores placements naming a question, the question itself, or a tile not on the page', () => {
    const plan = settlePlan([q('a?'), q('b?')], [
      { question: 'a?', category: 'b?' },
      { question: 'b?', category: 'b?' },
      { question: 'nowhere?', category: 'Lost' },
      { question: 'a?', category: null },
    ])
    expect(plan).toEqual({ create: [], move: [], retract: [] })
  })

  const minted = new Set(['storage', 'mixed'])

  it('a minted category left with too few questions retracts, and goes when nothing else is inside', () => {
    const plan = settlePlan([cat('Storage', ['what is a pool?']), cat('Mixed', ['one?'], 1)], [], minted)
    expect(plan.retract).toEqual([
      { category: 'Storage', members: ['what is a pool?'], remove: true },
      { category: 'Mixed', members: ['one?'], remove: false },
    ])
  })

  it('a category the host laid out never retracts — it keeps even one question', () => {
    const plan = settlePlan([cat('People', ['who is dana?'])], [])
    expect(plan.retract).toEqual([])
    expect(settlePlan([cat('People', ['who is dana?'])], [], minted).retract).toEqual([])
  })

  it('a category about to gain a question does not retract', () => {
    const plan = settlePlan([cat('Storage', ['what is a pool?']), q('what is a bag?')], [{ question: 'what is a bag?', category: 'Storage' }], minted)
    expect(plan.retract).toEqual([])
    expect(plan.move).toEqual([{ category: 'Storage', members: ['what is a bag?'] }])
  })

  it('a plain tile holding no questions is never retracted', () => {
    const plan = settlePlan([{ name: 'notes', question: false, children: 3, inside: [] }], [], new Set(['notes']))
    expect(plan.retract).toEqual([])
  })
})

describe('what an AI answered', () => {
  it('parses category names one per line, stripping bullets and folded duplicates', () => {
    expect(parseCategoryNames('Categories:\n- Storage\n2) People\n* storage\n\nHistory & Layers')).toEqual(['Storage', 'People', 'History & Layers'])
  })

  it('parses placed indexes from the first array, -1 for anything missing or odd', () => {
    expect(parsePlacedIndexes('Sure: [0, 2, -1, "x"]', 5)).toEqual([0, 2, -1, -1, -1])
    expect(parsePlacedIndexes('no array here', 2)).toEqual([-1, -1])
  })
})

describe('the tally', () => {
  const ana = 'a'.repeat(64)
  const ben = 'b'.repeat(64)
  const label = (k: string): string => (k === ana ? 'Ana' : k === ben ? 'Ben' : 'you')

  it('ranks answers by takes and scores who brought them', () => {
    const questions = [
      { question: 'what is a pool?', answers: [
        { id: '1', text: 'a folder of meaning', by: ana, takes: 3 },
        { id: '2', text: 'a bag', by: ben, takes: 1 },
      ] },
      { question: 'who is dana?', answers: [
        { id: '3', text: 'the hero', by: ben, takes: 2 },
        { id: '4', text: 'a wizard', by: ana, takes: 2 },
      ] },
    ]
    expect(rankAnswers(questions[0].answers).map(a => a.id)).toEqual(['1', '2'])
    expect(scoreboard(questions)).toEqual([
      { by: ana, takes: 5, answers: 2, best: 1 },
      { by: ben, takes: 3, answers: 2, best: 1 },
    ])
    const text = tallyText(questions[0], label)
    expect(text.startsWith('Tally · 2 answers')).toBe(true)
    expect(text).toContain('1. a folder of meaning — 3 takes · Ana')
    expect(isTallyNote(text)).toBe(true)
    const board = boardText(scoreboard(questions), label)
    expect(board).toContain('1. Ana — 5 takes, 1 best, 2 answers')
    expect(isTallyNote(board)).toBe(true)
  })

  it('an answer nobody took wins nothing', () => {
    expect(scoreboard([{ question: 'q?', answers: [{ id: '1', text: 'x', by: ana, takes: 0 }] }])).toEqual([
      { by: ana, takes: 0, answers: 1, best: 0 },
    ])
  })
})
