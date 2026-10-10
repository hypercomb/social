// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/share-ask.worker.spec.ts — ASK, PER PAGE, ONCE (jwize 2026-10-10,
// option b).
//
// The live SwarmDrone and the live ToastDrone run against stubbed IoC peers;
// the ShareAskWorker is the module under test. A joined tab that arrives on a
// page holding tiles from before the meeting is asked ONE line about that
// page — after the page has been announced, never before — and Share offers
// exactly those tiles (offerPrivateHere), nothing else — never a tile the
// participant hid. Not now, the ×, or the line timing out leave everything as
// it was, and that page is not asked again in that meeting, across a reload
// too. Another meeting asks again. A line taken down UNANSWERED (walking away,
// leaving, the tab going to the background) uses nothing up, and navigating
// takes it down at once.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { EffectBus, lineageKey } from '@hypercomb/core'
import { sessionHideStore } from '../presentation/tiles/session-hide.store.js'
import { hideStorageKey } from '../presentation/tiles/tile-public.js'

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
// jsdom has no idle callback; pin it absent so the worker's bounded fallback
// runs on the fake clock.
vi.stubGlobal('requestIdleCallback', undefined)

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const ME = 'a'.repeat(64)
const SECRET = 'riverside-4417'

const state = vi.hoisted(() => ({
  segments: [] as string[],
  /** page ('' = root, 'p1', …) → child names */
  children: new Map<string, string[]>(),
  /** 'location|name' → public */
  public: new Set<string>(),
  /** collection items (reference tiles) */
  refs: new Set<string>(),
  setCalls: [] as string[],
  branchCalls: [] as string[],
}))

vi.mock('../presentation/tiles/tile-public.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCellPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
  isBranchPublic: () => false,
  setCellPublic: (location: string, name: string, on: boolean) => {
    state.setCalls.push(`${location}|${name}|${on}`)
    if (on) state.public.add(`${location}|${name}`)
    else state.public.delete(`${location}|${name}`)
    return []
  },
  setBranchPublic: (...args: unknown[]) => { state.branchCalls.push(JSON.stringify(args)); return [] },
}))
vi.mock('../editor/tile-properties.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readTilePropertiesAt: async () => ({}),
  withoutSubstrateImage: <T>(p: T): T => p,
}))
vi.mock('../commands/decoration-kind-index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  titlesForSegments: () => ({}),
  kindsForLabel: () => [],
  referenceTargetForLabel: (name: string) => (state.refs.has(name) ? 'sets/target' : null),
}))

type Line =
  | { what: 'publish'; sig: string; names: string[]; at: number }
  | { what: 'said'; sig: string; at: number }
  | { what: 'ask'; message: string; at: number }
  | { what: 'count'; at: number }
const timeline: Line[] = []

// The relay takes its time to take an event — longer than the worker's idle
// fallback, so an ask that ran off anything before the page's word is in the
// room (the share status, a timer from the walk's start, publish's own
// promise) would land first. As the real mesh does, publish resolves at once
// (sent or queued — a fresh join's socket is still connecting) and onTaken
// runs only when the relay's OK arrives.
const RELAY_ACK_MS = 400
const mesh = {
  publish: vi.fn(async (kind: number, sig: string, payload: unknown, _tags?: string[][], onTaken?: () => void) => {
    if (kind === 30200) {
      const visuals = (payload as { visuals?: { name?: string }[] }).visuals ?? []
      timeline.push({ what: 'publish', sig, names: visuals.map(v => String(v.name)), at: Date.now() })
    }
    setTimeout(() => {
      if (kind === 30200) timeline.push({ what: 'said', sig, at: Date.now() })
      onTaken?.()
    }, RELAY_ACK_MS)
    return true
  }),
  subscribe: vi.fn(() => ({ close: () => undefined })),
  configureKinds: () => undefined,
  ensureStartedForSig: () => undefined,
  swarmHost: () => 'jwize.com',
  nowSec: () => Math.floor(Date.now() / 1000),
  setNetworkEnabled: () => undefined,
  connectAll: () => undefined,
  resubscribeAll: () => undefined,
}

