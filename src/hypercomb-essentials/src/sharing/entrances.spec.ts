// sharing/entrances.spec.ts — POWERS ARE OFF BY DEFAULT, AND THE PARTICIPANT
// TURNS THEM ON, AT THE APP'S OWN ADDRESS (documentation/using-a-creation.md).
//
//   • `entrances` is one HOST-keyed field of the signed index: read leniently,
//     normalized on every write, and omitted when empty so an index without it
//     is byte-identical to before;
//   • an entry counts only while the same index BINDS its host to a lineage —
//     an own address, or a published key's implicit `<key>.<zone>` label — so
//     unpublishing, closing a door or moving an address drops it;
//   • EVERY other index writer carries it through: publish, the domain switch,
//     setHiveRoot (and the bridge and the profile word that go through it),
//     clearHiveRoot, the host listing, and the text-theme offering;
//   • setEntrance refuses an unreadable index, a domain's root (a plain front
//     door), a host no creation is bound to, and a page the host does not hold
//     — and turning on records the participant's own review scent in the same
//     signed write, at the zone root.
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
/** The Hyperdex app's own address — where its powers run. */
const APP = `business-card.${ZONE}`

let marks: string[]
let served: Record<string, unknown> | null
let indexStatus: number
let held: boolean
let resources: Map<string, Uint8Array>
let published: { host: string; sigs: string[] }[]
let availableAsk: unknown[][]
let requests: { url: string; method: string }[]

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

// The host: one signed index per key, served back exactly as it was PUT —
// whichever zone root it is asked through.
globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  requests.push({ url, method: init?.method ?? 'GET' })
  if (!url.endsWith(`/${PUBKEY}`)) return new Response('', { status: 404 })
  if ((init?.method ?? 'GET') === 'PUT') {
    served = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response('', { status: 200 })
  }
  if (indexStatus !== 200) return new Response('', { status: indexStatus })
  return served ? Response.json(served) : new Response('', { status: 404 })
}) as typeof fetch

const { lineageKey } = await import('../history/lineage-key.js')
const { readEntrances, isPoweredEntrance, boundLineage, entranceHost } = await import('./zone-door.js')
const { fetchHiveIndex, putHiveManifest, setHiveRoot, clearHiveRoot, setHostListing } = await import('./hive-pointer.js')
const { publishBranch, unpublishBranch, setBranchDoors, setBranchAddress, setEntrance, applyEntranceIntent } = await import('./publish-branch.js')
const { setTextThemeOffering } = await import('./text-theme-offering.js')
const { HIVE_LINK_VERSION } = await import('./hive-link.js')
const { EntranceScoutService } = await import('./entrance-scout.service.js')

const SEGS = ['jaime-weise']
const KEY = lineageKey(SEGS)
/** The creation's implicit address on the zone — its key as the first label. */
const LABELLED = `${KEY}.${ZONE}`
const ALL: EntrancePower[] = ['keep', 'camera', 'read']
const ENTRANCE: ZoneEntrance = { page: PAGE, powers: ALL, from: { pubkey: PUBKEY, lineage: KEY } }
const ENTRANCES: Record<string, ZoneEntrance> = { [APP]: ENTRANCE }
const BOUND = { roots: { [KEY]: HEAD }, addresses: { [APP]: KEY }, doors: { [KEY]: [ZONE] } }

const sign = (content: Record<string, unknown>, createdAt = 1_700_000_000): Record<string, unknown> =>
  finalizeEvent({ kind: 30564, created_at: createdAt, tags: [], content: JSON.stringify(content) }, SECRET) as unknown as Record<string, unknown>

const seed = (extra: Record<string, unknown> = {}): void => {
  served = sign({
    v: 1, roots: { [KEY]: HEAD, other: OTHER_HEAD }, doors: { [KEY]: [ZONE] },
    addresses: { [APP]: KEY }, entrances: ENTRANCES, future: { kept: true }, ...extra,
  })
}

const signedContent = (): Record<string, unknown> => JSON.parse(String(served?.['content'] ?? '{}')) as Record<string, unknown>
const entrancesNow = (): Record<string, ZoneEntrance> | undefined => signedContent()['entrances'] as Record<string, ZoneEntrance> | undefined

beforeEach(() => {
  marks = [ZONE]
  served = null
  indexStatus = 200
  held = true
  resources = new Map()
  published = []
  availableAsk = []
  requests = []
  seed()
})

