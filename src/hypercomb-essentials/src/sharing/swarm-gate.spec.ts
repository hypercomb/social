// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm-gate.spec.ts — ANNOUNCE WHAT THE HOST SERVES; FOR ANYTHING
// ELSE, ONLY THE NAME (swarm.drone.ts #entryFor).
//
// The live SwarmDrone runs against stubbed IoC peers: a recording mesh, a
// layer history whose sealed handles the test moves, and a host-sync whose
// availability answer the test flips. Each case stands on its own page so the
// drone's per-page memos never cross cases. The page is a non-loopback origin
// (hypercomb.io), so the loopback-advertising rule is exercised for real.

import { createHash } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, lineageKey } from '@hypercomb/core'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const HEX64 = /[0-9a-f]{64}/i
const ME = 'a'.repeat(64)
const ROOM = 'meetup'
const SECRET = '4417'

const state = vi.hoisted(() => ({
  segments: [] as string[],
  // page key ('' = root, 'g1', 'g1/x') → child names
  children: new Map<string, string[]>(),
  // 'page/name' → sealed handle (moves on an edit)
  seal: new Map<string, string>(),
  // child name → 0000 props
  props: new Map<string, Record<string, unknown>>(),
  // 'location|name' → public
  public: new Set<string>(),
  // sealed handles a host serves
  available: new Set<string>(),
  swarmHost: 'jwize.com',
  selfOn: false,
}))

vi.mock('../presentation/tiles/tile-public.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCellPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
  isBranchPublic: () => false,
  setCellPublic: (location: string, name: string, on: boolean) => {
    if (on) state.public.add(`${location}|${name}`)
    else state.public.delete(`${location}|${name}`)
    return []
  },
}))
vi.mock('../editor/tile-properties.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readTilePropertiesAt: async (_segments: readonly string[], name: string) => ({ ...(state.props.get(name) ?? {}) }),
  withoutSubstrateImage: <T>(p: T): T => p,
}))
vi.mock('../commands/decoration-kind-index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  titlesForSegments: () => ({}),
  kindsForLabel: () => [],
  referenceTargetForLabel: () => null,
}))

type Published = { kind: number; sig: string; payload: { visuals?: Record<string, unknown>[] } & Record<string, unknown>; tags: string[][]; at: number }
const published: Published[] = []

const childSig = (page: string, name: string): string => sha(`child:${page}/${name}`)
const nameByChildSig = new Map<string, string>()

const mesh = {
  publish: vi.fn(async (kind: number, sig: string, payload: unknown, tags?: string[][]) => {
    published.push({ kind, sig, payload: JSON.parse(JSON.stringify(payload)), tags: tags ?? [], at: performance.now() })
    return true
  }),
  subscribe: vi.fn(() => ({ close: () => undefined })),
  configureKinds: () => undefined,
  ensureStartedForSig: () => undefined,
  swarmHost: () => state.swarmHost,
  nowSec: () => Math.floor(Date.now() / 1000),
  setNetworkEnabled: () => undefined,
  connectAll: () => undefined,
  resubscribeAll: () => undefined,
}

const history = {
  sign: async (l: { explorerSegments?: () => readonly string[] }) => `loc:${(l.explorerSegments?.() ?? []).join('/')}`,
  currentLayerAt: async (locSig: string) => {
    const kids = state.children.get(locSig.slice(4))
    return kids ? { children: kids.map(n => childSig(locSig.slice(4), n)) } : null
  },
  getLayerBySig: async (sig: string) => ({ name: nameByChildSig.get(sig) }),
  sealSubtree: async (segments: readonly string[]) => state.seal.get(segments.join('/')) ?? null,
}

class FakeLineage extends EventTarget {
  explorerSegments = (): readonly string[] => state.segments
  domain = (): string => 'hypercomb.io'
}
const lineage = new FakeLineage()

const hostSync = {
  markPublic: vi.fn(async () => undefined),
  isClosureAvailable: vi.fn(async (sig: string) => state.available.has(sig)),
  isEnabled: () => state.selfOn,
}

const registry: Record<string, unknown> = {
  '@diamondcoreprocessor.com/NostrMeshDrone': mesh,
  '@diamondcoreprocessor.com/NostrSigner': { getPublicKeyHex: async () => ME },
  '@hypercomb.social/TileSourceRegistry': { register: () => () => undefined },
  '@hypercomb.social/Lineage': lineage,
  '@diamondcoreprocessor.com/HistoryService': history,
  '@hypercomb/SignatureStore': { signText: async (s: string) => sha(s) },
  '@hypercomb.social/Store': { hypercombRoot: null },
  '@hypercomb.social/RoomStore': Object.assign(new EventTarget(), { value: ROOM }),
  '@hypercomb.social/SecretStore': Object.assign(new EventTarget(), { value: SECRET }),
  '@diamondcoreprocessor.com/HostSyncService': hostSync,
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
}

