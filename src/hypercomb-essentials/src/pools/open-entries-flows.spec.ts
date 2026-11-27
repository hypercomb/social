// pools/open-entries-flows.spec.ts : opening, closing, recycling, hiding,
// posting and reading the leader's own index, against a fake world: a leader's
// signed index that changes one write at a time, a host that serves atoms and
// answers the listing from that index, a visitor page, a record and a nonce
// store in memory. No network and no IoC.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateSecretKey } from 'nostr-tools/pure'
import { ROOT_MOVED, type ChangeHiveRootsResult, type HiveIndexResult, type HiveRootsChange } from '../sharing/hive-pointer.js'
import { I18N_IOC_KEY, POST_CODE_EFFECT, SignatureService } from '@hypercomb/core'
import {
  ENTRY_LIMITS,
  emptyHiddenList,
  entryCodeLink,
  entryIndexKeys,
  entryPoolAddress,
  entryPoolName,
  entryRecordBytes,
  hiddenListBytes,
  parseEntryRecord,
  parseHiddenList,
  readEntryMember,
  withHiddenLine,
  type EntryListing,
  type EntryPoolPath,
} from './open-entries.js'
import {
  carriedPackageOf,
  checkEntryPage,
  closeEntryPool,
  entryCodeFor,
  isPastKeeping,
  liveOpenedRecord,
  openEntryPool,
  openedPoolsOf,
  openedRecordBytes,
  ownEntryPools,
  packageHasPostBee,
  postEntryMember,
  readEntryPage,
  recycleEntryPool,
  setEntryHidden,
  type OpenEntriesDeps,
  type OpenedEntryPool,
} from './open-entries-flows.js'

const enc = new TextEncoder()
const sign = (bytes: Uint8Array): Promise<string> => SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
const hexOf = (ch: string, length = 64): string => ch.repeat(length)
const P = hexOf('5')
const HOST = 'example.com'
const PAGE = 'class.example.com'
const START = 1_800_000_000_000
const PACKAGE = hexOf('6')
const VISITOR_PAGE = `<html><head><meta name="hypercomb-takes" content="post" /><script id="hc-install" type="application/json">${JSON.stringify({ text: `${PACKAGE}\nmore` })}</script></head></html>`

/** A world the flows run in. Every knob a refusal needs is an option. */
const world = async (options: {
  html?: string | null
  postBee?: 'has' | 'lacks' | 'unknown'
  kept?: readonly string[]
  /** Listings answered as if the index were not yet seen (the host's five-second copy). */
  lag?: number
  /** The host never says open. */
  neverOpens?: boolean
  /** The host serves no atoms. */
  servesNothing?: boolean
  /** Index writes refused with this reason, this many times. */
  refuseWrites?: { reason: string; times: number }
  put?: (url: string, bytes: Uint8Array) => { status?: number; said: string }
  readonly?: boolean
  key?: string
} = {}) => {
  let clock = START
  const log: string[] = []
  const roots: Record<string, string> = {}
  const store = new Map<string, Uint8Array>()
  const host = new Map<string, Uint8Array>()
  const nonces = new Map<string, string>()
  const recordWrites: Uint8Array[] = []
  let records: OpenedEntryPool[] = []
  const posted: { url: string; bytes: Uint8Array }[] = []
  const listings: EntryPoolPath[] = []
  let lag = options.lag ?? 0
  let refusals = options.refuseWrites?.times ?? 0
  const template = enc.encode('{"recipe:template":1,"name":"Soup","sections":[]}')
  const templateSig = await sign(template)
  store.set(templateSig, template)

  const stateOf = async (path: EntryPoolPath): Promise<EntryListing['state']> => {
    const pool = await entryPoolName(path.address, path.by, path.until)
    const keys = entryIndexKeys(pool)
    if (roots[keys.closed]) return 'closed'
    if (roots[keys.open]) return options.neverOpens ? null : 'open'
    return null
  }

  const deps: OpenEntriesDeps = {
    publisherKey: async () => options.key ?? P,
    now: () => clock,
    sleep: async ms => { clock += ms },
    newNonce: () => hexOf('9', 32),
    newSecretKey: () => generateSecretKey(),
    readonly: () => options.readonly === true,
    keep: async bytes => { const sig = await sign(bytes); store.set(sig, bytes); log.push('keep'); return sig },
    bytesOf: async sig => store.get(sig) ?? null,
    publish: async (_host, sigs, bytesOf) => {
      for (const sig of sigs) { const bytes = await bytesOf(sig); if (!bytes) return { ok: false, error: 'not held' }; host.set(sig, bytes) }
      log.push(`publish ${sigs.length}`)
      return { ok: true }
    },
    atom: async (_page, sig) => options.servesNothing ? null : host.get(sig) ?? null,
    index: async (): Promise<HiveIndexResult> => ({ ok: true, manifest: { roots: { ...roots }, createdAt: 1, pubkey: P } }),
    changeRoots: async (_host, change: HiveRootsChange): Promise<ChangeHiveRootsResult> => {
      log.push(`index ${JSON.stringify(change)}`)
      if (refusals > 0) { refusals--; return { ok: false, host: HOST, pubkey: '', createdAt: 0, dropped: {}, set: {}, reason: options.refuseWrites!.reason } }
      for (const [key, want] of Object.entries(change.expect ?? {})) {
        if ((roots[key] ?? null) !== want) return { ok: false, host: HOST, pubkey: '', createdAt: 0, dropped: {}, set: {}, reason: ROOT_MOVED }
      }
      for (const key of change.drop ?? []) delete roots[key]
      Object.assign(roots, change.set ?? {})
      return { ok: true, host: HOST, pubkey: P, createdAt: 2, dropped: {}, set: { ...change.set } }
    },
    listing: async (path): Promise<EntryListing> => {
      listings.push(path)
      log.push('listing')
      const seen = lag > 0 ? (lag--, null) : await stateOf(path)
      return { reached: true, status: 200, state: seen, names: [], over: false, hidden: null, hostTime: Math.floor(clock / 1000) + 30, said: '' }
    },
    putMember: async (url, bytes) => {
      posted.push({ url, bytes })
      log.push('put')
      return options.put ? options.put(url, bytes) : { status: 201, said: 'member' }
    },
    page: async () => options.html === null ? null : { status: 200, html: options.html ?? VISITOR_PAGE },
    postBee: async () => options.postBee ?? 'has',
    keptLayers: async () => options.kept ?? [],
    records: {
      read: async () => records,
      write: async pools => { const bytes = openedRecordBytes(pools); recordWrites.push(bytes); records = openedPoolsOf(bytes); log.push('record'); return true },
    },
    nonces: {
      get: pool => nonces.get(pool) ?? '',
      set: (pool, nonce) => { nonces.set(pool, nonce); return true },
      drop: pool => { nonces.delete(pool) },
    },
  }
  return {
    deps, log, roots, store, host, nonces, posted, listings, recordWrites, templateSig,
    records: () => records,
    setClock: (ms: number) => { clock = ms },
    input: { host: HOST, page: PAGE, title: 'Tuesday class', meaning: 'recipe:entry', template: templateSig },
  }
}

