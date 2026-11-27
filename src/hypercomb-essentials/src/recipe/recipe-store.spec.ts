// recipe/recipe-store.spec.ts : a recipe on a tile, against a hive made of
// fakes: layers by route, a heap named by its bytes, a committer that records
// what it was asked, and a decoration that counts. No IoC, no network.

import { afterEach, describe, expect, it } from 'vitest'
import { RESOURCE_URL_PREFIX } from '@hypercomb/core'
import { RECIPE_SLOT } from './recipe-slot.js'
import {
  loadRecipeAt,
  recipeClipboardPictures,
  recipePictureUrl,
  recipeTemplateAt,
  saveRecipeAt,
  storeRecipePictures,
  type RecipeStoreDeps,
} from './recipe-store.js'
import { RECIPE_LIMITS, parseRecipe, recipeBytes, recipeTemplateBytes, type RecipeDocument, type RecipeTemplateDocument } from './recipe-template.js'

const enc = new TextEncoder()
const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
const sha = async (bytes: Uint8Array): Promise<string> => hex(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))
const sigOf = (ch: string): string => ch.repeat(64)

/** jsdom's Blob has no `arrayBuffer()`; a FileReader reads it. */
const bytesOf = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
  reader.readAsArrayBuffer(blob)
})

const SOUP: RecipeDocument = {
  values: {
    story: { kind: 'text', text: 'Sundays, always too much.' },
    steps: { kind: 'steps', steps: [{ text: 'Sweat the onions.', minutes: 10 }] },
  },
}
const STEW: RecipeDocument = { values: { story: { kind: 'text', text: 'The winter one.' } } }
const LAYOUT: RecipeTemplateDocument = { name: 'Plain', sections: [{ key: 'story', kind: 'text', label: 'The story' }] }

const sigFor = async (doc: RecipeDocument): Promise<string> => sha(recipeBytes(doc))

/** A hive as the recipe store sees it. `log` is every write, in the order it was asked. */
const hive = () => {
  const heap = new Map<string, Uint8Array>()
  const layers = new Map<string, Record<string, unknown>>()
  const log: string[] = []
  const commits: { segments: string[]; layer: Record<string, unknown> }[] = []
  const decorated: string[][] = []
  const keyOf = (segments: readonly string[]): string => `at:${segments.join('/')}`
  const deps: RecipeStoreDeps = {
    history: {
      sign: async lineage => keyOf(lineage.explorerSegments?.() ?? []),
      currentLayerAt: async locationSig => layers.get(locationSig) ?? null,
    },
    committer: {
      update: async (segments, layer) => {
        log.push('commit')
        commits.push({ segments: [...segments], layer: { ...layer } })
        layers.set(keyOf(segments), { ...layers.get(keyOf(segments)), ...layer })
        return 'layer'
      },
    },
    store: {
      putResource: async blob => {
        const bytes = await bytesOf(blob)
        const sig = await sha(bytes)
        heap.set(sig, bytes)
        log.push('put')
        return sig
      },
      getResource: async sig => {
        const bytes = heap.get(sig)
        if (!bytes) return null
        return { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer } as unknown as Blob
      },
    },
    decorate: async segments => { log.push('decorate'); decorated.push([...segments]) },
  }
  const hold = async (bytes: Uint8Array): Promise<string> => { const sig = await sha(bytes); heap.set(sig, bytes); return sig }
  const tile = (segments: readonly string[], layer: Record<string, unknown>): void => { layers.set(keyOf(segments), layer) }
  return { deps, heap, layers, log, commits, decorated, hold, tile }
}

