// sharing/entrances.spec.ts — POWERS ARE OFF BY DEFAULT, AND THE PARTICIPANT
// TURNS THEM ON (documentation/using-a-creation.md).
//
//   • `entrances` is one zone-keyed field of the signed index: read leniently,
//     normalized on every write, and omitted when empty so an index without it
//     is byte-identical to before;
//   • EVERY index writer carries it through (the plan's table): publish,
//     unpublish, the domain switch, the own address, setHiveRoot (and the
//     bridge and the profile word that go through it), clearHiveRoot, the host
//     listing, and the text-theme offering;
//   • setZoneEntrance refuses an unreadable index, a zone no creation opens
//     at its apex, and a page the host does not hold — and turning on records
//     the participant's own review scent in the same signed write.
//
// Real signing and real index reads: only the network and IoC are stubbed, so
// what a writer signs is exactly what the next reader verifies.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { SignatureService, type TextTheme } from '@hypercomb/core'
import type { EntrancePower, ZoneEntrance } from './zone-door.js'
import type { HiveIndexResult } from './hive-pointer.js'

const SECRET = new Uint8Array(32).fill(11)
const PUBKEY = getPublicKey(SECRET)
const HEAD = 'a'.repeat(64)
const OTHER_HEAD = 'b'.repeat(64)
const PAGE = 'd'.repeat(64)
const NEWER = 'e'.repeat(64)
const ZONE = 'cafesociety.buzz'

let marks: string[]
let served: Record<string, unknown> | null
let indexStatus: number
let held: boolean
let resources: Map<string, Uint8Array>
let published: { host: string; sigs: string[] }[]
let availableAsk: unknown[][]

vi.mock('./community-hosts.js', () => ({ hostsOfBranch: async () => marks }))

// jsdom's Blob, read the way jsdom reads it.
const bytesOfBlob = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
  reader.onerror = () => reject(reader.error)
  reader.readAsArrayBuffer(blob)
})

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string): unknown => {
    if (key === '@hypercomb.social/Store') {
      return {
        putResource: async (blob: Blob) => {
          const bytes = await bytesOfBlob(blob)
          const sig = await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
          resources.set(sig, bytes)
          return sig
        },
      }
    }
    if (key === '@diamondcoreprocessor.com/HistoryService') return { sealSubtree: async () => HEAD }
    if (key === '@diamondcoreprocessor.com/HostSyncService') {
      return {
        isEnabled: () => false,
        isPublicHostEnabled: () => true,
        publicHostDomain: () => ZONE,
        addPublishNodes: () => void 0,
        markPublic: async () => void 0,
        drain: async () => void 0,
        isClosureAvailable: async () => true,
        isClosureAvailableOn: async (...args: unknown[]) => { availableAsk.push(args); return held },
        ensureReceipt: async () => true,
        probeServed: async () => 'served' as const,
        publishAtoms: async (host: string, sigs: readonly string[]) => { published.push({ host, sigs: [...sigs] }); return { ok: true as const } },
      }
    }
    if (key === '@diamondcoreprocessor.com/NostrSigner') {
      return {
        getPublicKeyHex: async () => PUBKEY,
        signEvent: async (evt: { kind: number; created_at: number; tags: string[][]; content: string }) => finalizeEvent(evt, SECRET),
      }
    }
    return undefined
  },
}

// The host: one signed index per key, served back exactly as it was PUT.
globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  if (!url.endsWith(`/${PUBKEY}`)) return new Response('', { status: 404 })
  if ((init?.method ?? 'GET') === 'PUT') {
    served = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response('', { status: 200 })
  }
  if (indexStatus !== 200) return new Response('', { status: indexStatus })
  return served ? Response.json(served) : new Response('', { status: 404 })
}) as typeof fetch