describe('opening', () => {
  it('runs the seven steps in order and gives the code only at the end', async () => {
    const w = await world()
    const opened = await openEntryPool(w.input, w.deps)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const until = Math.floor(START / 1000) + ENTRY_LIMITS.defaultSeconds
    expect(opened.pool).toMatchObject({ host: HOST, page: PAGE, title: 'Tuesday class', until })
    const address = await entryPoolAddress(opened.pool.record, hexOf('9', 32))
    expect(await entryPoolName(address, P, until)).toBe(opened.pool.pool)
    expect(opened.link).toBe(entryCodeLink(PAGE, opened.pool.record, hexOf('9', 32)))
    expect(w.roots).toEqual({ [`entries:${opened.pool.pool}`]: opened.pool.record })
    expect(w.nonces.get(opened.pool.pool)).toBe(hexOf('9', 32))
    expect(w.log.filter(step => !step.startsWith('index'))).toEqual(['keep', 'publish 2', 'record', 'listing', 'put'])
    // The record and the template both went up, the template first.
    expect(w.host.has(opened.pool.record) && w.host.has(w.templateSig)).toBe(true)
  })

  it('posts a taken-back first member, for this pool, stamped with the host\'s time', async () => {
    const w = await world()
    const opened = await openEntryPool(w.input, w.deps)
    if (!opened.ok) throw new Error(opened.reason)
    expect(w.posted).toHaveLength(1)
    const member = await readEntryMember(w.posted[0].bytes, opened.pool.pool)
    expect(member).toMatchObject({ gone: true, title: 'Tuesday class', label: 'Tuesday class', at: Math.floor(START / 1000) + 30 })
    expect(w.posted[0].url).toContain(`?by=${P}&until=${opened.pool.until}`)
  })

  it('keeps the nonce out of the record', async () => {
    const w = await world()
    const opened = await openEntryPool(w.input, w.deps)
    if (!opened.ok) throw new Error(opened.reason)
    expect(w.recordWrites.length).toBeGreaterThan(0)
    for (const bytes of w.recordWrites) expect(new TextDecoder().decode(bytes)).not.toContain(hexOf('9', 32))
    expect(Object.keys(w.records()[0]).sort()).toEqual(['host', 'page', 'pool', 'record', 'title', 'until'])
  })

  it('keeps asking for about ten seconds while the host answers from an older copy of the index', async () => {
    const w = await world({ lag: 4 })
    expect((await openEntryPool(w.input, w.deps)).ok).toBe(true)
    expect(w.listings).toHaveLength(5)
  })

  it('refuses when the host never says open, after about ten seconds, and keeps the record so it can be closed', async () => {
    const w = await world({ neverOpens: true })
    const opened = await openEntryPool(w.input, w.deps)
    expect(opened).toMatchObject({ ok: false, why: 'not-open', whose: 'operator' })
    expect(w.listings).toHaveLength(10)
    expect(w.posted).toHaveLength(0)
    expect(w.records()).toHaveLength(1)
  })

  it('refuses on a visitor page, with no signer, a page that takes no writes, and an end out of range', async () => {
    expect(await openEntryPool((await world()).input, (await world({ readonly: true })).deps)).toMatchObject({ why: 'readonly' })
    const w = await world({ key: 'nope' })
    expect(await openEntryPool(w.input, w.deps)).toMatchObject({ why: 'no-signer' })
    const v = await world()
    expect(await openEntryPool({ ...v.input, page: 'host.example.com' }, v.deps)).toMatchObject({ why: 'page-not-offered' })
    expect(await openEntryPool({ ...v.input, page: 'try-abc.example.com' }, v.deps)).toMatchObject({ why: 'page-not-offered' })
    expect(await openEntryPool({ ...v.input, page: '' }, v.deps)).toMatchObject({ why: 'no-page' })
    const now = Math.floor(START / 1000)
    expect(await openEntryPool({ ...v.input, until: now + ENTRY_LIMITS.untilMaxSeconds + 1 }, v.deps)).toMatchObject({ why: 'until' })
    expect(await openEntryPool({ ...v.input, until: now }, v.deps)).toMatchObject({ why: 'until' })
    // The longest end is taken, kept ten minutes inside the host's 31 days (a leader's clock may run ahead of the host's).
    const longest = await openEntryPool({ ...v.input, until: now + ENTRY_LIMITS.untilMaxSeconds }, v.deps)
    expect(longest).toMatchObject({ ok: true, pool: { until: now + ENTRY_LIMITS.untilMaxSeconds - 600 } })
    expect(await openEntryPool({ ...v.input, title: 'a\nb' }, v.deps)).toMatchObject({ why: 'title' })
    expect(v.log.filter(step => step.startsWith('index'))).toHaveLength(1)
  })

  it('refuses a template this hive does not hold, and a record the page does not serve', async () => {
    const w = await world()
    expect(await openEntryPool({ ...w.input, template: hexOf('4') }, w.deps)).toMatchObject({ why: 'template' })
    const v = await world({ servesNothing: true })
    expect(await openEntryPool(v.input, v.deps)).toMatchObject({ why: 'read-back', whose: 'operator' })
    expect(v.roots).toEqual({})
  })

  it('drops the nonce when the index write is refused, and says another place moved it', async () => {
    const w = await world({ refuseWrites: { reason: ROOT_MOVED, times: 1 } })
    expect(await openEntryPool(w.input, w.deps)).toMatchObject({ ok: false, why: 'moved' })
    expect(w.nonces.size).toBe(0)
    const v = await world({ refuseWrites: { reason: 'host said 413', times: 1 } })
    const refused = await openEntryPool(v.input, v.deps)
    expect(refused).toMatchObject({ ok: false, why: 'index' })
    expect(!refused.ok && refused.reason).toContain('host said 413')
  })

  it('carries on when the index write lost its answer but the key landed, keeping the nonce', async () => {
    // Seen live: "host unreachable" while the host had already named the key.
    const w = await world()
    const write = w.deps.changeRoots!
    w.deps.changeRoots = async (host, change) => {
      await write(host, change)
      return { ok: false, host: HOST, pubkey: '', createdAt: 0, dropped: {}, set: {}, reason: 'host unreachable' }
    }
    const opened = await openEntryPool(w.input, w.deps)
    expect(opened.ok).toBe(true)
    expect(w.nonces.size).toBe(1)
    expect(w.records()).toHaveLength(1)
  })

  it('keeps the nonce and the record when the index write lost its answer and the index cannot be read again', async () => {
    const w = await world()
    const write = w.deps.changeRoots!
    const read = w.deps.index!
    let silent = false
    w.deps.index = async (host, pubkey) => silent ? { ok: false, reason: 'unreachable' } : read(host, pubkey)
    w.deps.changeRoots = async (host, change) => {
      await write(host, change)
      silent = true
      return { ok: false, host: HOST, pubkey: '', createdAt: 0, dropped: {}, set: {}, reason: 'host unreachable' }
    }
    expect(await openEntryPool(w.input, w.deps)).toMatchObject({ ok: false, why: 'index-unknown' })
    expect(w.nonces.size).toBe(1)
    expect(w.records()).toHaveLength(1)
  })

  it('refuses when the host does not take the first member', async () => {
    const w = await world({ put: () => ({ status: 403, said: 'this address belongs to another pool' }) })
    const opened = await openEntryPool(w.input, w.deps)
    expect(opened).toMatchObject({ ok: false, why: 'first-member' })
    expect(!opened.ok && opened.reason).toContain('this address belongs to another pool')
  })

  it('recycles the page\'s last pool in the same index write, and asks its listing once', async () => {
    const w = await world()
    const first = await openEntryPool(w.input, w.deps)
    if (!first.ok) throw new Error(first.reason)
    const old = entryIndexKeys(first.pool.pool)
    w.roots[old.hidden] = hexOf('3')
    const before = w.listings.length
    let n = 0
    w.deps.newNonce = () => (++n).toString(16).padStart(32, 'a')
    const second = await openEntryPool({ ...w.input, replaces: first.pool }, w.deps)
    if (!second.ok) throw new Error(second.reason)
    const writes = w.log.filter(step => step.startsWith('index'))
    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes[1].slice('index '.length)).drop).toEqual([old.open, old.closed, old.hidden])
    expect(w.roots).toEqual({ [`entries:${second.pool.pool}`]: second.pool.record })
    expect(w.nonces.has(first.pool.pool)).toBe(false)
    expect(w.records().map(one => one.pool)).toEqual([second.pool.pool])
    expect(w.listings.slice(before)[0].address).toBe(await entryPoolAddress(first.pool.record, hexOf('9', 32)))
  })
})

