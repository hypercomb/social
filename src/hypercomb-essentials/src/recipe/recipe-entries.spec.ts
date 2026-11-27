// recipe/recipe-entries.spec.ts : a recipe tile as a row someone offers, against
// a hive that behaves like the real one where it matters (resources are named
// by their bytes, a layer is read by its route, a commit is read back), fake
// domains, and a fake room host that holds atoms by signature and members by
// address. No IoC and no network: every external is injected. Each room test
// meets in its own room, because a member once read is remembered for the page.

import { describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { offeredListBytes, offeredRootKey, type OfferedReadIo } from '../pools/offered-pool.js'
import type { RoomEntriesDeps, RoomHostAnswer } from '../pools/room-entries.js'
import type { PoolNode } from '../pools/pool-node.js'
import { readEntryMember, signEntryMember, type EntryRow } from '../pools/open-entries.js'
import {
  RECIPE_ENTRY_MEANING,
  findRecipeEntries,
  openRecipeEntry,
  postedRecipeOf,
  postedRecipeOffers,
  recipeEntryContribution,
  recipeEntryOf,
  retractRecipeFromRoom,
  shareRecipeWithRoom,
  takeRecipeHome,
  type RecipeEntriesDeps,
  type RecipeEntryOffer,
  type RecipeEntryOpened,
} from './recipe-entries.js'
import { RECIPE_SLOT } from './recipe-slot.js'
import {
  RECIPE_LIMITS,
  parseRecipeEntry,
  recipeBytes,
  recipeEntryBytes,
  recipeTemplateBytes,
  type RecipeDocument,
  type RecipeTemplateDocument,
} from './recipe-template.js'

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

/** Bytes that begin as a PNG does, told apart by their last byte. */
const png = (n: number): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n])

const LAYOUT: RecipeTemplateDocument = { name: 'Supper', sections: [{ key: 'story', kind: 'text', label: 'The story' }, { key: 'look', kind: 'pictures', label: 'How it looks' }] }

/** A hive: the device's own heap, what only a host would answer, and layers by route. */
const hive = () => {
  const heap = new Map<string, Uint8Array>()
  const remote = new Map<string, Uint8Array>()
  const layers = new Map<string, Record<string, unknown>>()
  const puts: { sig: string; type: string }[] = []
  const hostAsked: string[] = []
  const imports: { segments: readonly string[]; layer: Record<string, unknown> }[] = []
  const decorated: string[] = []
  const store = {
    getResourceLocal: async (sig: string): Promise<Blob | null> => { const bytes = heap.get(sig); return bytes ? held(bytes) : null },
    getResource: async (sig: string): Promise<Blob | null> => {
      hostAsked.push(sig)
      const bytes = heap.get(sig) ?? remote.get(sig)
      return bytes ? held(bytes) : null
    },
    putResource: async (blob: Blob): Promise<string> => {
      const bytes = await bytesOf(blob)
      const sig = await sha(bytes)
      heap.set(sig, bytes)
      puts.push({ sig, type: blob.type })
      return sig
    },
  }
  const deps: RecipeEntriesDeps = {
    history: {
      sign: async lineage => (lineage.explorerSegments?.() ?? []).join('/'),
      currentLayerAt: async locationSig => layers.get(locationSig) ?? null,
    },
    store,
    committer: {
      importTree: async updates => {
        for (const update of updates) {
          imports.push({ segments: update.segments, layer: { ...update.layer } })
          layers.set(update.segments.join('/'), { ...update.layer })
        }
      },
    },
    decorate: async segments => { decorated.push(segments.join('/')) },
    takenAt: async route => layers.has(route.join('/')),
    ownHost: () => '',
  }
  const put = async (bytes: Uint8Array, into: Map<string, Uint8Array> = heap): Promise<string> => { const sig = await sha(bytes); into.set(sig, bytes); return sig }
  /** A tile at `route` holding `doc` as its recipe. */
  const recipeTile = async (route: string, doc: RecipeDocument): Promise<string> => {
    const sig = await put(recipeBytes(doc))
    layers.set(route, { name: route.split('/').pop(), [RECIPE_SLOT]: [sig] })
    return sig
  }
  return { deps, store, heap, remote, layers, puts, hostAsked, imports, decorated, put, recipeTile }
}

/** Followed domains as a reader sees them: per host its keys, per key its roots, and the atoms it serves. */
const domains = () => {
  const keys = new Map<string, string[]>()
  const roots = new Map<string, Record<string, string>>()
  const atoms = new Map<string, Uint8Array>()
  const asked: string[] = []
  const io: OfferedReadIo = {
    keysOf: async host => keys.get(host) ?? [],
    indexOf: async (host, pubkey) => roots.get(`${host}|${pubkey}`) ?? null,
    atom: async (host, sig) => { asked.push(`${host}|${sig}`); return atoms.get(`${host}|${sig}`) ?? null },
    own: async () => null,
  }
  /** Serve bytes on a host under their own signature, or under `as` to forge them. */
  const serve = async (host: string, bytes: Uint8Array, as?: string): Promise<string> => {
    const sig = as ?? await sha(bytes)
    atoms.set(`${host}|${sig}`, bytes)
    return sig
  }
  /** Offer members in the entry pool on a host. */
  const offer = async (host: string, members: readonly Uint8Array[]): Promise<string[]> => {
    const pubkey = sigOf('1')
    keys.set(host, [pubkey])
    const sigs: string[] = []
    for (const bytes of members) sigs.push(await serve(host, bytes))
    const list = offeredListBytes(RECIPE_ENTRY_MEANING, sigs)
    roots.set(`${host}|${pubkey}`, { [offeredRootKey(RECIPE_ENTRY_MEANING)]: await serve(host, list) })
    return sigs
  }
  return { io, atoms, asked, serve, offer }
}

const ROOM_HOST = 'class.example'
let rooms = 0
const freshRoom = (): string => `kitchen-${++rooms}`

/** The room's host: a heap of atoms, members per address, and every write in the order it arrived. */
const roomHost = () => {
  const atoms = new Map<string, Uint8Array>()
  const members = new Map<string, Map<string, Uint8Array>>()
  const log: string[] = []
  return {
    atoms,
    log,
    putAtom: async (_host: string, sig: string, bytes: Uint8Array): Promise<RoomHostAnswer> => { atoms.set(sig, bytes); log.push(`atom ${sig}`); return { ok: true } },
    putMember: async (_host: string, address: string, name: string, bytes: Uint8Array): Promise<RoomHostAnswer> => {
      const kept = members.get(address) ?? new Map<string, Uint8Array>()
      kept.set(name, bytes)
      members.set(address, kept)
      log.push('member')
      return { ok: true }
    },
    listing: async (_host: string, address: string): Promise<string | null> => {
      const kept = members.get(address)
      return kept ? [...kept.keys()].join('\n') : null
    },
    member: async (_host: string, address: string, name: string): Promise<Uint8Array | null> => members.get(address)?.get(name) ?? null,
    atom: async (_host: string, sig: string): Promise<Uint8Array | null> => atoms.get(sig) ?? null,
  }
}

