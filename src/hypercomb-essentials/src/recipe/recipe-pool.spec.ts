// recipe/recipe-pool.spec.ts : the templates a hive keeps, against a store that
// behaves like the real one where it matters (`openPool` never creates,
// `putPoolDoc` keeps every version, resources are named by their bytes), and
// the ones a community offers, against fake hosts. No IoC, no network.

import { describe, expect, it } from 'vitest'
import { offeredListBytes, offeredRootKey, type OfferedReadIo } from '../pools/offered-pool.js'
import { DEFAULT_RECIPE_TEMPLATES } from './recipe-defaults.js'
import {
  RECIPE_TEMPLATES_MAX,
  RECIPE_TEMPLATE_MEANING,
  defaultRecipeTemplates,
  findCommunityRecipeTemplates,
  forgetRecipeTemplate,
  holdRecipeTemplate,
  keepRecipeTemplate,
  listRecipeTemplates,
  readRecipeTemplate,
  recipeTemplateContribution,
  saveRecipeTemplate,
  type RecipeTemplateStore,
} from './recipe-pool.js'
import { RECIPE_SLOT } from './recipe-slot.js'
import type { RecipeStoreDeps } from './recipe-store.js'
import { recipeBytes, recipeTemplateBytes, type RecipeDocument, type RecipeTemplateDocument } from './recipe-template.js'

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

const held = (bytes: Uint8Array): Blob =>
  ({ size: bytes.length, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer }) as unknown as Blob

/** A store as this module sees it. `versions` is every list ever written, oldest first. */
const fakeStore = () => {
  const heap = new Map<string, Uint8Array>()
  const versions: string[][] = []
  const writes: { keep?: string }[] = []
  const files = new Set<string>()
  const pool = { name: 'pool', keys: async function* () { yield* files } }
  let created = false
  let current: ArrayBuffer | null = null
  const store: RecipeTemplateStore = {
    getPool: async () => { created = true; return pool },
    openPool: async () => (created ? pool : null),
    getPoolDoc: async () => current,
    putPoolDoc: async (_pool, bytes, _subKey, options) => {
      const doc = JSON.parse(new TextDecoder().decode(bytes)) as { meaning: string; members: string[] }
      expect(doc.meaning).toBe(RECIPE_TEMPLATE_MEANING)
      versions.push(doc.members)
      writes.push({ ...(options?.keep ? { keep: options.keep } : {}) })
      current = bytes
      const sig = await sha(new Uint8Array(bytes))
      files.add(sig)
      return sig
    },
    putResource: async blob => {
      const bytes = await bytesOf(blob)
      const sig = await sha(bytes)
      heap.set(sig, bytes)
      return sig
    },
    getResourceLocal: async sig => {
      const bytes = heap.get(sig)
      return bytes ? held(bytes) : null
    },
  }
  /** Put a list on disk that this module did not write. */
  const corrupt = async (text: string): Promise<void> => {
    created = true
    const bytes = enc.encode(text)
    current = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    files.add(await sha(bytes))
  }
  return { store, heap, versions, writes, corrupt, wasCreated: () => created }
}

const SUPPER: RecipeTemplateDocument = {
  name: 'Supper',
  description: 'What goes on the table.',
  sections: [
    { key: 'story', kind: 'text', label: 'The story' },
    { key: 'facts', kind: 'facts', label: 'At a glance', fields: ['Serves'] },
    { key: 'steps', kind: 'steps', label: 'Method' },
  ],
}
const PLAIN: RecipeTemplateDocument = { name: 'Plain', sections: [{ key: 'steps', kind: 'steps', label: 'Method' }] }

const sigFor = (doc: RecipeTemplateDocument): Promise<string> => sha(recipeTemplateBytes(doc))

