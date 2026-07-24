// diamondcoreprocessor.com/commands/decoration-kind-index.spec.ts
//
// THE DECORATION INDEX IS KEYED BY LOCATION, NEVER BY BARE LABEL.
//
// A label is not an identity. The same name exists at many places in a hive,
// and a REFERENCE tile is named after its target — so a reference and its
// target ALWAYS share a name, as do two references to the same place. While
// the index bucketed by label, every same-named cell UNIONED its decorations:
// a pheromone painted on one reference appeared on all of them, and a filter
// then acted on that union ("otherwise you get the wrong data").
//
// The write path was never wrong — `addTag(segments, name)` puts the sig in
// the right cell's slot. These tests pin the READ side: the index must answer
// for the cell at a location, and must answer NOTHING rather than answer with
// some other cell's decorations.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// The module self-registers into `window.ioc` and subscribes to the EffectBus
// at import time, so the shell globals must exist BEFORE it is evaluated.
vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => iocTable[key],
    whenReady: () => { /* noop */ },
  }
})

/** Decoration resources by sig — the slice `fetchDecorationRecord` reads. */
const resources = new Map<string, string>()

/** Where Lineage says we are. Replaced wholesale on "navigation", exactly as
 *  the real Lineage replaces `explorerPath` — the index memoizes on identity. */
let here: readonly string[] = []

/** `decorations` slot per location key — what the hydration walk finds. */
const layers = new Map<string, string[]>()

const iocTable: Record<string, unknown> = {
  '@hypercomb.social/Store': {
    getResource: async (sig: string) => {
      const json = resources.get(sig)
      // jsdom's Blob has no .text(); the index only needs that one method.
      return json === undefined ? null : ({ text: async () => json } as unknown as Blob)
    },
  },
  '@hypercomb.social/Lineage': { explorerSegments: () => here },
  '@diamondcoreprocessor.com/HistoryService': {
    // The location signature is opaque to the index — the joined path is a
    // perfectly good stand-in, and it keeps the fixture readable.
    sign: async (l: { explorerSegments?: () => readonly string[] }) =>
      (l.explorerSegments?.() ?? []).join('/'),
    currentLayerAt: async (sig: string) => {
      const decorations = layers.get(sig)
      return decorations ? { decorations } : null
    },
  },
}

const { EffectBus } = await import('@hypercomb/core')
const index = await import('./decoration-kind-index.js')

/** Put a decoration resource in the store and return its (fake) sig. Tag sigs
 *  are content-addressed for real, so two cells tagged `family` genuinely
 *  share ONE sig — the fixture reproduces that, since it is the property that
 *  makes a label-keyed index unrecoverable. */
function putResource(record: unknown): string {
  const json = JSON.stringify(record)
  const sig = `sig:${json}`
  resources.set(sig, json)
  return sig
}

const tagSig = (name: string) =>
  putResource({ kind: 'tag', appliesTo: [], payload: { name } })

const referenceSig = (targetSegments: string[]) =>
  putResource({ kind: 'reference', appliesTo: [], payload: { targetSegments } })

/** Commit a decoration onto the cell at `segments`, the way DecorationService
 *  does — and wait for the index's async record fetch to settle. */
async function decorate(segments: string[], sig: string): Promise<void> {
  const key = segments.join('/')
  layers.set(key, [...(layers.get(key) ?? []), sig])
  EffectBus.emit('decorations:changed', { segments, op: 'append', sig })
  await vi.waitFor(() => expect(resources.has(sig)).toBe(true))
  await Promise.resolve()
  await Promise.resolve()
}

/** Stand at a location, as navigation does. */
function goTo(...segments: string[]): void {
  here = [...segments]
}

beforeEach(() => {
  resources.clear()
  layers.clear()
  here = []
})

// The index is module-level state that accumulates for the life of a session
// — there is no reset, and adding one just for tests would be production API
// paid for by nobody. So each case works in its own corner of the fixture
// hive, which is also closer to how a real hive behaves.

