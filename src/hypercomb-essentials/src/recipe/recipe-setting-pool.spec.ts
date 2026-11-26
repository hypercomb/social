// recipe/recipe-setting-pool.spec.ts : bringing a render's table set in, the
// sets a hive keeps, the one its desk sits on, the ones a community offers,
// and what a lit hive leaves in the pool, against a store that behaves like
// the real one where it matters (`openPool` never creates, resources are named
// by their bytes, one document per pool) and fake hosts. No IoC, no network.
// The render is the real setting.json tableware/setting.py wrote (2026-11-25).

import { I18N_IOC_KEY } from '@hypercomb/core'
import { afterEach, describe, expect, it } from 'vitest'
import { offeredListBytes, offeredRootKey, publishOfferedPool, type OfferedPublishDeps, type OfferedReadIo } from '../pools/offered-pool.js'
import { publishLitPools } from '../pools/pool-contributions.js'
import { RECIPE_SLOT } from './recipe-slot.js'
import type { RecipeStoreDeps } from './recipe-store.js'
import { RECIPE_SETTING_LIMITS, recipeSettingBytes, recipeSettingSignatures, type RecipeSettingDocument } from './recipe-setting.js'
import {
  RECIPE_DESK_MEANING,
  RECIPE_SETTING_MEANING,
  findCommunityRecipeSettings,
  forgetRecipeSetting,
  importRecipeSetting,
  keepRecipeSetting,
  listRecipeSettings,
  readRecipeDeskSetting,
  readRecipeSetting,
  recipeSettingContribution,
  recipeSettingHeld,
  recipeSettingPictureType,
  takeCommunityRecipeSetting,
  writeRecipeDeskSetting,
  type RecipeSettingStore,
} from './recipe-setting-pool.js'
import { recipeBytes } from './recipe-template.js'

/** setting.json as tableware/setting.py wrote it for the set rendered on 2026-11-25. */
const RENDERED_SETTING = {
  size_px: [1800, 1200],
  camera: { location: [0.43, -0.67, 1.13], rotation_quaternion: [0.916038, 0.281257, 0.083931, 0.273359], lens_mm: 62.0, sensor_mm: 36.0 },
  floor_height_m: 0.0055,
  layers: { setting: 'setting.png', table: 'table.png', utensils: 'utensils.png' },
  plates: [
    { id: 'ash', glaze: 'ash', seed: 23, size_m: [0.28, 0.16], at_m: [-0.1, 0.13], turn_deg: -6,
      floor_corners_px: [[646.1, 206.4], [1007.1, 438.0], [1139.0, 306.0], [781.5, 87.6]], floor_centre_px: [889.7, 255.6], floor_size_m: [0.22, 0.1], layer: 'plate-ash.png' },
    { id: 'shino', glaze: 'shino', seed: 7, size_m: [0.27, 0.14], at_m: [0.205, 0.085], turn_deg: 13,
      floor_corners_px: [[1159.2, 616.7], [1632.5, 759.1], [1673.1, 612.0], [1212.9, 478.2]], floor_centre_px: [1416.3, 614.3], floor_size_m: [0.21, 0.08], layer: 'plate-shino.png' },
    { id: 'kuro', glaze: 'kuro', seed: 31, size_m: [0.27, 0.14], at_m: [-0.2, -0.1], turn_deg: -14,
      floor_corners_px: [[211.8, 402.0], [498.6, 685.8], [641.1, 581.7], [351.8, 310.1]], floor_centre_px: [422.1, 490.1], floor_size_m: [0.21, 0.08], layer: 'plate-kuro.png' },
    { id: 'tenmoku', glaze: 'tenmoku', seed: 11, size_m: [0.27, 0.15], at_m: [0.115, -0.14], turn_deg: -19,
      floor_corners_px: [[727.1, 778.6], [1042.2, 1143.0], [1215.8, 1016.0], [895.9, 668.8]], floor_centre_px: [965.5, 894.4], floor_size_m: [0.21, 0.09], layer: 'plate-tenmoku.png' },
  ],
  utensils_on: 'shino',
  note: 'Stack back to front: table, plates, dishes, utensils.',
}
const LAYERS = ['table.png', 'plate-ash.png', 'plate-shino.png', 'plate-kuro.png', 'plate-tenmoku.png', 'utensils.png']

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
  ({ size: bytes.length, type: '', arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer }) as unknown as Blob