describe('the entrances field, leniently', () => {
  it('keeps every valid field, folds the host to lower case, orders the powers, and keeps a whole-second from.at', () => {
    expect(readEntrances({
      'Business-Card.Cafesociety.buzz': { page: PAGE.toUpperCase(), powers: ['read', 'keep', 'camera'], from: { pubkey: PUBKEY, lineage: KEY, at: 1_700_000_005 } },
    }, BOUND)).toEqual({ [APP]: { page: PAGE, powers: ALL, from: { pubkey: PUBKEY, lineage: KEY, at: 1_700_000_005 } } })
    expect(readEntrances({ [APP]: { page: PAGE, from: { pubkey: PUBKEY, lineage: KEY, at: 1.5, head: 'nope' } } }, BOUND))
      .toEqual({ [APP]: { page: PAGE, from: { pubkey: PUBKEY, lineage: KEY } } })
    expect(readEntrances({ [APP]: { page: PAGE, from: { pubkey: PUBKEY, lineage: KEY, at: -1, head: HEAD.toUpperCase() } } }, BOUND))
      .toEqual({ [APP]: { page: PAGE, from: { pubkey: PUBKEY, lineage: KEY, head: HEAD } } })
  })

  it('drops an invalid or unknown field (a leftover `other` too), never the entry; an entry with nothing valid goes; powers need a page', () => {
    expect(readEntrances({ [APP]: { page: PAGE, powers: ALL, other: `host.${ZONE}`, junk: 1 } }, BOUND))
      .toEqual({ [APP]: { page: PAGE, powers: ALL } })
    expect(readEntrances({ [APP]: { page: 'nope', powers: ALL, other: `host.${ZONE}`, from: { pubkey: 'short', lineage: KEY } } }, BOUND)).toEqual({})
    expect(readEntrances({ [APP]: { powers: ALL, from: { pubkey: PUBKEY, lineage: KEY } } }, BOUND))
      .toEqual({ [APP]: { from: { pubkey: PUBKEY, lineage: KEY } } })
    expect(readEntrances({ [APP]: { page: PAGE, from: { pubkey: PUBKEY, lineage: 'x'.repeat(513) } } }, BOUND)).toEqual({ [APP]: { page: PAGE } })
    expect(readEntrances(null, BOUND)).toEqual({})
    expect(readEntrances([ENTRANCES], BOUND)).toEqual({})
  })

  it('a powers list it cannot read is dropped whole — never read as on', () => {
    for (const powers of [
      ['keep', 'camera', 'read', 'fly'], ['keep', 'keep', 'camera', 'read'], ['Keep', 'camera', 'read'], 'keep camera read',
    ]) {
      expect(readEntrances({ [APP]: { page: PAGE, powers } }, BOUND)).toEqual({ [APP]: { page: PAGE } })
    }
    expect(readEntrances({ [APP]: { page: PAGE, powers: ['keep'] } }, BOUND)).toEqual({ [APP]: { page: PAGE, powers: ['keep'] } })
  })

  it('a key must be a host: lower-cased, more than one label, every label a DNS label, at most 253 characters', () => {
    expect(entranceHost('https://Business-Card.Cafesociety.buzz/x')).toBe(APP)
    for (const raw of ['localhost', 'app.localhost:4250', '127.0.0.1', 'com', 'not a host', 'under_score.cafesociety.buzz', '-x.cafesociety.buzz', `${'a'.repeat(63)}.`.repeat(4) + 'buzz']) {
      expect(entranceHost(raw)).toBe('')
    }
  })

  it('keeps at most sixteen entries', () => {
    const addresses = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`a${i}.${ZONE}`, KEY]))
    const raw = Object.fromEntries(Object.keys(addresses).map(h => [h, { page: PAGE }]))
    expect(Object.keys(readEntrances(raw, { ...BOUND, addresses }))).toHaveLength(16)
  })

  it('powers are on only for a page with exactly all three — version 1 is all or nothing', () => {
    expect(isPoweredEntrance({ page: PAGE, powers: ['keep', 'camera', 'read'] })).toBe(true)
    expect(isPoweredEntrance({ page: PAGE, powers: ['read', 'camera', 'keep'] })).toBe(true)
    expect(isPoweredEntrance({ page: PAGE, powers: ['keep', 'camera'] })).toBe(false)
    expect(isPoweredEntrance({ powers: ['keep', 'camera', 'read'] })).toBe(false)
    expect(isPoweredEntrance(undefined)).toBe(false)
  })
})