/** One participant in a room on that host: their own key, their own hive, their own clock. */
const cook = (host: ReturnType<typeof roomHost>, room: string, label: string, joined = true) => {
  const key = generateSecretKey()
  const pubkey = getPublicKey(key)
  const clock = { ms: 1_800_000_000_000 }
  const own = hive()
  const roomDeps: RoomEntriesDeps = {
    joined: () => joined,
    room: () => room,
    secret: () => 'chalk',
    host: () => ROOM_HOST,
    signer: () => ({
      signEvent: async evt => finalizeEvent(evt, key) as unknown as Record<string, unknown>,
      knownPublicKeyHex: async () => pubkey,
    }),
    putAtom: host.putAtom,
    putMember: host.putMember,
    listing: host.listing,
    member: host.member,
    atom: host.atom,
    myName: () => label,
    now: () => clock.ms,
  }
  return { ...own, pubkey, clock, deps: { ...own.deps, room: roomDeps } satisfies RecipeEntriesDeps }
}

const SOUP: RecipeDocument = { values: { story: { kind: 'text', text: 'Slow, and worth it.' } } }

describe('the row a recipe tile offers', () => {
  it('refuses a tile with no recipe, an empty recipe and no tile, and writes nothing', async () => {
    const home = hive()
    home.layers.set('kitchen/notes', { name: 'notes' })
    home.layers.set('kitchen/blank', { name: 'blank', [RECIPE_SLOT]: [await home.put(enc.encode('{"recipe":1,"values":{"story":{"kind":"text","text":"  "}}}'))] })
    home.layers.set('kitchen/lost', { name: 'lost', [RECIPE_SLOT]: [sigOf('a')] })
    expect(await recipeEntryOf(['kitchen', 'notes'], home.deps)).toEqual({ ok: false, reason: 'This tile holds no recipe yet.' })
    expect(await recipeEntryOf(['kitchen', 'nowhere'], home.deps)).toEqual({ ok: false, reason: 'This tile holds no recipe yet.' })
    expect(await recipeEntryOf(['kitchen', 'blank'], home.deps)).toEqual({ ok: false, reason: 'This recipe is empty. Write something in it before you offer it.' })
    expect(await recipeEntryOf(['kitchen', 'lost'], home.deps)).toEqual({ ok: false, reason: 'The recipe on this tile could not be read: its bytes are not held here.' })
    expect(await recipeEntryOf([], home.deps)).toEqual({ ok: false, reason: 'No tile is named.' })
    expect(await recipeEntryOf(['kitchen', ''], home.deps)).toEqual({ ok: false, reason: 'No tile is named.' })
    expect(home.puts).toEqual([])
  })

  it('names the recipe and its cover, and its closure lists the recipe, the template and the pictures', async () => {
    const home = hive()
    const template = await home.put(recipeTemplateBytes(LAYOUT))
    const first = await home.put(png(1))
    const step = await home.put(png(2))
    const recipe = await home.recipeTile('kitchen/soup', {
      template,
      values: {
        look: { kind: 'pictures', pictures: [first] },
        method: { kind: 'steps', steps: [{ text: 'Simmer.', picture: step }] },
      },
    })
    const made = await recipeEntryOf(['kitchen', 'soup'], home.deps)
    if (!made.ok) throw new Error(made.reason)
    expect(made.entry).toEqual({ sig: made.sig, name: 'soup', recipe, cover: first })
    expect(made.closure).toEqual([recipe, template, first, step])
    expect(made.page).toMatch(/^[a-f0-9]{64}$/)
    // The row is its own bytes: canonical, readable by every reader, and held under its own signature.
    expect(made.bytes).toEqual(recipeEntryBytes({ name: 'soup', recipe, cover: first }))
    expect(made.sig).toBe(await sha(made.bytes))
    expect(await parseRecipeEntry(home.heap.get(made.sig) as Uint8Array, made.sig)).toMatchObject({ ok: true })
    expect(home.puts).toEqual([{ sig: made.sig, type: 'application/json' }])
  })

  it('offers only what this device holds, and asks no host for the rest', async () => {
    const home = hive()
    const template = await home.put(recipeTemplateBytes(LAYOUT), home.remote)
    const elsewhere = await home.put(png(1), home.remote)
    const here = await home.put(png(2))
    const recipe = await home.recipeTile('kitchen/soup', { template, values: { look: { kind: 'pictures', pictures: [elsewhere, here] } } })
    const made = await recipeEntryOf(['kitchen', 'soup'], home.deps)
    if (!made.ok) throw new Error(made.reason)
    expect(made.closure).toEqual([recipe, here])
    // The cover is the recipe's first picture, and that one is not here to send.
    expect(made.entry.cover).toBeUndefined()
    expect(home.hostAsked).toEqual([])

    const away = hive()
    away.layers.set('kitchen/soup', { name: 'soup', [RECIPE_SLOT]: [await away.put(recipeBytes(SOUP), away.remote)] })
    expect((await recipeEntryOf(['kitchen', 'soup'], away.deps)).ok).toBe(false)
    expect(away.hostAsked).toEqual([])
  })

  it('is refused when the store answers another signature, or there is no store to hold it', async () => {
    const home = hive()
    await home.recipeTile('kitchen/soup', SOUP)
    const lying: RecipeEntriesDeps = { ...home.deps, store: { ...home.store, putResource: async () => sigOf('f') } }
    expect(await recipeEntryOf(['kitchen', 'soup'], lying)).toEqual({ ok: false, reason: 'The store did not keep the entry it was given.' })
    const reading: RecipeEntriesDeps = { ...home.deps, store: { getResourceLocal: home.store.getResourceLocal } }
    expect(await recipeEntryOf(['kitchen', 'soup'], reading)).toEqual({ ok: false, reason: 'The store is not available here.' })
    const down: RecipeEntriesDeps = { ...home.deps, history: { sign: async () => { throw new Error('down') }, currentLayerAt: async () => null } }
    expect((await recipeEntryOf(['kitchen', 'soup'], down)).ok).toBe(false)
  })

  it('the same tile gives the same page, however its names were spelled, and another tile another', async () => {
    const home = hive()
    await home.recipeTile('my kitchen/soup', SOUP)
    await home.recipeTile('my-kitchen/soup', { values: { story: { kind: 'text', text: 'Changed since.' } } })
    await home.recipeTile('my kitchen/stew', SOUP)
    const first = await recipeEntryOf(['my kitchen', 'soup'], home.deps)
    const again = await recipeEntryOf(['my-kitchen', 'soup'], home.deps)
    const other = await recipeEntryOf(['my kitchen', 'stew'], home.deps)
    if (!first.ok || !again.ok || !other.ok) throw new Error('an entry was refused')
    expect(again.page).toBe(first.page)
    expect(again.sig).not.toBe(first.sig)
    expect(other.page).not.toBe(first.page)
    expect(first.page).toBe(await sha(enc.encode('my-kitchen/soup')))
  })
})

