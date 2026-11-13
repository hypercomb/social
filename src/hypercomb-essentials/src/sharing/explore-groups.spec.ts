import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GROUP_ASK_TIMEOUT_MS, GROUP_MIN_VALUES, GROUP_RETRY_MS,
  forgetGroups, groupKey, groupPrompt, groupTokens, groupValues, parseGroups, type GroupDeps,
} from './explore-groups.js'

const VALUES = ['soup', 'miso ramen', 'bread', 'lemon-tart', 'pancakes', 'curry', 'nachos', 'shakshuka', 'blue-cheese']

const answer = (groups: unknown): string => `Here you go:\n\`\`\`json\n${JSON.stringify({ groups })}\n\`\`\`\nEnjoy {really}`
const TWO = answer([{ name: 'A', items: [1, 2, 3, 4] }, { name: 'B', items: [5, 6, 7, 8, 9] }])

type Fake = GroupDeps & { asks: number; tokens: number[]; clock: number }
const deps = (reply: () => Promise<string>, available = true): Fake => {
  const d: Fake = {
    asks: 0, tokens: [], clock: 0,
    available: () => available,
    ask: async (_s, _u, maxTokens) => { d.asks++; d.tokens.push(maxTokens); return reply() },
    now: () => d.clock,
  }
  return d
}

describe('explore groups — named aggregations, presentation only', () => {
  beforeEach(() => forgetGroups())
  afterEach(() => vi.useRealTimers())

  it('reads item numbers out of a chatty answer, keeping the list\'s own spelling', () => {
    const groups = parseGroups(answer([
      { name: 'Soups', items: [1, 2] },
      { name: 'Baking', items: [3, 4, 5] },
    ]), VALUES)
    expect(groups?.[0]).toEqual({ name: 'Soups', values: ['soup', 'miso ramen'] })
    expect(groups?.[1]?.values).toEqual(['bread', 'lemon-tart', 'pancakes'])
  })

  it('still reads values copied back as text, matched by their fold', () => {
    const groups = parseGroups(answer([
      { name: 'Soups', values: ['Soup', 'Miso Ramen'] },
      { name: 'Baking', values: ['Lemon Tart'] },
    ]), VALUES)
    expect(groups?.[1]?.values).toEqual(['lemon-tart'])
  })

  it('every value lands exactly once: out-of-range and repeated items are dropped, leftovers go to Other', () => {
    const groups = parseGroups(answer([
      { name: 'Soups', items: [1, 1, 99, 0, 2.5, 'gazpacho'] },
      { name: 'Mains', items: [6, 1, 7] },
    ]), VALUES, 'Andere')!
    const all = groups.flatMap(group => group.values)
    expect([...all].sort()).toEqual([...VALUES].sort())
    expect(groups.find(group => group.name === 'Soups')!.values).toEqual(['soup'])
    expect(groups.find(group => group.name === 'Andere')!.values).toContain('bread')
  })

  it('folds two groups the model named the same', () => {
    const groups = parseGroups(answer([
      { name: 'Soups', items: [1] },
      { name: 'soups', items: [2] },
      { name: 'Rest', items: [3, 4, 5, 6, 7, 8, 9] },
    ]), VALUES)!
    expect(groups.map(group => group.name)).toEqual(['Soups', 'Rest'])
    expect(groups[0]!.values).toEqual(['soup', 'miso ramen'])
  })

  it('an answer that is not usable keeps the flat list', () => {
    expect(parseGroups('I could not do that.', VALUES)).toBeNull()
    expect(parseGroups('{"groups": "nope"}', VALUES)).toBeNull()
    expect(parseGroups('{"groups":[{"name":"A","items":[1,2', VALUES)).toBeNull()
    expect(parseGroups(answer([{ name: 'Food', items: VALUES.map((_, i) => i + 1) }]), VALUES)).toBeNull()
  })

  it('numbers the values in the prompt and sizes the answer to the list', () => {
    expect(groupPrompt('recipes', ['a', 'b'])).toContain('1. a\n2. b')
    expect(groupTokens(200)).toBeGreaterThan(groupTokens(10))
  })

  it('never asks without an AI, or for a list short enough to read flat', async () => {
    const none = deps(async () => TWO, false)
    expect(await groupValues('recipes', VALUES, none)).toBeNull()
    expect(none.asks).toBe(0)
    const short = deps(async () => TWO)
    expect(await groupValues('recipes', VALUES.slice(0, GROUP_MIN_VALUES - 1), short)).toBeNull()
    expect(short.asks).toBe(0)
  })

  it('asks once per name and value set, whatever order or spelling the values come in', async () => {
    const d = deps(async () => TWO)
    const first = await groupValues('recipes', VALUES, d)
    const again = await groupValues('Recipes', [...VALUES].reverse().map(v => v.replace('-', ' ')), d)
    expect(first).not.toBeNull()
    expect(again).toEqual(first)
    expect(d.asks).toBe(1)
    expect(groupKey('recipes', ['b', 'a'])).toBe(groupKey('Recipes', ['a', 'b']))
  })

  it('a failed grouping is not paid for again on every open — only after the retry window', async () => {
    let fail = true
    const d = deps(async () => { if (fail) throw new Error('model down'); return TWO })
    expect(await groupValues('recipes', VALUES, d)).toBeNull()
    fail = false
    await Promise.resolve()
    expect(await groupValues('recipes', VALUES, d)).toBeNull()
    expect(d.asks).toBe(1)
    d.clock += GROUP_RETRY_MS + 1
    expect(await groupValues('recipes', VALUES, d)).not.toBeNull()
    expect(d.asks).toBe(2)
  })

  it('a model that never answers gives up after the timeout', async () => {
    vi.useFakeTimers()
    const d = deps(() => new Promise<string>(() => {}))
    const pending = groupValues('recipes', VALUES, d)
    await vi.advanceTimersByTimeAsync(GROUP_ASK_TIMEOUT_MS + 1)
    expect(await pending).toBeNull()
  })
})
