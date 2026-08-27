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

/** `properties[0].small.image` per location key — the picture a cell wears. A
 *  reference cell has none of its own, so this is what its TARGET supplies. */
const layerImages = new Map<string, string>()

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
      const image = layerImages.get(sig)
      if (!decorations && !image) return null
      return {
        ...(decorations ? { decorations } : {}),
        ...(image ? { properties: [{ small: { image } }] } : {}),
      }
    },
  },
}

const { EffectBus } = await import('@hypercomb/core')
const index = await import('./decoration-kind-index.js')

/** Sig per distinct content — a stand-in for SHA-256 that keeps the two
 *  properties the index depends on: identical content yields the SAME sig (so
 *  two cells tagged `family` genuinely share one, which is what makes a
 *  label-keyed index unrecoverable), and it is 64 hex characters. The hydration
 *  walk VALIDATES that shape before fetching, so a readable fake sig would make
 *  every walk silently skip and leave only the event path under test. */
const sigOf = new Map<string, string>()

function putResource(record: unknown): string {
  const json = JSON.stringify(record)
  let sig = sigOf.get(json)
  if (!sig) {
    sig = String(sigOf.size + 1).padStart(64, '0')
    sigOf.set(json, sig)
  }
  resources.set(sig, json)
  return sig
}

const tagSig = (name: string) =>
  putResource({ kind: 'tag', appliesTo: [], payload: { name } })

const referenceSig = (
  targetSegments: string[],
  targetSig?: string,
  editsRootDefault = false,
) =>
  putResource({
    kind: 'reference',
    appliesTo: [],
    payload: {
      targetSegments,
      ...(targetSig ? { targetSig } : {}),
      ...(editsRootDefault ? { editsRootDefault: true } : {}),
    },
  })

/** A reference that demands something of what it shows. Written RAW (unsorted,
 *  duplicated, padded) on purpose — the index must not trust the writer. */
const requiringSig = (targetSegments: string[], requiredMarks: unknown[]) =>
  putResource({
    kind: 'reference',
    appliesTo: [],
    payload: { targetSegments, requiredMarks },
  })

const titleSig = (text: Record<string, string>) =>
  putResource({ kind: 'title', appliesTo: [], payload: { text } })