/** A picture's bytes: the PNG or WebP signature, then words of its own so every layer is its own signature. */
const png = (words: string): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...enc.encode(words)])
const webp = (words: string): Uint8Array => new Uint8Array([...enc.encode('RIFF'), 0, 0, 0, 0, ...enc.encode('WEBP'), ...enc.encode(words)])
const file = (name: string, bytes: Uint8Array, type = ''): File => new File([bytes.slice().buffer as ArrayBuffer], name, { type })
const json = (value: unknown, name = 'setting.json'): File => file(name, enc.encode(JSON.stringify(value)), 'application/json')
/** The folder a render writes: setting.json and every layer it names. */
const folder = (render: unknown = RENDERED_SETTING, picture = png): File[] => [json(render), ...LAYERS.map(name => file(name, picture(name)))]

/** A store as this module sees it: one document per pool, every version kept, resources named by their bytes. */
const fakeStore = () => {
  const heap = new Map<string, { bytes: Uint8Array; type: string }>()
  const docs = new Map<string, { current: ArrayBuffer | null; versions: string[]; keeps: (string | undefined)[]; files: Set<string> }>()
  const created = new Set<string>()
  const poolOf = (meaning: string) => {
    let doc = docs.get(meaning)
    if (!doc) docs.set(meaning, doc = { current: null, versions: [], keeps: [], files: new Set() })
    const files = doc.files
    return { name: meaning, keys: async function* () { yield* files } }
  }
  const store: RecipeSettingStore = {
    getPool: async meaning => { created.add(meaning); return poolOf(meaning) },
    openPool: async meaning => (created.has(meaning) ? poolOf(meaning) : null),
    getPoolDoc: async pool => docs.get((pool as { name: string }).name)?.current ?? null,
    putPoolDoc: async (pool, bytes, _subKey, options) => {
      const doc = docs.get((pool as { name: string }).name)
      if (!doc) return null
      doc.current = bytes
      doc.versions.push(new TextDecoder().decode(bytes))
      doc.keeps.push(options?.keep)
      const sig = await sha(new Uint8Array(bytes))
      doc.files.add(sig)
      return sig
    },
    putResource: async blob => {
      const bytes = await bytesOf(blob)
      const sig = await sha(bytes)
      heap.set(sig, { bytes, type: blob.type })
      return sig
    },
    getResourceLocal: async sig => {
      const at = heap.get(sig)
      return at ? held(at.bytes) : null
    },
  }
  const members = (): string[] => {
    const current = docs.get(RECIPE_SETTING_MEANING)?.current
    return current ? (JSON.parse(new TextDecoder().decode(current)) as { members: string[] }).members : []
  }
  const writes = (): number => [...docs.values()].reduce((sum, doc) => sum + doc.versions.length, 0)
  return { store, heap, docs, created, members, writes }
}

const imported = async (hive = fakeStore(), files: File[] = folder()) => {
  const kept = await importRecipeSetting(files, { store: hive.store })
  if (!kept.ok) throw new Error(kept.reason)
  return { hive, kept }
}