describe('what the lit recipe tiles leave in the pool', () => {
  it('says which pool, and how a count of its members reads', () => {
    const contribution = recipeEntryContribution()
    expect(contribution.meaning).toBe('recipe:entry')
    expect(contribution.label).toEqual({ key: 'recipe.entry.count', one: '1 recipe', other: '{count} recipes' })
  })

  it('answers an entry for each lit route that holds a recipe, and their closure', async () => {
    const home = hive()
    const template = await home.put(recipeTemplateBytes(LAYOUT))
    const picture = await home.put(png(1))
    const soup = await home.recipeTile('kitchen/soup', { template, values: { look: { kind: 'pictures', pictures: [picture] } } })
    const stew = await home.recipeTile('kitchen/stew', { template, values: { story: { kind: 'text', text: 'Thick.' } } })
    await home.recipeTile('kitchen/unlit', SOUP)
    home.layers.set('notes', { name: 'notes', children: [] })

    const contribution = recipeEntryContribution(home.deps)
    const members = await contribution.membersOf([['kitchen', 'soup'], ['notes'], ['kitchen', 'stew'], ['nowhere']])
    expect(members).toEqual([
      await sha(recipeEntryBytes({ name: 'soup', recipe: soup, cover: picture })),
      await sha(recipeEntryBytes({ name: 'stew', recipe: stew })),
    ])
    // Counting the members is a preview: nothing is written and no host is asked.
    expect(home.puts).toEqual([])
    expect(home.hostAsked).toEqual([])

    const closure = await contribution.closureOf?.(members)
    expect(closure).toEqual([soup, template, picture, stew])
    // A publish is about to send them: now the entries are resources, under their own signatures.
    expect(home.puts.map(written => written.sig)).toEqual(members)
    expect(await contribution.closureOf?.([sigOf('a')])).toEqual([])
    expect(await contribution.membersOf([])).toEqual([])
  })

  it('a lit tile that could not be read is never left out as if it held nothing: the members are not answered', async () => {
    const home = hive()
    const soup = await home.recipeTile('kitchen/soup', SOUP)
    await home.recipeTile('kitchen/stew', { values: { story: { kind: 'text', text: 'Thick.' } } })
    // The stew's head is known and its bytes have not reached this device yet: null, and cold.
    let arrived = false
    const cold: RecipeEntriesDeps = {
      ...home.deps,
      history: {
        sign: home.deps.history!.sign,
        currentLayerAt: async (locationSig, stats) => {
          if (locationSig !== 'kitchen/stew' || arrived) return home.layers.get(locationSig) ?? null
          if (stats) stats.cold = true
          return null
        },
      },
    }
    const contribution = recipeEntryContribution(cold)
    const routes = [['kitchen', 'soup'], ['kitchen', 'stew'], ['nowhere']]
    // A shorter list here would be published as the whole pool, and the stew withdrawn.
    await expect(contribution.membersOf(routes)).rejects.toThrow('could not be read')
    expect(await recipeEntryOf(['kitchen', 'stew'], cold)).toMatchObject({ ok: false, unread: true })
    // A tile with no recipe is left out, as before, and is no reason to refuse.
    expect(await recipeEntryOf(['nowhere'], cold)).toEqual({ ok: false, reason: 'This tile holds no recipe yet.' })
    arrived = true
    const members = await contribution.membersOf(routes)
    expect(members).toHaveLength(2)
    expect(members[0]).toBe(await sha(recipeEntryBytes({ name: 'soup', recipe: soup })))
  })
})

describe('sharing a recipe with the room', () => {
  it('sends what the entry names, then the entry, then a member; a classmate reads it back as their node', async () => {
    const host = roomHost()
    const room = freshRoom()
    const ana = cook(host, room, 'Ana Lopez')
    const ben = cook(host, room, 'Ben')
    const picture = await ana.put(png(1))
    const recipe = await ana.recipeTile('kitchen/soup', { values: { look: { kind: 'pictures', pictures: [picture] } } })

    expect(await shareRecipeWithRoom(['kitchen', 'soup'], ana.deps)).toEqual({ ok: true, host: ROOM_HOST })
    const entry = await sha(recipeEntryBytes({ name: 'soup', recipe, cover: picture }))
    expect(host.log).toEqual([`atom ${recipe}`, `atom ${picture}`, `atom ${entry}`, 'member'])

    const [seen] = await findRecipeEntries({ zones: [], room: true }, ben.deps)
    expect(seen).toMatchObject({ sig: entry, entry: { name: 'soup', recipe, cover: picture }, host: ROOM_HOST, at: 1_800_000_000 })
    expect(seen?.node).toEqual({ kind: 'participant', id: ana.pubkey, name: 'Ana Lopez' })
    // The cook sees their own row too, marked as theirs.
    const [mine] = await findRecipeEntries({ zones: [], room: true }, ana.deps)
    expect(mine?.node).toEqual({ kind: 'participant', id: ana.pubkey, name: 'Ana Lopez', you: true })
  })

  it('sharing the tile again replaces its entry, and taking it back leaves none', async () => {
    const host = roomHost()
    const room = freshRoom()
    const ana = cook(host, room, 'Ana')
    const ben = cook(host, room, 'Ben')
    await ana.recipeTile('kitchen/soup', SOUP)
    expect((await shareRecipeWithRoom(['kitchen', 'soup'], ana.deps)).ok).toBe(true)
    ana.clock.ms += 5_000
    const changed = await ana.recipeTile('kitchen/soup', { values: { story: { kind: 'text', text: 'Now with leeks.' } } })
    expect((await shareRecipeWithRoom(['kitchen', 'soup'], ana.deps)).ok).toBe(true)
    const offers = await findRecipeEntries({ zones: [], room: true }, ben.deps)
    expect(offers.map(offer => offer.entry.recipe)).toEqual([changed])

    ana.clock.ms += 5_000
    const atoms = host.atoms.size
    expect(await retractRecipeFromRoom(['kitchen', 'soup'], ana.deps)).toEqual({ ok: true, host: ROOM_HOST })
    expect(host.atoms.size).toBe(atoms)
    expect(await findRecipeEntries({ zones: [], room: true }, ben.deps)).toEqual([])
  })

  it('takes back the entry of a tile whose recipe is gone, by its page alone', async () => {
    const host = roomHost()
    const room = freshRoom()
    const ana = cook(host, room, 'Ana')
    await ana.recipeTile('kitchen/soup', SOUP)
    expect((await shareRecipeWithRoom(['kitchen', 'soup'], ana.deps)).ok).toBe(true)
    ana.layers.set('kitchen/soup', { name: 'soup' })
    ana.clock.ms += 5_000
    expect(await retractRecipeFromRoom(['kitchen', 'soup'], ana.deps)).toEqual({ ok: true, host: ROOM_HOST })
    expect(await findRecipeEntries({ zones: [], room: true }, ana.deps)).toEqual([])
    expect(await retractRecipeFromRoom([], ana.deps)).toEqual({ ok: false, reason: 'No tile is named.' })
  })

  it('says why in words when there is nothing to share, no room, or a host that keeps only its own', async () => {
    const host = roomHost()
    const room = freshRoom()
    const ana = cook(host, room, 'Ana')
    ana.layers.set('kitchen/notes', { name: 'notes' })
    expect(await shareRecipeWithRoom(['kitchen', 'notes'], ana.deps)).toEqual({ ok: false, reason: 'This tile holds no recipe yet.' })
    expect(host.log).toEqual([])

    const alone = cook(host, room, 'Cy', false)
    await alone.recipeTile('kitchen/soup', SOUP)
    const refused = await shareRecipeWithRoom(['kitchen', 'soup'], alone.deps)
    expect(refused).toMatchObject({ ok: false })
    expect(refused.ok ? '' : refused.reason).toMatch(/Join a room first/)

    await ana.recipeTile('kitchen/soup', SOUP)
    const closed: RecipeEntriesDeps = { ...ana.deps, room: { ...ana.deps.room, putAtom: async () => ({ ok: false, status: 403, said: 'not one of ours' }) } }
    const live = await shareRecipeWithRoom(['kitchen', 'soup'], closed)
    expect(live).toMatchObject({ ok: false, live: true })
    expect(live.ok ? '' : live.reason).toContain('shared live while you are here')
  })

  it('names the page by the route and the cook\'s own key, so a guessed route cannot be tested against it', async () => {
    const host = roomHost()
    const room = freshRoom()
    const ana = cook(host, room, 'Ana')
    const ben = cook(host, room, 'Ben')
    await ana.recipeTile('my kitchen/soup', SOUP)
    await ana.recipeTile('my-kitchen/soup', SOUP)
    await ben.recipeTile('my kitchen/soup', SOUP)

    const hers = await recipeEntryOf(['my kitchen', 'soup'], ana.deps)
    const again = await recipeEntryOf(['my-kitchen', 'soup'], ana.deps)
    const his = await recipeEntryOf(['my kitchen', 'soup'], ben.deps)
    if (!hers.ok || !again.ok || !his.ok) throw new Error('an entry was refused')
    const guessed = await sha(enc.encode('my-kitchen/soup'))
    // Stable for one tile and one person, different for each person, never the route alone.
    expect(hers.page).toBe(await sha(enc.encode(`my-kitchen/soup\u0000${ana.pubkey}`)))
    expect(again.page).toBe(hers.page)
    expect(his.page).toBe(await sha(enc.encode(`my-kitchen/soup\u0000${ben.pubkey}`)))
    expect(his.page).not.toBe(hers.page)
    expect([hers.page, his.page]).not.toContain(guessed)
    // The same recipe is still the same row: only what it is OF is each cook's own.
    expect(his.sig).toBe(hers.sig)

    // What the host is handed in the clear is that page, on a share and on taking it back.
    const sent: string[] = []
    const watched: RecipeEntriesDeps = {
      ...ana.deps,
      room: {
        ...ana.deps.room,
        putMember: async (at, address, name, bytes) => {
          const tags = (JSON.parse(new TextDecoder().decode(bytes)) as { tags: string[][] }).tags
          sent.push(tags.find(tag => tag[0] === 'page')?.[1] ?? '')
          return host.putMember(at, address, name, bytes)
        },
      },
    }
    expect((await shareRecipeWithRoom(['my kitchen', 'soup'], watched)).ok).toBe(true)
    ana.clock.ms += 5_000
    expect((await retractRecipeFromRoom(['my kitchen', 'soup'], watched)).ok).toBe(true)
    expect(sent).toEqual([hers.page, hers.page])
    expect(await findRecipeEntries({ zones: [], room: true }, ben.deps)).toEqual([])
  })

  it('signs the route alone only when the device holds no key yet', async () => {
    const host = roomHost()
    const ana = cook(host, freshRoom(), 'Ana')
    await ana.recipeTile('kitchen/soup', SOUP)
    const plain = await sha(enc.encode('kitchen/soup'))
    const keyless: RecipeEntriesDeps = { ...ana.deps, room: { ...ana.deps.room, signer: () => ({ signEvent: async () => ({}), knownPublicKeyHex: async () => null }) } }
    const silent: RecipeEntriesDeps = { ...ana.deps, room: { ...ana.deps.room, signer: () => ({ signEvent: async () => ({}) }) } }
    const failing: RecipeEntriesDeps = { ...ana.deps, room: { ...ana.deps.room, signer: () => ({ signEvent: async () => ({}), knownPublicKeyHex: async () => { throw new Error('locked') } }) } }
    const none: RecipeEntriesDeps = { ...ana.deps, room: { ...ana.deps.room, signer: () => null } }
    for (const deps of [keyless, silent, failing, none]) {
      expect(await recipeEntryOf(['kitchen', 'soup'], deps)).toMatchObject({ ok: true, page: plain })
    }
    expect(await recipeEntryOf(['kitchen', 'soup'], ana.deps)).not.toMatchObject({ page: plain })
  })

  it('a visitor hive shares nothing with a room and takes nothing back, and says so', async () => {
    const host = roomHost()
    const ana = cook(host, freshRoom(), 'Ana')
    await ana.recipeTile('kitchen/soup', SOUP)
    const world = globalThis as { __HC_READONLY__?: boolean }
    world.__HC_READONLY__ = true
    try {
      expect(await shareRecipeWithRoom(['kitchen', 'soup'], ana.deps)).toEqual({ ok: false, reason: 'This visitor hive cannot share with a room.' })
      expect(await retractRecipeFromRoom(['kitchen', 'soup'], ana.deps)).toEqual({ ok: false, reason: 'This visitor hive cannot share with a room.' })
    } finally {
      delete world.__HC_READONLY__
    }
    expect(host.log).toEqual([])
    expect(ana.puts).toEqual([])
    // The same hive, opened as its own, shares.
    expect((await shareRecipeWithRoom(['kitchen', 'soup'], ana.deps)).ok).toBe(true)
  })
})