const { lineageKey } = await import('../history/lineage-key.js')
const { readEntrances, isPoweredEntrance, entranceOther } = await import('./zone-door.js')
const { fetchHiveIndex, putHiveManifest, setHiveRoot, clearHiveRoot, setHostListing } = await import('./hive-pointer.js')
const { publishBranch, unpublishBranch, setBranchDoors, setBranchAddress, setZoneEntrance, applyEntranceIntent } = await import('./publish-branch.js')
const { setTextThemeOffering } = await import('./text-theme-offering.js')
const { HIVE_LINK_VERSION } = await import('./hive-link.js')
const { EntranceScoutService } = await import('./entrance-scout.service.js')

const SEGS = ['jaime-weise']
const KEY = lineageKey(SEGS)
const ALL: EntrancePower[] = ['keep', 'camera', 'read']
const ENTRANCE: ZoneEntrance = { page: PAGE, powers: ALL, other: `host.${ZONE}`, from: { pubkey: PUBKEY, lineage: KEY } }
const ENTRANCES: Record<string, ZoneEntrance> = { [ZONE]: ENTRANCE }

const sign = (content: Record<string, unknown>, createdAt = 1_700_000_000): Record<string, unknown> =>
  finalizeEvent({ kind: 30564, created_at: createdAt, tags: [], content: JSON.stringify(content) }, SECRET) as unknown as Record<string, unknown>

const seed = (extra: Record<string, unknown> = {}): void => {
  served = sign({
    v: 1, roots: { [KEY]: HEAD, other: OTHER_HEAD }, doors: { [KEY]: [ZONE] },
    addresses: { [ZONE]: KEY }, entrances: ENTRANCES, future: { kept: true }, ...extra,
  })
}

const signedContent = (): Record<string, unknown> => JSON.parse(String(served?.['content'] ?? '{}')) as Record<string, unknown>

beforeEach(() => {
  marks = [ZONE]
  served = null
  indexStatus = 200
  held = true
  resources = new Map()
  published = []
  availableAsk = []
  seed()
})

describe('the entrances field, leniently', () => {
  it('keeps every valid field, folds the zone, orders the powers, and keeps a whole-second from.at', () => {
    expect(readEntrances({
      'content.Cafesociety.buzz': { page: PAGE.toUpperCase(), powers: ['read', 'keep', 'camera', 'fly'], other: `Tea.${ZONE}`, from: { pubkey: PUBKEY, lineage: KEY, at: 1_700_000_005 } },
    })).toEqual({ [ZONE]: { page: PAGE, powers: ALL, other: `tea.${ZONE}`, from: { pubkey: PUBKEY, lineage: KEY, at: 1_700_000_005 } } })
    expect(readEntrances({ [ZONE]: { page: PAGE, from: { pubkey: PUBKEY, lineage: KEY, at: 1.5, head: 'nope' } } }))
      .toEqual({ [ZONE]: { page: PAGE, from: { pubkey: PUBKEY, lineage: KEY } } })
    expect(readEntrances({ [ZONE]: { page: PAGE, from: { pubkey: PUBKEY, lineage: KEY, head: HEAD.toUpperCase() } } }))
      .toEqual({ [ZONE]: { page: PAGE, from: { pubkey: PUBKEY, lineage: KEY, head: HEAD } } })
  })

  it('drops an invalid field, never the entry; an entry with nothing valid goes; powers need a page', () => {
    expect(readEntrances({
      [ZONE]: { page: 'nope', powers: ['keep', 'camera', 'read'], other: 'elsewhere.org', from: { pubkey: 'short', lineage: KEY } },
      'other.org': { page: PAGE, other: 'host.other.org', from: { pubkey: PUBKEY } },
      localhost: { page: PAGE },
      'not a zone': { page: PAGE },
    })).toEqual({ 'other.org': { page: PAGE, other: 'host.other.org' } })
    expect(readEntrances(null)).toEqual({})
    expect(readEntrances([ENTRANCES])).toEqual({})
  })

  it('other is host.<zone> or a <label>.<zone> own address, never the apex or another zone', () => {
    expect(entranceOther(`host.${ZONE}`, ZONE)).toBe(`host.${ZONE}`)
    expect(entranceOther(`home.${ZONE}`, ZONE)).toBe(`home.${ZONE}`)
    expect(entranceOther(ZONE, ZONE)).toBe('')
    expect(entranceOther(`try-x.${ZONE}`, ZONE)).toBe('')
    expect(entranceOther(`a.b.${ZONE}`, ZONE)).toBe('')
    expect(entranceOther('host.other.org', ZONE)).toBe('')
  })

  it('with the index\'s addresses, an other whose address is gone is dropped (host.<zone> always stays)', () => {
    const raw = { [ZONE]: { page: PAGE, other: `home.${ZONE}` } }
    expect(readEntrances(raw, { [`home.${ZONE}`]: KEY })).toEqual(raw)
    expect(readEntrances(raw, {})).toEqual({ [ZONE]: { page: PAGE } })
    expect(readEntrances({ [ZONE]: { other: `host.${ZONE}` } }, {})).toEqual({ [ZONE]: { other: `host.${ZONE}` } })
  })

  it('powers are on only for a page with all three — version 1 is all or nothing', () => {
    expect(isPoweredEntrance({ page: PAGE, powers: ['keep', 'camera', 'read'] })).toBe(true)
    expect(isPoweredEntrance({ page: PAGE, powers: ['keep', 'camera'] })).toBe(false)
    expect(isPoweredEntrance({ powers: ['keep', 'camera', 'read'] })).toBe(false)
    expect(isPoweredEntrance(undefined)).toBe(false)
  })
})

