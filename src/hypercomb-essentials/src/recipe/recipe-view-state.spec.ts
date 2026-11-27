// recipe-view-state.spec.ts: the recipe view's choices, pinned without a hive.

import { describe, expect, it } from 'vitest'
import type { RecipeTemplateOffer } from './recipe-pool.js'
import type { RecipeTemplateDocument } from './recipe-template.js'
import {
  RECIPE_VIEW_BROWSE,
  RECIPE_VIEW_FRESH_MS,
  RECIPE_VIEW_ZONES_MAX,
  recipeViewAddress,
  recipeViewCounts,
  recipeViewFresh,
  recipeViewKey,
  recipeViewLightStep,
  recipeViewPick,
  recipeViewPickerGroups,
  recipeViewQuery,
  recipeViewSameTile,
  recipeViewShared,
  recipeViewTarget,
  recipeViewTemplate,
  recipeViewTileRows,
  recipeViewZones,
  type RecipeViewSharing,
  type RecipeViewSources,
} from './recipe-view-state.js'

const sigOf = (letter: string): string => letter.repeat(64)

const layout = (name: string, label = 'Method'): RecipeTemplateDocument => ({
  name,
  sections: [{ key: 'steps', kind: 'steps', label }],
})

const offer = (letter: string, name: string, host: string): RecipeTemplateOffer => ({
  sig: sigOf(letter),
  template: { ...layout(name), sig: sigOf(letter) },
  bytes: new Uint8Array([1, 2, 3]),
  host,
  hosts: [host],
  pubkey: 'f'.repeat(64),
})

const words = { builtIn: 'Built in', yours: 'Yours' }

const sources = (over: Partial<RecipeViewSources> = {}): RecipeViewSources => ({
  defaults: [{ sig: sigOf('a'), template: layout('Family recipe') }, { sig: sigOf('b'), template: layout('Weeknight') }],
  kept: [{ sig: sigOf('c'), template: layout('Sunday roast') }],
  zones: ['one.example', 'two.example'],
  offers: new Map([
    ['one.example', [offer('d', 'Dumplings', 'one.example'), offer('e', 'Bread', 'one.example')]],
    ['two.example', [offer('d', 'Dumplings', 'two.example')]],
  ]),
  ...over,
})

describe('which tile the word opens', () => {
  it('opens the one selected tile under the place the cook stands', () => {
    expect(recipeViewTarget(new Set(['soup']), ['kitchen'])).toEqual(['kitchen', 'soup'])
  })

  it('opens the place itself when nothing, or more than one tile, is selected', () => {
    expect(recipeViewTarget(new Set(), ['kitchen', 'soup'])).toEqual(['kitchen', 'soup'])
    expect(recipeViewTarget(new Set(['soup', 'bread']), ['kitchen'])).toEqual(['kitchen'])
  })

  it('names no tile at the hive root with nothing selected', () => {
    expect(recipeViewTarget(new Set(), [])).toEqual([])
    expect(recipeViewTarget(new Set(['soup']), [])).toEqual(['soup'])
  })
})

describe('a live press', () => {
  it('takes a stamp inside the window and refuses an old one, or none', () => {
    const now = 1_000_000
    expect(recipeViewFresh(now - 10, now)).toBe(true)
    expect(recipeViewFresh(now - RECIPE_VIEW_FRESH_MS - 1, now)).toBe(false)
    expect(recipeViewFresh(undefined, now)).toBe(false)
    expect(recipeViewFresh('soon', now)).toBe(false)
  })
})

