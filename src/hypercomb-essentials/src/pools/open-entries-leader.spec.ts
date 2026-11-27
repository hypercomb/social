// pools/open-entries-leader.spec.ts : the leader's side of an open entry pool
// against a fake world: a signed index that changes one write at a time, a host
// that answers listings from it, a record and a nonce store in memory, and a
// reader handed in. No network and no IoC.

import { describe, expect, it, vi } from 'vitest'

const qr = vi.hoisted(() => ({ shown: [] as { link: string; note: string }[] }))
vi.mock('../sharing/room-qr.view.js', () => ({
  showRoomQr: (link: string, words: { note: string }) => { qr.shown.push({ link, note: words.note }); return true },
}))
import { SignatureService } from '@hypercomb/core'
import { ROOT_MOVED, type ChangeHiveRootsResult, type HiveIndexResult, type HiveRootsChange } from '../sharing/hive-pointer.js'
import { doorsOfIndex } from '../sharing/publish-results.js'
import {
  ENTRY_LIMITS,
  emptyHiddenList,
  entryCodeLink,
  entryIndexKeys,
  entryPoolAddress,
  entryPoolName,
  entryRecordBytes,
  latestEntryUntil,
  type EntryListing,
  type EntryPoolPath,
  type EntryPoolRead,
  isOfferablePage,
  type EntryRow,
} from './open-entries.js'
import { openedPoolsOf, openedRecordBytes, type OpenedEntryPool } from './open-entries-flows.js'
import { entryForms, registerEntryForm, type EntryForm } from './open-entries-forms.js'
import {
  ENTRY_END_DAYS,
  bringPostsHome,
  closeForPosts,
  entriesNotHome,
  entryPagesOf,
  entryUntilFor,
  entryWhoseWords,
  leaderPoolOfPage,
  openForPosts,
  readLeaderPosts,
  readOpenedSources,
  recycleForPosts,
  showPostsCode,
  type EntryLeaderDeps,
  type LeaderPool,
} from './open-entries-leader.js'

const enc = new TextEncoder()
const sign = (bytes: Uint8Array): Promise<string> => SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
const hexOf = (ch: string, length = 64): string => ch.repeat(length)
const P = hexOf('5')
const HOST = 'example.com'
const PAGE = 'https://example.com'
const NOW = 1_800_000_000
const NONCE = hexOf('9', 32)

const row = (signer: string, content: string, title = 'Soup'): EntryRow => ({
  signer, label: 'Ana', title, page: hexOf('a'), at: NOW, content, member: hexOf('b'), bytes: enc.encode(content),
})

/** A pool this device opened, with its real names, and the record's bytes. */
const poolOf = async (title: string, until: number, page = PAGE, template = hexOf('7')) => {
  const bytes = entryRecordBytes({ meaning: 'recipe:entry', title, template, by: P, until })
  const record = await sign(bytes)
  const address = await entryPoolAddress(record, NONCE)
  const pool = await entryPoolName(address, P, until)
  const known: OpenedEntryPool = { record, pool, host: HOST, page, title, until }
  return { known, bytes, address }
}