describe('an intent applies to what the index holds now', () => {
  const addresses = { [ZONE]: KEY, [`home.${ZONE}`]: KEY }
  const powered: ZoneEntrance = { page: PAGE, powers: ALL, other: `home.${ZONE}` }

  it('on sets the page and all three powers, keeping other', () => {
    expect(applyEntranceIntent({ page: NEWER, powers: [], other: `home.${ZONE}` }, { kind: 'on', page: PAGE }, ZONE, addresses)).toEqual(powered)
  })

  it('off keeps the page and sets no powers', () => {
    expect(applyEntranceIntent(powered, { kind: 'off' }, ZONE, addresses)).toEqual({ ...powered, powers: [] })
    expect(applyEntranceIntent(null, { kind: 'off' }, ZONE, addresses)).toBeNull()
  })

  it('other changes only other — it neither raises nor drops powers', () => {
    expect(applyEntranceIntent(powered, { kind: 'other', other: `host.${ZONE}` }, ZONE, addresses)).toEqual({ ...powered, other: `host.${ZONE}` })
    const off = { ...powered, powers: [] as EntrancePower[] }
    expect(applyEntranceIntent(off, { kind: 'other', other: null }, ZONE, addresses)).toEqual({ page: PAGE, powers: [] })
  })

  it('an other change that leaves the entry empty is a forget', () => {
    expect(applyEntranceIntent({ other: `host.${ZONE}` }, { kind: 'other', other: null }, ZONE, addresses)).toBeNull()
  })

  it('forget removes the entry', () => {
    expect(applyEntranceIntent(powered, { kind: 'forget' }, ZONE, addresses)).toBeNull()
  })
})