describe('the page check', () => {
  const check = async (options: Parameters<typeof world>[0]) => {
    const w = await world(options)
    return checkEntryPage({ page: PAGE, host: HOST, roots: {} }, w.deps)
  }

  it('takes the visitor shell that wears the mark and carries a package with the bee', async () => {
    expect(await check({})).toEqual({ ok: true, packageSig: PACKAGE })
    expect(carriedPackageOf(VISITOR_PAGE)).toBe(PACKAGE)
  })

  it('says each failure in its own sentence, with whose it is', async () => {
    expect(await check({ html: null })).toMatchObject({ why: 'page-unreachable' })
    expect(await check({ html: '<html><head><meta name="hypercomb-takes" content="post" /></head></html>' })).toMatchObject({ why: 'page-not-visitor', whose: 'leader' })
    expect(await check({ html: VISITOR_PAGE.replace(/<meta[^>]*>/, '') })).toMatchObject({ why: 'page-old-shell', whose: 'operator' })
    expect(await check({ kept: ['recipe'] })).toMatchObject({ why: 'page-bee-kept', whose: 'leader' })
    expect(await check({ postBee: 'lacks' })).toMatchObject({ why: 'page-no-bee', whose: 'operator' })
    expect(await check({ postBee: 'unknown' })).toMatchObject({ why: 'page-package-unknown' })
  })

  it('stops opening at a failed check, before anything is written', async () => {
    const w = await world({ postBee: 'lacks' })
    expect(await openEntryPool(w.input, w.deps)).toMatchObject({ why: 'page-no-bee' })
    expect(w.log).toEqual([])
  })
})