describe('bringing a render in', () => {
  it('holds every layer under its own signature, builds the set from setting.json, holds it and keeps it', async () => {
    const hive = fakeStore()
    const { kept } = await imported(hive)
    expect(kept.added).toBe(true)
    const shas = await Promise.all(LAYERS.map(name => sha(png(name))))
    expect(recipeSettingSignatures(kept.setting)).toEqual(shas)
    for (const sig of shas) expect(hive.heap.get(sig)?.type).toBe('image/png')
    // The set itself is a resource under its own signature, read back strictly, and on the kept list.
    expect(await sha(recipeSettingBytes(kept.setting))).toBe(kept.sig)
    expect(hive.heap.get(kept.sig)?.type).toBe('application/json')
    expect(hive.members()).toEqual([kept.sig])
    expect(kept.setting).toMatchObject({ name: 'ash · shino · kuro · tenmoku', size: [1800, 1200] })
    expect(kept.setting.plates.map(plate => plate.id)).toEqual(['ash', 'shino', 'kuro', 'tenmoku'])
    // The composite setting.png is for looking at: it is never asked for.
    expect(LAYERS).not.toContain('setting.png')
  })

  it('takes WebP layers as it takes PNG, by what their bytes are, and names matched without regard to case', async () => {
    const hive = fakeStore()
    const files = [json(RENDERED_SETTING), ...LAYERS.map(name => file(name.toUpperCase(), webp(name), 'image/png'))]
    const { kept } = await imported(hive, files)
    for (const sig of recipeSettingSignatures(kept.setting)) expect(hive.heap.get(sig)?.type).toBe('image/webp')
  })

  it('bringing the same set in twice keeps it once', async () => {
    const { hive } = await imported()
    const again = await importRecipeSetting(folder(), { store: hive.store })
    expect(again.ok && again.added).toBe(false)
    expect(hive.members()).toHaveLength(1)
  })

  it('refuses with one plain sentence, and writes nothing, when setting.json is not among the files or is not a set', async () => {
    const cases: [File[], string][] = [
      [LAYERS.map(name => file(name, png(name))), 'Choose the setting.json the render wrote, together with its pictures.'],
      [[json(RENDERED_SETTING, 'a.json'), json(RENDERED_SETTING, 'b.json')], 'Choose one setting.json at a time, together with its pictures.'],
      [[json({ plates: [] })], 'setting.json is not a table set: it does not say where its plates are.'],
      [[file('setting.json', enc.encode('{not json'))], 'setting.json is not a table set: it does not say where its plates are.'],
      [[json({ ...RENDERED_SETTING, note: 'x'.repeat(70_000) })], 'setting.json is not a table set: it does not say where its plates are.'],
    ]
    for (const [files, said] of cases) {
      const hive = fakeStore()
      expect(await importRecipeSetting(files, { store: hive.store })).toEqual({ ok: false, reason: said })
      expect(hive.heap.size).toBe(0)
      expect(hive.writes()).toBe(0)
    }
  })

  it('refuses a named picture that is missing, too large, or not a PNG or WebP, before anything is written', async () => {
    const hive = fakeStore()
    const without = folder().filter(each => each.name !== 'plate-kuro.png')
    expect(await importRecipeSetting(without, { store: hive.store })).toEqual({ ok: false, reason: 'plate-kuro.png is missing: choose it together with setting.json.' })

    const large = folder().map(each => (each.name === 'table.png' ? file('table.png', new Uint8Array(RECIPE_SETTING_LIMITS.layerBytes + 1)) : each))
    expect(await importRecipeSetting(large, { store: hive.store })).toEqual({ ok: false, reason: 'table.png is larger than 3 MB, the most one layer of a table set may be.' })

    const jpeg = folder().map(each => (each.name === 'utensils.png' ? file('utensils.png', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'image/png') : each))
    expect(await importRecipeSetting(jpeg, { store: hive.store })).toEqual({ ok: false, reason: 'utensils.png is not a PNG or WebP picture.' })

    expect(hive.heap.size).toBe(0)
    expect(hive.writes()).toBe(0)
  })

  it('refuses a render whose plates do not make a set this desk can lay, naming why', async () => {
    const hive = fakeStore()
    const bad = { ...RENDERED_SETTING, plates: [{ ...RENDERED_SETTING.plates[0], id: 'Ash Plate' }] }
    const said = await importRecipeSetting(folder(bad), { store: hive.store })
    expect(said.ok).toBe(false)
    if (!said.ok) expect(said.reason).toMatch(/^setting\.json does not make a table set this desk can lay: "plates\[0\]\.id" must be one short word/)
    expect(hive.heap.size).toBe(0)
  })

  it('refuses a render of a shape the desk cannot fit whole, before anything is written', async () => {
    const hive = fakeStore()
    const wide = { ...RENDERED_SETTING, size_px: [9000, 1200] }
    expect(await importRecipeSetting(folder(wide), { store: hive.store })).toEqual({
      ok: false,
      reason: 'setting.json does not make a table set this desk can lay: "size" is 9000 by 1200: a table set may be at most 4 times as wide as it is tall, or as tall as it is wide.',
    })
    expect(hive.heap.size).toBe(0)
    expect(hive.writes()).toBe(0)
  })

  it('needs a store to bring anything in', async () => {
    expect(await importRecipeSetting(folder(), { store: {} })).toEqual({ ok: false, reason: 'the store is not available here' })
  })

  it('knows a picture by its first bytes', () => {
    expect(recipeSettingPictureType(png('x'))).toBe('image/png')
    expect(recipeSettingPictureType(webp('x'))).toBe('image/webp')
    expect(recipeSettingPictureType(enc.encode('GIF89a'))).toBeNull()
    expect(recipeSettingPictureType(new Uint8Array())).toBeNull()
  })
})