describe('the list is read from this device only', () => {
  it('says when there is no store, and never throws', async () => {
    expect(await listRecipeTemplates(undefined)).toEqual({ entries: [], problem: 'no-store' })
    expect(await listRecipeTemplates({ getPoolDoc: async () => null })).toEqual({ entries: [], problem: 'no-store' })
  })

  it('a hive that kept nothing has an empty list, and reading it creates no pool', async () => {
    const hive = fakeStore()
    expect(await listRecipeTemplates(hive.store)).toEqual({ entries: [] })
    expect(hive.wasCreated()).toBe(false)
  })

  it('a store whose every call throws is an answer, not a throw', async () => {
    const boom = async (): Promise<never> => { throw new Error('down') }
    const store: RecipeTemplateStore = { getPool: boom, openPool: boom, getPoolDoc: boom, putPoolDoc: boom, putResource: boom, getResourceLocal: boom }
    expect(await listRecipeTemplates(store)).toEqual({ entries: [] })
    expect((await saveRecipeTemplate(store, SUPPER)).ok).toBe(false)
    expect((await holdRecipeTemplate(store, SUPPER)).ok).toBe(false)
    expect((await forgetRecipeTemplate(store, sigOf('a'))).ok).toBe(false)
    expect((await readRecipeTemplate(store, sigOf('a'))).ok).toBe(false)
  })

  it('shows each member read back, and one that does not read with its reason', async () => {
    const hive = fakeStore()
    const sig = await sigFor(SUPPER)
    await saveRecipeTemplate(hive.store, SUPPER)
    await saveRecipeTemplate(hive.store, PLAIN)
    hive.heap.delete(await sigFor(PLAIN))
    const listing = await listRecipeTemplates(hive.store)
    expect(listing.problem).toBeUndefined()
    expect(listing.entries[0]).toMatchObject({ sig, ok: true, template: { sig, name: 'Supper' } })
    expect(listing.entries[1]).toEqual({ sig: await sigFor(PLAIN), ok: false, reason: 'its bytes are not held here' })
  })
})

describe('keeping a template', () => {
  it('saving twice adds it once, and the list is the document a host offers', async () => {
    const hive = fakeStore()
    const sig = await sigFor(SUPPER)
    expect(await saveRecipeTemplate(hive.store, SUPPER)).toEqual({ ok: true, sig, added: true })
    expect(await saveRecipeTemplate(hive.store, SUPPER)).toEqual({ ok: true, sig, added: false })
    expect(hive.versions).toEqual([[sig]])
    expect(await sha(hive.heap.get(sig) as Uint8Array)).toBe(sig)
    const listed = await hive.store.getPoolDoc?.({}) as ArrayBuffer
    expect(hex(listed)).toBe(hex(offeredListBytes(RECIPE_TEMPLATE_MEANING, [sig]).slice().buffer as ArrayBuffer))
    expect(new TextDecoder().decode(listed)).toBe(`{"meaning":"recipe:template","members":["${sig}"]}`)
  })

  it('a save keeps the list before it: no write asks for current-only', async () => {
    const hive = fakeStore()
    await saveRecipeTemplate(hive.store, SUPPER)
    await saveRecipeTemplate(hive.store, PLAIN)
    expect(hive.versions).toEqual([[await sigFor(SUPPER)], [await sigFor(SUPPER), await sigFor(PLAIN)]])
    expect(hive.writes).toEqual([{}, {}])
  })

  it('two saves finishing together are both on the list', async () => {
    const hive = fakeStore()
    await Promise.all([saveRecipeTemplate(hive.store, SUPPER), saveRecipeTemplate(hive.store, PLAIN)])
    expect(hive.versions.at(-1)).toEqual([await sigFor(SUPPER), await sigFor(PLAIN)])
  })

  it('holding makes the bytes a resource and does not list it', async () => {
    const hive = fakeStore()
    const sig = await sigFor(SUPPER)
    expect(await holdRecipeTemplate(hive.store, SUPPER)).toEqual({ ok: true, sig })
    expect(hive.heap.has(sig)).toBe(true)
    expect(hive.versions).toEqual([])
    expect(hive.wasCreated()).toBe(false)
    expect(await listRecipeTemplates(hive.store)).toEqual({ entries: [] })
    expect(await readRecipeTemplate(hive.store, sig)).toMatchObject({ sig, ok: true, template: { name: 'Supper' } })
  })

  it('refuses what is not a template before anything is written', async () => {
    const hive = fakeStore()
    const empty = { name: 'Nothing', sections: [] } as RecipeTemplateDocument
    expect(await saveRecipeTemplate(hive.store, empty)).toEqual({ ok: false, reason: 'it has no sections: a template arranges at least one' })
    expect(await holdRecipeTemplate(hive.store, null as unknown as RecipeTemplateDocument)).toEqual({ ok: false, reason: 'it is not a template' })
    expect(await holdRecipeTemplate({ putResource: async () => sigOf('f') }, SUPPER)).toEqual({ ok: false, reason: 'the store did not keep the bytes it was given' })
    expect(hive.heap.size).toBe(0)
    expect(hive.versions).toEqual([])
  })

  it('keeps someone else\'s by their own bytes, whatever their spelling', async () => {
    const hive = fakeStore()
    const theirs = enc.encode(JSON.stringify({ sections: [{ label: 'Method', kind: 'steps', key: 'steps' }], name: 'Theirs', 'recipe:template': 1 }, null, 2))
    const sig = await sha(theirs)
    expect(await keepRecipeTemplate(hive.store, theirs, sig)).toEqual({ ok: true, sig, added: true })
    // Their spelling, byte for byte: the heap holds what hashes to the name they gave it.
    expect(new TextDecoder().decode(hive.heap.get(sig))).toBe(new TextDecoder().decode(theirs))
    expect(hive.versions).toEqual([[sig]])
  })

  it('refuses bytes under the wrong signature, and bytes that are not a template', async () => {
    const hive = fakeStore()
    const bytes = recipeTemplateBytes(SUPPER)
    expect(await keepRecipeTemplate(hive.store, bytes, sigOf('a'))).toEqual({ ok: false, reason: 'its bytes do not match the signature they were held under' })
    expect(await keepRecipeTemplate(hive.store, bytes, 'not-a-signature')).toEqual({ ok: false, reason: 'not a signature' })
    const recipe = recipeBytes({ values: { story: { kind: 'text', text: 'not a layout' } } })
    expect((await keepRecipeTemplate(hive.store, recipe, await sha(recipe))).ok).toBe(false)
    const page = enc.encode('<html></html>')
    expect(await keepRecipeTemplate(hive.store, page, await sha(page))).toEqual({ ok: false, reason: 'it is not JSON' })
    expect(hive.heap.size).toBe(0)
    expect(hive.versions).toEqual([])
  })

  it('a full list refuses one more, and the bytes it was handed are still held', async () => {
    const hive = fakeStore()
    for (let at = 0; at < RECIPE_TEMPLATES_MAX; at++) {
      expect((await saveRecipeTemplate(hive.store, { ...PLAIN, name: `Plain ${at}` })).ok).toBe(true)
    }
    expect(await saveRecipeTemplate(hive.store, SUPPER)).toEqual({ ok: false, reason: `the list already holds ${RECIPE_TEMPLATES_MAX} templates` })
    expect(hive.versions.at(-1)).toHaveLength(RECIPE_TEMPLATES_MAX)
    expect(hive.heap.has(await sigFor(SUPPER))).toBe(true)
  })
})