describe('loadRecipeAt', () => {
  it('reads the newest signature of the slot, and the name of the layer', async () => {
    const world = hive()
    const older = await world.hold(recipeBytes(STEW))
    const newer = await world.hold(recipeBytes(SOUP))
    world.tile(['kitchen', 'soup'], { name: 'Onion soup', [RECIPE_SLOT]: [older, newer] })
    const loaded = await loadRecipeAt(['kitchen', 'soup'], world.deps)
    expect(loaded.name).toBe('Onion soup')
    expect(loaded.reason).toBeUndefined()
    expect(loaded.recipe?.sig).toBe(newer)
    expect(loaded.recipe?.values['steps']).toEqual({ kind: 'steps', steps: [{ text: 'Sweat the onions.', minutes: 10 }] })
  })

  it('a tile with no recipe is an answer with no reason, named by its route when the layer has no name', async () => {
    const world = hive()
    world.tile(['kitchen', 'bread'], { children: [] })
    expect(await loadRecipeAt(['kitchen', 'bread'], world.deps)).toEqual({ name: 'bread', recipe: null })
    expect(await loadRecipeAt(['kitchen', 'nothing-here'], world.deps)).toEqual({ name: 'nothing-here', recipe: null })
  })

  it('bytes that are not a recipe answer the reason', async () => {
    const world = hive()
    const garbage = await world.hold(enc.encode('<html>not a recipe</html>'))
    world.tile(['soup'], { name: 'soup', [RECIPE_SLOT]: [garbage] })
    expect(await loadRecipeAt(['soup'], world.deps)).toEqual({ name: 'soup', recipe: null, reason: 'it is not JSON' })
  })

  it('a recipe whose bytes are not here, or are too large to be one, answers the reason', async () => {
    const world = hive()
    world.tile(['soup'], { name: 'soup', [RECIPE_SLOT]: [sigOf('a')] })
    expect((await loadRecipeAt(['soup'], world.deps)).reason).toBe('its bytes are not held here')
    const huge = await world.hold(new Uint8Array(RECIPE_LIMITS.recipeBytes + 1))
    world.tile(['stew'], { name: 'stew', [RECIPE_SLOT]: [huge] })
    expect((await loadRecipeAt(['stew'], world.deps)).reason).toBe('it is larger than 512 KB')
  })

  it('never throws: no route, a route with an empty name, a history that fails', async () => {
    const world = hive()
    expect(await loadRecipeAt([], world.deps)).toEqual({ name: '', recipe: null, reason: 'no tile is named' })
    expect((await loadRecipeAt(['kitchen', ' '], world.deps)).reason).toBe('no tile is named')
    const down: RecipeStoreDeps = { ...world.deps, history: { sign: async () => { throw new Error('down') }, currentLayerAt: async () => null } }
    expect(await loadRecipeAt(['kitchen', 'soup'], down)).toEqual({ name: 'soup', recipe: null, reason: 'the tile could not be read', unread: true })
  })

  it('a tile whose layer is known but not readable yet could not be read: never a tile with no recipe', async () => {
    const world = hive()
    const sig = await world.hold(recipeBytes(SOUP))
    world.tile(['kitchen', 'soup'], { name: 'Onion soup', [RECIPE_SLOT]: [sig] })
    // The head is known and its bytes have not reached this device: the history answers null and says cold.
    let arrived = false
    const cold: RecipeStoreDeps = {
      ...world.deps,
      history: {
        sign: world.deps.history!.sign,
        currentLayerAt: async (locationSig, stats) => {
          if (arrived) return world.layers.get(locationSig) ?? null
          if (stats) stats.cold = true
          return null
        },
      },
    }
    expect(await loadRecipeAt(['kitchen', 'soup'], cold)).toEqual({ name: 'soup', recipe: null, reason: 'the tile could not be read', unread: true })
    expect(await recipeTemplateAt(['kitchen', 'soup'], cold)).toBeNull()
    // A tile that truly has no layer still answers with no reason.
    expect(await loadRecipeAt(['kitchen', 'nothing-here'], world.deps)).toEqual({ name: 'nothing-here', recipe: null })
    arrived = true
    expect((await loadRecipeAt(['kitchen', 'soup'], cold)).recipe?.sig).toBe(sig)
  })
})