describe('the sets a hive keeps', () => {
  it('lists them from this device only, and reading creates no pool', async () => {
    const empty = fakeStore()
    expect(await listRecipeSettings(empty.store)).toEqual({ entries: [] })
    expect(empty.created.size).toBe(0)
    expect(await listRecipeSettings(undefined)).toEqual({ entries: [], problem: 'no-store' })
    const { hive, kept } = await imported()
    const listing = await listRecipeSettings(hive.store)
    expect(listing.entries).toEqual([{ sig: kept.sig, ok: true, setting: kept.setting }])
  })

  it('never rewrites a list that does not read as a shorter one', async () => {
    const { hive, kept } = await imported()
    const doc = hive.docs.get(RECIPE_SETTING_MEANING)
    if (doc) doc.current = enc.encode('{"meaning":"recipe:setting","members":"no"}').buffer as ArrayBuffer
    expect(await listRecipeSettings(hive.store)).toEqual({ entries: [], problem: 'unreadable' })
    expect(await forgetRecipeSetting(hive.store, kept.sig)).toEqual({ ok: false, reason: 'the list of table sets on this device does not read, so it was left as it is' })
  })

  it('keeps a set only by bytes that read as one, and taking it off the list keeps its bytes', async () => {
    const { hive, kept } = await imported()
    expect(await keepRecipeSetting(hive.store, recipeBytes({ values: {} }))).toMatchObject({ ok: false })
    expect(await keepRecipeSetting(hive.store, recipeSettingBytes(kept.setting), sigOf('f'))).toEqual({ ok: false, reason: 'its bytes do not match the signature they were held under' })
    expect(await forgetRecipeSetting(hive.store, kept.sig)).toEqual({ ok: true })
    expect(hive.members()).toEqual([])
    expect((await readRecipeSetting(hive.store, kept.sig)).ok).toBe(true)
    // Every list before this one is kept: a participant's save.
    expect(hive.docs.get(RECIPE_SETTING_MEANING)?.versions).toHaveLength(2)
  })

  it('knows whether every picture a set names is held here', async () => {
    const { hive, kept } = await imported()
    expect(await recipeSettingHeld(hive.store, kept.setting)).toBe(true)
    hive.heap.delete(kept.setting.plates[2].layer)
    expect(await recipeSettingHeld(hive.store, kept.setting)).toBe(false)
    expect(await recipeSettingHeld(undefined, kept.setting)).toBe(false)
  })
})

describe('the set the desk sits on', () => {
  it('is none until one is chosen, remembered as one current document, and none again when the plate is chosen', async () => {
    const { hive, kept } = await imported()
    expect(await readRecipeDeskSetting(hive.store)).toBe('')
    expect(hive.created.has(RECIPE_DESK_MEANING)).toBe(false)
    expect(await writeRecipeDeskSetting(hive.store, kept.sig)).toBe(true)
    expect(await readRecipeDeskSetting(hive.store)).toBe(kept.sig)
    expect(await writeRecipeDeskSetting(hive.store, '')).toBe(true)
    expect(await readRecipeDeskSetting(hive.store)).toBe('')
    expect(hive.docs.get(RECIPE_DESK_MEANING)?.keeps).toEqual(['current', 'current'])
    expect(hive.docs.get(RECIPE_DESK_MEANING)?.versions).toEqual([JSON.stringify({ setting: kept.sig }), JSON.stringify({ setting: null })])
  })

  it('remembers only a signature, and a document that does not read is none', async () => {
    const hive = fakeStore()
    expect(await writeRecipeDeskSetting(hive.store, 'table')).toBe(false)
    expect(await writeRecipeDeskSetting({}, sigOf('a'))).toBe(false)
    await hive.store.getPool?.(RECIPE_DESK_MEANING)
    const doc = hive.docs.get(RECIPE_DESK_MEANING)
    if (doc) doc.current = enc.encode('{"setting":"not a sig"}').buffer as ArrayBuffer
    expect(await readRecipeDeskSetting(hive.store)).toBe('')
  })
})