describe('taking one off the list', () => {
  it('hides it: the bytes stay, and the list before still names it', async () => {
    const hive = fakeStore()
    const sig = await sigFor(SUPPER)
    await saveRecipeTemplate(hive.store, SUPPER)
    await saveRecipeTemplate(hive.store, PLAIN)
    expect(await forgetRecipeTemplate(hive.store, sig)).toEqual({ ok: true, sig, added: false })
    expect(hive.versions.at(-1)).toEqual([await sigFor(PLAIN)])
    expect(hive.versions.at(-2)).toContain(sig)
    expect(hive.heap.has(sig)).toBe(true)
    expect(await readRecipeTemplate(hive.store, sig)).toMatchObject({ ok: true })
  })

  it('forgetting what is not listed writes nothing', async () => {
    const hive = fakeStore()
    await saveRecipeTemplate(hive.store, SUPPER)
    expect(await forgetRecipeTemplate(hive.store, sigOf('a'))).toEqual({ ok: true, sig: sigOf('a'), added: false })
    expect(hive.versions).toHaveLength(1)
    expect(await forgetRecipeTemplate(hive.store, 'nope')).toEqual({ ok: false, reason: 'not a signature' })
  })
})

describe('a list that does not read', () => {
  it('is reported, and never rewritten as a shorter one', async () => {
    for (const text of ['not json', '{"meaning":"mail:template","members":[]}', '{"meaning":"recipe:template","members":["short"]}']) {
      const hive = fakeStore()
      await hive.corrupt(text)
      expect(await listRecipeTemplates(hive.store)).toEqual({ entries: [], problem: 'unreadable' })
      const reason = 'the template list on this device does not read, so it was left as it is'
      expect(await saveRecipeTemplate(hive.store, SUPPER)).toEqual({ ok: false, reason })
      expect(await forgetRecipeTemplate(hive.store, sigOf('a'))).toEqual({ ok: false, reason })
      expect(hive.versions).toEqual([])
    }
  })

  it('a pool that holds a document it will not hand over is unreadable, not empty', async () => {
    const hive = fakeStore()
    await hive.corrupt('{}')
    const blind: RecipeTemplateStore = { ...hive.store, getPoolDoc: async () => null }
    expect(await listRecipeTemplates(blind)).toEqual({ entries: [], problem: 'unreadable' })
    expect((await saveRecipeTemplate(blind, SUPPER)).ok).toBe(false)
    expect(hive.versions).toEqual([])
  })
})