describe('the recipes the sources offer', () => {
  it('is one offer per entry, with a domain and a classmate as two nodes of it', async () => {
    const host = roomHost()
    const room = freshRoom()
    const ana = cook(host, room, 'Ana Lopez')
    const reader = cook(host, room, 'Ben')
    const recipe = await ana.recipeTile('kitchen/soup', SOUP)
    expect((await shareRecipeWithRoom(['kitchen', 'soup'], ana.deps)).ok).toBe(true)

    const world = domains()
    const soup = recipeEntryBytes({ name: 'soup', recipe })
    const bread = recipeEntryBytes({ name: 'bread', recipe: sigOf('b') })
    const apples = recipeEntryBytes({ name: 'apples', recipe: sigOf('c') })
    await world.offer('a.example', [soup, bread, enc.encode('{"recipe:template":1,"name":"A layout","sections":[]}'), enc.encode('just words')])
    await world.offer('b.example', [soup, apples])

    const offers = await findRecipeEntries({ zones: ['a.example', 'b.example'], room: true }, { ...reader.deps, io: world.io, ownHost: () => 'b.example' })
    // The one with a time first, then by name. What is not an entry is not there.
    expect(offers.map(offer => offer.entry.name)).toEqual(['soup', 'apples', 'bread'])
    const [merged, fromB, fromA] = offers as [RecipeEntryOffer, RecipeEntryOffer, RecipeEntryOffer]
    expect(merged.sig).toBe(await sha(soup))
    expect(merged.host).toBe('a.example')
    expect(merged.at).toBe(1_800_000_000)
    expect(merged.node).toEqual({ kind: 'domain', id: 'a.example' })
    expect(merged.nodes).toEqual([
      { kind: 'domain', id: 'a.example' },
      { kind: 'domain', id: 'b.example', you: true },
      { kind: 'participant', id: ana.pubkey, name: 'Ana Lopez' },
    ])
    expect(fromB).toMatchObject({ host: 'b.example', node: { kind: 'domain', id: 'b.example', you: true } })
    expect(fromB.at).toBeUndefined()
    expect(fromA.nodes).toEqual([{ kind: 'domain', id: 'a.example' }])
  })

  it('reads only the sources it is handed, and silence is an empty answer', async () => {
    const host = roomHost()
    const room = freshRoom()
    const ana = cook(host, room, 'Ana')
    await ana.recipeTile('kitchen/soup', SOUP)
    expect((await shareRecipeWithRoom(['kitchen', 'soup'], ana.deps)).ok).toBe(true)
    const world = domains()
    await world.offer('a.example', [recipeEntryBytes({ name: 'bread', recipe: sigOf('b') })])
    const deps: RecipeEntriesDeps = { ...ana.deps, io: world.io }

    expect((await findRecipeEntries({ zones: ['a.example'] }, deps)).map(offer => offer.entry.name)).toEqual(['bread'])
    expect((await findRecipeEntries({ zones: [], room: true }, deps)).map(offer => offer.entry.name)).toEqual(['soup'])
    expect(await findRecipeEntries({ zones: [] }, deps)).toEqual([])
    const outside = cook(host, room, 'Cy', false)
    expect(await findRecipeEntries({ zones: [], room: true }, outside.deps)).toEqual([])
    const down: OfferedReadIo = { ...world.io, keysOf: async () => { throw new Error('down') } }
    expect(await findRecipeEntries({ zones: ['a.example', 'silent.example'] }, { ...deps, io: down })).toEqual([])
    expect(await findRecipeEntries(null as unknown as { zones: string[] }, deps)).toEqual([])
  })

  it('drops a room entry that is not an entry', async () => {
    const host = roomHost()
    const room = freshRoom()
    const ana = cook(host, room, 'Ana')
    await ana.recipeTile('kitchen/soup', SOUP)
    const made = await recipeEntryOf(['kitchen', 'soup'], ana.deps)
    if (!made.ok) throw new Error(made.reason)
    expect((await shareRecipeWithRoom(['kitchen', 'soup'], ana.deps)).ok).toBe(true)
    // The host swaps the entry's bytes: they no longer hash to the head the member names.
    host.atoms.set(made.sig, recipeEntryBytes({ name: 'swapped', recipe: sigOf('d') }))
    expect(await findRecipeEntries({ zones: [], room: true }, cook(host, room, 'Ben').deps)).toEqual([])
  })
})