const childSig = (page: string, name: string): string => sha(`child:${page}/${name}`)
const nameByChildSig = new Map<string, string>()
const sealed: string[] = []
const history = {
  sign: async (l: { explorerSegments?: () => readonly string[] }) => `loc:${(l.explorerSegments?.() ?? []).join('/')}`,
  currentLayerAt: async (locSig: string) => {
    const page = locSig.slice(4)
    const kids = state.children.get(page)
    if (!kids) return null
    for (const n of kids) nameByChildSig.set(childSig(page, n), n)
    return { children: kids.map(n => childSig(page, n)) }
  },
  getLayerBySig: async (sig: string) => ({ name: nameByChildSig.get(sig) }),
  sealSubtree: async (segments: readonly string[]) => { sealed.push(segments.join('/')); return sha(`seal:${segments.join('/')}`) },
}

class FakeLineage extends EventTarget {
  explorerSegments = (): readonly string[] => state.segments
  domain = (): string => 'hypercomb.io'
}
const lineage = new FakeLineage()

const marked: string[] = []
const hostSync = {
  markPublic: vi.fn(async (sig: string) => { marked.push(sig) }),
  withdrawPublic: vi.fn(),
  isClosureAvailable: vi.fn(async () => false),
  isEnabled: () => false,
}