describe('the three every hive starts with', () => {
  it('have three distinct signatures, in the picker\'s order, and are worked out once', async () => {
    const defaults = await defaultRecipeTemplates()
    expect(defaults.map(entry => entry.template.name)).toEqual(DEFAULT_RECIPE_TEMPLATES.map(doc => doc.name))
    expect(new Set(defaults.map(entry => entry.sig)).size).toBe(3)
    for (const [at, entry] of defaults.entries()) {
      expect(entry.sig).toBe(await sigFor(DEFAULT_RECIPE_TEMPLATES[at] as RecipeTemplateDocument))
      expect(entry.template.sig).toBe(entry.sig)
    }
    expect(await defaultRecipeTemplates()).toBe(defaults)
  })

  it('a default is held under the same signature the picker showed', async () => {
    const hive = fakeStore()
    const [first] = await defaultRecipeTemplates()
    expect(await holdRecipeTemplate(hive.store, DEFAULT_RECIPE_TEMPLATES[0] as RecipeTemplateDocument)).toEqual({ ok: true, sig: first?.sig })
  })
})

describe('what the community offers', () => {
  /** Hosts as a reader sees them: per host its keys, per key its roots, and the atoms it serves. */
  const hosts = () => {
    const keys = new Map<string, string[]>()
    const roots = new Map<string, Record<string, string>>()
    const atoms = new Map<string, Uint8Array>()
    const asked: string[] = []
    const io: OfferedReadIo = {
      keysOf: async host => keys.get(host) ?? [],
      indexOf: async (host, pubkey) => roots.get(`${host}|${pubkey}`) ?? null,
      atom: async (host, sig) => { asked.push(host); return atoms.get(`${host}|${sig}`) ?? null },
      own: async () => null,
    }
    /** Offer members on a host under a key. `forged` names a member whose served bytes are not its own. */
    const offer = async (host: string, pubkey: string, members: readonly Uint8Array[], forged?: Uint8Array): Promise<string[]> => {
      keys.set(host, [pubkey])
      const sigs: string[] = []
      for (const bytes of members) {
        const sig = await sha(bytes)
        atoms.set(`${host}|${sig}`, bytes === forged ? enc.encode('{"recipe:template":1,"name":"Swapped","sections":[]}') : bytes)
        sigs.push(sig)
      }
      const list = offeredListBytes(RECIPE_TEMPLATE_MEANING, sigs)
      const listSig = await sha(list)
      atoms.set(`${host}|${listSig}`, list)
      roots.set(`${host}|${pubkey}`, { [offeredRootKey(RECIPE_TEMPLATE_MEANING)]: listSig })
      return sigs
    }
    return { io, asked, offer }
  }

  it('is the union of the hosts, one row per template, naming every host that offers it', async () => {
    const world = hosts()
    const supper = recipeTemplateBytes(SUPPER)
    const plain = recipeTemplateBytes(PLAIN)
    await world.offer('a.example', sigOf('1'), [supper, plain])
    await world.offer('b.example', sigOf('2'), [supper])
    const offers = await findCommunityRecipeTemplates(['a.example', 'b.example'], { io: world.io })
    expect(offers.map(offer => offer.template.name)).toEqual(['Supper', 'Plain'])
    expect(offers[0]).toMatchObject({ sig: await sha(supper), host: 'a.example', hosts: ['a.example', 'b.example'], pubkey: sigOf('1') })
    expect(offers[0]?.bytes).toEqual(supper)
    expect(offers[1]).toMatchObject({ host: 'a.example', hosts: ['a.example'] })
  })

  it('drops a forged member and a member that is not a template', async () => {
    const world = hosts()
    const supper = recipeTemplateBytes(SUPPER)
    const forged = recipeTemplateBytes(PLAIN)
    const recipe = recipeBytes({ values: { story: { kind: 'text', text: 'a recipe, not a layout' } } })
    const [good] = await world.offer('a.example', sigOf('1'), [supper, forged, recipe, enc.encode('just words')], forged)
    const offers = await findCommunityRecipeTemplates(['a.example'], { io: world.io })
    expect(offers.map(offer => offer.sig)).toEqual([good])
  })

  it('an offer is only held in the answer: the cook keeps it by its own bytes', async () => {
    const world = hosts()
    const hive = fakeStore()
    await world.offer('a.example', sigOf('1'), [recipeTemplateBytes(SUPPER)])
    const [offer] = await findCommunityRecipeTemplates(['a.example'], { io: world.io })
    expect(hive.heap.size).toBe(0)
    expect(await keepRecipeTemplate(hive.store, offer?.bytes as Uint8Array, offer?.sig as string)).toEqual({ ok: true, sig: await sigFor(SUPPER), added: true })
  })

  it('asks only the hosts it is handed, and silence is an empty answer', async () => {
    const world = hosts()
    await world.offer('a.example', sigOf('1'), [recipeTemplateBytes(SUPPER)])
    expect(await findCommunityRecipeTemplates([], { io: world.io })).toEqual([])
    expect(await findCommunityRecipeTemplates(['silent.example'], { io: world.io })).toEqual([])
    expect(world.asked).toEqual([])
    const down: OfferedReadIo = { ...world.io, keysOf: async () => { throw new Error('down') } }
    expect(await findCommunityRecipeTemplates(['a.example'], { io: down })).toEqual([])
  })
})