// THIS tab is joined — the per-tab session membership.ts seeds from.
sessionStorage.setItem('hc:mesh-session', 'true')
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as {
  currentSegments: () => readonly string[]
  markDisposed: () => void
}

const shareStatus: Record<string, unknown>[] = []
EffectBus.on<Record<string, unknown>>('swarm:share-status', (p) => { shareStatus.push(p) })

afterAll(() => swarm.markDisposed())

const until = async (pred: () => boolean, timeoutMs = 3000): Promise<void> => {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting')
    await new Promise(r => setTimeout(r, 5))
  }
}

const pageSig = (segments: readonly string[]): string => sha(`${lineageKey(segments)}\0${ROOM}\0${SECRET}`)
const layerAt = (segments: readonly string[]): Published[] =>
  published.filter(p => p.kind === 30200 && p.sig === pageSig(segments))
const lastLayerAt = (segments: readonly string[]): Published | undefined => layerAt(segments).at(-1)

/** Put `names` at page `segments`, each sealed to `child:<page>/<name>`. */
const seedPage = (segments: string[], names: string[]): void => {
  const page = segments.join('/')
  state.children.set(page, names)
  for (const n of names) {
    nameByChildSig.set(childSig(page, n), n)
    state.seal.set([...segments, n].join('/'), sha(`seal:${page}/${n}:v1`))
  }
}
const sealOf = (segments: string[], name: string): string => state.seal.get([...segments, name].join('/'))!
const makePublic = (segments: string[], name: string): void => { state.public.add(`/${segments.join('/')}|${name}`) }

/** Navigate this tab — the lineage change drives the swarm's sync + walk. */
const goTo = async (segments: string[]): Promise<void> => {
  const before = layerAt(segments).length
  state.segments = segments
  lineage.dispatchEvent(new Event('change'))
  await until(() => layerAt(segments).length > before)
}

beforeEach(() => {
  state.swarmHost = 'jwize.com'
  state.selfOn = false
})