describe('saveRecipeAt', () => {
  it('writes the resource, then the layer, then the decoration, once', async () => {
    const world = hive()
    world.tile(['kitchen', 'soup'], { name: 'Onion soup', children: [] })
    const sig = await sigFor(SOUP)
    expect(await saveRecipeAt(['kitchen', 'soup'], SOUP, world.deps)).toEqual({ ok: true, sig, changed: true })
    expect(world.log).toEqual(['put', 'commit', 'decorate'])
    expect(world.commits).toEqual([{ segments: ['kitchen', 'soup'], layer: { name: 'Onion soup', [RECIPE_SLOT]: [sig] } }])
    expect(world.decorated).toEqual([['kitchen', 'soup']])
    expect((await parseRecipe(world.heap.get(sig) as Uint8Array, sig)).ok).toBe(true)

    const next = await sigFor(STEW)
    expect(await saveRecipeAt(['kitchen', 'soup'], STEW, world.deps)).toEqual({ ok: true, sig: next, changed: true })
    expect(world.commits.at(-1)?.layer).toEqual({ name: 'Onion soup', [RECIPE_SLOT]: [next] })
    expect(world.decorated).toHaveLength(1)
    expect((await loadRecipeAt(['kitchen', 'soup'], world.deps)).recipe?.sig).toBe(next)
  })

  it('an unchanged recipe commits nothing', async () => {
    const world = hive()
    await saveRecipeAt(['soup'], SOUP, world.deps)
    const before = world.commits.length
    expect(await saveRecipeAt(['soup'], SOUP, world.deps)).toEqual({ ok: true, sig: await sigFor(SOUP), changed: false })
    // The same recipe typed in another order is the same recipe.
    const reordered: RecipeDocument = { values: { steps: SOUP.values['steps']!, story: SOUP.values['story']! } }
    expect(await saveRecipeAt(['soup'], reordered, world.deps)).toMatchObject({ ok: true, changed: false })
    expect(world.commits).toHaveLength(before)
    expect(world.decorated).toHaveLength(1)
  })

  it('a document that would not read back is refused before any write', async () => {
    const world = hive()
    const bad = { values: { 'Bad Key': { kind: 'text', text: 'x' } } } as unknown as RecipeDocument
    const refused = await saveRecipeAt(['soup'], bad, world.deps)
    expect(refused.ok).toBe(false)
    const unsafe = { values: { links: { kind: 'links', links: [{ url: 'javascript:alert(1)' }] } } } as unknown as RecipeDocument
    expect(await saveRecipeAt(['soup'], unsafe, world.deps)).toEqual({ ok: false, reason: 'links.links[0].url is not an http or https link' })
    expect(await saveRecipeAt(['soup'], null as unknown as RecipeDocument, world.deps)).toEqual({ ok: false, reason: 'it is not a recipe' })
    expect(world.log).toEqual([])
    expect(world.heap.size).toBe(0)
  })

  it('refuses with words where there is no tile, no store, or a store that kept other bytes', async () => {
    const world = hive()
    expect(await saveRecipeAt([], SOUP, world.deps)).toEqual({ ok: false, reason: 'no tile is named' })
    expect(await saveRecipeAt(['soup'], SOUP, { ...world.deps, store: {} })).toEqual({ ok: false, reason: 'the hive is not ready to save here yet' })
    const lying: RecipeStoreDeps = { ...world.deps, store: { putResource: async () => sigOf('f') } }
    expect(await saveRecipeAt(['soup'], SOUP, lying)).toEqual({ ok: false, reason: 'the store did not keep the bytes it was given' })
    const failing: RecipeStoreDeps = { ...world.deps, committer: { update: async () => { throw new Error('down') } } }
    expect(await saveRecipeAt(['soup'], SOUP, failing)).toEqual({ ok: false, reason: 'the recipe could not be saved' })
    expect(world.commits).toEqual([])
  })

  it('is not saved when the committer answers and wrote nothing: the tile is read back', async () => {
    const world = hive()
    world.tile(['kitchen', 'soup'], { name: 'Onion soup', children: [] })
    // A hive viewing its past, or with a preview up: the committer resolves and no layer changes.
    const silent: RecipeStoreDeps = { ...world.deps, committer: { update: async () => 'layer' } }
    const refused = await saveRecipeAt(['kitchen', 'soup'], SOUP, silent)
    expect(refused).toEqual({ ok: false, reason: 'the hive is not taking writes right now: step forward to now, or close the preview' })
    // Nothing marks a tile that holds no recipe.
    expect(world.decorated).toEqual([])
    expect((await loadRecipeAt(['kitchen', 'soup'], world.deps)).recipe).toBeNull()

    // Over a recipe that is already there, the older one still standing is not the one saved.
    await saveRecipeAt(['kitchen', 'soup'], STEW, world.deps)
    expect((await saveRecipeAt(['kitchen', 'soup'], SOUP, silent)).ok).toBe(false)
    expect((await loadRecipeAt(['kitchen', 'soup'], world.deps)).recipe?.sig).toBe(await sigFor(STEW))
    // Once the hive takes writes again, the same save lands.
    expect(await saveRecipeAt(['kitchen', 'soup'], SOUP, world.deps)).toEqual({ ok: true, sig: await sigFor(SOUP), changed: true })
  })

  it('a decoration that fails does not undo a saved recipe', async () => {
    const world = hive()
    const result = await saveRecipeAt(['soup'], SOUP, { ...world.deps, decorate: async () => { throw new Error('down') } })
    expect(result).toEqual({ ok: true, sig: await sigFor(SOUP), changed: true })
  })

  it('saves run one at a time: two at once commit the recipe once', async () => {
    const world = hive()
    const [first, second] = await Promise.all([saveRecipeAt(['soup'], SOUP, world.deps), saveRecipeAt(['soup'], SOUP, world.deps)])
    expect(first).toMatchObject({ ok: true, changed: true })
    expect(second).toMatchObject({ ok: true, changed: false })
    expect(world.commits).toHaveLength(1)
    expect(world.decorated).toHaveLength(1)
  })
})