/** The world the leader's side runs in. */
const world = (options: { rows?: Record<string, EntryRow[]>; index?: 'down' | 'absent'; held?: string[] } = {}) => {
  let clock = NOW * 1000
  const roots: Record<string, string> = {}
  const store = new Map<string, Uint8Array>()
  const nonces = new Map<string, string>()
  let records: OpenedEntryPool[] = []
  const writes: HiveRootsChange[] = []
  const shown: string[] = []
  const held = new Set(options.held ?? [])
  const stateOf = async (path: EntryPoolPath): Promise<EntryListing['state']> => {
    const keys = entryIndexKeys(await entryPoolName(path.address, path.by, path.until))
    return roots[keys.closed] ? 'closed' : roots[keys.open] ? 'open' : null
  }
  const deps: EntryLeaderDeps = {
    host: () => HOST,
    publisherKey: async () => P,
    now: () => clock,
    sleep: async ms => { clock += ms },
    newNonce: () => NONCE,
    readonly: () => false,
    keep: async bytes => { const sig = await sign(bytes); store.set(sig, bytes); return sig },
    bytesOf: async sig => store.get(sig) ?? null,
    publish: async () => ({ ok: true }),
    atom: async (_page, sig) => store.get(sig) ?? null,
    index: async (): Promise<HiveIndexResult> => options.index === 'down'
      ? { ok: false, reason: 'unreachable' }
      : options.index === 'absent' && !Object.keys(roots).length
        ? { ok: false, reason: 'http', status: 404 }
        : { ok: true, manifest: { roots: { ...roots }, createdAt: 1, pubkey: P } },
    changeRoots: async (_host, change): Promise<ChangeHiveRootsResult> => {
      writes.push(change)
      for (const [key, want] of Object.entries(change.expect ?? {})) {
        if ((roots[key] ?? null) !== want) return { ok: false, host: HOST, pubkey: '', createdAt: 0, dropped: {}, set: {}, reason: ROOT_MOVED }
      }
      for (const key of change.drop ?? []) delete roots[key]
      Object.assign(roots, change.set ?? {})
      return { ok: true, host: HOST, pubkey: P, createdAt: 2, dropped: {}, set: { ...change.set } }
    },
    listing: async (path): Promise<EntryListing> =>
      ({ reached: true, status: 200, state: await stateOf(path), names: [], over: false, hidden: null, hostTime: Math.floor(clock / 1000), said: '' }),
    putMember: async () => ({ status: 201, said: 'member' }),
    page: async () => ({ status: 200, html: '' }),
    readPool: async (path, pool): Promise<EntryPoolRead> => ({
      reached: true, state: await stateOf(path), rows: options.rows?.[pool] ?? [], over: false, offset: 0,
      hidden: { named: null, list: null }, said: '',
    }),
    held: async sig => held.has(sig),
    records: {
      read: async () => records,
      write: async pools => { records = openedPoolsOf(openedRecordBytes(pools)); return true },
    },
    nonces: {
      get: pool => nonces.get(pool) ?? '',
      set: (pool, nonce) => { nonces.set(pool, nonce); return true },
      drop: pool => { nonces.delete(pool) },
    },
    showCode: link => { shown.push(link); return true },
  }
  /** Put an opened pool in the world as if this device had opened it. */
  const plant = async (opened: Awaited<ReturnType<typeof poolOf>>, as: 'open' | 'closed' = 'open', closedHere = false) => {
    store.set(opened.known.record, opened.bytes)
    roots[as === 'open' ? `entries:${opened.known.pool}` : `entries-closed:${opened.known.pool}`] = opened.known.record
    nonces.set(opened.known.pool, NONCE)
    records = [...records, closedHere ? { ...opened.known, closed: NOW - 10 } : opened.known]
  }
  return { deps, roots, store, nonces, writes, shown, plant, records: () => records, setClock: (s: number) => { clock = s * 1000 } }
}