describe('opening an offered recipe', () => {
  /** A domain offering one recipe with a template and two pictures; `theirs` is the recipe's own spelling. */
  const offered = async () => {
    const world = domains()
    const template = await world.serve('a.example', recipeTemplateBytes(LAYOUT))
    const first = await world.serve('a.example', png(1))
    const second = await world.serve('a.example', png(2))
    const theirs = enc.encode(JSON.stringify({ values: { look: { pictures: [first, second], kind: 'pictures' }, story: { text: 'Slow.', kind: 'text' } }, template, recipe: 1 }, null, 1))
    const recipe = await world.serve('a.example', theirs)
    await world.offer('a.example', [recipeEntryBytes({ name: 'Grandma\'s Soup', recipe, cover: first })])
    const read = async (deps: RecipeEntriesDeps): Promise<RecipeEntryOffer> => {
      const [offer] = await findRecipeEntries({ zones: ['a.example'] }, { ...deps, io: world.io })
      return offer as RecipeEntryOffer
    }
    return { world, template, first, second, theirs, recipe, read }
  }

  it('reads the recipe, its template and its pictures from the node that offered it, and keeps nothing', async () => {
    const there = await offered()
    const home = hive()
    const deps: RecipeEntriesDeps = { ...home.deps, io: there.world.io }
    const opened = await openRecipeEntry(await there.read(deps), deps)
    if (!opened.ok) throw new Error(opened.reason)
    expect(opened.recipe.sig).toBe(there.recipe)
    expect(opened.template).toMatchObject({ sig: there.template, name: 'Supper' })
    expect([...opened.pictures.keys()]).toEqual([there.first, there.second])
    expect(opened.bytes.recipe).toEqual(there.theirs)
    expect(opened.bytes.template).toEqual(recipeTemplateBytes(LAYOUT))
    // Opening is not keeping.
    expect(home.puts).toEqual([])
    expect(home.heap.size).toBe(0)
    expect(home.imports).toEqual([])
  })

  it('refuses a recipe that is forged, absent or not a recipe', async () => {
    const there = await offered()
    const home = hive()
    const deps: RecipeEntriesDeps = { ...home.deps, io: there.world.io }
    const offer = await there.read(deps)

    await there.world.serve('a.example', recipeBytes(SOUP), there.recipe)
    expect(await openRecipeEntry(offer, deps)).toEqual({ ok: false, reason: 'The recipe did not arrive from a.example.' })
    there.world.atoms.delete(`a.example|${there.recipe}`)
    expect(await openRecipeEntry(offer, deps)).toEqual({ ok: false, reason: 'The recipe did not arrive from a.example.' })

    const layout = await there.world.serve('a.example', recipeTemplateBytes(LAYOUT))
    const wrong: RecipeEntryOffer = { ...offer, entry: { ...offer.entry, recipe: layout } }
    const unread = await openRecipeEntry(wrong, deps)
    expect(unread.ok ? '' : unread.reason).toMatch(/^The recipe from a\.example could not be read: /)
    expect(await openRecipeEntry({} as RecipeEntryOffer, deps)).toEqual({ ok: false, reason: 'This is not an offered recipe.' })
    expect(home.puts).toEqual([])
  })

  it('lets go of a piece a domain serves that runs past its size, instead of holding it whole', async () => {
    const there = await offered()
    const home = hive()
    const offer = await there.read({ ...home.deps, io: there.world.io })
    // The domain answers the recipe with a body that states no length and does not end at 512 KB.
    const seen = { pulled: 0, cancelled: false }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (seen.pulled >= 8000) { controller.close(); return }
        seen.pulled++
        controller.enqueue(new Uint8Array(1024))
      },
      cancel() { seen.cancelled = true },
    }, { highWaterMark: 0 }))))
    try {
      // No `io`: the piece is asked of the domain itself, at both spellings.
      expect(await openRecipeEntry(offer, home.deps)).toEqual({ ok: false, reason: 'The recipe did not arrive from a.example.' })
      expect(seen.pulled).toBeLessThanOrEqual(2 * (RECIPE_LIMITS.recipeBytes / 1024 + 2))
      expect(seen.cancelled).toBe(true)
    } finally { vi.unstubAllGlobals() }
  })

  it('leaves out a template or a picture that is forged, too large, missing or not a picture', async () => {
    const world = domains()
    const forged = await world.serve('a.example', png(9), await sha(png(1)))
    const large = new Uint8Array(2 * 1024 * 1024 + 1)
    large.set(png(2))
    const tooLarge = await world.serve('a.example', large)
    const page = await world.serve('a.example', enc.encode('<html><script>alert(1)</script></html>'))
    const good = await world.serve('a.example', png(3))
    const missing = await sha(png(4))
    const template = await sha(recipeTemplateBytes(LAYOUT))
    const recipe = await world.serve('a.example', recipeBytes({ template, values: { look: { kind: 'pictures', pictures: [forged, tooLarge, page, good, missing] } } }))
    await world.offer('a.example', [recipeEntryBytes({ name: 'soup', recipe })])
    const deps: RecipeEntriesDeps = { ...hive().deps, io: world.io }
    const [offer] = await findRecipeEntries({ zones: ['a.example'] }, deps)
    const opened = await openRecipeEntry(offer as RecipeEntryOffer, deps)
    if (!opened.ok) throw new Error(opened.reason)
    expect([...opened.pictures.keys()]).toEqual([good])
    expect(opened.template).toBeNull()
    expect(opened.bytes.template).toBeUndefined()
  })

  it('asks for at most as many pictures as one section holds', async () => {
    const world = domains()
    const steps = Array.from({ length: RECIPE_LIMITS.pictures + 12 }, (_, at) => ({ text: `Step ${at}`, picture: hex(new Uint8Array(32).fill(at + 1).buffer as ArrayBuffer) }))
    const recipe = await world.serve('a.example', recipeBytes({ values: { method: { kind: 'steps', steps } } }))
    await world.offer('a.example', [recipeEntryBytes({ name: 'long', recipe })])
    const deps: RecipeEntriesDeps = { ...hive().deps, io: world.io }
    const [offer] = await findRecipeEntries({ zones: ['a.example'] }, deps)
    world.asked.length = 0
    expect((await openRecipeEntry(offer as RecipeEntryOffer, deps)).ok).toBe(true)
    expect(world.asked).toHaveLength(1 + RECIPE_LIMITS.pictures)
  })

  it('reads a classmate\'s recipe from the room\'s host', async () => {
    const host = roomHost()
    const room = freshRoom()
    const ana = cook(host, room, 'Ana')
    const ben = cook(host, room, 'Ben')
    const picture = await ana.put(png(1))
    const recipe = await ana.recipeTile('kitchen/soup', { values: { look: { kind: 'pictures', pictures: [picture] } } })
    expect((await shareRecipeWithRoom(['kitchen', 'soup'], ana.deps)).ok).toBe(true)
    const [offer] = await findRecipeEntries({ zones: [], room: true }, ben.deps)
    const opened = await openRecipeEntry(offer as RecipeEntryOffer, ben.deps)
    if (!opened.ok) throw new Error(opened.reason)
    expect(opened.recipe.sig).toBe(recipe)
    expect([...opened.pictures.keys()]).toEqual([picture])
    expect(ben.puts).toEqual([])
    // Outside the room there is nowhere to read it from.
    const outside = cook(host, room, 'Cy', false)
    expect(await openRecipeEntry(offer as RecipeEntryOffer, outside.deps)).toEqual({ ok: false, reason: 'The recipe did not arrive from Ana.' })
  })
})