describe('recipeTemplateAt', () => {
  it('answers the template the recipe names, when its bytes are held and read', async () => {
    const world = hive()
    const template = await world.hold(recipeTemplateBytes(LAYOUT))
    await saveRecipeAt(['soup'], { ...SOUP, template }, world.deps)
    const found = await recipeTemplateAt(['soup'], world.deps)
    expect(found?.sig).toBe(template)
    expect(found?.template.name).toBe('Plain')
  })

  it('is null for no recipe, a recipe that names none, a template not held, and bytes that are not a template', async () => {
    const world = hive()
    expect(await recipeTemplateAt(['nowhere'], world.deps)).toBeNull()
    await saveRecipeAt(['soup'], SOUP, world.deps)
    expect(await recipeTemplateAt(['soup'], world.deps)).toBeNull()
    await saveRecipeAt(['stew'], { ...STEW, template: sigOf('c') }, world.deps)
    expect(await recipeTemplateAt(['stew'], world.deps)).toBeNull()
    const other = await world.hold(recipeBytes(STEW))
    await saveRecipeAt(['bread'], { ...SOUP, template: other }, world.deps)
    expect(await recipeTemplateAt(['bread'], world.deps)).toBeNull()
  })
})

describe('pictures', () => {
  const picture = (text: string, type = 'image/jpeg'): Blob => new Blob([text], { type })
  /** A re-encode that works: the same words under another type. */
  const reencode = async (blob: Blob): Promise<{ blob: Blob }> => ({ blob: new Blob([await bytesOf(blob)], { type: 'image/webp' }) })

  it('keeps each picture re-encoded, in order, once each, and skips what is not one', async () => {
    const world = hive()
    const sigs = await storeRecipePictures(
      [picture('one'), new Blob(['notes'], { type: 'text/plain' }), picture('two'), picture('one')],
      { ...world.deps, large: reencode },
    )
    expect(sigs).toEqual([await sha(enc.encode('one')), await sha(enc.encode('two'))])
    expect(world.heap.size).toBe(2)
  })

  it('skips a picture that came back as it came, except a GIF', async () => {
    const world = hive()
    const asItCame = async (blob: Blob): Promise<{ blob: Blob }> => ({ blob })
    const sigs = await storeRecipePictures([picture('photo'), picture('moving', 'image/gif')], { ...world.deps, large: asItCame })
    expect(sigs).toEqual([await sha(enc.encode('moving'))])
  })

  it('with the real re-encoder, a browser that cannot decode keeps nothing', async () => {
    const world = hive()
    expect(await storeRecipePictures([picture('not really a photo')], world.deps)).toEqual([])
    expect(world.heap.size).toBe(0)
  })

  it('skips one that fails and keeps the rest, and stops at the limit', async () => {
    const world = hive()
    const flaky = async (blob: Blob): Promise<{ blob: Blob }> => {
      if ((await bytesOf(blob))[0] === 'x'.charCodeAt(0)) throw new Error('refused')
      return reencode(blob)
    }
    expect(await storeRecipePictures([picture('a'), picture('x'), picture('b')], { ...world.deps, large: flaky }))
      .toEqual([await sha(enc.encode('a')), await sha(enc.encode('b'))])
    const many = Array.from({ length: RECIPE_LIMITS.pictures + 5 }, (_, at) => picture(`p${at}`))
    expect(await storeRecipePictures(many, { ...hive().deps, large: reencode })).toHaveLength(RECIPE_LIMITS.pictures)
    expect(await storeRecipePictures([picture('a')], { large: reencode, store: {} })).toEqual([])
  })

  it('a picture is shown from this hive, by its signature and nothing else', () => {
    expect(recipePictureUrl(sigOf('a'))).toBe(RESOURCE_URL_PREFIX + sigOf('a'))
    expect(recipePictureUrl('https://elsewhere.example/a.png')).toBe('')
    expect(recipePictureUrl('')).toBe('')
  })
})