describe('decoration index — location is the identity', () => {
  it('does not smear one reference\'s pheromones onto same-named references', async () => {
    // Two references to the SAME place, in two collections. Both are named
    // after their target, so all three cells share the label "people".
    const ref = referenceSig(['people'])
    await decorate(['work', 'people'], ref)
    await decorate(['family', 'people'], ref)

    // A pheromone on each — one apiece, the whole point of the feature.
    await decorate(['work', 'people'], tagSig('colleagues'))
    await decorate(['family', 'people'], tagSig('relatives'))

    goTo('work')
    expect(index.tagsForLabel('people')).toEqual(['colleagues'])

    goTo('family')
    expect(index.tagsForLabel('people')).toEqual(['relatives'])
  })

  it('keeps a reference\'s pheromones off the target it points at', async () => {
    // The systemic case: a reference is NAMED after its target, so these two
    // cells always collide on label — there is no way to name around it.
    await decorate(['collections', 'people'], referenceSig(['people']))
    await decorate(['collections', 'people'], tagSig('shortlist'))
    await decorate(['people'], tagSig('everyone'))

    goTo('collections')
    expect(index.tagsForLabel('people')).toEqual(['shortlist'])

    goTo()
    expect(index.tagsForLabel('people')).toEqual(['everyone'])
  })

  it('reports a cell that carries nothing as carrying nothing', async () => {
    // A miss must read as "empty", never as "here is the other cell's data" —
    // the failure mode is silent and looks exactly like a working feature.
    await decorate(['places'], tagSig('everywhere'))

    goTo('untagged-page')
    expect(index.tagsForLabel('places')).toEqual([])
    expect(index.hasDecorationKind('places', 'tag')).toBe(false)
  })

  it('resolves a reference target per location, not per name', async () => {
    await decorate(['work', 'people'], referenceSig(['staff']))
    await decorate(['family', 'people'], referenceSig(['relatives']))

    goTo('work')
    expect(index.referenceTargetForLabel('people')).toEqual(['staff'])

    goTo('family')
    expect(index.referenceTargetForLabel('people')).toEqual(['relatives'])
  })

  it('removes a tag from the cell it was removed from, and only that one', async () => {
    // A tag resource is content-addressed, so BOTH cells hold the same sig.
    // The removal event's segments are the only thing distinguishing them.
    const close = tagSig('close')
    await decorate(['left', 'friends'], close)
    await decorate(['right', 'friends'], close)

    EffectBus.emit('decorations:changed', {
      segments: ['left', 'friends'], op: 'removeSig', sig: close,
    })
    await Promise.resolve()

    goTo('left')
    expect(index.tagsForLabel('friends')).toEqual([])
    goTo('right')
    expect(index.tagsForLabel('friends')).toEqual(['close'])
  })

  it('counts same-named cells at different locations as separate carriers', async () => {
    await decorate(['north', 'members'], tagSig('active'))
    await decorate(['south', 'members'], tagSig('active'))

    expect(index.countLabelsWithTag('active')).toBe(2)
  })

  it('hydrates a flattened match at its real location, not here + label', async () => {
    // Under a tag filter the page shows cells from anywhere in the hive, so
    // `here + label` names a layer that does not exist. show-cell hands the
    // absolute paths over in `flatPaths`; without them the match's own
    // decorations are unreachable and its chips come up empty.
    await decorate(['deep', 'nested', 'people'], tagSig('found'))

    goTo('somewhere', 'else')
    EffectBus.emit('render:cell-count', {
      labels: ['people'],
      flatPaths: { people: ['deep', 'nested', 'people'] },
    })
    await vi.waitFor(() => expect(index.tagsForLabel('people')).toEqual(['found']))

    // …and the flatten's paths must not survive into the next ordinary page.
    EffectBus.emit('render:cell-count', { labels: ['people'], flatPaths: {} })
    expect(index.tagsForLabel('people')).toEqual([])
  })
})
