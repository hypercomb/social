// howto/howto.census.spec.ts
//
// EVERY WORD EXPLAINS ITSELF (jwize, 2026-10-25: "every beehavior needs to
// have a how to page that can be published for clarity").
//
// A page is generated from what a word declares, so the rule is on the word:
// a description that is a sentence, and something to try (an example, or a
// machine example). This spec measures the language the way the site lists it:
// the REAL slash drone, fed by a registry that behaves like the real one
// (listeners hear every registration, a wrapped queen becomes a provider), over
// every queen the build ships, the drones that register queens, and the
// providers the drone and the assistant declare by hand. It fails, naming the
// word and what it lacks, when one declares too little. A new word without
// them cannot pass the suite, the same 1:1 rule the windows keep with their
// tutorial lessons.
//
// Not reached from here: a word the shared package registers (`header`), since
// essentials never imports shared. Its declaration is held by hand.

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const map = new Map<string, unknown>()
  const listeners: Array<(key: string, value: unknown) => void> = []
  const waiters = new Map<string, Array<(value: unknown) => void>>()
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: (key: string, value: unknown) => {
      map.set(key, value)
      for (const listen of [...listeners]) { try { listen(key, value) } catch { /* a listener's own trouble */ } }
      for (const wake of waiters.get(key) ?? []) { try { wake(value) } catch { /* likewise */ } }
    },
    get: (key: string) => map.get(key),
    has: (key: string) => map.has(key),
    list: () => [...map.keys()],
    whenReady: (key: string, then: (value: unknown) => void) => {
      if (map.has(key)) then(map.get(key))
      else waiters.set(key, [...(waiters.get(key) ?? []), then])
    },
    onRegister: (listen: (key: string, value: unknown) => void) => { listeners.push(listen); return () => { /* noop */ } },
  }
})

import { isReservedPoolWord } from '@hypercomb/core'
import { factsOf, whatIsMissing, wordPageHtml } from './howto-page.js'

// vite's glob, written literally below so its transform sees it; typed here
// because this package's tsconfig does not pull in vite's client types.
declare global {
  interface ImportMeta {
    glob(pattern: string | string[]): Record<string, () => Promise<unknown>>
  }
}

type Entry = Record<string, unknown> & { name: string }

/** The language, as the how-to site lists it. */
async function everyWord(): Promise<Entry[]> {
  // The drone first: it declares its own providers and wraps queens as they register.
  await import('../commands/slash-behaviour.drone.js')
  const loaders = {
    ...import.meta.glob('../**/*.queen.ts'),
    // drones that register queens of their own (games, the doctrine word)
    ...import.meta.glob(['../games/**/*.drone.ts', '../assistant/llm-context.drone.ts']),
  }
  for (const load of Object.values(loaders)) await load()
  const drone = (window as unknown as { ioc: { get(k: string): { entries(): Entry[] } | undefined } }).ioc
    .get('@diamondcoreprocessor.com/SlashBehaviourDrone')
  return (drone?.entries() ?? []).filter(e => e['local'] !== true)
}

describe('every word can be explained', () => {
  it('finds the whole language (so this ratchet can never go quietly empty)', async () => {
    const words = await everyWord()
    expect(words.length).toBeGreaterThan(150)
    for (const name of ['howto', 'help', 'clear', 'opus', 'create', 'publish']) {
      expect(words.some(w => w.name === name), name).toBe(true)
    }
  }, 120_000)

  it('every word declares a sentence of description and something to try', async () => {
    const lacking = (await everyWord())
      .map(e => ({ word: e.name, missing: whatIsMissing(factsOf(e)) }))
      .filter(r => r.missing.length)
      .map(r => `${r.word}: ${r.missing.join(', ')}`)
    expect(lacking, `these words cannot be explained yet — declare them next to their description:\n${lacking.join('\n')}`).toEqual([])
  }, 120_000)

  it('a word never lists the same sentence twice — the page numbers its examples as different things to try', async () => {
    const repeated = (await everyWord())
      .map(e => ({ word: e.name, inputs: factsOf(e).examples.map(x => x.input) }))
      .filter(r => new Set(r.inputs).size !== r.inputs.length)
      .map(r => r.word)
    expect(repeated, 'put a state-dependent outcome in ONE result ("with X on, …; with it off, …") instead of repeating the input').toEqual([])
  }, 120_000)

  it('every word has a name a tile can bear, that is not a reserved pool word, and is said only once', async () => {
    const names = (await everyWord()).map(e => e.name)
    expect(names.filter(n => !/^[a-z0-9][a-z0-9-]*$/.test(n))).toEqual([])
    expect(names.filter(n => isReservedPoolWord(n))).toEqual([])
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([])
  }, 120_000)

  it('a page can be made for every word, and carries the word', async () => {
    for (const e of await everyWord()) {
      const page = wordPageHtml(factsOf(e))
      expect(page, e.name).toContain(`<h1>${e.name}</h1>`)
      expect(page, e.name).not.toContain('<script')
    }
  }, 120_000)

  it('a word that exists only because of this machine is not part of the language', async () => {
    // an announced agent CLI becomes a model word here; it must never get a page
    const drone = (window as unknown as { ioc: { get(k: string): { addProvider(p: unknown): void; entries(): Entry[] } } }).ioc
      .get('@diamondcoreprocessor.com/SlashBehaviourDrone')
    drone.addProvider({
      name: 'this-machine', priority: 1, execute: () => { /* noop */ },
      behaviours: [{ name: 'only-here', description: 'Ask a CLI that only this machine has', local: true }],
    })
    expect(drone.entries().some(e => e.name === 'only-here')).toBe(true)
    expect((await everyWord()).some(e => e.name === 'only-here')).toBe(false)
  }, 120_000)
})