// The catalog the participant reads, with the service's plural rule.
const en = JSON.parse(readFileSync(joinPath(__dirname, '../../../hypercomb-shared/i18n/en.json'), 'utf8')) as Record<string, string>
const i18n = {
  t: (key: string, params?: Record<string, string | number>): string => {
    const n = params?.['count']
    const tpl = (typeof n === 'number' ? (n === 1 ? en[`${key}.one`] : en[`${key}.other`]) : undefined) ?? en[key] ?? key
    return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`))
  },
}

const roomStore = Object.assign(new EventTarget(), { value: 'downtown' })
const secretStore = Object.assign(new EventTarget(), { value: SECRET })
const registry: Record<string, unknown> = {
  '@diamondcoreprocessor.com/NostrMeshDrone': mesh,
  '@diamondcoreprocessor.com/NostrSigner': { getPublicKeyHex: async () => ME },
  '@hypercomb.social/TileSourceRegistry': { register: () => () => undefined },
  '@hypercomb.social/Lineage': lineage,
  '@diamondcoreprocessor.com/HistoryService': history,
  '@hypercomb/SignatureStore': { signText: async (s: string) => sha(s) },
  '@hypercomb.social/Store': { hypercombRoot: null },
  '@hypercomb.social/RoomStore': roomStore,
  '@hypercomb.social/SecretStore': secretStore,
  '@diamondcoreprocessor.com/HostSyncService': hostSync,
  '@hypercomb.social/I18n': i18n,
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
}

// Whether anyone is looking at the tab — jsdom says visible; the hidden-tab
// case flips it.
let visibility: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
const setVisible = (visible: boolean): void => {
  visibility = visible ? 'visible' : 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
}

// Not in the swarm when the page loaded: the join is made below.
sessionStorage.removeItem('hc:mesh-session')
await import('./swarm.drone.js')
await import('../commands/toast.drone.js')
const { ShareAskWorker, SHARE_ASKED_KEY, SHARE_ASK_ANSWER, SHARE_ASK_DURATION_MS } = await import('./share-ask.worker.js')

type SwarmApi = {
  privateToOfferHere: () => Promise<number | null>
  markDisposed: () => void
}
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as SwarmApi
type ToastAction = { label: string; effect: string; payload?: { ask?: string; share?: boolean } }
type ToastApi = { toasts: readonly { id: number; message: string; fading: boolean; actions: readonly ToastAction[] }[]; executeActionAt: (id: number, i: number) => void }
const toastDrone = registry['@diamondcoreprocessor.com/ToastDrone'] as ToastApi

// The count is read only after the page's announce — record when it is.
const realCount = swarm.privateToOfferHere
swarm.privateToOfferHere = async () => { timeline.push({ what: 'count', at: Date.now() }); return realCount() }

let worker = registry['@diamondcoreprocessor.com/ShareAskWorker'] as InstanceType<typeof ShareAskWorker>
await worker.pulse('')

EffectBus.on<{ message?: string; actions?: ToastAction[] }>('toast:show', (t) => {
  if (t?.actions?.some(a => a.effect === SHARE_ASK_ANSWER)) timeline.push({ what: 'ask', message: String(t.message), at: Date.now() })
})
const tilePublicChanged: Record<string, unknown>[] = []
EffectBus.on<Record<string, unknown>>('tile:public-changed', p => { tilePublicChanged.push(p) })

afterAll(() => { worker.markDisposed(); swarm.markDisposed(); vi.unstubAllGlobals(); vi.useRealTimers() })

const pageSig = (segments: readonly string[], room = roomStore.value): string => sha(`${lineageKey(segments)}\0${room}\0${SECRET}`)
const asks = (): Extract<Line, { what: 'ask' }>[] => timeline.filter((l): l is Extract<Line, { what: 'ask' }> => l.what === 'ask')
const publishesAt = (segments: readonly string[], room?: string): Extract<Line, { what: 'publish' }>[] =>
  timeline.filter((l): l is Extract<Line, { what: 'publish' }> => l.what === 'publish' && l.sig === pageSig(segments, room))
const askToast = () => toastDrone.toasts.find(t => !t.fading && t.actions.some(a => a.effect === SHARE_ASK_ANSWER))
const seedPage = (segments: string[], names: string[], publicNames: string[] = []): void => {
  state.children.set(segments.join('/'), names)
  for (const n of publicNames) state.public.add(`/${segments.join('/')}|${n}`)
}
const goTo = async (segments: string[], settleMs = 1_000): Promise<void> => {
  state.segments = segments
  lineage.dispatchEvent(new Event('change'))
  await vi.advanceTimersByTimeAsync(settleMs)
}
const join = async (): Promise<number> => {
  const at = Date.now()
  EffectBus.emit('mesh:public-changed', { public: true })
  await vi.advanceTimersByTimeAsync(1_000)
  return at
}
const leave = async (): Promise<void> => {
  EffectBus.emit('mesh:public-changed', { public: false })
  await vi.advanceTimersByTimeAsync(500)
}
/** Wait until the sticky refresh has said `segments` again — sent, and taken
 *  by the relay. */
const nextPublishOf = async (segments: readonly string[]): Promise<void> => {
  const from = publishesAt(segments).length
  for (let i = 0; i < 80 && publishesAt(segments).length === from; i++) await vi.advanceTimersByTimeAsync(500)
  expect(publishesAt(segments).length).toBeGreaterThan(from)
  await vi.advanceTimersByTimeAsync(RELAY_ACK_MS + 100)
}

describe('the ask about tiles from before the meeting', () => {
  it('never asks a tab that is not in the swarm — the same page is asked about once it joins', async () => {
    seedPage(['p0'], ['secret-plan', 'old-notes'])
    await goTo(['p0'], 2_000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(asks()).toEqual([])
    expect(timeline.filter(l => l.what === 'count')).toEqual([])

    await join()
    expect(asks().map(a => a.message)).toEqual(['Share the 2 tiles on this page with downtown?'])
    toastDrone.executeActionAt(askToast()!.id, 1)
    await leave()
  })

  it('a join asks once about this page — after its first announce, with its own private count and the room as typed; join timing unchanged; nothing sealed or marked', async () => {
    seedPage(['p1'], ['alpha', 'beta', 'gamma', 'shared-one', 'a-collection-item'], ['shared-one'])
    state.refs.add('a-collection-item')
    await goTo(['p1'], 500)
    const fromJoin = timeline.length
    const askedBefore = asks().length
    const joinedAt = await join()

    const first = publishesAt(['p1'])[0]
    expect(first).toBeTruthy()
    // The same bound the fresh-join spec pins: the ask adds nothing before it.
    expect(first!.at - joinedAt).toBeLessThan(300)
    expect(first!.names).toEqual(['shared-one'])

    expect(asks().slice(askedBefore).map(a => a.message)).toEqual(['Share the 3 tiles on this page with downtown?'])
    // Order: the page's word is in the room, then the count is read, then the
    // line — nothing of the ask's between the join and the first announce.
    const iSaid = timeline.findIndex((l, i) => i >= fromJoin && l.what === 'said' && l.sig === pageSig(['p1']))
    const iCount = timeline.findIndex((l, i) => i >= fromJoin && l.what === 'count')
    const iAsk = timeline.findIndex((l, i) => i >= fromJoin && l.what === 'ask')
    expect(timeline.indexOf(first!)).toBeGreaterThanOrEqual(fromJoin)
    expect(iSaid).toBeGreaterThan(timeline.indexOf(first!))
    expect(iSaid).toBeLessThan(iCount)
    expect(iCount).toBeLessThan(iAsk)

    // Asking read names only: nothing private was sealed or staged for upload.
    for (const name of ['alpha', 'beta', 'gamma', 'a-collection-item']) {
      expect(sealed).not.toContain(`p1/${name}`)
      expect(marked).not.toContain(sha(`seal:p1/${name}`))
    }
    expect(state.setCalls).toEqual([])
    expect(askToast()?.message).toBe('Share the 3 tiles on this page with downtown?')
    expect(askToast()?.actions.map(a => a.label)).toEqual(['Share', 'Not now'])
  })

  it('a line that times out changes nothing, and that page is not asked again — not by heartbeats, not on coming back', async () => {
    const asked = asks().length
    expect(askToast()?.message).toBe('Share the 3 tiles on this page with downtown?')
    await vi.advanceTimersByTimeAsync(SHARE_ASK_DURATION_MS + 1_000)
    expect(askToast()).toBeUndefined()
    const before = publishesAt(['p1']).length
    await vi.advanceTimersByTimeAsync(60_000)            // the slot refresh re-announces the page
    expect(publishesAt(['p1']).length).toBeGreaterThan(before)
    seedPage(['p1b'], [])
    await goTo(['p1b'])
    await goTo(['p1'])
    expect(asks().length).toBe(asked)
    expect(state.setCalls).toEqual([])
    expect(publishesAt(['p1']).at(-1)!.names).toEqual(['shared-one'])
  })

  it('Share offers exactly this page\'s private tiles — tile by tile, nothing else', async () => {
    seedPage(['p2'], ['echo', 'fox', 'golf', 'hotel-item'], ['golf'])
    state.refs.add('hotel-item')
    const publicBefore = new Set(state.public)
    await goTo(['p2'])
    expect(asks().at(-1)!.message).toBe('Share the 2 tiles on this page with downtown?')

    const toast = askToast()!
    toastDrone.executeActionAt(toast.id, 0)
    await vi.advanceTimersByTimeAsync(1_000)

    const added = [...state.public].filter(k => !publicBefore.has(k)).sort()
    expect(added).toEqual(['/p2|echo', '/p2|fox'])
    expect(state.setCalls).toEqual(['/p2|echo|true', '/p2|fox|true'])
    expect(state.branchCalls).toEqual([])
    expect(tilePublicChanged.at(-1)).toMatchObject({ location: '/p2', public: true, offered: 2 })
    // The walk that follows shares them like any tile made in the meeting.
    expect(publishesAt(['p2']).at(-1)!.names.sort()).toEqual(['echo', 'fox', 'golf'])
    expect(askToast()).toBeUndefined()
  })

  it('Not now changes nothing and is remembered for this meeting — across a reload, with nothing readable kept', async () => {
    seedPage(['p3'], ['india', 'juliet'])
    await goTo(['p3'])
    expect(asks().at(-1)!.message).toBe('Share the 2 tiles on this page with downtown?')
    const setBefore = state.setCalls.length
    toastDrone.executeActionAt(askToast()!.id, 1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(state.setCalls.length).toBe(setBefore)
    expect(publishesAt(['p3']).at(-1)!.names).toEqual([])

    // A RELOAD of the same meeting: a fresh worker over the same tab session.
    const n = asks().length
    worker.markDisposed()
    worker = new ShareAskWorker()
    await worker.pulse('')
    seedPage(['p3b'], [])
    await goTo(['p3b'])
    await goTo(['p3'])
    expect(asks().length).toBe(n)

    const kept = sessionStorage.getItem(SHARE_ASKED_KEY) ?? ''
    for (const word of ['p3', 'p1', 'downtown', SECRET, 'india', 'alpha']) expect(kept).not.toContain(word)
    expect((JSON.parse(kept) as string[]).every(d => /^[0-9a-f]{64}$/.test(d))).toBe(true)
  })

  it('another meeting asks again about the same page; coming back to the first does not', async () => {
    const n = asks().length
    roomStore.value = 'uptown'
    roomStore.dispatchEvent(new Event('change'))
    await vi.advanceTimersByTimeAsync(1_500)
    expect(asks().length).toBe(n + 1)
    expect(asks().at(-1)!.message).toBe('Share the 2 tiles on this page with uptown?')
    toastDrone.executeActionAt(askToast()!.id, 1)

    roomStore.value = 'downtown'
    roomStore.dispatchEvent(new Event('change'))
    await vi.advanceTimersByTimeAsync(1_500)
    expect(asks().length).toBe(n + 1)
  })

  it('never counts tiles made in the meeting, and says one tile in the singular', async () => {
    const n = asks().length
    seedPage(['p4'], ['kilo'])
    state.segments = ['p4']
    lineage.dispatchEvent(new Event('change'))
    await vi.advanceTimersByTimeAsync(20)
    // Made here, in the meeting, before the line is considered: public by default.
    state.children.set('p4', ['kilo', 'lima-new'])
    EffectBus.emit('cell:added', { cell: 'lima-new', segments: ['p4'] })
    expect(state.public.has('/p4|lima-new')).toBe(true)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(asks().length).toBe(n + 1)
    expect(asks().at(-1)!.message).toBe('Share the 1 tile on this page with downtown?')
    toastDrone.executeActionAt(askToast()!.id, 1)
  })

  it('never asks when nothing here is private: all public, empty, collection items only, or the sets page', async () => {
    const n = asks().length
    seedPage(['p5'], ['mike', 'november'], ['mike', 'november'])
    await goTo(['p5'])
    seedPage(['p6'], [])
    await goTo(['p6'])
    seedPage(['p7'], ['oscar-item'])
    state.refs.add('oscar-item')
    await goTo(['p7'])
    seedPage(['sets'], ['papa', 'quebec'])
    await goTo(['sets'])
    expect(asks().length).toBe(n)

    // The same walk onto a page that does hold one asks — the silence above
    // was the pages, not a sleeping worker.
    seedPage(['p7b'], ['uniform', 'victor-item'])
    state.refs.add('victor-item')
    await goTo(['p7b'])
    expect(asks().length).toBe(n + 1)
    expect(asks().at(-1)!.message).toBe('Share the 1 tile on this page with downtown?')
    toastDrone.executeActionAt(askToast()!.id, 1)
  })

  it('leaving cancels an ask still waiting, and takes down one already showing — its Share then does nothing', async () => {
    seedPage(['p8'], ['romeo'])
    const from = timeline.length
    state.segments = ['p8']
    lineage.dispatchEvent(new Event('change'))
    // Announced (the relay took it), and the idle pass has not run yet.
    for (let i = 0; i < 100 && !timeline.slice(from).some(l => l.what === 'said' && l.sig === pageSig(['p8'])); i++) {
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(timeline.slice(from).some(l => l.what === 'said' && l.sig === pageSig(['p8']))).toBe(true)
    expect(timeline.slice(from).some(l => l.what === 'count')).toBe(false)
    const n = asks().length
    await leave()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(asks().length).toBe(n)

    // Joined again: the page was never asked, so it is asked now.
    await join()
    expect(asks().length).toBe(n + 1)
    const toast = askToast()!
    const shareId = toast.actions[0]!.payload!.ask!
    await leave()
    expect(askToast()).toBeUndefined()
    const setBefore = state.setCalls.length
    EffectBus.emit(SHARE_ASK_ANSWER, { ask: shareId, share: true })
    await vi.advanceTimersByTimeAsync(500)
    expect(state.setCalls.length).toBe(setBefore)
    await join()
  })

  it('walking to another page takes the line down; a late Share for the page left shares nothing', async () => {
    seedPage(['p9'], ['sierra', 'tango'])
    await goTo(['p9'])
    const toast = askToast()!
    expect(toast.message).toBe('Share the 2 tiles on this page with downtown?')
    const shareId = toast.actions[0]!.payload!.ask!
    seedPage(['p10'], [])
    await goTo(['p10'])
    expect(askToast()).toBeUndefined()
    const setBefore = state.setCalls.length
    EffectBus.emit(SHARE_ASK_ANSWER, { ask: shareId, share: true })
    await vi.advanceTimersByTimeAsync(500)
    expect(state.setCalls.length).toBe(setBefore)
  })

  it('a tile the participant hid is neither counted nor shared — the page\'s hide list, the path-keyed list or the global one', async () => {
    seedPage(['p11'], ['papa-hidden', 'quebec', 'romeo-lineage', 'sierra-global', 'tango'])
    sessionHideStore.setItem(hideStorageKey('/p11'), JSON.stringify(['papa-hidden']))
    sessionHideStore.setItem('hc:hidden-lineages', JSON.stringify(['p11/romeo-lineage']))
    localStorage.setItem('hc:hidden-tiles', JSON.stringify(['sierra-global']))
    try {
      const setBefore = state.setCalls.length
      await goTo(['p11'])
      expect(askToast()?.message).toBe('Share the 2 tiles on this page with downtown?')
      toastDrone.executeActionAt(askToast()!.id, 0)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(state.setCalls.slice(setBefore)).toEqual(['/p11|quebec|true', '/p11|tango|true'])
      expect(publishesAt(['p11']).at(-1)!.names.sort()).toEqual(['quebec', 'tango'])
    } finally {
      sessionHideStore.removeItem(hideStorageKey('/p11'))
      sessionHideStore.removeItem('hc:hidden-lineages')
      localStorage.removeItem('hc:hidden-tiles')
    }
  })

  it('navigating takes the line down at once, before the next page is announced — and walking away answers nothing, so the page asks again', async () => {
    seedPage(['p12'], ['uniform-a', 'victor-a'])
    await goTo(['p12'])
    const toast = askToast()!
    expect(toast.message).toBe('Share the 2 tiles on this page with downtown?')
    const shareId = toast.actions[0]!.payload!.ask!
    const n = asks().length
    seedPage(['p13'], ['whiskey'], ['whiskey'])
    const from = timeline.length
    state.segments = ['p13']
    lineage.dispatchEvent(new Event('change'))
    // Down in the same turn — nothing of the next page has reached the room.
    expect(askToast()).toBeUndefined()
    expect(timeline.slice(from).some(l => l.what === 'said')).toBe(false)
    // A Share tapped as the line went shares nothing…
    const setBefore = state.setCalls.length
    EffectBus.emit(SHARE_ASK_ANSWER, { ask: shareId, share: true })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(state.setCalls.length).toBe(setBefore)
    // …and used nothing up: back on the page, it asks again.
    await goTo(['p12'])
    expect(asks().length).toBe(n + 1)
    expect(askToast()?.message).toBe('Share the 2 tiles on this page with downtown?')
    toastDrone.executeActionAt(askToast()!.id, 1)
  })

  it('a line about the page left never stays over a page whose walk says nothing new (sticky refresh)', async () => {
    // A fresh session of the same meeting, so the sticky refresh walks only
    // the pages below.
    await leave()
    seedPage(['p20'], ['xray'], ['xray'])
    await goTo(['p20'])
    await join()
    seedPage(['p21'], ['yankee-a'])
    await goTo(['p21'])
    expect(askToast()?.message).toBe('Share the 1 tile on this page with downtown?')
    toastDrone.executeActionAt(askToast()!.id, 1)          // A is decided
    await goTo(['p20'])
    // The sticky refresh re-says A: its slot is fresh again.
    await nextPublishOf(['p21'])
    seedPage(['p22'], ['zulu-b', 'alpha-b'])
    await goTo(['p22'], 1_500)
    expect(askToast()?.message).toBe('Share the 2 tiles on this page with downtown?')
    const saidA = publishesAt(['p21']).length
    const n = asks().length
    // Back on A while B's line is up.
    state.segments = ['p21']
    lineage.dispatchEvent(new Event('change'))
    expect(askToast()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1_500)
    // A's walk was unchanged (nothing re-sent); no line stands over it.
    expect(publishesAt(['p21']).length).toBe(saidA)
    expect(askToast()).toBeUndefined()
    expect(asks().length).toBe(n)
  })

  it('arriving back on a page already in the room asks at once when it was never answered — not at its next refresh', async () => {
    seedPage(['p23'], ['bravo-d', 'charlie-d'])
    await goTo(['p23'], 1_500)
    expect(askToast()?.message).toBe('Share the 2 tiles on this page with downtown?')
    seedPage(['p24'], ['delta-e'], ['delta-e'])
    await goTo(['p24'])                                    // walked away: unanswered
    expect(askToast()).toBeUndefined()
    await nextPublishOf(['p23'])                          // the sticky refresh re-says it
    const saidD = publishesAt(['p23']).length
    const n = asks().length
    await goTo(['p23'], 1_500)
    expect(publishesAt(['p23']).length).toBe(saidD)       // unchanged: nothing re-sent
    expect(asks().length).toBe(n + 1)
    expect(askToast()?.message).toBe('Share the 2 tiles on this page with downtown?')
    toastDrone.executeActionAt(askToast()!.id, 1)
  })

  it('never shows the line to a tab nobody is looking at — it asks when the tab is looked at again, and a line up when the tab goes away asks again', async () => {
    const asked = (): number => (JSON.parse(sessionStorage.getItem(SHARE_ASKED_KEY) ?? '[]') as string[]).length
    seedPage(['p25'], ['echo-h', 'fox-h'])
    setVisible(false)
    const n = asks().length
    const kept = asked()
    await goTo(['p25'], 2_000)
    await vi.advanceTimersByTimeAsync(SHARE_ASK_DURATION_MS + 1_000)
    expect(asks().length).toBe(n)
    expect(asked()).toBe(kept)                            // nothing decided unseen
    setVisible(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(asks().length).toBe(n + 1)
    expect(askToast()?.message).toBe('Share the 2 tiles on this page with downtown?')

    // Up, then the tab goes to the background: down, unanswered.
    setVisible(false)
    expect(askToast()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(SHARE_ASK_DURATION_MS + 1_000)
    expect(asked()).toBe(kept)
    setVisible(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(asks().length).toBe(n + 2)
    expect(askToast()?.message).toBe('Share the 2 tiles on this page with downtown?')
    toastDrone.executeActionAt(askToast()!.id, 1)
    expect(asked()).toBe(kept + 1)
  })

  it('reads plainly when the catalog predates these words, in the singular too', async () => {
    const shipped = registry['@hypercomb.social/I18n']
    // LocalizationService answers a key it does not have with the key.
    registry['@hypercomb.social/I18n'] = { t: (key: string) => key }
    try {
      seedPage(['p26'], ['golf-1'])
      await goTo(['p26'])
      expect(askToast()?.message).toBe('Share the 1 tile on this page with downtown?')
      expect(askToast()?.actions.map(a => a.label)).toEqual(['Share', 'Not now'])
      toastDrone.executeActionAt(askToast()!.id, 1)
      seedPage(['p27'], ['hotel-1', 'india-1', 'juliet-1'])
      await goTo(['p27'])
      expect(askToast()?.message).toBe('Share the 3 tiles on this page with downtown?')
      toastDrone.executeActionAt(askToast()!.id, 1)
    } finally {
      registry['@hypercomb.social/I18n'] = shipped
    }
  })

  it('the × answers like Not now — at once, not when the line would have timed out', async () => {
    const asked = (): number => (JSON.parse(sessionStorage.getItem(SHARE_ASKED_KEY) ?? '[]') as string[]).length
    seedPage(['p29'], ['mike-x', 'november-x'])
    await goTo(['p29'])
    const n = asks().length
    const kept = asked()
    const setBefore = state.setCalls.length
    ;(toastDrone as unknown as { dismiss: (id: number) => void }).dismiss(askToast()!.id)
    expect(asked()).toBe(kept + 1)
    // Walked away and back before the line's own timeout: not asked again.
    seedPage(['p30'], [])
    await goTo(['p30'])
    await goTo(['p29'])
    expect(asks().length).toBe(n)
    expect(state.setCalls.length).toBe(setBefore)
  })

  it('asks on a shell whose core predates EffectBus.listens', async () => {
    const bus = EffectBus as unknown as { listens?: unknown }
    bus.listens = undefined
    try {
      seedPage(['p28'], ['kilo-x', 'lima-x'])
      await goTo(['p28'])
      expect(askToast()?.message).toBe('Share the 2 tiles on this page with downtown?')
      toastDrone.executeActionAt(askToast()!.id, 1)
    } finally {
      delete bus.listens
    }
  })
})