describe('taking a recipe home', () => {
  /** An offer and what opening it answered, with the recipe in its publisher's own spelling. */
  const inHand = async (name = 'Grandma\'s Soup') => {
    const picture = png(1)
    const pictureSig = await sha(picture)
    const layout = recipeTemplateBytes(LAYOUT)
    const template = await sha(layout)
    const theirs = enc.encode(JSON.stringify({ values: { look: { pictures: [pictureSig], kind: 'pictures' } }, template, recipe: 1 }, null, 2))
    const recipe = await sha(theirs)
    const world = domains()
    for (const bytes of [picture, layout, theirs]) await world.serve('a.example', bytes)
    await world.offer('a.example', [recipeEntryBytes({ name, recipe, cover: pictureSig })])
    const deps: RecipeEntriesDeps = { ...hive().deps, io: world.io }
    const [offer] = await findRecipeEntries({ zones: ['a.example'] }, deps)
    const opened = await openRecipeEntry(offer as RecipeEntryOffer, deps)
    if (!opened.ok) throw new Error(opened.reason)
    return { offer: offer as RecipeEntryOffer, opened: opened as RecipeEntryOpened, theirs, recipe, template, pictureSig }
  }

  it('keeps every piece under its own signature, then makes one tile named for the entry', async () => {
    const hand = await inHand()
    const home = hive()
    const taken = await takeRecipeHome(hand.offer, hand.opened, ['kitchen'], home.deps)
    expect(taken).toEqual({ ok: true, segments: ['kitchen', 'grandmas-soup'] })
    // The parts, then the document that names them, each as the type it is.
    expect(home.puts).toEqual([
      { sig: hand.pictureSig, type: 'image/png' },
      { sig: hand.template, type: 'application/json' },
      { sig: hand.recipe, type: 'application/json' },
    ])
    // The publisher's own bytes: another spelling would be another signature.
    expect(new TextDecoder().decode(home.heap.get(hand.recipe))).toBe(new TextDecoder().decode(hand.theirs))
    expect(home.imports).toEqual([{ segments: ['kitchen', 'grandmas-soup'], layer: { name: 'grandmas-soup', [RECIPE_SLOT]: [hand.recipe] } }])
    expect(home.decorated).toEqual(['kitchen/grandmas-soup'])
    // The recipe it took home is one it can offer in turn.
    const offeredOn = await recipeEntryOf(['kitchen', 'grandmas-soup'], home.deps)
    expect(offeredOn).toMatchObject({ ok: true, entry: { recipe: hand.recipe, cover: hand.pictureSig }, closure: [hand.recipe, hand.template, hand.pictureSig] })
  })

  it('a visitor hive takes no recipe home: nothing is kept and no tile is made', async () => {
    const hand = await inHand()
    const home = hive()
    const world = globalThis as { __HC_READONLY__?: boolean }
    world.__HC_READONLY__ = true
    try {
      expect(await takeRecipeHome(hand.offer, hand.opened, ['kitchen'], home.deps)).toEqual({ ok: false, reason: 'This visitor hive cannot keep a recipe.' })
    } finally {
      delete world.__HC_READONLY__
    }
    expect(home.puts).toEqual([])
    expect(home.imports).toEqual([])
    expect(home.decorated).toEqual([])
  })

  it('refuses a store that answers another signature, and makes no tile', async () => {
    const hand = await inHand()
    const home = hive()
    const lying: RecipeEntriesDeps = { ...home.deps, store: { ...home.store, putResource: async () => sigOf('f') } }
    expect(await takeRecipeHome(hand.offer, hand.opened, ['kitchen'], lying)).toEqual({ ok: false, reason: 'The store did not keep the bytes it was given, so no tile was made.' })
    const failing: RecipeEntriesDeps = { ...home.deps, store: { ...home.store, putResource: async () => { throw new Error('full') } } }
    expect((await takeRecipeHome(hand.offer, hand.opened, ['kitchen'], failing)).ok).toBe(false)
    expect(home.imports).toEqual([])
    expect(home.decorated).toEqual([])
  })

  it('a name already taken on the page gets a number after it, and a reserved word is never taken', async () => {
    const hand = await inHand()
    const home = hive()
    home.layers.set('kitchen/grandmas-soup', { name: 'grandmas-soup', [RECIPE_SLOT]: [sigOf('a')] })
    expect(await takeRecipeHome(hand.offer, hand.opened, ['kitchen'], home.deps)).toEqual({ ok: true, segments: ['kitchen', 'grandmas-soup-2'] })
    expect(await takeRecipeHome(hand.offer, hand.opened, ['kitchen'], home.deps)).toEqual({ ok: true, segments: ['kitchen', 'grandmas-soup-3'] })
    // Two presses at once never take the same free name.
    const both = await Promise.all([
      takeRecipeHome(hand.offer, hand.opened, [], home.deps),
      takeRecipeHome(hand.offer, hand.opened, [], home.deps),
    ])
    expect(both).toEqual([{ ok: true, segments: ['grandmas-soup'] }, { ok: true, segments: ['grandmas-soup-2'] }])
    // The one that was there is untouched.
    expect(home.layers.get('kitchen/grandmas-soup')).toEqual({ name: 'grandmas-soup', [RECIPE_SLOT]: [sigOf('a')] })

    const reserved = await inHand('Bees')
    expect(await takeRecipeHome(reserved.offer, reserved.opened, ['kitchen'], hive().deps)).toEqual({ ok: true, segments: ['kitchen', 'bees-2'] })
    const symbols = await inHand('!!!')
    expect(await takeRecipeHome(symbols.offer, symbols.opened, ['kitchen'], hive().deps)).toEqual({ ok: true, segments: ['kitchen', 'recipe'] })
  })

  it('checks what was opened again, by its own bytes, before anything is kept', async () => {
    const hand = await inHand()
    const home = hive()
    const swapped: RecipeEntryOpened = { ...hand.opened, bytes: { recipe: recipeBytes(SOUP) } }
    expect(await takeRecipeHome(hand.offer, swapped, ['kitchen'], home.deps)).toEqual({ ok: false, reason: 'What was opened is not the recipe this entry names.' })
    expect(await takeRecipeHome(hand.offer, null as unknown as RecipeEntryOpened, ['kitchen'], home.deps)).toMatchObject({ ok: false })
    expect(home.puts).toEqual([])

    // A picture that is not the bytes it is named by, and one the recipe does not name, are not kept.
    const dressed: RecipeEntryOpened = { ...hand.opened, pictures: new Map([[hand.pictureSig, png(7)], [await sha(png(8)), png(8)]]) }
    expect((await takeRecipeHome(hand.offer, dressed, ['kitchen'], home.deps)).ok).toBe(true)
    expect(home.puts.map(written => written.sig)).toEqual([hand.template, hand.recipe])
  })

  it('says so when the tile did not land, the page cannot be read, or the hive is not ready', async () => {
    const hand = await inHand()
    const home = hive()
    const silent: RecipeEntriesDeps = { ...home.deps, committer: { importTree: async () => undefined } }
    expect(await takeRecipeHome(hand.offer, hand.opened, ['kitchen'], silent)).toEqual({ ok: false, reason: 'The recipe is kept, but its tile could not be made here.' })
    const rewound: RecipeEntriesDeps = { ...home.deps, committer: { importTree: async () => { throw new Error('viewing the past') } } }
    expect(await takeRecipeHome(hand.offer, hand.opened, ['kitchen'], rewound)).toEqual({ ok: false, reason: 'The recipe is kept, but its tile could not be made here.' })
    const cold: RecipeEntriesDeps = { ...home.deps, takenAt: async () => { throw new Error('cold') } }
    expect(await takeRecipeHome(hand.offer, hand.opened, ['kitchen'], cold)).toEqual({ ok: false, reason: 'This page could not be read, so no tile was made.' })
    const crowded: RecipeEntriesDeps = { ...home.deps, takenAt: async () => true }
    expect(await takeRecipeHome(hand.offer, hand.opened, ['kitchen'], crowded)).toEqual({ ok: false, reason: 'No free name was found for the tile.' })
    expect(await takeRecipeHome(hand.offer, hand.opened, ['kitchen'], { ...home.deps, committer: {} })).toEqual({ ok: false, reason: 'The hive is not ready to keep a recipe here yet.' })
    expect(await takeRecipeHome(hand.offer, hand.opened, ['kitchen', ''], home.deps)).toEqual({ ok: false, reason: 'There is no page to put the recipe on.' })
    expect(home.decorated).toEqual([])
  })
})