describe('the index reads and writes it', () => {
  it('a verified read surfaces the entrances and ignores a malformed entry without refusing the index', async () => {
    seed({ entrances: { ...ENTRANCES, 'bad.org': { page: 'x' } } })
    const read = await fetchHiveIndex(ZONE, PUBKEY)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.manifest.entrances).toEqual(ENTRANCES)
  })

  it('an index without entrances reads without the field', async () => {
    served = sign({ v: 1, roots: { [KEY]: HEAD } })
    const read = await fetchHiveIndex(ZONE, PUBKEY)
    expect(read.ok && 'entrances' in read.manifest).toBe(false)
  })

  it('a write normalizes the entrances it carries', async () => {
    served = null   // nothing to read back: the caller's map is the one carried
    const previous = { v: 1, roots: { [KEY]: HEAD }, entrances: { [ZONE]: { page: PAGE, powers: ['read', 'keep', 'camera'], junk: 1 }, 'bad.org': {} } }
    expect((await putHiveManifest(ZONE, { [KEY]: HEAD }, {}, 1_600_000_000, previous)).ok).toBe(true)
    expect(signedContent()['entrances']).toEqual({ [ZONE]: { page: PAGE, powers: ALL } })
  })

  it('an index without entrances is byte-identical to before, and an empty map is omitted', async () => {
    served = null
    const roots = { [KEY]: HEAD }
    const previous = { v: 1, roots, future: { kept: true } }
    await putHiveManifest(ZONE, roots, {}, 1_600_000_000, previous)
    expect(served?.['content']).toBe(JSON.stringify({ ...previous, v: HIVE_LINK_VERSION, roots }))
    await putHiveManifest(ZONE, roots, {}, 1_600_000_000, { ...previous, entrances: { 'bad.org': { page: 'x' } } })
    expect(served?.['content']).toBe(JSON.stringify({ ...previous, v: HIVE_LINK_VERSION, roots }))
  })
})

describe('no writer carries a stale entrance forward', () => {
  // The participant turned powers off while another writer held an older read.
  const staleRead = { v: 1, roots: { [KEY]: HEAD }, addresses: { [ZONE]: KEY }, entrances: ENTRANCES }
  const offNow = { [ZONE]: { ...ENTRANCE, powers: [] as EntrancePower[] } }

  it('takes the entrances from a fresh read right before signing, never from the caller\'s copy', async () => {
    served = sign({ ...staleRead, entrances: offNow }, 1_700_000_100)
    expect((await putHiveManifest(ZONE, { [KEY]: HEAD }, {}, 1_700_000_000, staleRead)).ok).toBe(true)
    expect(signedContent()['entrances']).toEqual(offNow)
  })

  it('a stale setHiveRoot cannot undo a Turn off', async () => {
    seed({ entrances: offNow })                           // what the host holds now
    const stale: HiveIndexResult = { ok: true, manifest: {  // what the writer read earlier
      roots: { [KEY]: HEAD }, createdAt: 1_600_000_000, pubkey: PUBKEY,
      addresses: { [ZONE]: KEY }, entrances: ENTRANCES, signedContent: staleRead,
    } }
    expect((await setHiveRoot(ZONE, 'install:essentials', NEWER, { fetchIndex: async () => stale })).ok).toBe(true)
    expect(signedContent()['entrances']).toEqual(offNow)
  })

  it('only setZoneEntrance sets them — its own map stands', async () => {
    served = sign({ ...staleRead, entrances: offNow }, 1_700_000_100)
    await putHiveManifest(ZONE, { [KEY]: HEAD }, {}, 1_700_000_100, staleRead, { setsEntrances: true })
    expect(signedContent()['entrances']).toEqual(ENTRANCES)
  })

  it('falls back to the caller\'s copy when the fresh read fails, or is older than what it replaces', async () => {
    indexStatus = 503
    await putHiveManifest(ZONE, { [KEY]: HEAD }, {}, 1_700_000_000, staleRead)
    indexStatus = 200
    expect(signedContent()['entrances']).toEqual(ENTRANCES)
    served = sign({ ...staleRead, entrances: offNow }, 1_600_000_000)
    await putHiveManifest(ZONE, { [KEY]: HEAD }, {}, 1_700_000_000, staleRead)
    expect(signedContent()['entrances']).toEqual(ENTRANCES)
  })
})