const featureSig = (kind: string) =>
  putResource({ kind, appliesTo: [], payload: {} })

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
  layerImages.clear()
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

  it('routes only an explicitly marked Portal row to the root default', async () => {
    await decorate(['portal-inventory', 'jaime'], referenceSig(['jaime'], undefined, true))
    await decorate(['friends', 'jaime'], referenceSig(['jaime']))

    goTo('portal-inventory')
    await vi.waitFor(() =>
      expect(index.referenceEditsRootDefaultForLabel('jaime')).toBe(true))

    goTo('friends')
    await vi.waitFor(() =>
      expect(index.referenceEditsRootDefaultForLabel('jaime')).toBe(false))
  })

  it('keeps pre-marker references in the legacy sets Portal authoring surface', async () => {
    await decorate(['sets', 'legacy-jaime'], referenceSig(['legacy-jaime']))

    goTo('sets')
    await vi.waitFor(() =>
      expect(index.referenceEditsRootDefaultForLabel('legacy-jaime')).toBe(true))
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

  it('indexes the ancestors of the page you land on', async () => {
    // The breadcrumb's crumbs are ancestors, and an ancestor is never a cell on
    // the page you are standing on — so nothing else in the index ever walks
    // one. Walking IN warms them incidentally; arriving by a jump (deep link,
    // restored session, reference portal) does not, which is why the crumbs
    // kept reading raw addresses after the title feature landed.
    layers.set('venue', [titleSig({ en: 'The Blue Note', ja: 'ブルーノート' })])
    layers.set('venue/room', [titleSig({ en: 'Back Room' })])

    goTo('venue', 'room')
    EffectBus.emit('render:cell-count', { labels: [], flatPaths: {} })

    await vi.waitFor(() => {
      expect(index.titleForSegments(['venue'], 'en')).toBe('The Blue Note')
      expect(index.titlesForSegments(['venue'])).toEqual({ en: 'The Blue Note', ja: 'ブルーノート' })
      expect(index.titleForSegments(['venue', 'room'], 'en')).toBe('Back Room')
    })
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

  it('reconciles removed feature kinds after a whole-layer replacement', async () => {
    const website = featureSig('website')
    await decorate(['adopted', 'page'], website)
    goTo('adopted')
    expect(index.hasDecorationKind('page', 'website')).toBe(true)

    // importTree replaces this layer wholesale, so no per-decoration
    // decorations:changed removeSig event accompanies the removal.
    layers.set('adopted/page', [])
    index.forgetDecorationLabel('page')
    EffectBus.emit('render:cell-count', { labels: ['page'], flatPaths: {} })

    await vi.waitFor(() =>
      expect(index.hasDecorationKind('page', 'website')).toBe(false))
  })

  // ── Portal default FACE: resolve THROUGH the pointer ────────────────────
  //
  // A reference cell's layer is a pointer with no `properties`, so rendered
  // from its own layer it is a blank named tile — a collection of references
  // paints as a page of empty hexagons. The face has to come from the target,
  // read at paint time, so one item looks like itself everywhere it appears.

  it('gives the marked Portal row its target’s current picture', async () => {
    layerImages.set('friends/rosa', 'a'.repeat(64))
    await decorate(['gathering', 'rosa'], referenceSig(['friends', 'rosa'], undefined, true))

    goTo('gathering')
    await vi.waitFor(() => expect(index.referenceFaceForLabel('rosa')).toBe('a'.repeat(64)))
  })

  it('does not dynamically repaint ordinary same-name activations from the root', async () => {
    layerImages.set('friends/mira', 'b'.repeat(64))
    await decorate(['inner', 'mira'], referenceSig(['friends', 'mira']))
    await decorate(['outer', 'mira'], referenceSig(['friends', 'mira']))

    goTo('inner')
    await vi.waitFor(() =>
      expect(index.referenceTargetForLabel('mira')).toEqual(['friends', 'mira']))
    expect(index.referenceFaceForLabel('mira')).toBe('')
    goTo('outer')
    await vi.waitFor(() =>
      expect(index.referenceTargetForLabel('mira')).toEqual(['friends', 'mira']))
    expect(index.referenceFaceForLabel('mira')).toBe('')
  })

  it('carries the target’s identity alongside the route — and tolerates its absence', async () => {
    // The route (`targetSegments`) is what a click walks and it follows the
    // target's head. The signature is what survives the target being renamed or
    // rehomed, and what lets a reference join a layer closure. Both, not either.
    const identity = 'd'.repeat(64)
    await decorate(['party', 'ines'], referenceSig(['friends', 'ines'], identity))
    // Written before the field existed — must keep working, route intact.
    await decorate(['party', 'older'], referenceSig(['friends', 'older']))

    goTo('party')
    await vi.waitFor(() => expect(index.referenceSigForLabel('ines')).toBe(identity))
    expect(index.referenceTargetForLabel('ines')).toEqual(['friends', 'ines'])
    expect(index.referenceTargetForLabel('older')).toEqual(['friends', 'older'])
    expect(index.referenceSigForLabel('older')).toBe('')
  })

  it('answers nothing for a non-reference, and for a target with no picture', async () => {
    // A miss must degrade to the ordinary imageless path, never to a hole —
    // and it must never hand back some other cell's face.
    layerImages.set('shed', 'c'.repeat(64))
    await decorate(['yard', 'shed'], tagSig('tools'))
    await decorate(['yard', 'faceless'], referenceSig(['nowhere']))

    goTo('yard')
    expect(index.referenceFaceForLabel('shed')).toBe('')
    await vi.waitFor(() => expect(index.referenceTargetForLabel('faceless')).toEqual(['nowhere']))
    expect(index.referenceFaceForLabel('faceless')).toBe('')
  })
})

// A reference's required marks are the filter it imposes on what it shows.
// They live in the PAYLOAD, never as tag decorations — see
// `referenceMarksForLabel` for why that placement is load-bearing rather than
// incidental. These cases pin the two properties the placement buys: the marks
// never reach the tag surface, and two references to one target keep their own
// demands.
describe('decoration index — a reference’s required marks', () => {
  it('keeps required marks off the tag surface entirely', async () => {
    // The whole point of storing them in the payload: they cannot be listed as
    // chips, so they cannot be toggled off, so the reference cannot be edited
    // by relaxing a lens. If this ever fails, the lock is gone.
    await decorate(['circle', 'people'], requiringSig(['people'], ['family']))

    goTo('circle')
    await vi.waitFor(() =>
      expect(index.referenceMarksForLabel('people')).toEqual(['family']))
    expect(index.tagsForLabel('people')).toEqual([])
  })

  it('lets two references to ONE target demand different things', async () => {
    // `People(family)` and `People(work)` are genuinely distinct references to
    // one place — the reason the marks are part of the reference's identity.
    await decorate(['home', 'people'], requiringSig(['people'], ['family']))
    await decorate(['office', 'people'], requiringSig(['people'], ['work']))

    goTo('home')
    await vi.waitFor(() =>
      expect(index.referenceMarksForLabel('people')).toEqual(['family']))
    expect(index.referenceTargetForLabel('people')).toEqual(['people'])

    goTo('office')
    expect(index.referenceMarksForLabel('people')).toEqual(['work'])
    expect(index.referenceTargetForLabel('people')).toEqual(['people'])
  })

  it('normalizes what it reads and collapses an empty demand to none', async () => {
    // The writer normalizes so identical requirements dedup to one sig, but a
    // payload can arrive from a peer that normalized differently or not at all.
    // An emptied requirement must be indistinguishable from never having had
    // one, or it would never dedup with a plain reference to the same place.
    await decorate(['messy', 'crew'], requiringSig(['crew'], ['  work ', 'family', 'work', '']))
    await decorate(['empty', 'crew'], requiringSig(['crew'], []))
    await decorate(['junk', 'crew'], requiringSig(['crew'], [null, 3, {}]))
    await decorate(['plain', 'crew'], referenceSig(['crew']))

    goTo('messy')
    await vi.waitFor(() =>
      expect(index.referenceMarksForLabel('crew')).toEqual(['family', 'work']))

    for (const where of ['empty', 'junk', 'plain']) {
      goTo(where)
      expect(index.referenceMarksForLabel('crew')).toEqual([])
      // Still a reference — an absent demand narrows nothing, it does not
      // stop the cell being a pointer.
      expect(index.referenceTargetForLabel('crew')).toEqual(['crew'])
    }
  })

  it('answers nothing for a cell that is not a reference', async () => {
    await decorate(['plainly', 'notes'], tagSig('idea'))

    goTo('plainly')
    await vi.waitFor(() => expect(index.tagsForLabel('notes')).toEqual(['idea']))
    expect(index.referenceMarksForLabel('notes')).toEqual([])
  })
})

// A reference may demand a BOUQUET — a named, sig-addressed set of marks —
// instead of, or as well as, inline marks. The payload carries only the
// bouquet's resource sig (`requiredBouquet`); the index expands it once
// (content-addressed, so the expansion never invalidates) and unions it into
// `referenceMarksForLabel`, so the requirement drone and show-cell's AND are
// unchanged downstream.
describe('decoration index — a reference’s demanded bouquet', () => {
  /** A bouquet resource, exactly as BouquetRegistry writes one. */
  const bouquetOf = (marks: unknown[]) => putResource({ marks })

  const bouquetRequiringSig = (
    targetSegments: string[], requiredBouquet: string, requiredMarks?: unknown[],
  ) =>
    putResource({
      kind: 'reference',
      appliesTo: [],
      payload: requiredMarks
        ? { targetSegments, requiredMarks, requiredBouquet }
        : { targetSegments, requiredBouquet },
    })

  it('expands a demanded bouquet into its marks', async () => {
    const bouquet = bouquetOf([' field ', 'notes', 'field', ''])
    await decorate(['garden', 'people'], bouquetRequiringSig(['people'], bouquet))

    goTo('garden')
    await vi.waitFor(() =>
      expect(index.referenceMarksForLabel('people')).toEqual(['field', 'notes']))
    expect(index.referenceTargetForLabel('people')).toEqual(['people'])
  })

  it('unions the bouquet with inline marks, sorted', async () => {
    const bouquet = bouquetOf(['work'])
    await decorate(['office', 'people'], bouquetRequiringSig(['people'], bouquet, ['family']))

    goTo('office')
    await vi.waitFor(() =>
      expect(index.referenceMarksForLabel('people')).toEqual(['family', 'work']))
  })

  it('reads a missing or malformed bouquet as no expansion, never a fault', async () => {
    // A sig whose bytes this store cannot serve — the inline marks must
    // still hold, and nothing may throw.
    const absent = 'f'.repeat(64)
    await decorate(['lost', 'people'], bouquetRequiringSig(['people'], absent, ['family']))

    goTo('lost')
    await vi.waitFor(() =>
      expect(index.referenceMarksForLabel('people')).toEqual(['family']))
    expect(index.referenceTargetForLabel('people')).toEqual(['people'])
  })
})