describe('recipeClipboardPictures', () => {
  const clipboardIs = (value: unknown): void => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value }) }
  afterEach(() => clipboardIs(undefined))

  const item = (types: Record<string, string>) => ({
    types: Object.keys(types),
    getType: async (mime: string): Promise<Blob> => new Blob([types[mime] ?? ''], { type: mime }),
  })

  it('answers one picture for every copied item that has one', async () => {
    clipboardIs({ read: async () => [
      item({ 'text/html': '<img>', 'image/png': 'first' }),
      item({ 'text/plain': 'words only' }),
      item({ 'image/jpeg': 'second', 'image/png': 'second again' }),
    ] })
    const blobs = await recipeClipboardPictures()
    expect(blobs.map(blob => blob.type)).toEqual(['image/png', 'image/jpeg'])
    expect(new TextDecoder().decode(await bytesOf(blobs[1] as Blob))).toBe('second')
  })

  it('is empty where there is no clipboard to read, or the read is refused', async () => {
    clipboardIs(undefined)
    expect(await recipeClipboardPictures()).toEqual([])
    clipboardIs({ read: async () => { throw new Error('denied') } })
    expect(await recipeClipboardPictures()).toEqual([])
  })
})

// THE LIVE HIVE WRAPS WHAT A SLOT NAMES (L2, the life primitive): the committer
// stores a meta envelope { meta: 1, resource: <recipe>, relation } and the slot
// holds the ENVELOPE's signature; the store's getResource follows that one hop.
// The fake above keeps the recipe's own signature in the slot, which no real
// hive does, and that difference once hid a recipe that would not reopen.
describe('a recipe behind a meta envelope, as a real hive keeps it', () => {
  const wrapping = () => {
    const world = hive()
    const keyOf = (segments: readonly string[]): string => `at:${segments.join('/')}`
    const raw = world.deps.store!.getResource!
    const deps: RecipeStoreDeps = {
      ...world.deps,
      committer: {
        update: async (segments, layer) => {
          world.log.push('commit')
          const wrapped: Record<string, unknown> = { ...layer }
          const slot = layer[RECIPE_SLOT]
          if (Array.isArray(slot)) {
            wrapped[RECIPE_SLOT] = await Promise.all(slot.map(sig =>
              world.hold(enc.encode(JSON.stringify({ meta: 1, resource: sig, relation: RECIPE_SLOT })))))
          }
          world.commits.push({ segments: [...segments], layer: wrapped })
          world.layers.set(keyOf(segments), { ...world.layers.get(keyOf(segments)), ...wrapped })
          return 'layer'
        },
      },
      store: {
        putResource: world.deps.store!.putResource!,
        getResource: async sig => {
          const blob = await raw(sig)
          if (!blob) return null
          try {
            const parsed = JSON.parse(new TextDecoder().decode(await blob.arrayBuffer())) as { meta?: unknown; resource?: unknown }
            if (parsed.meta === 1 && typeof parsed.resource === 'string') return raw(parsed.resource)
          } catch { /* not an envelope: the bytes as they are */ }
          return blob
        },
      },
    }
    return { ...world, deps }
  }

  it('opens again as the recipe that was saved, under the recipe\'s own signature', async () => {
    const world = wrapping()
    const saved = await saveRecipeAt(['soup'], SOUP, world.deps)
    expect(saved).toMatchObject({ ok: true, changed: true })
    const slot = world.layers.get('at:soup')![RECIPE_SLOT] as string[]
    // The slot names the envelope, never the recipe.
    expect(slot).toHaveLength(1)
    expect(slot[0]).not.toBe(await sigFor(SOUP))

    const loaded = await loadRecipeAt(['soup'], world.deps)
    expect(loaded.reason).toBeUndefined()
    expect(loaded.recipe?.sig).toBe(await sigFor(SOUP))
    expect(loaded.recipe?.values['story']).toEqual(SOUP.values['story'])
  })

  it('commits nothing when the same recipe is saved again', async () => {
    const world = wrapping()
    await saveRecipeAt(['soup'], SOUP, world.deps)
    const again = await saveRecipeAt(['soup'], SOUP, world.deps)
    expect(again).toEqual({ ok: true, sig: await sigFor(SOUP), changed: false })
    expect(world.commits).toHaveLength(1)
    expect(world.decorated).toHaveLength(1)

    const changed = await saveRecipeAt(['soup'], STEW, world.deps)
    expect(changed).toMatchObject({ ok: true, changed: true })
    expect(world.commits).toHaveLength(2)
    // The mark is put on once, with the first recipe.
    expect(world.decorated).toHaveLength(1)
  })

  it('reads a save back through the envelope: saved when it landed, not saved when nothing was written', async () => {
    const world = wrapping()
    expect(await saveRecipeAt(['soup'], SOUP, world.deps)).toEqual({ ok: true, sig: await sigFor(SOUP), changed: true })
    const silent: RecipeStoreDeps = { ...world.deps, committer: { update: async () => 'layer' } }
    expect((await saveRecipeAt(['soup'], STEW, silent)).ok).toBe(false)
    expect((await loadRecipeAt(['soup'], world.deps)).recipe?.sig).toBe(await sigFor(SOUP))
  })

  it('finds the template the recipe names', async () => {
    const world = wrapping()
    const layout = await world.hold(recipeTemplateBytes(LAYOUT))
    await saveRecipeAt(['soup'], { ...SOUP, template: layout }, world.deps)
    expect((await recipeTemplateAt(['soup'], world.deps))?.sig).toBe(layout)
  })
})