describe('the package a page runs (the live postBee)', () => {
  /** A package of layers served at the page, by the hash of each layer's bytes. */
  const served = async (layers: { name: string; bees?: string[]; docs?: Record<string, unknown>; children?: number[] }[]) => {
    const bytes = new Map<string, Uint8Array>()
    const sigs: string[] = []
    // Children first, so a parent can name them by signature.
    for (let at = layers.length - 1; at >= 0; at--) {
      const layer = layers[at]
      const doc = {
        name: layer.name,
        cells: (layer.children ?? []).map(child => `${sigs[child]}.js`),
        bees: (layer.bees ?? []).map(bee => `${bee}.js`),
        ...(layer.docs ? { docs: { bees: layer.docs } } : {}),
      }
      const body = enc.encode(JSON.stringify(doc))
      sigs[at] = await sign(body)
      bytes.set(sigs[at], body)
    }
    const asked: string[] = []
    const atom = async (_page: string, sig: string): Promise<Uint8Array | null> => { asked.push(sig); return bytes.get(sig) ?? null }
    return { root: sigs[0], sigs, bytes, atom, asked }
  }
  const BEE = hexOf('b')
  const OTHER = hexOf('c')

  it('has: a listed bee whose docs wake on the code, in a layer below the package', async () => {
    const p = await served([
      { name: 'root', children: [1, 2] },
      { name: 'sharing', bees: [OTHER], docs: { [OTHER]: { className: 'FollowDrone', wakesOn: ['swarm:leader-moved'] } } },
      { name: 'recipe', bees: [BEE], docs: { [BEE]: { className: 'RecipePostDrone', passive: true, wakesOn: [POST_CODE_EFFECT] } } },
    ])
    expect(await packageHasPostBee(PAGE, p.root, p.atom)).toBe('has')
  })

  it('lacks: every layer was read and no bee wakes on the code', async () => {
    const p = await served([
      { name: 'root', children: [1] },
      { name: 'recipe', bees: [OTHER], docs: { [OTHER]: { className: 'RecipeViewDrone', renders: ['recipe'] } } },
    ])
    expect(await packageHasPostBee(PAGE, p.root, p.atom)).toBe('lacks')
    expect(new Set(p.asked)).toEqual(new Set(p.sigs))
  })

  it('lacks: a doc that wakes on the code for a bee the package does not list proves nothing', async () => {
    const p = await served([{ name: 'root', bees: [OTHER], docs: { [BEE]: { className: 'RecipePostDrone', wakesOn: [POST_CODE_EFFECT] } } }])
    expect(await packageHasPostBee(PAGE, p.root, p.atom)).toBe('lacks')
  })

  it('unknown: a layer that does not arrive, or does not parse, claims nothing either way', async () => {
    const p = await served([
      { name: 'root', children: [1, 2] },
      { name: 'recipe', bees: [BEE], docs: { [BEE]: { className: 'RecipePostDrone', wakesOn: [POST_CODE_EFFECT] } } },
      { name: 'sharing' },
    ])
    p.bytes.delete(p.sigs[2])
    expect(await packageHasPostBee(PAGE, p.root, p.atom)).toBe('unknown')
    const broken = enc.encode('{not json')
    const brokenSig = await sign(broken)
    expect(await packageHasPostBee(PAGE, brokenSig, async () => broken)).toBe('unknown')
    expect(await packageHasPostBee(PAGE, 'not a sig', p.atom)).toBe('unknown')
    expect(await packageHasPostBee(PAGE, p.root, async () => { throw new Error('down') })).toBe('unknown')
  })

  it('is what the page check asks when no postBee is handed in', async () => {
    const p = await served([{ name: 'root', bees: [BEE], docs: { [BEE]: { className: 'RecipePostDrone', wakesOn: [POST_CODE_EFFECT] } } }])
    const html = (sig: string): string => VISITOR_PAGE.replace(PACKAGE, sig)
    const check = async (sig: string, atom: OpenEntriesDeps['atom']) => {
      const w = await world({ html: html(sig) })
      const { postBee: _unused, ...rest } = w.deps
      return checkEntryPage({ page: PAGE, host: HOST, roots: {} }, { ...rest, atom })
    }
    expect(await check(p.root, p.atom)).toEqual({ ok: true, packageSig: p.root })
    const bare = await served([{ name: 'root', bees: [OTHER] }])
    expect(await check(bare.root, bare.atom)).toMatchObject({ why: 'page-no-bee', whose: 'operator' })
    expect(await check(bare.root, async () => null)).toMatchObject({ why: 'page-package-unknown' })
  })
})