describe('the never-retract gate', () => {
  it('a held, never-announced child goes out as a placeholder — name only, no 64-hex anywhere', async () => {
    const page = ['g1']
    seedPage(page, ['alpha', 'hidden-one'])
    makePublic(page, 'alpha')          // 'hidden-one' stays private
    state.props.set('alpha', {
      index: 3,
      accent: 'amber',
      small: { image: 'b'.repeat(64) },
      flat: { small: { image: 'c'.repeat(64) } },
      link: `https://jwize.com/${'d'.repeat(64)}`,
    })
    await goTo(page)
    const visuals = lastLayerAt(page)!.payload.visuals!
    expect(visuals.map(v => v['name'])).toEqual(['alpha'])
    const [alpha] = visuals
    expect(alpha['layerSig']).toBeUndefined()
    expect(alpha['index']).toBe(3)
    expect(alpha['accent']).toBe('amber')
    expect(HEX64.test(JSON.stringify(alpha))).toBe(false)
    // The private sibling is never announced — not even by name.
    expect(JSON.stringify(layerAt(page).map(p => p.payload))).not.toContain('hidden-one')
    expect(shareStatus.at(-1)).toMatchObject({ location: '/g1', offered: 1, uploading: 1, nameOnly: 1, private: 1 })
  })

  it('an edited child re-announces its last hosted entry byte-for-byte, then swaps after a receipt', async () => {
    const page = ['g2']
    seedPage(page, ['beta'])
    makePublic(page, 'beta')
    state.props.set('beta', { accent: 'blue', small: { image: 'e'.repeat(64) } })
    state.available.add(sealOf(page, 'beta'))
    await goTo(page)
    const hosted = lastLayerAt(page)!.payload.visuals!
    expect(hosted[0]['layerSig']).toBe(sealOf(page, 'beta'))
    const hostedJson = JSON.stringify(hosted)

    // EDIT: a new sealed handle no host serves yet, new props.
    state.seal.set('g2/beta', sha('seal:g2/beta:v2'))
    state.props.set('beta', { accent: 'green', small: { image: 'f'.repeat(64) } })
    const statusBefore = shareStatus.length
    EffectBus.emit('cell:0000-changed', { cell: 'beta' })
    await until(() => shareStatus.length > statusBefore && shareStatus.at(-1)!['location'] === '/g2')
    expect(shareStatus.at(-1)).toMatchObject({ offered: 1, uploading: 1, nameOnly: 0 })
    // Never retracted: every announcement since is the hosted entry, unchanged.
    for (const p of layerAt(page)) expect(JSON.stringify(p.payload.visuals)).toBe(hostedJson)

    // The new handle lands on the host — the receipt swaps it in.
    state.available.add(sha('seal:g2/beta:v2'))
    const n = layerAt(page).length
    EffectBus.emit('host:receipt', { sig: sha('seal:g2/beta:v2') })
    await until(() => layerAt(page).length > n)
    const swapped = lastLayerAt(page)!.payload.visuals!
    expect(swapped[0]['layerSig']).toBe(sha('seal:g2/beta:v2'))
    expect(swapped[0]['accent']).toBe('green')
  })

  it('making a tile private drops its name at once — the hosted memory never resurrects it', async () => {
    const page = ['g3']
    seedPage(page, ['gamma', 'delta'])
    makePublic(page, 'gamma')
    makePublic(page, 'delta')
    state.available.add(sealOf(page, 'gamma'))
    state.available.add(sealOf(page, 'delta'))
    await goTo(page)
    expect(lastLayerAt(page)!.payload.visuals!.map(v => v['name']).sort()).toEqual(['delta', 'gamma'])

    state.public.delete('/g3|gamma')
    const n = layerAt(page).length
    EffectBus.emit('tile:public-changed', { cell: 'gamma', location: '/g3', public: false })
    await until(() => layerAt(page).length > n)
    expect(lastLayerAt(page)!.payload.visuals!.map(v => v['name'])).toEqual(['delta'])
  })

  it('a receipt re-walks a waiting visited page within 150 ms — not only the page you stand on', async () => {
    const away = ['g4']
    seedPage(away, ['epsilon'])
    makePublic(away, 'epsilon')
    await goTo(away)
    expect(lastLayerAt(away)!.payload.visuals![0]['layerSig']).toBeUndefined()   // placeholder

    // Walk on to another page: g4 stays visited (sticky) and pending.
    seedPage(['g4b'], [])
    await goTo(['g4b'])

    state.available.add(sealOf(away, 'epsilon'))
    const n = layerAt(away).length
    const t0 = performance.now()
    EffectBus.emit('host:receipt', { sig: sealOf(away, 'epsilon') })
    await until(() => layerAt(away).length > n, 1000)
    const landed = lastLayerAt(away)!
    expect(landed.payload.visuals![0]['layerSig']).toBe(sealOf(away, 'epsilon'))
    // 150 ms coalesce + a stubbed walk — far inside the old 2 s debounce +
    // current-page-only re-walk, which never reached a page left behind.
    expect(landed.at - t0).toBeLessThan(600)
  })

  it('domain tags lead with the swarm host and never advertise a loopback host from a public origin', async () => {
    const page = ['g5']
    seedPage(page, ['zeta'])
    makePublic(page, 'zeta')
    state.available.add(sealOf(page, 'zeta'))
    localStorage.setItem('hc:nostrmesh:self-domain', 'hypercomb.io')

    // The self-domain backup is OFF: only the swarm host is named.
    await goTo(page)
    expect(lastLayerAt(page)!.tags.filter(t => t[0] === 'domain')).toEqual([['domain', 'jwize.com']])

    // Self target ON: named after the swarm host.
    state.selfOn = true
    state.props.set('zeta', { accent: 'red' })
    let n = layerAt(page).length
    EffectBus.emit('cell:0000-changed', { cell: 'zeta' })
    await until(() => layerAt(page).length > n)
    expect(lastLayerAt(page)!.tags.filter(t => t[0] === 'domain')).toEqual([['domain', 'jwize.com'], ['domain', 'hypercomb.io']])

    // A loopback relay is unreachable for anyone else — never advertised here.
    state.selfOn = false
    state.swarmHost = 'localhost:7801'
    state.props.set('zeta', { accent: 'teal' })
    n = layerAt(page).length
    EffectBus.emit('cell:0000-changed', { cell: 'zeta' })
    await until(() => layerAt(page).length > n)
    const tags = lastLayerAt(page)!.tags.filter(t => t[0] === 'domain')
    expect(tags).toEqual([])
    for (const p of published) {
      for (const t of p.tags) if (t[0] === 'domain') expect(t[1]).not.toMatch(/localhost|127\.0\.0\.1/)
    }
  })
})