describe('every index writer carries the entrances', () => {
  const carried = (): void => {
    expect(signedContent()['entrances']).toEqual(ENTRANCES)
    expect(signedContent()['future']).toEqual({ kept: true })
  }

  it('publishBranch', async () => {
    const out = await publishBranch(SEGS)
    expect(out.ok).toBe(true)
    carried()
  })

  it('unpublishBranch — keyed by zone, so withdrawing the creation prunes nothing here', async () => {
    expect(await unpublishBranch(SEGS)).toEqual({ ok: true, removed: true })
    expect((signedContent()['roots'] as Record<string, string>)[KEY]).toBeUndefined()
    carried()
  })

  it('setBranchDoors', async () => {
    expect((await setBranchDoors(SEGS, [ZONE, 'pluginthematrix.com'])).ok).toBe(true)
    carried()
  })

  it('setBranchAddress', async () => {
    expect(await setBranchAddress(SEGS, ZONE, 'tea')).toEqual({ ok: true, host: `tea.${ZONE}` })
    carried()
  })

  it('setHiveRoot — and the bridge\'s hive-root-set and the profile word, which write through it', async () => {
    expect((await setHiveRoot(ZONE, 'install:essentials', NEWER)).ok).toBe(true)
    carried()
  })

  it('clearHiveRoot', async () => {
    expect((await clearHiveRoot(ZONE, 'other')).ok).toBe(true)
    carried()
  })

  it('setHostListing', async () => {
    expect(await setHostListing(ZONE, 'hypercomb:windows', true)).toEqual({ ok: true, listed: ['hypercomb:windows'] })
    carried()
  })

  it('the text-theme offering', async () => {
    const location = await SignatureService.sign(new TextEncoder().encode('themes:text:studio').buffer as ArrayBuffer)
    seed({ offerings: { [location]: { meaning: 'themes:text', key: 'studio', head: HEAD, title: 'Studio', host: ZONE } } })
    const theme: TextTheme = { key: 'studio', label: 'Studio', read: 'serif', code: 'plex', location, head: HEAD }
    const out = await setTextThemeOffering(theme, ZONE, false, {
      sync: { publicHostDomain: () => ZONE, publishAtoms: async () => ({ ok: true, sent: 0, held: 0 }) },
      pubkey: async () => PUBKEY,
    })
    expect(out).toEqual({ ok: true, state: 'off' })
    carried()
  })
})