describe('what changed', () => {
  it('gives the same key to two documents that say the same thing', () => {
    const one = { values: { story: { kind: 'text' as const, text: 'Nan made it.' }, more: { kind: 'text' as const, text: 'x' } } }
    const two = { values: { more: { kind: 'text' as const, text: 'x' }, story: { kind: 'text' as const, text: 'Nan made it.' } } }
    expect(recipeViewKey(one)).toBe(recipeViewKey(two))
  })

  it('gives another key when a word or the named template changes', () => {
    const base = { values: { story: { kind: 'text' as const, text: 'Nan made it.' } } }
    expect(recipeViewKey({ values: { story: { kind: 'text', text: 'Nan made it!' } } })).not.toBe(recipeViewKey(base))
    expect(recipeViewKey({ ...base, template: sigOf('a') })).not.toBe(recipeViewKey(base))
  })
})

describe('which layout a recipe is shown through', () => {
  const defaults = sources().defaults

  it('shows the template the recipe names when this hive holds it', () => {
    const held = { sig: sigOf('9'), template: layout('Held') }
    expect(recipeViewTemplate(sigOf('9'), held, defaults)).toBe(held)
  })

  it('shows the built-in one a recipe names, though it was never held', () => {
    expect(recipeViewTemplate(sigOf('b'), null, defaults)?.template.name).toBe('Weeknight')
  })

  it('falls back to the first built-in for no template, or one that is not here', () => {
    expect(recipeViewTemplate(undefined, null, defaults)?.template.name).toBe('Family recipe')
    expect(recipeViewTemplate(sigOf('9'), null, defaults)?.template.name).toBe('Family recipe')
  })

  it('answers null when there is nothing built in', () => {
    expect(recipeViewTemplate(undefined, null, [])).toBeNull()
  })
})

describe('the search words and the domains', () => {
  it('writes the words the way the domain shelf announces them', () => {
    expect(recipeViewQuery('  Sunday ROAST  ')).toBe('sunday roast')
    expect(recipeViewQuery('x'.repeat(200))).toHaveLength(80)
  })

  it('asks each domain once, in order, and no more than a hive follows', () => {
    expect(recipeViewZones(['b.example', 'a.example', 'b.example', ' '])).toEqual(['b.example', 'a.example'])
    const many = Array.from({ length: 40 }, (_, at) => `host${at}.example`)
    expect(recipeViewZones(many)).toHaveLength(RECIPE_VIEW_ZONES_MAX)
  })
})

describe('the picker groups', () => {
  it('lists built in, the cook\'s own, then one group per domain that is on', () => {
    const groups = recipeViewPickerGroups(sources(), '', words)
    expect(groups.map(group => group.id)).toEqual(['built-in', 'yours', 'domain:one.example', 'domain:two.example'])
    expect(groups.map(group => group.label)).toEqual(['Built in', 'Yours', 'one.example', 'two.example'])
    expect(groups[0].entries.map(entry => entry.template.name)).toEqual(['Family recipe', 'Weeknight'])
  })

  it('marks only the cook\'s own as kept, and never repeats a built-in one there', () => {
    const groups = recipeViewPickerGroups(sources({
      kept: [{ sig: sigOf('a'), template: layout('Family recipe') }, { sig: sigOf('c'), template: layout('Sunday roast') }],
    }), '', words)
    const yours = groups.find(group => group.id === 'yours')
    expect(yours?.entries.map(entry => entry.sig)).toEqual([sigOf('c')])
    expect(yours?.entries.every(entry => entry.kept === true)).toBe(true)
    expect(groups.filter(group => group.id !== 'yours').flatMap(group => group.entries).some(entry => entry.kept)).toBe(false)
  })

  it('shows a template two domains offer under each of them', () => {
    const groups = recipeViewPickerGroups(sources(), '', words)
    const under = (id: string): string[] => groups.find(group => group.id === id)?.entries.map(entry => entry.sig) ?? []
    expect(under('domain:one.example')).toEqual([sigOf('d'), sigOf('e')])
    expect(under('domain:two.example')).toEqual([sigOf('d')])
  })

  it('leaves out a domain that is switched off, whatever it was heard to offer', () => {
    const groups = recipeViewPickerGroups(sources({ zones: ['two.example'] }), '', words)
    expect(groups.map(group => group.id)).toEqual(['built-in', 'yours', 'domain:two.example'])
  })

  it('narrows to the entries that say every word, and drops a group left empty', () => {
    const groups = recipeViewPickerGroups(sources(), 'DUMPLINGS method', words)
    expect(groups.map(group => group.id)).toEqual(['domain:one.example', 'domain:two.example'])
    expect(groups.flatMap(group => group.entries).every(entry => entry.template.name === 'Dumplings')).toBe(true)
    expect(recipeViewPickerGroups(sources(), 'no such words', words)).toEqual([])
  })
})

