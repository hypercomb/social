// slash-dark-words.spec.ts — A SWITCHED-OFF WORD AT THE DOOR.
//
// Every word reaches its behaviour through the slash drone, so the drone is
// where a word switched off in Beehaviors stops: typed in full it refuses,
// once and out loud, and its behaviour never runs; it leaves the palette,
// the autocomplete and the reading of prose from the one presentation seam;
// nothing is offered past it. The roster still sees it — that is where it
// comes back. A game's word is the game's row and is never gated twice.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const held = new Map<string, unknown>()
const listeners: ((key: string, value: unknown) => void)[] = []
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { held.set(key, value); for (const listener of listeners) listener(key, value) },
  get: (key: string) => held.get(key),
  list: () => [...held.keys()],
  whenReady: () => void 0,
  onRegister: (listener: (key: string, value: unknown) => void) => { listeners.push(listener) },
}
const ioc = (window as unknown as { ioc: { register(key: string, value: unknown): void; get(key: string): unknown } }).ioc

await import('./slash-behaviour.drone.js')
type Drone = InstanceType<typeof import('./slash-behaviour.drone.js').SlashBehaviourDrone>
const drone = ioc.get('@diamondcoreprocessor.com/SlashBehaviourDrone') as Drone

const queen = (command: string, namespace = 'diamondcoreprocessor.com') => {
  const seen = { invoked: [] as string[] }
  ioc.register(`@test/${command}`, {
    command,
    namespace,
    description: `the ${command} word`,
    invoke: (args: string) => { seen.invoked.push(args) },
    slashComplete: () => ['on', 'off'],
  })
  return seen
}

const lights = (on: string[] | null, off: string[] = []): void => {
  if (on) localStorage.setItem('hc:behavior-global-on', JSON.stringify(on))
  else localStorage.removeItem('hc:behavior-global-on')
  localStorage.setItem('hc:behavior-global-off', JSON.stringify(off))
  EffectBus.emit('behavior:enablement-changed', {})
}

const said: { title?: string; actionPayload?: unknown }[] = []
EffectBus.on<{ title?: string; actionPayload?: unknown }>('toast:show', p => { if (p) said.push(p) })

const post = queen('post')
const lounge = queen('lounge', 'lounge.example')
const solomon = queen('solomon')
// The game the word belongs to: a `genotype:'game'` bee with that id.
ioc.register('@test/SolomonDrone', { genotype: 'game', gameId: 'solomon', gameLabel: "Solomon's Key" })

describe('a word switched off in Beehaviors', () => {
  beforeEach(() => {
    localStorage.clear()
    lights([])
    said.length = 0
    post.invoked.length = 0
    lounge.invoked.length = 0
    solomon.invoked.length = 0
  })

  it('runs while lit — a shipped word is lit until switched off', async () => {
    await drone.execute('post', 'hello')
    expect(post.invoked).toEqual(['hello'])
    expect(said).toHaveLength(0)
  })

  it('refuses at the door, says so once, and its behaviour never runs', async () => {
    lights([], ['word:post'])
    await drone.execute('post', 'hello')
    expect(post.invoked).toEqual([])
    expect(said).toHaveLength(1)
    expect(said[0].title).toBe('/post')
    expect(said[0].actionPayload).toEqual({ query: 'post' })
  })

  it('refuses a model calling it by its canonical name too', async () => {
    lights([], ['word:post'])
    await drone.executePublicCanonical('post', 'hello')
    expect(post.invoked).toEqual([])
    expect(said).toHaveLength(1)
  })

  it('leaves the palette and the lexicon, and nothing is offered past it', () => {
    expect(drone.match('po').map(m => m.behaviour.name)).toContain('post')
    lights([], ['word:post'])
    expect(drone.match('po').map(m => m.behaviour.name)).not.toContain('post')
    const row = drone.entries().find(entry => entry.name === 'post')
    expect(row?.hidden).toBe(true)
    expect(row?.dark).toBe(true)
    expect(drone.complete('post', '')).toEqual([])
    // Still a word the command line knows — so it is refused, never made a tile.
    expect(drone.has('post')).toBe(true)
  })

  it('comes back the moment it is lit again', async () => {
    lights([], ['word:post'])
    lights(['word:post'], [])
    await drone.execute('post', 'again')
    expect(post.invoked).toEqual(['again'])
    expect(drone.match('po').map(m => m.behaviour.name)).toContain('post')
  })

  it("reads anyone else's word dark until it is lit", async () => {
    await drone.execute('lounge', '')
    expect(lounge.invoked).toEqual([])
    expect(said).toHaveLength(1)
    lights(['word:lounge'])
    await drone.execute('lounge', '')
    expect(lounge.invoked).toEqual([''])
  })

  it("never gates a game's word — the game's row is its switch", async () => {
    lights([], ['word:solomon'])
    await drone.execute('solomon', '')
    expect(solomon.invoked).toEqual([''])
  })
})

describe('the word census Beehaviors reads', () => {
  beforeEach(() => {
    localStorage.clear()
    lights([])
  })

  it('lists every word once, dark ones included, with whose word it is', () => {
    lights([], ['word:post'])
    const census = drone.wordCensus()
    const post = census.find(entry => entry.word === 'post')
    expect(post).toMatchObject({ word: 'post', dark: true, namespace: 'diamondcoreprocessor.com' })
    expect(census.find(entry => entry.word === 'lounge')).toMatchObject({ dark: true, namespace: 'lounge.example' })
    expect(census.filter(entry => entry.word === 'post')).toHaveLength(1)
  })

  it("leaves a game's word to the game's row", () => {
    expect(drone.wordCensus().map(entry => entry.word)).not.toContain('solomon')
  })
})