describe('what the leader picks', () => {
  it('ends a pool a day from now by default and never more than 31 days ahead', () => {
    expect(ENTRY_END_DAYS[0]).toBe(1)
    expect(ENTRY_END_DAYS.at(-1)).toBe(31)
    expect(entryUntilFor(ENTRY_END_DAYS[0] as number, NOW)).toBe(NOW + 86_400)
    // The longest end is kept ten minutes inside the host's 31 days: a leader's clock may run ahead of the host's.
    expect(entryUntilFor(90, NOW)).toBe(NOW + ENTRY_LIMITS.untilMaxSeconds - 600)
    expect(entryUntilFor(31, NOW)).toBe(latestEntryUntil(NOW))
    expect(latestEntryUntil(NOW)).toBe(NOW + 31 * 86_400 - 600)
    expect(entryUntilFor(30, NOW)).toBe(NOW + 30 * 86_400)
    expect(entryUntilFor(0, NOW)).toBe(NOW + 86_400)
    expect(entryUntilFor(Number.NaN, NOW)).toBe(NOW + 86_400)
  })

  it('offers the addresses the leader\'s index gives, once each, and only those a code may be shown for', () => {
    const manifest = {
      roots: { kitchen: hexOf('1'), 'kitchen/soup': hexOf('2'), bakery: hexOf('3'), 'pool:recipe:entry': hexOf('4') },
      doors: { bakery: ['example.com', 'try-example.com'] },
      createdAt: 1,
    }
    const doors = doorsOfIndex(manifest, HOST).map(door => door.address)
    const pages = entryPagesOf(manifest, HOST)
    expect(pages.length).toBeGreaterThan(0)
    expect(pages).toEqual([...new Set(doors.filter(isOfferablePage))])
    expect(entryPagesOf({ roots: {}, createdAt: 1 }, HOST)).toEqual([])
  })

  it('says whose a refusal is to fix', () => {
    expect(entryWhoseWords('leader')).toMatch(/yours/)
    expect(entryWhoseWords('operator')).toMatch(/operator/)
    expect(entryWhoseWords()).toBe('')
  })

  it('counts an entry as home once its words are held here, each entry once', async () => {
    const soup = row(hexOf('c'), '{"soup":1}')
    const kept = await sign(enc.encode(soup.content))
    const rows = [soup, row(hexOf('d'), '{"soup":1}'), row(hexOf('d'), '{"bread":1}')]
    expect(await entriesNotHome(rows, async () => false)).toBe(2)
    expect(await entriesNotHome(rows, async sig => sig === kept)).toBe(1)
  })
})

describe('the entry forms', () => {
  it('keeps one form a meaning, shared by every bundle through globalThis', () => {
    const form: EntryForm = { meaning: 'test:entry', templates: async () => [] }
    registerEntryForm(form)
    registerEntryForm({ ...form })
    expect(entryForms().filter(one => one.meaning === 'test:entry')).toHaveLength(1)
    expect((globalThis as { __hypercombEntryForms?: Map<string, EntryForm> }).__hypercombEntryForms?.has('test:entry')).toBe(true)
  })
})

describe('reading the leader\'s pools', () => {
  it('refuses without a host, and when the index cannot be read, never answering empty', async () => {
    expect(await readLeaderPosts({ ...world().deps, host: () => '' })).toMatchObject({ ok: false, why: 'no-host', whose: 'leader' })
    expect(await readLeaderPosts(world({ index: 'down' }).deps)).toMatchObject({ ok: false, why: 'index-unsafe' })
    expect(await readLeaderPosts(world({ index: 'absent' }).deps)).toMatchObject({ ok: true, pools: [] })
  })

  it('reads each pool with its count and what is not home, and shows a pool of another device without a code', async () => {
    const mine = await poolOf('Tuesday class', NOW + 3_600)
    const w = world({ rows: { [mine.known.pool]: [row(hexOf('c'), 'one'), row(hexOf('d'), 'two')] } })
    await w.plant(mine)
    w.roots[`entries:${hexOf('e')}`] = hexOf('f')
    const read = await readLeaderPosts(w.deps)
    if (!read.ok) throw new Error(read.reason)
    const own = read.pools.find(one => one.pool === mine.known.pool) as LeaderPool
    expect(own).toMatchObject({ state: 'open', entries: 2, notHome: 2, hostState: 'open', code: entryCodeLink(PAGE, mine.known.record, NONCE) })
    const other = read.pools.find(one => one.pool === hexOf('e')) as LeaderPool
    expect(other).toMatchObject({ known: null, code: '', entries: null, state: 'open' })
    expect(leaderPoolOfPage(read.pools, PAGE)?.pool).toBe(mine.known.pool)
    expect(read.told).toEqual([])
  })

  it('closes again a pool this device closed that the index names open, and says so', async () => {
    const mine = await poolOf('Tuesday class', NOW + 3_600)
    const w = world()
    await w.plant(mine, 'open', true)
    const read = await readLeaderPosts(w.deps)
    if (!read.ok) throw new Error(read.reason)
    expect(w.roots).toEqual({ [`entries-closed:${mine.known.pool}`]: mine.known.record })
    expect(read.pools[0]).toMatchObject({ state: 'closed' })
    expect(read.told.join(' ')).toMatch(/closed again/)
  })

  it('recycles a pool more than 30 days past its end, and says so', async () => {
    const old = await poolOf('Old class', NOW - ENTRY_LIMITS.keptSeconds - 60)
    const w = world()
    await w.plant(old, 'closed')
    const read = await readLeaderPosts(w.deps)
    if (!read.ok) throw new Error(read.reason)
    expect(w.roots).toEqual({})
    expect(w.writes.at(-1)?.drop).toEqual(Object.values(entryIndexKeys(old.known.pool)))
    expect(read.pools).toEqual([])
    expect(read.told.join(' ')).toMatch(/recycled/)
    expect(w.nonces.has(old.known.pool)).toBe(false)
  })
})