describe('setZoneEntrance — the participant turns a zone\'s powers on or off', () => {
  const start = (extra: Record<string, unknown> = {}): void => seed({ entrances: undefined, ...extra })
  const entranceNow = (): ZoneEntrance | undefined => (signedContent()['entrances'] as Record<string, ZoneEntrance> | undefined)?.[ZONE]

  it('turn on writes the page with all three powers, the review scent and what was followed, in one signed write', async () => {
    start()
    const out = await setZoneEntrance(ZONE, { kind: 'on', page: PAGE, from: { pubkey: PUBKEY, lineage: KEY } })
    expect(out.ok).toBe(true)
    // Following yourself: `at` is the stamp of this very write, `head` the
    // followed lineage's head as your index names it.
    expect(entranceNow()).toEqual({ page: PAGE, powers: ALL, from: { pubkey: PUBKEY, lineage: KEY, at: served?.['created_at'], head: HEAD } })
    const scent = (signedContent()['roots'] as Record<string, string>)[`assess:${PAGE}`]
    expect(out.ok && out.assessed).toBe(scent)
    expect(published).toEqual([{ host: ZONE, sigs: expect.arrayContaining([scent]) }])
    const record = JSON.parse(new TextDecoder().decode(resources.get(scent!)!)) as Record<string, unknown>
    expect(record).toMatchObject({ kind: 'module-assessment', sandbox: 'card-door', root: PAGE, change: null, verdict: 'accept' })
    expect(availableAsk).toEqual([[PAGE, 'resource', false, [ZONE]]])
  })

  it('turn off keeps the page with no powers — never gated on the page being held, and no scent', async () => {
    held = false
    expect((await setZoneEntrance(ZONE, { kind: 'off' })).ok).toBe(true)
    expect(entranceNow()).toEqual({ ...ENTRANCE, powers: [] })
    expect(published).toEqual([])
    expect(availableAsk).toEqual([])
  })

  it('Turn off, then choosing Other, stays off', async () => {
    seed({ addresses: { [ZONE]: KEY, [`home.${ZONE}`]: KEY } })
    expect((await setZoneEntrance(ZONE, { kind: 'off' })).ok).toBe(true)
    expect((await setZoneEntrance(ZONE, { kind: 'other', other: `home.${ZONE}` })).ok).toBe(true)
    expect(entranceNow()).toEqual({ ...ENTRANCE, powers: [], other: `home.${ZONE}` })
  })

  it('what a stale panel believed can neither drop nor raise powers — the intent meets the index as it is', async () => {
    // The panel last saw nothing; the index holds a powered entrance.
    expect((await setZoneEntrance(ZONE, { kind: 'other', other: null })).ok).toBe(true)
    const { other: _gone, ...kept } = ENTRANCE
    expect(entranceNow()).toEqual(kept)
    // The panel last saw powers on; the index holds them off.
    seed({ entrances: { [ZONE]: { page: PAGE, powers: [], from: ENTRANCE.from } } })
    expect((await setZoneEntrance(ZONE, { kind: 'other', other: `host.${ZONE}` })).ok).toBe(true)
    expect(entranceNow()).toEqual({ ...ENTRANCE, powers: [] })
  })

  it('forget removes the entrance — the field goes with its last entry', async () => {
    held = false
    expect((await setZoneEntrance(ZONE, { kind: 'forget' })).ok).toBe(true)
    expect('entrances' in signedContent()).toBe(false)
    expect(signedContent()['future']).toEqual({ kept: true })
  })

  it('clearing Other on an entry with no page forgets it', async () => {
    seed({ entrances: { [ZONE]: { other: `host.${ZONE}` } } })
    expect((await setZoneEntrance(ZONE, { kind: 'other', other: null })).ok).toBe(true)
    expect('entrances' in signedContent()).toBe(false)
  })

  it('refuses an index it cannot read, and signs nothing', async () => {
    const before = served
    indexStatus = 503
    expect(await setZoneEntrance(ZONE, { kind: 'off' })).toMatchObject({ ok: false, failure: 'index-unsafe' })
    expect(served).toBe(before)
  })

  it('needs a creation at the apex only to turn on — an orphaned entrance can still be turned off and forgotten', async () => {
    seed({ addresses: { [`rituals.${ZONE}`]: KEY } })
    const before = served
    expect(await setZoneEntrance(ZONE, { kind: 'on', page: NEWER })).toMatchObject({ ok: false, failure: 'no-apex' })
    expect(served).toBe(before)
    expect((await setZoneEntrance(ZONE, { kind: 'off' })).ok).toBe(true)
    expect(entranceNow()?.powers).toEqual([])
    expect((await setZoneEntrance(ZONE, { kind: 'forget' })).ok).toBe(true)
    expect('entrances' in signedContent()).toBe(false)
    served = null
    expect(await setZoneEntrance(ZONE, { kind: 'on', page: PAGE })).toMatchObject({ ok: false, failure: 'no-apex' })
  })

  it('refuses to turn on a page the host does not hold', async () => {
    start()
    const before = served
    held = false
    expect(await setZoneEntrance(ZONE, { kind: 'on', page: NEWER })).toMatchObject({ ok: false, failure: 'not-available' })
    expect(served).toBe(before)
    expect(published).toEqual([])
  })

  it('refuses a bad page, an other that is not one of the zone\'s addresses, and a loopback zone', async () => {
    expect(await setZoneEntrance(ZONE, { kind: 'on', page: 'nope' })).toMatchObject({ ok: false, failure: 'no-page' })
    expect(await setZoneEntrance(ZONE, { kind: 'other', other: `home.${ZONE}` })).toMatchObject({ ok: false, failure: 'bad-other' })
    expect(await setZoneEntrance(ZONE, { kind: 'other', other: 'elsewhere.org' })).toMatchObject({ ok: false, failure: 'bad-other' })
    expect(await setZoneEntrance('localhost:4250', { kind: 'off' })).toMatchObject({ ok: false, failure: 'no-host' })
  })

  it('refuses a seventeenth entrance rather than letting the host refuse the whole index', async () => {
    const full = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`zone${i}.org`, { page: PAGE }]))
    seed({ entrances: full })
    expect(await setZoneEntrance(ZONE, { kind: 'on', page: PAGE })).toMatchObject({ ok: false, failure: 'too-many' })
  })

  it('an unchanged entrance signs nothing', async () => {
    const before = served
    expect(await setZoneEntrance(ZONE, { kind: 'on', page: PAGE, from: { pubkey: PUBKEY, lineage: KEY } })).toMatchObject({ ok: true, reason: 'unchanged' })
    expect(await setZoneEntrance(ZONE, { kind: 'other', other: `host.${ZONE}` })).toMatchObject({ ok: true, reason: 'unchanged' })
    expect(served).toBe(before)
  })
})