/** A world with one pool opened. */
const openedWorld = async (options: Parameters<typeof world>[0] = {}) => {
  const w = await world(options)
  const opened = await openEntryPool(w.input, w.deps)
  if (!opened.ok) throw new Error(opened.reason)
  w.log.length = 0
  w.listings.length = 0
  return { ...w, pool: opened.pool }
}

describe('closing', () => {
  it('is one index write that drops the open key and names the closed one, then proved closed', async () => {
    const w = await openedWorld()
    const keys = entryIndexKeys(w.pool.pool)
    expect(await closeEntryPool(w.pool, w.deps)).toEqual({ ok: true, proved: true })
    expect(w.log.filter(step => step.startsWith('index'))).toEqual([`index ${JSON.stringify({ drop: [keys.open], set: { [keys.closed]: w.pool.record } })}`])
    expect(w.roots).toEqual({ [keys.closed]: w.pool.record })
    expect(w.records()[0].closed).toBe(Math.floor(START / 1000))
  })

  it('closes from H and O alone on a device without the nonce, unproved', async () => {
    const w = await openedWorld()
    w.nonces.clear()
    const closed = await closeEntryPool({ pool: w.pool.pool, record: w.pool.record, host: HOST }, w.deps)
    expect(closed).toMatchObject({ ok: true, proved: false })
    expect(w.listings).toHaveLength(0)
  })

  it('refuses when the host still says open after asking', async () => {
    const w = await openedWorld()
    w.deps.listing = async () => ({ reached: true, status: 200, state: 'open', names: [], over: false, hidden: null, hostTime: null, said: '' })
    expect(await closeEntryPool(w.pool, w.deps)).toMatchObject({ ok: false, why: 'not-closed' })
  })
})

describe('recycling', () => {
  it('is one write dropping the three keys, then one listing, and the pool leaves the record and the nonce store', async () => {
    const w = await openedWorld()
    const keys = entryIndexKeys(w.pool.pool)
    w.roots[keys.hidden] = hexOf('3')
    expect(await recycleEntryPool(w.pool, w.deps)).toEqual({ ok: true, asked: true })
    expect(w.log.filter(step => step.startsWith('index'))).toEqual([`index ${JSON.stringify({ drop: [keys.open, keys.closed, keys.hidden] })}`])
    expect(w.roots).toEqual({})
    expect(w.listings).toHaveLength(1)
    expect(w.records()).toEqual([])
    expect(w.nonces.size).toBe(0)
  })

  it('asks no listing without the nonce, and still drops the keys', async () => {
    const w = await openedWorld()
    w.nonces.clear()
    expect(await recycleEntryPool({ pool: w.pool.pool, record: w.pool.record, host: HOST }, w.deps)).toEqual({ ok: true, asked: false })
    expect(w.roots).toEqual({})
  })

  it('knows a pool more than 30 days past its end', () => {
    expect(isPastKeeping({ until: 100 }, 100 + ENTRY_LIMITS.keptSeconds)).toBe(false)
    expect(isPastKeeping({ until: 100 }, 101 + ENTRY_LIMITS.keptSeconds)).toBe(true)
  })
})