describe('what the community offers', () => {
  /** Hosts with publishers, signed indexes and atoms, as the reader meets them. `asked` is every atom fetched. */
  const hosts = () => {
    const roots = new Map<string, Record<string, string>>()
    const atoms = new Map<string, Uint8Array>()
    const asked: string[] = []
    const io: OfferedReadIo = {
      keysOf: async host => [...roots.keys()].filter(key => key.startsWith(`${host}|`)).map(key => key.split('|')[1]),
      indexOf: async (host, pubkey) => roots.get(`${host}|${pubkey}`) ?? null,
      atom: async (host, sig) => { asked.push(`${host}|${sig}`); return atoms.get(`${host}|${sig}`) ?? null },
      own: async () => null,
    }
    const offer = async (host: string, pubkey: string, sets: Uint8Array[], layers: Uint8Array[] = []): Promise<string[]> => {
      const sigs: string[] = []
      for (const bytes of sets) {
        const sig = await sha(bytes)
        atoms.set(`${host}|${sig}`, bytes)
        sigs.push(sig)
      }
      for (const bytes of layers) atoms.set(`${host}|${await sha(bytes)}`, bytes)
      const list = offeredListBytes(RECIPE_SETTING_MEANING, sigs)
      atoms.set(`${host}|${await sha(list)}`, list)
      roots.set(`${host}|${pubkey}`, { [offeredRootKey(RECIPE_SETTING_MEANING)]: await sha(list) })
      return sigs
    }
    return { io, asked, atoms, offer }
  }

  /** A set someone else made: its document, and its layers as the maker holds them. */
  const theirs = async () => {
    const maker = fakeStore()
    const { kept } = await imported(maker)
    const layers = recipeSettingSignatures(kept.setting).map(sig => maker.heap.get(sig)?.bytes as Uint8Array)
    return { bytes: recipeSettingBytes(kept.setting), sig: kept.sig, layers, setting: kept.setting }
  }

  it('reads the union of the hosts\' recipe:setting pools, each a set under its own signature, and fetches no picture', async () => {
    const world = hosts()
    const set = await theirs()
    await world.offer('a.example', sigOf('1'), [set.bytes, recipeBytes({ values: {} })], set.layers)
    await world.offer('b.example', sigOf('2'), [set.bytes])
    const offers = await findCommunityRecipeSettings(['a.example', 'b.example'], { io: world.io })
    expect(offers.map(offer => offer.sig)).toEqual([set.sig])
    expect(offers[0]).toMatchObject({ host: 'a.example', hosts: ['a.example', 'b.example'], pubkey: sigOf('1') })
    const pictures = recipeSettingSignatures(set.setting)
    expect(world.asked.filter(each => pictures.some(sig => each.endsWith(sig)))).toEqual([])
  })

  it('keeping one fetches each picture from a host that offered it, verified, before the set is kept', async () => {
    const world = hosts()
    const set = await theirs()
    // The first host lies about one layer; the second serves it true.
    await world.offer('a.example', sigOf('1'), [set.bytes], set.layers)
    await world.offer('b.example', sigOf('2'), [set.bytes], set.layers)
    const forged = recipeSettingSignatures(set.setting)[1]
    world.atoms.set(`a.example|${forged}`, png('forged'))
    const [offer] = await findCommunityRecipeSettings(['a.example', 'b.example'], { io: world.io })
    const reader = fakeStore()
    const kept = await takeCommunityRecipeSetting(reader.store, offer, { io: world.io })
    expect(kept).toMatchObject({ ok: true, sig: set.sig, added: true })
    expect(await recipeSettingHeld(reader.store, set.setting)).toBe(true)
    expect(world.asked).toContain(`b.example|${forged}`)
    expect(reader.members()).toEqual([set.sig])
  })

  it('keeps nothing when a picture cannot be fetched from any host that offered it', async () => {
    const world = hosts()
    const set = await theirs()
    await world.offer('a.example', sigOf('1'), [set.bytes], set.layers.slice(0, 3))
    const [offer] = await findCommunityRecipeSettings(['a.example'], { io: world.io })
    const reader = fakeStore()
    expect(await takeCommunityRecipeSetting(reader.store, offer, { io: world.io })).toEqual({ ok: false, reason: 'A picture of this table set could not be fetched from a.example.' })
    expect(reader.members()).toEqual([])
  })
})