// ── per page: the hosts its tiles went to (jwize 2026-10-07) ──────────────
// A current host-sync answers where each page's tiles go (swarmHostsFor:
// publish domains, else the hosts pool, else a relay that hosts participants)
// and whether a closure is served ON those hosts (isClosureAvailableOn). The
// layer event names exactly them, the gate asks exactly them, and the status
// line says which one and why.

describe('per page: the hosts its tiles went to', () => {
  type Choice = { hosts: string[]; source: string; pending: boolean }
  const pageHosts = new Map<string, Choice>()
  const availableOn = new Map<string, string[]>()
  const current = hostSync as unknown as Record<string, unknown>
  const domainsAt = (page: string[]): string[][] => lastLayerAt(page)!.tags.filter(t => t[0] === 'domain')

  beforeEach(() => {
    pageHosts.clear()
    availableOn.clear()
    current['swarmHostsFor'] = (segments: readonly string[]): Choice =>
      pageHosts.get(segments.join('/')) ?? { hosts: ['hypercomb.com'], source: 'pool', pending: false }
    current['isClosureAvailableOn'] = async (sig: string, _kind: string, _closure: boolean, domains: readonly string[]) =>
      (availableOn.get(sig) ?? []).some(d => domains.includes(d))
    current['warmSwarmHosts'] = () => undefined
  })
  afterEach(() => {
    delete current['swarmHostsFor']
    delete current['isClosureAvailableOn']
    delete current['warmSwarmHosts']
  })

  it('a pool page names hypercomb.com — never the relay it meets at — and tells markPublic the page', async () => {
    const page = ['p1']
    seedPage(page, ['eta'])
    makePublic(page, 'eta')
    availableOn.set(sealOf(page, 'eta'), ['hypercomb.com'])
    await goTo(page)
    expect(domainsAt(page)).toEqual([['domain', 'hypercomb.com']])
    expect(lastLayerAt(page)!.payload.visuals![0]['layerSig']).toBe(sealOf(page, 'eta'))
    expect(JSON.stringify(layerAt(page).map(p => p.tags))).not.toContain('jwize.com')
    expect(shareStatus.at(-1)).toMatchObject({ location: '/p1', host: 'hypercomb.com', hosts: ['hypercomb.com'], hostSource: 'pool' })
    expect(hostSync.markPublic).toHaveBeenCalledWith(sealOf(page, 'eta'), 'layer', false, ['p1'])
  })

  it('a page wearing publish domains names them, and counts as hosted only once THEY serve it', async () => {
    const page = ['p2']
    pageHosts.set('p2', { hosts: ['pointblank.example'], source: 'publish', pending: false })
    seedPage(page, ['theta'])
    makePublic(page, 'theta')
    availableOn.set(sealOf(page, 'theta'), ['hypercomb.com']) // served elsewhere only
    await goTo(page)
    expect(domainsAt(page)).toEqual([['domain', 'pointblank.example']])
    expect(lastLayerAt(page)!.payload.visuals![0]['layerSig']).toBeUndefined()
    expect(shareStatus.at(-1)).toMatchObject({ location: '/p2', host: 'pointblank.example', hostSource: 'publish' })

    availableOn.set(sealOf(page, 'theta'), ['pointblank.example'])
    const n = layerAt(page).length
    EffectBus.emit('host:receipt', { sig: sealOf(page, 'theta'), host: 'pointblank.example', swarm: true })
    await until(() => layerAt(page).length > n, 1000)
    expect(lastLayerAt(page)!.payload.visuals![0]['layerSig']).toBe(sealOf(page, 'theta'))
  })

  it('a page\'s status speaks for its own host: another host\'s refusal is not its reason', async () => {
    const page = ['p4']
    seedPage(page, ['kappa'])
    makePublic(page, 'kappa')
    EffectBus.emit('sync:state', { host: 'jwize.com', state: 'refused', status: 'refused', reason: '403 participants-closed', swarm: true })
    EffectBus.emit('sync:state', { host: 'hypercomb.com', state: 'syncing', status: 'syncing', reason: '', swarm: true })
    await goTo(page)
    expect(shareStatus.at(-1)).toMatchObject({ location: '/p4', host: 'hypercomb.com', hostState: 'syncing' })
  })

  it('nothing hosts a page: names only, no domain named, said as no-host', async () => {
    const page = ['p3']
    pageHosts.set('p3', { hosts: [], source: 'none', pending: false })
    seedPage(page, ['iota'])
    makePublic(page, 'iota')
    availableOn.set(sealOf(page, 'iota'), ['jwize.com'])
    await goTo(page)
    expect(domainsAt(page)).toEqual([])
    expect(lastLayerAt(page)!.payload.visuals![0]['layerSig']).toBeUndefined()
    expect(shareStatus.at(-1)).toMatchObject({ location: '/p3', host: '', hostSource: 'none', hostState: 'no-host' })
  })

  it('a page whose hosts are still being read says NOTHING yet — never the relay meanwhile — and walks when they land', async () => {
    const page = ['p5']
    pageHosts.set('p5', { hosts: [], source: 'none', pending: true })
    seedPage(page, ['lambda'])
    makePublic(page, 'lambda')
    availableOn.set(sealOf(page, 'lambda'), ['jwize.com', 'hypercomb.com'])
    const since = published.length
    state.segments = page
    lineage.dispatchEvent(new Event('change'))
    await new Promise(r => setTimeout(r, 300))
    // Like a cold history read: no slot is written for a page whose hosts are
    // unknown — the relay keeps whatever it had, and no host is guessed.
    expect(layerAt(page)).toEqual([])
    expect(JSON.stringify(published.slice(since).map(p => p.tags))).not.toContain('jwize.com')
    expect(hostSync.markPublic).toHaveBeenCalledWith(sealOf(page, 'lambda'), 'layer', false, ['p5'])

    // The read lands: the page walks, where its bytes go.
    pageHosts.set('p5', { hosts: ['hypercomb.com'], source: 'pool', pending: false })
    EffectBus.emit('swarm:hosts-changed', { at: Date.now() })
    await until(() => layerAt(page).length > 0, 1000)
    expect(domainsAt(page)).toEqual([['domain', 'hypercomb.com']])
    expect(lastLayerAt(page)!.payload.visuals![0]['layerSig']).toBe(sealOf(page, 'lambda'))
  })

  it('hosts going unknown again (a reload\'s first walk) never take back a hosted handle', async () => {
    const page = ['p6']
    seedPage(page, ['mu'])
    makePublic(page, 'mu')
    availableOn.set(sealOf(page, 'mu'), ['hypercomb.com'])
    await goTo(page)
    expect(lastLayerAt(page)!.payload.visuals![0]['layerSig']).toBe(sealOf(page, 'mu'))
    const n = layerAt(page).length

    pageHosts.set('p6', { hosts: [], source: 'none', pending: true })
    EffectBus.emit('cell:0000-changed', { cell: 'mu' })
    await new Promise(r => setTimeout(r, 300))
    // Nothing said while unknown: the slot that holds the hosted entry stands.
    expect(layerAt(page).length).toBe(n)
    for (const p of layerAt(page)) expect(p.payload.visuals![0]['layerSig']).toBe(sealOf(page, 'mu'))
  })

  it('a closure whose deeper page is still being read keeps the hosted entry, not a name', async () => {
    const page = ['p7']
    seedPage(page, ['nu'])
    makePublic(page, 'nu')
    // The per-page gate (isClosureAvailableAt): yes for the first version.
    const verdicts = new Map<string, boolean | null>([[sealOf(page, 'nu'), true]])
    current['isClosureAvailableAt'] = async (sig: string) => (verdicts.has(sig) ? verdicts.get(sig)! : false)
    try {
      await goTo(page)
      expect(lastLayerAt(page)!.payload.visuals![0]['layerSig']).toBe(sealOf(page, 'nu'))

      // An edit whose subtree reaches a page still being read: unknown, for
      // the new version AND (a moment) for the one already hosted.
      state.seal.set('p7/nu', sha('seal:p7/nu:v2'))
      verdicts.set(sha('seal:p7/nu:v2'), null)
      verdicts.set(sha('seal:p7/nu:v1'), null)
      const statusBefore = shareStatus.length
      EffectBus.emit('cell:0000-changed', { cell: 'nu' })
      await until(() => shareStatus.length > statusBefore && shareStatus.at(-1)!['location'] === '/p7')
      for (const p of layerAt(page)) expect(p.payload.visuals![0]['layerSig']).toBe(sha('seal:p7/nu:v1'))
      expect(shareStatus.at(-1)).toMatchObject({ nameOnly: 0 })
    } finally { delete current['isClosureAvailableAt'] }
  })
})