describe('hiding', () => {
  const key = hexOf('7')

  it('writes a new list expecting the one named, and shows it again by naming none', async () => {
    const w = await openedWorld()
    const hiddenKey = entryIndexKeys(w.pool.pool).hidden
    const hid = await setEntryHidden({ host: HOST, pool: w.pool.pool, line: { key }, hide: true }, w.deps)
    expect(hid).toMatchObject({ ok: true, list: { keys: [`k:${key}`], pages: [] } })
    const sig = w.roots[hiddenKey]
    expect(await parseHiddenList(w.host.get(sig)!, sig)).toEqual({ keys: [`k:${key}`], pages: [] })
    expect(w.log.filter(step => step.startsWith('index'))[0]).toContain(`"expect":{"${hiddenKey}":null}`)
    const shown = await setEntryHidden({ host: HOST, pool: w.pool.pool, line: { key }, hide: false }, w.deps)
    expect(shown).toMatchObject({ ok: true, sig: null })
    expect(w.roots[hiddenKey]).toBeUndefined()
    expect(w.log.filter(step => step.startsWith('index'))[1]).toContain(`"expect":{"${hiddenKey}":"${sig}"}`)
  })

  it('tries again from the newer list when another tab moved it, keeping that tab\'s line', async () => {
    const w = await openedWorld()
    const hiddenKey = entryIndexKeys(w.pool.pool).hidden
    const other = hiddenListBytes(withHiddenLine(emptyHiddenList(), { key: hexOf('8') }, true))
    const otherSig = await sign(other)
    w.store.set(otherSig, other)
    const change = w.deps.changeRoots!
    let first = true
    w.deps.changeRoots = async (host, asked) => {
      // Another tab names its list just before this write signs.
      if (first) { first = false; w.roots[hiddenKey] = otherSig }
      return change(host, asked)
    }
    const hid = await setEntryHidden({ host: HOST, pool: w.pool.pool, line: { key, page: hexOf('2') }, hide: true }, w.deps)
    expect(hid).toMatchObject({ ok: true, list: { keys: [`k:${hexOf('8')}`], pages: [`${key}:${hexOf('2')}`] } })
  })

  it('refuses when the named list cannot be read, and answers unchanged for a line already as asked', async () => {
    const w = await openedWorld()
    const hiddenKey = entryIndexKeys(w.pool.pool).hidden
    w.roots[hiddenKey] = hexOf('4')
    expect(await setEntryHidden({ host: HOST, pool: w.pool.pool, line: { key }, hide: true }, w.deps)).toMatchObject({ ok: false, why: 'hidden-unread' })
    const v = await openedWorld()
    expect(await setEntryHidden({ host: HOST, pool: v.pool.pool, line: { key }, hide: false }, v.deps)).toMatchObject({ ok: true, unchanged: true })
    expect(v.log.filter(step => step.startsWith('index'))).toHaveLength(0)
  })
})

describe('posting', () => {
  const pool = hexOf('c')
  const path: EntryPoolPath = { page: PAGE, address: hexOf('d'), by: P, until: Math.floor(START / 1000) + 3600 }
  const entry = { page: hexOf('e'), name: 'Ana', title: 'Soup', content: '{"recipe":1,"values":{}}' }

  it('stamps with this clock plus the host\'s offset and puts at /<A>/<member> with by and until', async () => {
    const w = await world()
    const posted = await postEntryMember({ path, pool, secretKey: generateSecretKey(), offset: -40, entry }, w.deps)
    expect(posted).toMatchObject({ ok: true, held: false, offset: -40 })
    if (!posted.ok) return
    expect(posted.event.created_at).toBe(Math.floor(START / 1000) - 40)
    expect(w.posted[0].url).toBe(`https://${PAGE}/${hexOf('d')}/${posted.name}?by=${P}&until=${path.until}`)
    expect(await readEntryMember(w.posted[0].bytes, pool, posted.name)).not.toBeNull()
  })

  it('asks the listing for the host\'s time once when the stamp is refused, and signs again', async () => {
    let calls = 0
    const w = await world({ put: () => (++calls === 1 ? { status: 409, said: 'entry stamp is more than ten minutes from this host\'s clock' } : { status: 201, said: '' }) })
    const posted = await postEntryMember({ path, pool, secretKey: generateSecretKey(), offset: -4000, entry }, w.deps)
    expect(posted).toMatchObject({ ok: true, offset: 30 })
    expect(w.listings).toHaveLength(1)
    expect(w.posted).toHaveLength(2)
  })

  it('stamps a change and a take-back past the post they replace, though they come within one second', async () => {
    const w = await world()
    const secretKey = generateSecretKey()
    const own = { ...entry, page: hexOf('f') }
    const first = await postEntryMember({ path, pool, secretKey, offset: 0, entry: own }, w.deps)
    const change = await postEntryMember({ path, pool, secretKey, offset: 0, entry: { ...own, title: 'Soup, again' } }, w.deps)
    const back = await postEntryMember({ path, pool, secretKey, offset: 0, entry: { ...own, gone: true } }, w.deps)
    if (!first.ok || !change.ok || !back.ok) throw new Error('a post was refused')
    expect(first.event.created_at).toBe(Math.floor(START / 1000))
    expect(change.event.created_at).toBe(first.event.created_at + 1)
    expect(back.event.created_at).toBe(change.event.created_at + 1)
  })

  it('answers in the host\'s own words, and says when it never answered', async () => {
    const w = await world({ put: () => ({ status: 507, said: 'this one is full' }) })
    expect(await postEntryMember({ path, pool, secretKey: generateSecretKey(), offset: 0, entry }, w.deps)).toMatchObject({ ok: false, why: 'host', reason: 'this one is full', status: 507 })
    const v = await world({ put: () => ({ said: '' }) })
    expect(await postEntryMember({ path, pool, secretKey: generateSecretKey(), offset: 0, entry }, v.deps)).toMatchObject({ ok: false, why: 'unreachable' })
    const held = await world({ put: () => ({ status: 200, said: 'member' }) })
    expect(await postEntryMember({ path, pool, secretKey: generateSecretKey(), offset: 0, entry }, held.deps)).toMatchObject({ ok: true, held: true })
  })

  it('refuses an entry the reader would refuse, before anything is sent', async () => {
    const w = await world()
    expect(await postEntryMember({ path, pool, secretKey: generateSecretKey(), offset: 0, entry: { ...entry, name: '' } }, w.deps)).toMatchObject({ ok: false, why: 'sign' })
    expect(w.posted).toHaveLength(0)
  })
})