describe("a refusal is said in the participant's language", () => {
  /** A catalog that knows a few keys and echoes the rest back, as the shell's does. */
  const speak = (words: Record<string, string>): void => {
    (globalThis as { ioc?: unknown }).ioc = {
      get: (key: string) => (key === I18N_IOC_KEY ? { t: (name: string) => words[name] ?? name } : undefined),
    }
  }
  afterEach(() => { delete (globalThis as { ioc?: unknown }).ioc })

  it("reading a held set that does not read says why in the catalog's words", async () => {
    const hive = fakeStore()
    const bytes = enc.encode('not json')
    const sig = await hive.store.putResource?.(new Blob([bytes.slice().buffer as ArrayBuffer])) ?? ''
    speak({ 'recipe.setting.refusal.notJson': 'JSON ではありません' })
    expect(await readRecipeSetting(hive.store, sig)).toEqual({ sig, ok: false, reason: 'JSON ではありません' })
  })

  it("bringing a render in that does not make a set says the reader's reason in the catalog's words, its holes filled", async () => {
    const hive = fakeStore()
    speak({
      'recipe.setting.reason.invalid': '{file} はこの机に置ける食卓セットになりません：{reason}。',
      'recipe.setting.refusal.aspect': '「size」が {width} × {height} です',
    })
    const wide = { ...RENDERED_SETTING, size_px: [9000, 1200] }
    expect(await importRecipeSetting(folder(wide), { store: hive.store })).toEqual({ ok: false, reason: 'setting.json はこの机に置ける食卓セットになりません：「size」が 9000 × 1200 です。' })
  })

  it("keeping bytes that are not a set, and taking a domain's set that does not read, say it in the catalog's words", async () => {
    const hive = fakeStore()
    speak({ 'recipe.setting.refusal.sigMismatch': '署名と一致しません' })
    const { kept } = await imported()
    expect(await keepRecipeSetting(hive.store, recipeSettingBytes(kept.setting), sigOf('f'))).toEqual({ ok: false, reason: '署名と一致しません' })
    const offer = { sig: sigOf('f'), bytes: recipeSettingBytes(kept.setting), host: 'a.example', hosts: ['a.example'] }
    expect(await takeCommunityRecipeSetting(hive.store, offer)).toEqual({ ok: false, reason: '署名と一致しません' })
  })
})