describe('a pick', () => {
  it('takes a built-in or kept template from here, even when a domain offers it too', () => {
    const both = sources({ offers: new Map([['one.example', [offer('a', 'Family recipe', 'one.example'), offer('c', 'Sunday roast', 'one.example')]]]) })
    expect(recipeViewPick(sigOf('a'), both)?.from).toBe('built-in')
    expect(recipeViewPick(sigOf('c'), both)?.from).toBe('yours')
  })

  it('answers a domain\'s offer with the maker\'s own bytes', () => {
    const picked = recipeViewPick(sigOf('e'), sources())
    expect(picked?.from).toBe('domain')
    expect(picked?.from === 'domain' && picked.offer.bytes).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('finds nothing for a signature nobody offers, or a domain that is off', () => {
    expect(recipeViewPick(sigOf('9'), sources())).toBeNull()
    expect(recipeViewPick(sigOf('e'), sources({ zones: ['two.example'] }))).toBeNull()
  })
})

describe('what the chips say', () => {
  it('counts what each domain asked so far offers, zero included', () => {
    const offers = new Map(sources().offers)
    offers.set('three.example', [])
    expect(recipeViewCounts(offers)).toEqual({ 'one.example': 2, 'two.example': 1, 'three.example': 0 })
  })
})

describe('the desk\'s list', () => {
  it('says a tile\'s route as the address the desk shows', () => {
    expect(recipeViewAddress(['recipes', 'sunday-soup'])).toBe('/recipes/sunday-soup')
    expect(recipeViewAddress(['soup'])).toBe('/soup')
    expect(recipeViewAddress([' recipes ', '', 'soup'])).toBe('/recipes/soup')
    expect(recipeViewAddress([])).toBe('/')
  })

  it('lists the page\'s tiles once each in the page\'s order, the open one marked', () => {
    const holds = (label: string): boolean => label === 'bread'
    expect(recipeViewTileRows(['soup', 'bread', 'salad'], holds, 'bread')).toEqual([
      { label: 'soup', hasRecipe: false, current: false },
      { label: 'bread', hasRecipe: true, current: true },
      { label: 'salad', hasRecipe: false, current: false },
    ])
    // A name listed twice is one tile: the name is the path segment.
    expect(recipeViewTileRows(['soup', 'Soup', ' soup ', 'bread'], holds, 'soup').map(row => row.label)).toEqual(['soup', 'bread'])
  })

  it('never leaves the open tile out, and knows it however its name was spelled', () => {
    expect(recipeViewTileRows([], () => false, 'soup')).toEqual([{ label: 'soup', hasRecipe: false, current: true }])
    expect(recipeViewTileRows(['bread'], () => false, 'soup').map(row => [row.label, row.current])).toEqual([['bread', false], ['soup', true]])
    expect(recipeViewTileRows(['sunday-soup', 'bread'], () => false, 'Sunday Soup')).toEqual([
      { label: 'sunday-soup', hasRecipe: false, current: true },
      { label: 'bread', hasRecipe: false, current: false },
    ])
    expect(recipeViewSameTile('Sunday Soup', 'sunday-soup')).toBe(true)
    expect(recipeViewSameTile('soup', 'stew')).toBe(false)
  })
})

describe('where the recipe is offered', () => {
  /** Says the fallback with its holes filled, as a catalog with no entry does. */
  const say = (_key: string, fallback: string, params?: Record<string, string | number>): string =>
    fallback.replace(/\{(\w+)\}/g, (hole, name: string) => (params && name in params ? String(params[name]) : hole))
  const state = (over: Partial<RecipeViewSharing> = {}): RecipeViewSharing =>
    ({ lit: true, joined: true, room: 'class 4b', host: 'class.example', empty: false, outcome: null, ...over })

  it('is only you while the tile is not lit, whatever room the tab is in', () => {
    expect(recipeViewShared(state({ lit: false }), say)).toEqual({ lit: false, words: 'Only you' })
    expect(recipeViewShared(state({ lit: false, joined: false, outcome: 'kept' }), say)).toEqual({ lit: false, words: 'Only you' })
  })

  it('is your pools when you publish while lit outside a room', () => {
    expect(recipeViewShared(state({ joined: false }), say)).toEqual({ lit: true, words: 'On: left in your pools when you publish' })
    // What a room's host once answered says nothing outside it.
    expect(recipeViewShared(state({ joined: false, outcome: 'kept' }), say)).toEqual({ lit: true, words: 'On: left in your pools when you publish' })
  })

  it('is the room while lit inside one: kept by its host, live, or on its way', () => {
    expect(recipeViewShared(state({ outcome: 'kept' }), say)).toEqual({ lit: true, tone: 'good', words: 'Shared with class 4b \u00b7 class.example' })
    expect(recipeViewShared(state({ outcome: 'live' }), say))
      .toEqual({ lit: true, tone: 'warn', words: 'Shared live with class 4b. class.example keeps entries only for its own people' })
    expect(recipeViewShared(state(), say)).toEqual({ lit: true, words: 'Sharing with class 4b…' })
    expect(recipeViewShared(state({ outcome: 'failed' }), say)).toEqual({ lit: true, words: 'Sharing with class 4b…' })
  })

  it('says an empty recipe is shared once it says something, and never that it is being shared', () => {
    expect(recipeViewShared(state({ empty: true }), say)).toEqual({ lit: true, words: 'On: shared with class 4b once you write something' })
    expect(recipeViewShared(state({ empty: true, outcome: 'kept' }), say).words).toBe('On: shared with class 4b once you write something')
  })

  it('still reads when the room or its host has no name', () => {
    expect(recipeViewShared(state({ room: ' ', host: '', outcome: 'kept' }), say).words).toBe('Shared with the room \u00b7 its host')
  })

  it('asks for every word by its key', () => {
    const keys: string[] = []
    const noting = (key: string, fallback: string): string => { keys.push(key); return fallback }
    for (const each of [state({ lit: false }), state({ joined: false }), state({ empty: true }), state({ outcome: 'kept' }), state({ outcome: 'live' }), state()]) {
      recipeViewShared(each, noting)
    }
    expect([...new Set(keys)].sort()).toEqual([
      'recipe.shared.kept', 'recipe.shared.live', 'recipe.shared.only-you', 'recipe.shared.pools', 'recipe.shared.sharing', 'recipe.shared.waiting',
    ])
  })
})

describe('the bulb', () => {
  it('lights a tile nothing lights, and unlights the tile\'s own mark first', () => {
    expect(recipeViewLightStep({ own: false, branch: false, lit: false })).toBe('light')
    expect(recipeViewLightStep({ own: true, branch: false, lit: true })).toBe('unlight')
    expect(recipeViewLightStep({ own: true, branch: true, lit: true })).toBe('unlight')
  })

  it('unlights the branch the tile is the root of, and holds when a branch above is what lights it', () => {
    expect(recipeViewLightStep({ own: false, branch: true, lit: true })).toBe('unlight-branch')
    expect(recipeViewLightStep({ own: false, branch: false, lit: true })).toBe('held')
  })

  it('names the catalogue as where Browse goes', () => {
    expect(RECIPE_VIEW_BROWSE).toBe('catalogue')
  })
})