describe('what my own index says', () => {
  it('lists open and closed pools, closed winning, with the ones this device has no record of', async () => {
    const w = await openedWorld()
    const mine = w.pool.pool
    const elsewhere = hexOf('a')
    const both = hexOf('b')
    w.roots[entryIndexKeys(elsewhere).open] = hexOf('1')
    w.roots[entryIndexKeys(both).open] = hexOf('2')
    w.roots[entryIndexKeys(both).closed] = hexOf('2')
    w.roots[entryIndexKeys(both).hidden] = hexOf('3')
    w.roots['pool:recipe:entry'] = hexOf('0')
    const own = await ownEntryPools(HOST, w.deps)
    expect(own.ok).toBe(true)
    if (!own.ok) return
    const by = new Map(own.pools.map(one => [one.pool, one]))
    expect(by.size).toBe(3)
    expect(by.get(mine)).toMatchObject({ state: 'open', known: { pool: mine }, reopened: false, pastKeeping: false })
    expect(by.get(elsewhere)).toMatchObject({ state: 'open', known: null, record: hexOf('1') })
    expect(by.get(both)).toMatchObject({ state: 'closed', hidden: hexOf('3') })
  })

  it('flags a pool this device closed that the index names open again, and one past keeping', async () => {
    const w = await openedWorld()
    await closeEntryPool(w.pool, w.deps)
    const keys = entryIndexKeys(w.pool.pool)
    delete w.roots[keys.closed]
    w.roots[keys.open] = w.pool.record
    w.setClock((w.pool.until + ENTRY_LIMITS.keptSeconds + 10) * 1000)
    const own = await ownEntryPools(HOST, w.deps)
    expect(own.ok && own.pools[0]).toMatchObject({ state: 'open', reopened: true, pastKeeping: true })
  })

  it('refuses when the index cannot be read, never answering empty', async () => {
    const w = await world()
    w.deps.index = async () => ({ ok: false, reason: 'unreachable' })
    expect(await ownEntryPools(HOST, w.deps)).toMatchObject({ ok: false, why: 'index-unsafe' })
    w.deps.index = async () => ({ ok: false, reason: 'http', status: 404 })
    expect(await ownEntryPools(HOST, w.deps)).toEqual({ ok: true, pools: [] })
  })
})

describe('the leader\'s record', () => {
  const pool: OpenedEntryPool = { record: hexOf('1'), pool: hexOf('2'), host: HOST, page: PAGE, title: 'Tuesday class', until: 1_900_000_000 }

  it('round-trips its pools once each and drops what is not one', () => {
    const bytes = openedRecordBytes([pool, pool, { ...pool, pool: 'nope' } as OpenedEntryPool, { ...pool, pool: hexOf('3'), closed: 5 }])
    expect(openedPoolsOf(bytes)).toEqual([pool, { ...pool, pool: hexOf('3'), closed: 5 }])
    expect(openedPoolsOf(enc.encode('{"pools":[]}'))).toEqual([])
  })

  it('never carries a field it does not know, so a nonce handed to it is not written', () => {
    const text = new TextDecoder().decode(openedRecordBytes([{ ...pool, nonce: hexOf('9', 32) } as unknown as OpenedEntryPool]))
    expect(text).not.toContain(hexOf('9', 32))
  })

  it('is one current document in entries:opened through the store', async () => {
    const docs = new Map<string, ArrayBuffer>()
    const asked: string[] = []
    const store = {
      getPool: async (meaning: string) => { asked.push(meaning); return { name: meaning } },
      openPool: async (meaning: string) => (docs.has(meaning) ? { name: meaning } : null),
      getPoolDoc: async (handle: object) => docs.get((handle as { name: string }).name) ?? null,
      putPoolDoc: async (handle: object, bytes: ArrayBuffer, _sub?: string, options?: { keep?: string }) => {
        if (options?.keep !== 'current') return null
        docs.set((handle as { name: string }).name, bytes)
        return hexOf('f')
      },
    }
    const io = liveOpenedRecord(store)
    expect(await io.read()).toEqual([])
    expect(await io.write([pool])).toBe(true)
    expect(asked).toEqual(['entries:opened'])
    expect(await io.read()).toEqual([pool])
  })

  it('gives the code again only where the nonce is held', async () => {
    expect(entryCodeFor(pool, { nonces: { get: () => '', set: () => false, drop: () => undefined } })).toBe('')
    expect(entryCodeFor(pool, { nonces: { get: () => hexOf('9', 32), set: () => true, drop: () => undefined } }))
      .toBe(entryCodeLink(PAGE, hexOf('1'), hexOf('9', 32)))
  })
})