// THE LIVE HIVE WRAPS WHAT A SLOT NAMES (L2): the slot holds the signature of a
// meta envelope { meta: 1, resource, relation }, and only the store's resolved
// reads follow that hop. The hive above keeps the recipe's own signature in the
// slot, which no real hive does.
describe('a recipe behind a meta envelope, as a real hive keeps it', () => {
  const wrapping = () => {
    const world = hive()
    const envelope = (sig: string): Promise<string> => world.put(enc.encode(JSON.stringify({ meta: 1, resource: sig, relation: RECIPE_SLOT })))
    const through = async (sig: string): Promise<Blob | null> => {
      const bytes = world.heap.get(sig)
      if (!bytes) return null
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { meta?: unknown; resource?: unknown }
        if (parsed.meta === 1 && typeof parsed.resource === 'string') return world.store.getResourceLocal(parsed.resource)
      } catch { /* not an envelope: the bytes as they are */ }
      return held(bytes)
    }
    const deps: RecipeEntriesDeps = {
      ...world.deps,
      store: { ...world.store, getResource: through, getResourceResolvedLocal: through },
      committer: {
        importTree: async updates => {
          for (const update of updates) {
            const slot = update.layer[RECIPE_SLOT]
            const wrapped = { ...update.layer, ...(Array.isArray(slot) ? { [RECIPE_SLOT]: await Promise.all(slot.map(sig => envelope(String(sig)))) } : {}) }
            world.imports.push({ segments: update.segments, layer: wrapped })
            world.layers.set(update.segments.join('/'), wrapped)
          }
        },
      },
    }
    /** A tile whose slot names the envelope of `doc`, as a commit leaves it. */
    const recipeTile = async (route: string, doc: RecipeDocument): Promise<string> => {
      const sig = await world.put(recipeBytes(doc))
      world.layers.set(route, { name: route.split('/').pop(), [RECIPE_SLOT]: [await envelope(sig)] })
      return sig
    }
    return { ...world, deps, recipeTile }
  }

  it('offers the recipe by its own signature, never by the slot\'s reference', async () => {
    const home = wrapping()
    const recipe = await home.recipeTile('kitchen/soup', SOUP)
    const slot = (home.layers.get('kitchen/soup') as Record<string, string[]>)[RECIPE_SLOT]
    expect(slot).not.toEqual([recipe])

    const made = await recipeEntryOf(['kitchen', 'soup'], home.deps)
    if (!made.ok) throw new Error(made.reason)
    expect(made.entry.recipe).toBe(recipe)
    expect(made.closure).toEqual([recipe])
    const contribution = recipeEntryContribution(home.deps)
    expect(await contribution.membersOf([['kitchen', 'soup']])).toEqual([made.sig])
    expect(await contribution.closureOf?.([made.sig])).toEqual([recipe])
  })

  it('a recipe taken home lands behind its envelope and reads back as itself', async () => {
    const theirs = recipeBytes(SOUP)
    const recipe = await sha(theirs)
    const world = domains()
    await world.serve('a.example', theirs)
    await world.offer('a.example', [recipeEntryBytes({ name: 'soup', recipe })])
    const home = wrapping()
    const deps: RecipeEntriesDeps = { ...home.deps, io: world.io }
    const [offer] = await findRecipeEntries({ zones: ['a.example'] }, deps)
    const opened = await openRecipeEntry(offer as RecipeEntryOffer, deps)
    if (!opened.ok) throw new Error(opened.reason)

    expect(await takeRecipeHome(offer as RecipeEntryOffer, opened, ['kitchen'], deps)).toEqual({ ok: true, segments: ['kitchen', 'soup'] })
    expect((home.layers.get('kitchen/soup') as Record<string, string[]>)[RECIPE_SLOT]).not.toEqual([recipe])
    expect(await recipeEntryOf(['kitchen', 'soup'], deps)).toMatchObject({ ok: true, entry: { recipe } })
  })
})