describe('an entrance counts only where the index binds its host', () => {
  it('its own address names the lineage — `<label>.<zone>`, or an apex claim', () => {
    expect(boundLineage(BOUND, APP)).toBe(KEY)
    expect(boundLineage({ ...BOUND, addresses: { [ZONE]: KEY } }, ZONE)).toBe(KEY)
  })

  it('the implicit label names a published key on a domain its doors open — or on any, with no doors', () => {
    const roots = { [KEY]: HEAD }
    expect(boundLineage({ roots, doors: { [KEY]: [ZONE] } }, LABELLED)).toBe(KEY)
    expect(boundLineage({ roots }, LABELLED)).toBe(KEY)
    expect(boundLineage({ roots, doors: { [KEY]: [ZONE] } }, `${KEY}.eu.${ZONE}`)).toBe(KEY)
    expect(boundLineage({ roots, doors: { [KEY]: ['jwize.com'] } }, LABELLED)).toBe('')
    expect(boundLineage({ roots, doors: { [KEY]: [ZONE] } }, `${KEY}.evil${ZONE}`)).toBe('')
    expect(boundLineage({ roots: {}, doors: {} }, LABELLED)).toBe('')
  })

  it('an own address outranks the label; a reserved or apex label never binds', () => {
    expect(boundLineage({ roots: { [KEY]: HEAD, other: OTHER_HEAD }, addresses: { [LABELLED]: 'other' } }, LABELLED)).toBe('other')
    for (const label of ['host', 'content', 'try-x']) {
      expect(boundLineage({ roots: { [label]: HEAD } }, `${label}.${ZONE}`)).toBe('')
    }
    expect(boundLineage({ roots: { [KEY]: HEAD } }, ZONE)).toBe('')
  })

  it('reading drops an entrance whose host the index does not bind', () => {
    const raw = { [APP]: { page: PAGE }, [`tea.${ZONE}`]: { page: PAGE }, [LABELLED]: { page: PAGE } }
    expect(readEntrances(raw, BOUND)).toEqual({ [APP]: { page: PAGE }, [LABELLED]: { page: PAGE } })
    expect(readEntrances(raw, { roots: {}, addresses: {} })).toEqual({})
  })
})

describe('an intent applies to what the index holds now', () => {
  const powered: ZoneEntrance = { page: PAGE, powers: ALL, from: { pubkey: PUBKEY, lineage: KEY } }

  it('on sets the page and all three powers, keeping who is followed', () => {
    expect(applyEntranceIntent({ page: NEWER, powers: [], from: powered.from }, { kind: 'on', page: PAGE })).toEqual(powered)
  })

  it('off keeps the page and sets no powers', () => {
    expect(applyEntranceIntent(powered, { kind: 'off' })).toEqual({ ...powered, powers: [] })
    expect(applyEntranceIntent(null, { kind: 'off' })).toBeNull()
  })

  it('forget removes the entry', () => {
    expect(applyEntranceIntent(powered, { kind: 'forget' })).toBeNull()
  })
})