describe('opening for posts', () => {
  const template = { sig: '', name: 'Weeknight', bytes: enc.encode('{"recipe:template":1}'), meaning: 'recipe:entry' }

  it('opens with the template\'s bytes handed to the flow, the end picked, and shows the code', async () => {
    const w = world()
    const t = { ...template, sig: await sign(template.bytes) }
    const pageCheck = { postBee: async () => 'has' as const, page: async () => ({ status: 200, html: `<meta name="hypercomb-takes" content="post"><script id="hc-install">${JSON.stringify({ text: hexOf('6') })}</script>` }), keptLayers: async () => [] }
    w.store.set(t.sig, t.bytes) // published to the host and read back as a stranger would
    const publish = vi.fn(async (_host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) => {
      for (const sig of sigs) w.store.set(sig, (await bytesOf(sig)) as Uint8Array)
      return { ok: true as const }
    })
    const opened = await openForPosts({ host: HOST, page: PAGE, title: 'Tuesday class', days: 3, meaning: 'recipe:entry', template: t }, { ...w.deps, ...pageCheck, publish, bytesOf: async () => null })
    if (!opened.ok) throw new Error(opened.reason)
    expect(opened.pool.until).toBe(NOW + 3 * 86_400)
    expect(publish.mock.calls[0]?.[1]).toContain(t.sig)
    expect(w.shown).toEqual([opened.link])
    expect(opened.said).toMatch(/Tuesday class/)
  })

  it('recycles the page\'s last pool in the same write that opens the next', async () => {
    const w = world()
    const last = await poolOf('Last week', NOW + 600)
    await w.plant(last)
    const t = { ...template, sig: await sign(template.bytes) }
    const pageCheck = { postBee: async () => 'has' as const, page: async () => ({ status: 200, html: `<meta name="hypercomb-takes" content="post"><script id="hc-install">${JSON.stringify({ text: hexOf('6') })}</script>` }), keptLayers: async () => [] }
    const read = await readLeaderPosts(w.deps)
    if (!read.ok) throw new Error(read.reason)
    w.store.set(t.sig, t.bytes)
    const opened = await openForPosts({ host: HOST, page: PAGE, title: 'This week', days: 1, meaning: 'recipe:entry', template: t, replaces: leaderPoolOfPage(read.pools, PAGE) }, { ...w.deps, ...pageCheck })
    if (!opened.ok) throw new Error(opened.reason)
    const opening = w.writes.find(change => change.set?.[`entries:${opened.pool.pool}`])
    expect(opening?.drop).toEqual(Object.values(entryIndexKeys(last.known.pool)))
    expect(Object.keys(w.roots)).toEqual([`entries:${opened.pool.pool}`])
  })

  it('refuses a title that is not one line, before anything is written', async () => {
    const w = world()
    expect(await openForPosts({ host: HOST, page: PAGE, title: ' ', days: 1, meaning: 'recipe:entry', template }, w.deps)).toMatchObject({ why: 'title', whose: 'leader' })
    expect(w.writes).toEqual([])
  })
})