describe('a posted row: a member of an open entry pool', () => {
  const POOL = sigOf('9')
  const HOST = 'https://class.example.com'
  const poster = generateSecretKey()

  /** A member of POOL carrying `content`, read back as the reader's fold gives it. */
  const rowOf = async (content: string, over: { title?: string; name?: string; secret?: Uint8Array; page?: string } = {}): Promise<EntryRow> => {
    const signed = await signEntryMember({
      pool: POOL, page: over.page ?? sigOf('a'), name: over.name ?? 'Ana', title: over.title ?? 'Sunday soup', content, createdAt: 1_800_000_000,
    }, over.secret ?? poster)
    if (!signed.ok) throw new Error(signed.reason)
    const member = await readEntryMember(signed.body, POOL, signed.name)
    if (!member) throw new Error('the member did not read back')
    return { signer: member.signer, label: member.label, title: member.title, page: member.page, at: member.at, content: member.content, member: member.name, bytes: member.bytes }
  }
  const layout = recipeTemplateBytes(LAYOUT)
  const posted = async () => {
    const template = await sha(layout)
    const words = recipeBytes({ template, values: { story: { kind: 'text', text: 'Slow, and worth it.' } } })
    return { template, words, recipe: await sha(words), row: await rowOf(new TextDecoder().decode(words)) }
  }

  it('is an offer of the same shape as any other: its entry names the hash of the words, under the person who signed it', async () => {
    const { template, recipe, row } = await posted()
    const made = await postedRecipeOf(row, { pool: POOL, host: HOST, template, own: getPublicKey(poster) })
    if (!made.ok) throw new Error(made.reason)
    const entry = recipeEntryBytes({ name: 'Sunday soup', recipe })
    expect(made.offer.sig).toBe(await sha(entry))
    expect(made.offer.entry).toMatchObject({ name: 'Sunday soup', recipe })
    expect(made.offer.node).toEqual({ kind: 'participant', id: getPublicKey(poster), name: 'Ana', you: true })
    expect(made.offer.posted).toEqual({ member: row.member, bytes: row.bytes, pool: POOL, host: HOST, template, lines: [{ signer: row.signer, page: row.page }] })
  })

  it('refuses a posted recipe that names any signature but the pool\'s template', async () => {
    const { template } = await posted()
    const picture = recipeBytes({ template, values: { look: { kind: 'pictures', pictures: [sigOf('d')] } } })
    const stepPicture = recipeBytes({ template, values: { steps: { kind: 'steps', steps: [{ text: 'Stir', picture: sigOf('d') }] } } })
    const otherTemplate = recipeBytes({ template: sigOf('e'), values: { story: { kind: 'text', text: 'Hi' } } })
    for (const words of [picture, stepPicture, otherTemplate]) {
      const row = await rowOf(new TextDecoder().decode(words))
      expect(await postedRecipeOf(row, { pool: POOL, host: HOST, template })).toMatchObject({ ok: false, reason: expect.stringContaining('names something other than the form') })
      expect(await postedRecipeOffers([row], { pool: POOL, host: HOST, template })).toEqual([])
    }
  })

  it('refuses words that are not a recipe the reader accepts', async () => {
    const { template } = await posted()
    expect(await postedRecipeOf(await rowOf('not a recipe'), { pool: POOL, host: HOST, template })).toMatchObject({ ok: false })
  })

  it('gathers one offer per entry, with every person who posted the same one', async () => {
    const { template, words } = await posted()
    const other = generateSecretKey()
    const rows = [await rowOf(new TextDecoder().decode(words)), await rowOf(new TextDecoder().decode(words), { secret: other, name: 'Ben' })]
    const offers = await postedRecipeOffers(rows, { pool: POOL, host: HOST, template })
    expect(offers).toHaveLength(1)
    expect(offers[0]?.nodes.map(node => node.name)).toEqual(['Ana', 'Ben'])
    // Each poster's own entry page: what the leader hides one entry by.
    expect(offers[0]?.posted?.lines).toEqual(rows.map(row => ({ signer: row.signer, page: row.page })))
  })

  it('opens from the member\'s own bytes and reads the template from the pool\'s host: the room is never asked', async () => {
    const { template, words, row } = await posted()
    const made = await postedRecipeOf(row, { pool: POOL, host: HOST, template })
    if (!made.ok) throw new Error(made.reason)
    const asked: string[] = []
    const roomAsked = vi.fn(async () => null)
    const deps: RecipeEntriesDeps = {
      store: {},
      io: { atom: async (host, sig) => { asked.push(`${host} ${sig}`); return sig === template ? layout : null } },
      room: { bytesOf: roomAsked } as unknown as RoomEntriesDeps,
    }
    const opened = await openRecipeEntry(made.offer, deps)
    if (!opened.ok) throw new Error(opened.reason)
    expect(opened.bytes.recipe).toEqual(words)
    expect(opened.template?.sig).toBe(template)
    expect(opened.pictures.size).toBe(0)
    expect(asked).toEqual([`${HOST} ${template}`])
    expect(roomAsked).not.toHaveBeenCalled()
  })

  it('reads the template from this device\'s own store first', async () => {
    const { template, row } = await posted()
    const made = await postedRecipeOf(row, { pool: POOL, host: HOST, template })
    if (!made.ok) throw new Error(made.reason)
    const atom = vi.fn(async () => null)
    const opened = await openRecipeEntry(made.offer, { store: { getResourceLocal: async sig => (sig === template ? held(layout) : null) }, io: { atom } })
    expect(opened).toMatchObject({ ok: true, template: { sig: template } })
    expect(atom).not.toHaveBeenCalled()
  })

  it('refuses an offer whose bytes are not the member it names, or whose words are not the recipe its entry names', async () => {
    const { template, row } = await posted()
    const made = await postedRecipeOf(row, { pool: POOL, host: HOST, template })
    if (!made.ok) throw new Error(made.reason)
    const carried = made.offer.posted as NonNullable<RecipeEntryOffer['posted']>
    const tampered = carried.bytes.slice()
    tampered[tampered.length - 3] ^= 1
    const io = { atom: async () => layout }
    expect(await openRecipeEntry({ ...made.offer, posted: { ...carried, bytes: tampered } }, { store: {}, io }))
      .toMatchObject({ ok: false, reason: expect.stringContaining('is not the member it says it is') })
    expect(await openRecipeEntry({ ...made.offer, posted: { ...carried, pool: sigOf('8') } }, { store: {}, io })).toMatchObject({ ok: false })
    expect(await openRecipeEntry({ ...made.offer, entry: { ...made.offer.entry, recipe: sigOf('7') } }, { store: {}, io })).toMatchObject({ ok: false })
  })

  it('is brought home as an ordinary recipe: its words and its template under their own signatures', async () => {
    const { template, recipe, row } = await posted()
    const made = await postedRecipeOf(row, { pool: POOL, host: HOST, template })
    if (!made.ok) throw new Error(made.reason)
    const opened = await openRecipeEntry(made.offer, { store: {}, io: { atom: async () => layout } })
    if (!opened.ok) throw new Error(opened.reason)
    const home = hive()
    expect(await takeRecipeHome(made.offer, opened, ['kitchen'], home.deps)).toEqual({ ok: true, segments: ['kitchen', 'sunday-soup'] })
    expect(home.puts).toEqual([{ sig: template, type: 'application/json' }, { sig: recipe, type: 'application/json' }])
  })
})

describe('a domain that did not answer', () => {
  it('is told by name, apart from one that answered with nothing, and the others still give their rows', async () => {
    const world = domains()
    await world.offer('up.example', [recipeEntryBytes({ name: 'soup', recipe: sigOf('a') })])
    const io: OfferedReadIo = {
      ...world.io,
      keysOf: async host => {
        if (host === 'down.example') throw new Error('offline')
        return world.io.keysOf!(host)
      },
    }
    const told: PoolNode[] = []
    const answers = vi.fn(async (zone: string) => zone !== 'gone.example')
    const offers = await findRecipeEntries(
      { zones: ['up.example', 'down.example', 'quiet.example', 'gone.example'] },
      { io, ownHost: () => '', answers, unanswered: node => { told.push(node) } },
    )
    expect(offers.map(offer => offer.entry.name)).toEqual(['soup'])
    // A read that threw, and a host that does not answer at all: never read as offering nothing.
    expect(told.map(node => node.id).sort()).toEqual(['down.example', 'gone.example'])
    expect(told.every(node => node.kind === 'domain')).toBe(true)
    // A host that offered rows is not asked again; one that threw needs no second question.
    expect(answers.mock.calls.map(([zone]) => zone).sort()).toEqual(['gone.example', 'quiet.example'])
  })

  it('asks nothing more where nobody listens for it', async () => {
    const world = domains()
    const answers = vi.fn(async () => false)
    expect(await findRecipeEntries({ zones: ['quiet.example'] }, { io: world.io, ownHost: () => '', answers })).toEqual([])
    expect(answers).not.toHaveBeenCalled()
  })
})