describe('the index reads and writes it', () => {
  it('a verified read surfaces the entrances, and ignores a malformed or unbound entry without refusing the index', async () => {
    seed({ entrances: { ...ENTRANCES, 'bad.org': { page: PAGE }, [`tea.${ZONE}`]: { page: 'x' } } })
    const read = await fetchHiveIndex(ZONE, PUBKEY)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.manifest.entrances).toEqual(ENTRANCES)
  })

  it('an index without entrances reads without the field', async () => {
    served = sign({ v: 1, roots: { [KEY]: HEAD } })
    const read = await fetchHiveIndex(ZONE, PUBKEY)
    expect(read.ok && 'entrances' in read.manifest).toBe(false)
  })

  it('a write normalizes the entrances it carries — an unknown field is ignored, an unbound host dropped', async () => {
    served = null   // nothing to read back: the caller's map is the one carried
    const previous = {
      v: 1, roots: { [KEY]: HEAD }, addresses: { [APP]: KEY },
      entrances: { [APP]: { page: PAGE, powers: ['read', 'keep', 'camera'], other: `host.${ZONE}`, junk: 1 }, 'bad.org': { page: PAGE } },
    }
    expect((await putHiveManifest(ZONE, { [KEY]: HEAD }, {}, 1_600_000_000, previous)).ok).toBe(true)
    expect(entrancesNow()).toEqual({ [APP]: { page: PAGE, powers: ALL } })
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
  const staleRead = { v: 1, roots: { [KEY]: HEAD }, addresses: { [APP]: KEY }, entrances: ENTRANCES }
  const offNow = { [APP]: { ...ENTRANCE, powers: [] as EntrancePower[] } }

  it('takes the entrances from a fresh read right before signing, never from the caller\'s copy', async () => {
    served = sign({ ...staleRead, entrances: offNow }, 1_700_000_100)
    expect((await putHiveManifest(ZONE, { [KEY]: HEAD }, {}, 1_700_000_000, staleRead)).ok).toBe(true)
    expect(entrancesNow()).toEqual(offNow)
  })

  it('a stale setHiveRoot cannot undo a Turn off', async () => {
    seed({ entrances: offNow })                           // what the host holds now
    const stale: HiveIndexResult = { ok: true, manifest: {  // what the writer read earlier
      roots: { [KEY]: HEAD }, createdAt: 1_600_000_000, pubkey: PUBKEY,
      addresses: { [APP]: KEY }, entrances: ENTRANCES, signedContent: staleRead,
    } }
    expect((await setHiveRoot(ZONE, 'install:essentials', NEWER, { fetchIndex: async () => stale })).ok).toBe(true)
    expect(entrancesNow()).toEqual(offNow)
  })

  it('only setEntrance sets them — its own map stands', async () => {
    served = sign({ ...staleRead, entrances: offNow }, 1_700_000_100)
    await putHiveManifest(ZONE, { [KEY]: HEAD }, {}, 1_700_000_100, staleRead, { setsEntrances: true })
    expect(entrancesNow()).toEqual(ENTRANCES)
  })

  it('falls back to the caller\'s copy when the fresh read fails, or is older than what it replaces', async () => {
    indexStatus = 503
    await putHiveManifest(ZONE, { [KEY]: HEAD }, {}, 1_700_000_000, staleRead)
    indexStatus = 200
    expect(entrancesNow()).toEqual(ENTRANCES)
    served = sign({ ...staleRead, entrances: offNow }, 1_600_000_000)
    await putHiveManifest(ZONE, { [KEY]: HEAD }, {}, 1_700_000_000, staleRead)
    expect(entrancesNow()).toEqual(ENTRANCES)
  })
})

describe('every other index writer carries the entrances', () => {
  const carried = (): void => {
    expect(entrancesNow()).toEqual(ENTRANCES)
    expect(signedContent()['future']).toEqual({ kept: true })
  }

  it('publishBranch', async () => {
    const out = await publishBranch(SEGS)
    expect(out.ok).toBe(true)
    carried()
  })

  it('setBranchDoors — an own address stays bound whatever the doors say', async () => {
    expect((await setBranchDoors(SEGS, [ZONE, 'pluginthematrix.com'])).ok).toBe(true)
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

describe('an entrance goes with its binding', () => {
  it('unpublishBranch drops the withdrawn creation\'s entrance, and keeps another creation\'s', async () => {
    const tea = `tea.${ZONE}`
    seed({ addresses: { [APP]: KEY, [tea]: 'other' }, entrances: { ...ENTRANCES, [tea]: { page: NEWER } } })
    expect(await unpublishBranch(SEGS)).toEqual({ ok: true, removed: true })
    expect((signedContent()['roots'] as Record<string, string>)[KEY]).toBeUndefined()
    expect(entrancesNow()).toEqual({ [tea]: { page: NEWER } })
    expect(signedContent()['future']).toEqual({ kept: true })
  })

  it('moving the own address drops the entrance of the address given up', async () => {
    expect(await setBranchAddress(SEGS, ZONE, 'tea')).toEqual({ ok: true, host: `tea.${ZONE}` })
    expect(signedContent()['addresses']).toEqual({ [`tea.${ZONE}`]: KEY })
    expect('entrances' in signedContent()).toBe(false)
  })

  it('closing the door an implicit label stood on drops its entrance', async () => {
    seed({ addresses: undefined, entrances: { [LABELLED]: ENTRANCE } })
    expect((await setBranchDoors(SEGS, [ZONE, 'pluginthematrix.com'])).ok).toBe(true)
    expect(entrancesNow()).toEqual({ [LABELLED]: ENTRANCE })
    expect((await setBranchDoors(SEGS, ['pluginthematrix.com'])).ok).toBe(true)
    expect('entrances' in signedContent()).toBe(false)
  })
})

describe('setEntrance — the participant turns an app address\'s powers on or off', () => {
  const start = (extra: Record<string, unknown> = {}): void => seed({ entrances: undefined, ...extra })
  const entranceNow = (host = APP): ZoneEntrance | undefined => entrancesNow()?.[host]
  const puts = (): string[] => requests.filter(r => r.method === 'PUT').map(r => new URL(r.url).host)

  it('turn on writes the page with all three powers, the review scent and what was followed, in one signed write at the zone root', async () => {
    start()
    const out = await setEntrance(APP, { kind: 'on', page: PAGE, from: { pubkey: PUBKEY, lineage: KEY } })
    expect(out).toMatchObject({ ok: true, host: APP })
    // Following yourself: `at` is the stamp of this very write, `head` the
    // followed lineage's head as your index names it.
    expect(entranceNow()).toEqual({ page: PAGE, powers: ALL, from: { pubkey: PUBKEY, lineage: KEY, at: served?.['created_at'], head: HEAD } })
    const scent = (signedContent()['roots'] as Record<string, string>)[`assess:${PAGE}`]
    expect(out.ok && out.assessed).toBe(scent)
    expect(published).toEqual([{ host: ZONE, sigs: expect.arrayContaining([scent]) }])
    const record = JSON.parse(new TextDecoder().decode(resources.get(scent!)!)) as Record<string, unknown>
    expect(record).toMatchObject({ kind: 'module-assessment', sandbox: 'card-door', root: PAGE, change: null, verdict: 'accept' })
    const notes = [...resources.values()].map(b => new TextDecoder().decode(b))
    expect(notes).toContain(`Previewed and turned on for ${APP}.`)
    expect(availableAsk).toEqual([[PAGE, 'resource', false, [ZONE]]])
    expect(puts()).toEqual([ZONE])
  })

  it('an implicit label is an address too — the creation\'s key on a domain its doors open', async () => {
    start({ addresses: undefined })
    expect(await setEntrance(LABELLED.toUpperCase(), { kind: 'on', page: PAGE })).toMatchObject({ ok: true, host: LABELLED })
    expect(entranceNow(LABELLED)).toEqual({ page: PAGE, powers: ALL })
  })

  it('aims the index, the receipt and the scent at the zone the address sits under', async () => {
    const app = 'business-card.jwize.com'
    start({ addresses: { [app]: KEY }, doors: { [KEY]: [ZONE, 'jwize.com'] } })
    expect((await setEntrance(app, { kind: 'on', page: PAGE })).ok).toBe(true)
    expect(entranceNow(app)).toEqual({ page: PAGE, powers: ALL })
    expect(new URL(requests[0]!.url).host).toBe('jwize.com')
    expect(puts()).toEqual(['jwize.com'])
    expect(availableAsk).toEqual([[PAGE, 'resource', false, ['jwize.com']]])
    expect(published.map(p => p.host)).toEqual(['jwize.com'])
  })

  it('turn off keeps the page with no powers — never gated on the page being held, and no scent', async () => {
    held = false
    expect(await setEntrance(APP, { kind: 'off' })).toMatchObject({ ok: true, host: APP, entrance: { ...ENTRANCE, powers: [] } })
    expect(entranceNow()).toEqual({ ...ENTRANCE, powers: [] })
    expect(published).toEqual([])
    expect(availableAsk).toEqual([])
  })

  it('what a stale panel believed can neither drop nor raise powers — the intent meets the index as it is', async () => {
    // The panel last saw powers on; the index holds them off. Off again is no change.
    seed({ entrances: { [APP]: { ...ENTRANCE, powers: [] } } })
    const before = served
    expect(await setEntrance(APP, { kind: 'off' })).toMatchObject({ ok: true, reason: 'unchanged' })
    expect(served).toBe(before)
  })

  it('forget removes the entrance — the field goes with its last entry', async () => {
    held = false
    expect((await setEntrance(APP, { kind: 'forget' })).ok).toBe(true)
    expect('entrances' in signedContent()).toBe(false)
    expect(signedContent()['future']).toEqual({ kept: true })
  })

  it('refuses an index it cannot read, and signs nothing', async () => {
    const before = served
    indexStatus = 503
    expect(await setEntrance(APP, { kind: 'off' })).toMatchObject({ ok: false, failure: 'index-unsafe' })
    expect(served).toBe(before)
  })

  it('a domain\'s root is a plain front door: no powers there, even where a creation claims the apex', async () => {
    seed({ addresses: { [ZONE]: KEY, 'jwize.com': KEY }, doors: { [KEY]: [ZONE, 'jwize.com'] }, entrances: undefined })
    const before = served
    expect(await setEntrance(ZONE, { kind: 'on', page: PAGE })).toMatchObject({ ok: false, failure: 'root' })
    expect(await setEntrance('jwize.com', { kind: 'on', page: PAGE })).toMatchObject({ ok: false, failure: 'root' })
    expect(served).toBe(before)
    expect(published).toEqual([])
  })

  it('needs the address bound to a creation only to turn on — off and forget are always allowed', async () => {
    seed({ addresses: { [`rituals.${ZONE}`]: KEY } })
    const before = served
    expect(await setEntrance(APP, { kind: 'on', page: NEWER })).toMatchObject({ ok: false, failure: 'no-address' })
    expect(served).toBe(before)
    // The unbound entry is not read at all, so there is nothing to change.
    expect(await setEntrance(APP, { kind: 'off' })).toMatchObject({ ok: true, reason: 'unchanged' })
    expect(await setEntrance(APP, { kind: 'forget' })).toMatchObject({ ok: true, reason: 'unchanged' })
    expect(served).toBe(before)
    served = null
    expect(await setEntrance(APP, { kind: 'on', page: PAGE })).toMatchObject({ ok: false, failure: 'no-address' })
  })

  it('refuses to turn on a page the host does not hold', async () => {
    start()
    const before = served
    held = false
    expect(await setEntrance(APP, { kind: 'on', page: NEWER })).toMatchObject({ ok: false, failure: 'not-available' })
    expect(served).toBe(before)
    expect(published).toEqual([])
  })

  it('refuses a bad page, and a host that is not an address', async () => {
    expect(await setEntrance(APP, { kind: 'on', page: 'nope' })).toMatchObject({ ok: false, failure: 'no-page' })
    for (const host of ['localhost:4250', 'app.localhost', 'com', 'not a host', '']) {
      expect(await setEntrance(host, { kind: 'off' })).toMatchObject({ ok: false, failure: 'no-host' })
    }
  })

  it('refuses a seventeenth entrance rather than letting the host refuse the whole index', async () => {
    const addresses = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`a${i}.${ZONE}`, 'other']))
    const full = Object.fromEntries(Object.keys(addresses).map(h => [h, { page: PAGE }]))
    seed({ addresses: { ...addresses, [APP]: KEY }, entrances: full })
    expect(await setEntrance(APP, { kind: 'on', page: PAGE })).toMatchObject({ ok: false, failure: 'too-many' })
  })

  it('an unchanged entrance signs nothing', async () => {
    const before = served
    expect(await setEntrance(APP, { kind: 'on', page: PAGE, from: { pubkey: PUBKEY, lineage: KEY } })).toMatchObject({ ok: true, reason: 'unchanged' })
    expect(served).toBe(before)
  })
})

describe('a self-followed entrance, turned on before its page is published', () => {
  // The followed lineage's head (HEAD) still wears the older, published page;
  // the participant previewed and turned on a page they have not published.
  const OLDER_PUBLISHED = 'f'.repeat(64)
  const MOVED_PAGE = '9'.repeat(64)
  const MOVED_HEAD = '8'.repeat(64)
  const entranceNow = (): ZoneEntrance => entrancesNow()![APP]!
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
    expect((await setEntrance(APP, { kind: 'on', page: PAGE, from: { pubkey: PUBKEY, lineage: KEY } })).ok).toBe(true)
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
    served = sign({ ...signedContent(), entrances: { [APP]: { ...entranceNow(), from: stampOnly } } }, Number(served?.['created_at']) + 1)
    expect(await look()).toEqual([expect.objectContaining({ host: APP, offered: OLDER_PUBLISHED })])
  })

  it('offers the page once the followed head moves', async () => {
    seed({ entrances: undefined })
    expect((await setEntrance(APP, { kind: 'on', page: PAGE, from: { pubkey: PUBKEY, lineage: KEY } })).ok).toBe(true)
    expect((await setHiveRoot(ZONE, KEY, MOVED_HEAD)).ok).toBe(true)
    expect(await look()).toEqual([expect.objectContaining({ host: APP, current: PAGE, offered: MOVED_PAGE, head: MOVED_HEAD })])
  })
})
