// commands/machine-declarations.spec.ts — EVERY MACHINE DECLARATION, PINNED.
//
// The gate reads `reach` and `scope` as tiers (core's machine-admission): under
// the default grant a destructive verb is refused and anything up to editing is
// admitted, and a participant who narrows the grant refuses more. So a
// declaration that says less than its code does is a door left open, and one
// that says more refuses a verb for nothing. The surface audit asked for every
// declaration to be checked against what its ADMITTED forms really do "before
// reach is ever read as a tier" — it already was. Done 2026-10-01; the
// reasoning for each verdict lives beside the declaration, and the table below
// is the census as audited. Changing a declaration, or adding one, means
// changing this table on purpose.
//
// (A declaration bounds the forms its own `refuse` admits — its contract.
// The bridge door does not run `refuse` yet; that is a door finding, recorded
// in documentation/natural-language-surface-audit.md, not a reason to inflate
// these.)

import { describe, expect, it } from 'vitest'

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
await import('../assistant/bridge.queen.js')
await import('../assistant/file.queen.js')
await import('../assistant/module.queen.js')
await import('../clipboard/clipboard.queen.js')
await import('./create.queen.js')
await import('./language.queen.js')
await import('./postit.queen.js')
await import('./title.queen.js')
// The game view registers the story word (game-view.drone.ts); registered the
// same way here, so the census wraps it without loading the whole view.
const { StoryQueenBee } = await import('../games/story.queen.js')
ioc.register('@diamondcoreprocessor.com/StoryQueenBee', new StoryQueenBee())
await import('../history/undo.queen.js')
await import('../presentation/tiles/hide.queen.js')
await import('../presentation/tiles/organism.queen.js')
await import('../references/gather/feed.queen.js')
await import('../references/gather/from.queen.js')
await import('../references/gather/references.queen.js')
await import('../sharing/profile.queen.js')

type Declared = { reach?: string; scope?: string; refuse?: (args: string) => string | undefined }
const census = (ioc.get('@diamondcoreprocessor.com/SlashBehaviourDrone') as {
  entries(): readonly { name: string; machine?: Declared }[]
}).entries()
const declared = new Map(census.filter(entry => entry.machine).map(entry => [entry.name, entry.machine!]))

/** The census as audited. reach / scope, by verb. */
const AUDITED: Record<string, readonly [reach: string, scope: string]> = {
  // Held: each traced to its code, unchanged.
  file: ['additive', 'hive'],          // a note on its tile and on the tile's word
  copy: ['additive', 'hive'],          // stages the clipboard pool (refused over a held cut)
  cut: ['destructive', 'hive'],        // the tile leaves its page at once
  paste: ['additive', 'hive'],         // appends only; a name already there is skipped
  create: ['additive', 'page'],        // mints; an existing level is a no-op
  language: ['editing', 'local'],      // a locale preference; offer/sync/missing refused
  keyword: ['editing', 'hive'],        // tile slot + the global tag registry
  remove: ['destructive', 'page'],     // the parent's children lose the tile
  accent: ['editing', 'tile'],         // the named form writes one tile's properties
  title: ['editing', 'tile'],          // set only; clearing is refused
  story: ['editing', 'hive'],          // plug/room seat, unplug puts away
  undo: ['editing', 'hive'],           // a cursor; the hive refuses writes while rewound
  redo: ['editing', 'hive'],
  hide: ['editing', 'network'],        // a flag, published as a signed mesh event
  organism: ['editing', 'local'],      // a projection, never a commit
  // Corrected by the audit.
  module: ['additive', 'local'],       // was editing/network: list only; drop is the participant's
  postit: ['editing', 'tile'],         // was additive: `here <text>` replaces an existing note
  feed: ['editing', 'page'],           // was additive: `<page> off` switches a target off
  from: ['editing', 'page'],           // was additive: `<group> off` detaches a link
  references: ['additive', 'local'],   // was page: it opens two panels and writes nothing
  // Judged on arrival (2026-10-03, sealed-audiences Names step 3).
  profile: ['additive', 'local'],      // shows only, from the participant's own host; every set
                                       // form and any other host is refused, so nothing is written
                                       // and no host a model names is ever asked
  // Judged on arrival (2026-10-09, bridge codes).
  bridge: ['destructive', 'local'],    // a ceiling only: every form is refused (who may reach
                                       // this machine is the participant's to say); declared so
                                       // the queen stays awake and the remote door finds `refuse`
}

describe('every machine declaration, as audited', () => {
  it('the census declares exactly the audited verbs — a new one must be judged here first', () => {
    expect([...declared.keys()].sort()).toEqual(Object.keys(AUDITED).sort())
  })

  for (const [verb, [reach, scope]] of Object.entries(AUDITED)) {
    it(`/${verb} is ${reach} at the ${scope}`, () => {
      expect(declared.get(verb)).toMatchObject({ reach, scope })
    })
  }
})

describe('what the corrections refuse', () => {
  it('/bridge refuses a machine every form, the bare word included', () => {
    const refuse = declared.get('bridge')!.refuse!
    for (const line of ['', 'give susan', 'add susan', 'withdraw susan']) {
      expect(refuse(line), line).toContain('only the participant')
    }
  })

  it('/module lets a machine look, and nothing else', () => {
    const refuse = declared.get('module')!.refuse!
    expect(refuse('')).toBeUndefined()
    expect(refuse('list')).toBeUndefined()
    expect(refuse('drop games/solomon')).toBe("/module drop takes the participant's draft off what runs; only the participant says it")
    expect(refuse('commit fresh-rooms')).toContain('only the participant says it')
  })

  it("/profile lets a machine look, on the participant's own host, and nothing else", () => {
    const refuse = declared.get('profile')!.refuse!
    expect(refuse('')).toBeUndefined()
    expect(refuse('@tracker.example')).toBe("/profile shows the participant's own host; a machine does not name another")
    expect(refuse('name jwize')).toBe("/profile name publishes under the participant's key; only the participant says it")
    expect(refuse('about I make hives')).toContain('only the participant says it')
  })

  it('/copy is refused over a tile the participant cut and has not placed', () => {
    const refuse = declared.get('copy')!.refuse!
    const clipboard = (items: readonly { label: string; cut?: boolean }[]): void =>
      ioc.register('@diamondcoreprocessor.com/ClipboardService', { items })
    clipboard([])
    expect(refuse('drafts')).toBeUndefined()
    clipboard([{ label: 'notes' }])
    expect(refuse('drafts')).toBeUndefined()   // a held copy loses nothing when replaced
    clipboard([{ label: 'notes' }, { label: 'roadmap', cut: true }])
    expect(refuse('drafts')).toBe('/copy would replace a tile the participant cut and has not placed yet; leave the clipboard to them')
    // Its own argument rule still answers first.
    expect(refuse('')).toBe('/copy needs a tile name — a machine cannot see what is picked')
  })
})