describe('closing, recycling and bringing home', () => {
  it('closes in one write and says the host confirmed it', async () => {
    const mine = await poolOf('Tuesday class', NOW + 3_600)
    const w = world()
    await w.plant(mine)
    const read = await readLeaderPosts(w.deps)
    if (!read.ok) throw new Error(read.reason)
    const done = await closeForPosts(HOST, read.pools[0] as LeaderPool, w.deps)
    expect(done).toMatchObject({ ok: true })
    expect(done.said).toMatch(/host says so/)
    expect(w.writes).toHaveLength(1)
  })

  it('closes a pool of another device from the index alone, saying it could not ask the host', async () => {
    const w = world()
    w.roots[`entries:${hexOf('e')}`] = hexOf('f')
    const read = await readLeaderPosts(w.deps)
    if (!read.ok) throw new Error(read.reason)
    const done = await closeForPosts(HOST, read.pools[0] as LeaderPool, w.deps)
    expect(done.ok).toBe(true)
    expect(w.roots).toEqual({ [`entries-closed:${hexOf('e')}`]: hexOf('f') })
    expect(done.said).toMatch(/did not open it/)
  })

  it('recycles by hand, taking the pool out of the index and the record', async () => {
    const mine = await poolOf('Tuesday class', NOW + 3_600)
    const w = world()
    await w.plant(mine)
    const read = await readLeaderPosts(w.deps)
    if (!read.ok) throw new Error(read.reason)
    expect(await recycleForPosts(HOST, read.pools[0] as LeaderPool, w.deps)).toMatchObject({ ok: true })
    expect(w.roots).toEqual({})
    expect(w.records()).toEqual([])
  })

  it('brings the rows home through the form the record names, with the record\'s template', async () => {
    const mine = await poolOf('Tuesday class', NOW + 3_600, PAGE, hexOf('7'))
    const rows = [row(hexOf('c'), 'one')]
    const w = world({ rows: { [mine.known.pool]: rows } })
    await w.plant(mine)
    const read = await readLeaderPosts(w.deps)
    if (!read.ok) throw new Error(read.reason)
    const bring = vi.fn(async () => ({ brought: 1 }))
    const done = await bringPostsHome(read.pools[0] as LeaderPool, { ...w.deps, forms: () => [{ meaning: 'recipe:entry', templates: async () => [], bring }] })
    expect(done).toMatchObject({ ok: true })
    expect(bring).toHaveBeenCalledWith(rows, { pool: mine.known.pool, page: PAGE, template: hexOf('7'), title: 'Tuesday class' })
    const none = await bringPostsHome(read.pools[0] as LeaderPool, { ...w.deps, forms: () => [] })
    expect(none).toMatchObject({ ok: false })
  })
})

describe('the catalogue\'s source', () => {
  it('reads every pool this device opened and holds the code of, with its meaning and template, never one past keeping', async () => {
    const mine = await poolOf('Tuesday class', NOW + 3_600, PAGE, hexOf('7'))
    const old = await poolOf('Old class', NOW - ENTRY_LIMITS.keptSeconds - 60)
    const lost = await poolOf('Lost code', NOW + 3_600, 'https://other.example.com')
    const w = world({ rows: { [mine.known.pool]: [row(hexOf('c'), 'one')] } })
    await w.plant(mine)
    await w.plant(old, 'closed')
    await w.plant(lost)
    w.nonces.delete(lost.known.pool)
    const sources = await readOpenedSources(w.deps)
    expect(sources.map(one => one.pool)).toEqual([mine.known.pool])
    expect(sources[0]).toMatchObject({ meaning: 'recipe:entry', template: hexOf('7'), page: PAGE, title: 'Tuesday class' })
    expect(sources[0]?.read.rows).toHaveLength(1)
    expect(sources[0]?.read.hidden).toEqual({ named: null, list: null })
    expect(emptyHiddenList()).toEqual({ keys: [], pages: [] })
  })
})