describe('what the review found', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { ioc?: unknown }).ioc
  })

  it('carries the page in the opening record, so another device can place the pool', async () => {
    const w = await world()
    const opened = await openEntryPool(w.input, w.deps)
    if (!opened.ok) throw new Error(opened.reason)
    const parsed = await parseEntryRecord(w.host.get(opened.pool.record)!, opened.pool.record)
    expect(parsed).toMatchObject({ ok: true, record: { page: PAGE, until: opened.pool.until } })
    // Another device: no record, no nonce. The index and the public record place the pool on its page.
    w.nonces.clear()
    const own = await ownEntryPools(HOST, { ...w.deps, records: { read: async () => [], write: async () => true }, bytesOf: async () => null })
    expect(own.ok && own.pools[0]).toMatchObject({ known: null, opening: { page: PAGE, title: 'Tuesday class', until: opened.pool.until } })
  })

  it('refuses a second pool on a page that already has one, from this device or another', async () => {
    const w = await world()
    expect((await openEntryPool(w.input, w.deps)).ok).toBe(true)
    const writes = w.log.filter(step => step.startsWith('index')).length
    expect(await openEntryPool(w.input, w.deps)).toMatchObject({ ok: false, why: 'page-has-pool', whose: 'leader' })
    // Opened on another device: this one holds no record of it, only the index and the public record.
    const v = await world()
    const bytes = entryRecordBytes({ meaning: 'recipe:entry', title: 'Phone class', template: v.templateSig, by: P, until: Math.floor(START / 1000) + 600, page: `https://${PAGE}` })
    const record = await sign(bytes)
    v.host.set(record, bytes)
    v.roots[entryIndexKeys(hexOf('e')).closed] = record
    expect(await openEntryPool(v.input, v.deps)).toMatchObject({ ok: false, why: 'page-has-pool' })
    expect(w.log.filter(step => step.startsWith('index'))).toHaveLength(writes)
    expect(v.log.filter(step => step.startsWith('index'))).toHaveLength(0)
  })

  it('remembers the pool before the index names it: a record that cannot be kept names nothing, a refused write puts the record back', async () => {
    const w = await world()
    w.deps.records = { read: async () => [], write: async () => false }
    expect(await openEntryPool(w.input, w.deps)).toMatchObject({ ok: false, why: 'record' })
    expect(w.log.filter(step => step.startsWith('index'))).toHaveLength(0)
    expect(w.posted).toHaveLength(0)
    expect(w.nonces.size).toBe(0)
    const v = await world({ refuseWrites: { reason: 'host said 413', times: 1 } })
    expect(await openEntryPool(v.input, v.deps)).toMatchObject({ ok: false, why: 'index' })
    expect(v.records()).toEqual([])
    expect(v.log.indexOf('record')).toBeLessThan(v.log.findIndex(step => step.startsWith('index')))
  })

  it('names the new hidden list only once the page serves it', async () => {
    const w = await openedWorld()
    const hiddenKey = entryIndexKeys(w.pool.pool).hidden
    const served = w.deps.atom!
    const asked: string[] = []
    // The host took the list, but the page does not serve it yet.
    w.deps.atom = async (page, sig, limit) => { asked.push(page); return sig === w.pool.record ? served(page, sig, limit) : null }
    const hid = await setEntryHidden({ host: HOST, pool: w.pool.pool, line: { key: hexOf('7') }, hide: true }, w.deps)
    expect(hid).toMatchObject({ ok: false, why: 'hidden-read-back', whose: 'operator' })
    expect(w.roots[hiddenKey]).toBeUndefined()
    expect(w.log.filter(step => step.startsWith('index'))).toHaveLength(0)
    // Read back through the page the pool's code opens, as this device's record names it.
    expect(asked).toEqual([PAGE])
    w.deps.atom = served
    expect(await setEntryHidden({ host: HOST, pool: w.pool.pool, line: { key: hexOf('7') }, hide: true, page: 'https://other.example.com' }, w.deps)).toMatchObject({ ok: true })
  })

  it('reads the picked page at its own path, never the origin\'s root', async () => {
    const fetched: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { fetched.push(String(url)); return new Response('<html></html>', { status: 200 }) }))
    expect(await readEntryPage('https://example.com/kitchen/soup?x=1#post=abc')).toEqual({ status: 200, html: '<html></html>' })
    expect(await readEntryPage('class.example.com')).toMatchObject({ status: 200 })
    expect(fetched).toEqual(['https://example.com/kitchen/soup', 'https://class.example.com/'])
  })

  it('says "no answer" in the reader\'s language, never in English', async () => {
    ;(globalThis as { ioc?: unknown }).ioc = {
      get: (key: string) => key === I18N_IOC_KEY ? { t: (asked: string) => asked === 'pools.posts.refuse.no-answer' ? 'pas de réponse' : asked } : undefined,
    }
    const w = await world({ refuseWrites: { reason: '', times: 1 } })
    const refused = await openEntryPool(w.input, w.deps)
    expect(refused).toMatchObject({ ok: false, why: 'index' })
    expect(!refused.ok && refused.reason).toContain('pas de réponse')
    expect(!refused.ok && refused.reason).not.toContain('no answer')
    const v = await world()
    v.deps.publish = async () => ({ ok: false, error: '' })
    const unsent = await openEntryPool(v.input, v.deps)
    expect(!unsent.ok && unsent.reason).toContain('pas de réponse')
  })
})