describe('a self-followed entrance, turned on before its page is published', () => {
  // The followed lineage's head (HEAD) still wears the older, published page;
  // the participant previewed and turned on a page they have not published.
  const OLDER_PUBLISHED = 'f'.repeat(64)
  const MOVED_PAGE = '9'.repeat(64)
  const MOVED_HEAD = '8'.repeat(64)
  const entranceNow = (): ZoneEntrance => (signedContent()['entrances'] as Record<string, ZoneEntrance>)[ZONE]!
  const look = async () => {
    const emitted: unknown[] = []
    await new EntranceScoutService().check({
      hosts: async () => [ZONE],
      ownPubkey: async () => PUBKEY,
      skipped: async () => new Set<string>(),
      pageAt: async head => (head === HEAD ? OLDER_PUBLISHED : head === MOVED_HEAD ? MOVED_PAGE : null),
      emit: update => { emitted.push(update) },
    })
    return emitted
  }

  it('stays silent when another write re-stamps the index — the followed head did not move', async () => {
    seed({ entrances: undefined })
    expect((await setZoneEntrance(ZONE, { kind: 'on', page: PAGE, from: { pubkey: PUBKEY, lineage: KEY } })).ok).toBe(true)
    const turnedOn = entranceNow().from!
    expect(turnedOn.head).toBe(HEAD)
    // Publishing something else: the index is stamped later than `at`.
    expect((await setHiveRoot(ZONE, 'install:essentials', NEWER)).ok).toBe(true)
    expect(Number(served?.['created_at'])).toBeGreaterThan(turnedOn.at!)
    expect(entranceNow().from).toEqual(turnedOn)
    expect(await look()).toEqual([])

    // The stamp rule alone (an entry with no recorded head) would have
    // offered the older published page — the gap `from.head` closes.
    const { head: _head, ...stampOnly } = turnedOn
    served = sign({ ...signedContent(), entrances: { [ZONE]: { ...entranceNow(), from: stampOnly } } }, Number(served?.['created_at']) + 1)
    expect(await look()).toEqual([expect.objectContaining({ zone: ZONE, offered: OLDER_PUBLISHED })])
  })

  it('offers the page once the followed head moves', async () => {
    seed({ entrances: undefined })
    expect((await setZoneEntrance(ZONE, { kind: 'on', page: PAGE, from: { pubkey: PUBKEY, lineage: KEY } })).ok).toBe(true)
    expect((await setHiveRoot(ZONE, KEY, MOVED_HEAD)).ok).toBe(true)
    expect(await look()).toEqual([expect.objectContaining({ zone: ZONE, current: PAGE, offered: MOVED_PAGE, head: MOVED_HEAD })])
  })
})