describe('a pool opened on another of the leader\'s devices', () => {
  const template = { sig: '', name: 'Weeknight', bytes: enc.encode('{"recipe:template":1}'), meaning: 'recipe:entry' }
  const pageCheck = { postBee: async () => 'has' as const, page: async () => ({ status: 200, html: `<meta name="hypercomb-takes" content="post"><script id="hc-install">${JSON.stringify({ text: hexOf('6') })}</script>` }), keptLayers: async () => [] }

  /** A pool this device has no record and no code of: only its public record, which carries the page. */
  const elsewhere = async (w: ReturnType<typeof world>, until: number, as: 'open' | 'closed' = 'open') => {
    const bytes = entryRecordBytes({ meaning: 'recipe:entry', title: 'Phone class', template: hexOf('7'), by: P, until, page: PAGE })
    const record = await sign(bytes)
    w.store.set(record, bytes)
    w.roots[`${as === 'open' ? 'entries' : 'entries-closed'}:${hexOf('e')}`] = record
    return record
  }

  it('is placed on its page by its public record, with its end and title, and can be recycled, saying the host was not asked', async () => {
    const w = world()
    await elsewhere(w, NOW + 3_600)
    const read = await readLeaderPosts(w.deps)
    if (!read.ok) throw new Error(read.reason)
    const other = leaderPoolOfPage(read.pools, PAGE)
    expect(other).toMatchObject({ pool: hexOf('e'), known: null, code: '', page: PAGE, until: NOW + 3_600, title: 'Phone class' })
    const done = await recycleForPosts(HOST, other as LeaderPool, w.deps)
    expect(done.ok).toBe(true)
    expect(done.said).toMatch(/"Phone class" was recycled\. This device does not hold its code/)
    expect(w.roots).toEqual({})
  })

  it('is recycled by the hive once its public record says it is more than 30 days past its end', async () => {
    const w = world()
    await elsewhere(w, NOW - ENTRY_LIMITS.keptSeconds - 60, 'closed')
    const read = await readLeaderPosts(w.deps)
    if (!read.ok) throw new Error(read.reason)
    expect(w.roots).toEqual({})
    expect(read.told.join(' ')).toMatch(/"Phone class" ended more than 30 days ago/)
  })

  it('keeps the page to one pool: opening there is refused, unless it is the pool replaced in the same write', async () => {
    const w = world()
    await elsewhere(w, NOW + 3_600)
    const t = { ...template, sig: await sign(template.bytes) }
    w.store.set(t.sig, t.bytes)
    const refused = await openForPosts({ host: HOST, page: PAGE, title: 'This week', days: 1, meaning: 'recipe:entry', template: t }, { ...w.deps, ...pageCheck })
    expect(refused).toMatchObject({ ok: false, why: 'page-has-pool', whose: 'leader' })
    expect(w.writes).toEqual([])
    const read = await readLeaderPosts(w.deps)
    if (!read.ok) throw new Error(read.reason)
    const opened = await openForPosts({ host: HOST, page: PAGE, title: 'This week', days: 1, meaning: 'recipe:entry', template: t, replaces: leaderPoolOfPage(read.pools, PAGE) }, { ...w.deps, ...pageCheck })
    if (!opened.ok) throw new Error(opened.reason)
    expect(w.writes.find(change => change.set?.[`entries:${opened.pool.pool}`])?.drop).toEqual(Object.values(entryIndexKeys(hexOf('e'))))
    expect(Object.keys(w.roots)).toEqual([`entries:${opened.pool.pool}`])
  })
})

describe('the code shown again', () => {
  it('says when an open pool takes posts, and never says a closed one does', async () => {
    const mine = await poolOf('Tuesday class', NOW + 3_600)
    const w = world()
    await w.plant(mine)
    const read = await readLeaderPosts(w.deps)
    if (!read.ok) throw new Error(read.reason)
    const { showCode: _drawn, ...live } = w.deps
    qr.shown.length = 0
    const pool = read.pools[0] as LeaderPool
    expect(showPostsCode(pool, live)).toBe(true)
    expect(showPostsCode({ ...pool, state: 'closed' }, live)).toBe(true)
    w.setClock(NOW + 7_200)
    expect(showPostsCode(pool, live)).toBe(true)
    expect(qr.shown.map(one => one.note)).toEqual([
      expect.stringMatching(/It takes posts until /),
      expect.stringMatching(/It takes no more posts/),
      expect.stringMatching(/It takes no more posts/),
    ])
  })
})

describe('a read that breaks part way', () => {
  it('names the host it was reading', async () => {
    const w = world()
    const read = await readLeaderPosts({ ...w.deps, publisherKey: () => { throw new Error('no signer here') } })
    expect(read).toMatchObject({ ok: false, why: 'failed' })
    expect(!read.ok && read.reason).toBe(`Your signed index on ${HOST} could not be read.`)
  })
})