describe('what the lit recipe tiles leave in the pool', () => {
  /** A hive with tiles: layers by route, and two heaps, the device's own and what only a host would answer. */
  const tiles = () => {
    const local = new Map<string, Uint8Array>()
    const remote = new Map<string, Uint8Array>()
    const layers = new Map<string, Record<string, unknown>>()
    const hostAsked: string[] = []
    const store = {
      getResourceLocal: async (sig: string): Promise<Blob | null> => { const bytes = local.get(sig); return bytes ? held(bytes) : null },
      getResource: async (sig: string): Promise<Blob | null> => {
        hostAsked.push(sig)
        const bytes = local.get(sig) ?? remote.get(sig)
        return bytes ? held(bytes) : null
      },
    }
    const deps: RecipeStoreDeps = {
      history: {
        sign: async lineage => (lineage.explorerSegments?.() ?? []).join('/'),
        currentLayerAt: async locationSig => layers.get(locationSig) ?? null,
      },
      store,
    }
    const put = async (into: Map<string, Uint8Array>, bytes: Uint8Array): Promise<string> => { const sig = await sha(bytes); into.set(sig, bytes); return sig }
    /** A tile whose recipe names `template` (or none). */
    const recipeTile = async (route: string, template?: string): Promise<void> => {
      const doc: RecipeDocument = { ...(template ? { template } : {}), values: { story: { kind: 'text', text: route } } }
      layers.set(route, { name: route, [RECIPE_SLOT]: [await put(local, recipeBytes(doc))] })
    }
    return { deps, local, remote, layers, hostAsked, put, recipeTile }
  }

  it('says which pool, and how a count of its members reads', () => {
    const contribution = recipeTemplateContribution()
    expect(contribution.meaning).toBe('recipe:template')
    expect(contribution.label).toEqual({ key: 'recipe.pool.count', one: '1 recipe template', other: '{count} recipe templates' })
    expect(contribution.closureOf).toBeUndefined()
  })

  it('answers the template of each lit recipe tile, once each, and nothing for any other tile', async () => {
    const hive = tiles()
    const supper = await hive.put(hive.local, recipeTemplateBytes(SUPPER))
    const plain = await hive.put(hive.local, recipeTemplateBytes(PLAIN))
    await hive.recipeTile('kitchen/soup', supper)
    await hive.recipeTile('kitchen/stew', supper)
    await hive.recipeTile('kitchen/bread', plain)
    await hive.recipeTile('kitchen/unlit', plain)
    await hive.recipeTile('kitchen/free')
    hive.layers.set('notes', { name: 'notes', children: [] })
    const contribution = recipeTemplateContribution(hive.deps)
    const members = await contribution.membersOf([['kitchen', 'soup'], ['notes'], ['kitchen', 'stew'], ['kitchen', 'free'], ['nowhere']])
    expect(members).toEqual([supper])
    expect(await contribution.membersOf([['kitchen', 'bread'], ['kitchen', 'soup']])).toEqual([plain, supper])
    expect(await contribution.membersOf([])).toEqual([])
  })

  it('offers only a template this hive holds and can read, and asks no host for it', async () => {
    const hive = tiles()
    const elsewhere = await hive.put(hive.remote, recipeTemplateBytes(SUPPER))
    const notLayout = await hive.put(hive.local, recipeBytes({ values: { story: { kind: 'text', text: 'a recipe' } } }))
    await hive.recipeTile('kitchen/soup', elsewhere)
    await hive.recipeTile('kitchen/stew', notLayout)
    await hive.recipeTile('kitchen/bread', sigOf('c'))
    const contribution = recipeTemplateContribution(hive.deps)
    expect(await contribution.membersOf([['kitchen', 'soup'], ['kitchen', 'stew'], ['kitchen', 'bread']])).toEqual([])
    expect(hive.hostAsked).toEqual([])
  })
})