describe('what a lit hive leaves in the pool', () => {
  /** A hive with kept sets and tiles, the device's own heap only. */
  const lit = async () => {
    const { hive, kept } = await imported()
    const layers = new Map<string, Record<string, unknown>>()
    const recipes: RecipeStoreDeps = {
      history: {
        sign: async lineage => (lineage.explorerSegments?.() ?? []).join('/'),
        currentLayerAt: async (at, stats) => {
          if (at === 'kitchen/cold') { if (stats) stats.cold = true; return null }
          return layers.get(at) ?? null
        },
      },
      store: hive.store as RecipeStoreDeps['store'],
    }
    const recipeTile = async (route: string): Promise<void> => {
      const sig = await hive.store.putResource?.(new Blob([recipeBytes({ values: { story: { kind: 'text', text: route } } }).slice().buffer as ArrayBuffer]))
      layers.set(route, { name: route, [RECIPE_SLOT]: [sig] })
    }
    layers.set('notes', { name: 'notes' })
    await recipeTile('kitchen/soup')
    return { hive, kept, layers, recipes, recipeTile, contribution: recipeSettingContribution({ store: hive.store, recipes }) }
  }

  it('says which pool, and how a count of its members reads', () => {
    const contribution = recipeSettingContribution({ store: {} })
    expect(contribution.meaning).toBe('recipe:setting')
    expect(contribution.label).toEqual({ key: 'recipe.setting.pool.count', one: '1 table set', other: '{count} table sets' })
  })

  it('offers the kept sets while a lit tile holds a recipe, and nothing otherwise', async () => {
    const world = await lit()
    expect(await world.contribution.membersOf([['kitchen', 'soup'], ['notes']])).toEqual([world.kept.sig])
    expect(await world.contribution.membersOf([['notes']])).toEqual([])
    expect(await world.contribution.membersOf([])).toEqual([])
  })

  it('names every picture of each set as its closure, so the pictures travel with it', async () => {
    const world = await lit()
    expect(await world.contribution.closureOf?.([world.kept.sig])).toEqual(recipeSettingSignatures(world.kept.setting))
  })

  it('never offers a set whose pictures are not all here', async () => {
    const world = await lit()
    world.hive.heap.delete(world.kept.setting.table)
    expect(await world.contribution.membersOf([['kitchen', 'soup']])).toEqual([])
  })

  it('a lit tile that could not be read leaves the pool as it is published', async () => {
    const world = await lit()
    await expect(world.contribution.membersOf([['kitchen', 'soup'], ['kitchen', 'cold']])).rejects.toThrow()
  })

  it('stops offering sets before what they name would be more than one publish carries', async () => {
    const world = await lit()
    // Sets of ten pictures each, every picture held: fifty-one fit beside the one already kept, at most 512 pictures in all.
    const one = world.kept.setting
    for (let n = 0; n < 60; n++) {
      const name = (k: number): string => (n * 16 + k + 1).toString(16).padStart(64, '0')
      const doc: RecipeSettingDocument = {
        ...one,
        name: `set ${n}`,
        table: name(0),
        utensils: name(9),
        plates: [...one.plates, ...one.plates].map((plate, k) => ({ ...plate, id: `p${k}`, layer: name(k + 1) })),
      }
      for (const sig of recipeSettingSignatures(doc)) world.hive.heap.set(sig, { bytes: png(sig), type: 'image/png' })
      await keepRecipeSetting(world.hive.store, recipeSettingBytes(doc))
    }
    const members = await world.contribution.membersOf([['kitchen', 'soup']])
    const closure = await world.contribution.closureOf?.(members) ?? []
    expect(members).toHaveLength(51)
    expect(closure.length).toBeLessThanOrEqual(512)
  })

  it('publishes each picture before the set that names it, and the set before the list', async () => {
    const world = await lit()
    const sent: string[] = []
    const deps: OfferedPublishDeps = {
      put: async bytes => sha(bytes),
      bytesOf: async () => new Uint8Array([1]),
      publish: async (_host, sigs) => { sent.push(...sigs); return { ok: true } },
      stamp: async () => ({ ok: true }),
      clear: async () => ({ ok: true }),
    }
    const result = await publishLitPools({
      host: () => 'cook.example',
      lit: async () => [{ segments: ['kitchen', 'soup'], branch: false }],
      childrenOf: async () => [],
      contributions: () => [world.contribution],
      publish: (host, meaning, members, options) => publishOfferedPool(host, meaning, members, { ...options, deps }),
      now: () => 1,
    })
    expect(result).toMatchObject({ ok: true, host: 'cook.example', pools: [{ meaning: 'recipe:setting', count: 1 }] })
    const pictures = recipeSettingSignatures(world.kept.setting)
    expect(sent.slice(0, pictures.length)).toEqual(pictures)
    expect(sent[pictures.length]).toBe(world.kept.sig)
    expect(sent).toHaveLength(pictures.length + 2)
  })
})
