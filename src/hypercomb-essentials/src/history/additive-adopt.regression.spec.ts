// @vitest-environment jsdom
//
// history/additive-adopt.regression.spec.ts — THE 'susan' INCIDENT, EXERCISED.
//
// jwize's mother's hive has a tile 'susan' with her own content (children,
// a note, a properties bag wearing her picture). jwize adopted HIS newer
// 'susan' (same name, different layer sigs, newer content) onto her machine
// and ALL her content was replaced by his version.
//
// The rule: tiles are only ADDITIVE and every commit starts from the layer we
// left off with (her current head). Her values win on conflict; his newer
// content only ADDS.
//
// This is a BEHAVIOURAL test. It drives the REAL HistoryService and the REAL
// LayerCommitter over an in-memory OPFS, authors hive A (hers) and hive B
// (his) through the same writers the app uses, lands B's layer closure on
// A's disk (what the broker does), and then runs EVERY entry that can bring a
// same-named tile onto an owned one:
//
//   - SwarmAdoptDrone fold mode        (resume of a legacy pending fold)
//   - SwarmAdoptDrone sync mode        (adoptResolvedBranch, the explicit gesture)
//   - SwarmAdoptDrone sync, auto       (syncResolvedBranch, the receiver refresh)
//   - SwarmAdoptDrone mesh adopt       (tile:action adopt on a held tile)
//   - SwarmAdoptDrone static sync      (tile:action sync, a public host's offer)
//   - hive-visit / adopt-branch / example-hives (all end in adoptResolvedBranch)
//   - clipboard paste of a same-named tile
//   - image paste / intake onto an existing tile
//
// After each: all of her children (a, b) still resolve through the parent
// head, her note / picture / properties are unchanged, his additions (c) are
// present where the entry adds at all, no orphan is left behind, and a SECOND
// run is idempotent (no new marker anywhere).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, SignatureService } from '@hypercomb/core'

const textOf = vi.hoisted(() => (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => resolve(String(reader.result))
  reader.readAsText(blob)
}))

vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => {}, get: () => undefined, whenReady: () => {},
  }
})

// A canvas does not exist in jsdom: the image pipeline's two pixel steps are
// stubbed with bytes derived from the input, everything else is real.
vi.mock('../editor/arm-resource.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../editor/arm-resource.js')
  return {
    ...actual,
    largeImage: async (blob: Blob) => ({ blob: new Blob([`large:${await textOf(blob)}`], { type: 'image/webp' }) }),
  }
})
vi.mock('../editor/resource-thumbnail.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../editor/resource-thumbnail.js')
  return {
    ...actual,
    generateHexThumbnails: async (blob: Blob) => ({
      pointBlob: new Blob([`point:${await textOf(blob)}`], { type: 'image/webp' }),
      flatBlob: new Blob([`flat:${await textOf(blob)}`], { type: 'image/webp' }),
    }),
  }
})

// ── in-memory OPFS ─────────────────────────────────────────────────────

class MemoryFile {
  readonly kind = 'file'
  bytes = new Uint8Array()
  constructor(readonly name: string) {}
  async getFile(): Promise<File> {
    const exact = this.bytes.slice().buffer
    return Object.assign(new Blob([exact]), {
      name: this.name, lastModified: 1,
      arrayBuffer: async () => exact,
      text: async () => new TextDecoder().decode(exact),
    }) as File
  }
  async createWritable() {
    return {
      write: async (value: ArrayBuffer | Uint8Array | string) => {
        this.bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
      },
      close: async () => {},
      abort: async () => {},
    }
  }
}

class MemoryDirectory {
  readonly kind = 'directory'
  readonly files = new Map<string, MemoryFile>()
  readonly dirs = new Map<string, MemoryDirectory>()
  constructor(readonly name = '') {}
  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    if (this.dirs.has(name)) throw new DOMException('Directory at file address', 'TypeMismatchError')
    let file = this.files.get(name)
    if (!file) {
      if (!options.create) throw new DOMException('File absent', 'NotFoundError')
      this.files.set(name, file = new MemoryFile(name))
    }
    return file
  }
  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    if (this.files.has(name)) throw new DOMException('File at directory address', 'TypeMismatchError')
    let directory = this.dirs.get(name)
    if (!directory) {
      if (!options.create) throw new DOMException('Directory absent', 'NotFoundError')
      this.dirs.set(name, directory = new MemoryDirectory(name))
    }
    return directory
  }
  async removeEntry(name: string) {
    if (!this.files.delete(name) && !this.dirs.delete(name)) throw new DOMException('Absent', 'NotFoundError')
  }
  async *entries() {
    for (const entry of [...this.files]) yield entry
    for (const entry of [...this.dirs]) yield entry
  }
}

// ── the world ──────────────────────────────────────────────────────────

const services = new Map<string, unknown>()
const get = (key: string) => services.get(key)
;(globalThis as Record<string, unknown>)['get'] = get
;(window as unknown as { ioc: unknown }).ioc = {
  get, whenReady: () => {}, register: (key: string, value: unknown) => services.set(key, value),
}

const RealChannel = globalThis.BroadcastChannel
const opened: { close(): void }[] = []
class MuteChannel {
  constructor(_name: string) {}
  postMessage(): void {}
  set onmessage(_handler: unknown) {}
  close(): void {}
}
const withMute = <T>(make: () => T): T => {
  ;(globalThis as Record<string, unknown>)['BroadcastChannel'] = MuteChannel
  try { return make() } finally { (globalThis as Record<string, unknown>)['BroadcastChannel'] = RealChannel }
}

const readBlob = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => resolve(reader.result as ArrayBuffer)
  reader.readAsArrayBuffer(blob)
})

const { HistoryService, ROOT_NAME } = await import('./history.service.js')
const { LayerCommitter } = await import('./layer-committer.drone.js')
const { resolveLayerAt, childLayerOf, childNamesOfStrict } = await import('./layer-placement.js')
const { writeTilePropertiesAt, readOwnTilePropertiesAt } = await import('../editor/tile-properties.js')
const { SwarmAdoptDrone } = await import('../sharing/swarm-adopt.drone.js')
const { ClipboardWorker } = await import('../clipboard/clipboard.worker.js')
const { ClipboardService } = await import('../clipboard/clipboard.service.js')
const { holdImagesOnTile, replaceWornPicture } = await import('../sharing/tile-image-intake.js')

type History = InstanceType<typeof HistoryService>
type Layer = { name?: string; children?: string[]; [slot: string]: unknown }

/** ONE committer for the file (it subscribes to the bus forever). */
const committer = new LayerCommitter()
const adoptDrone = services.get('@diamondcoreprocessor.com/SwarmAdoptDrone') as InstanceType<typeof SwarmAdoptDrone>
const clipboardWorker = services.get('@diamondcoreprocessor.com/ClipboardWorker') as InstanceType<typeof ClipboardWorker>
void clipboardWorker

type World = { root: MemoryDirectory; history: History; store: Record<string, unknown> }

let peers: { current: Record<string, unknown>[]; byLoc: Map<string, Record<string, unknown>[]>; statics: Record<string, unknown>[] }
let brokerFailed = 0
/** The page the participant is standing on (the lineage's explorer segments). */
let standingAt: string[] = []

/** The root of the world under test - what settleLong watches go quiet. */
let liveRoot: MemoryDirectory | null = null

const world = async (): Promise<World> => {
  // Every HistoryService ever built in this file still holds a 1.5s debounced
  // head-index write and a pagehide listener. Flush them NOW (pagehide), then
  // clear: otherwise a previous world's timer fires mid-test and plants ITS
  // lineage->sig entries (same lineage, same marker number, different content)
  // in this world's localStorage, where a fresh HistoryService restores and
  // trusts them (the validation is filename-only) - the source of the
  // 'cold head committed over' flake.
  window.dispatchEvent(new Event('pagehide'))
  localStorage.clear()
  const root = new MemoryDirectory()
  liveRoot = root
  const clipboardDir = new MemoryDirectory()
  const store: Record<string, unknown> = {
    hypercombRoot: root, opfsRoot: root, clipboard: clipboardDir,
    getLayerPoolBytes: async (sig: string) => root.files.get(sig)?.bytes ?? null,
    getResourceLocal: async (sig: string) => root.files.get(sig)?.getFile() ?? null,
    // The real Store follows a meta envelope to its payload (store.ts #getResolvedResource).
    getResource: async (sig: string): Promise<Blob | null> => {
      let at = sig
      for (let hop = 0; hop < 8; hop++) {
        const file = root.files.get(at)
        if (!file) return null
        const blob = await file.getFile()
        if (blob.size > 64 * 1024) return blob
        try {
          const parsed = JSON.parse(await textOf(blob)) as { meta?: unknown; resource?: unknown }
          if (parsed && parsed.meta === 1 && typeof parsed.resource === 'string') { at = parsed.resource; continue }
        } catch { /* not JSON: raw bytes */ }
        return blob
      }
      return null
    },
    writeLayerBytes: async (sig: string, bytes: ArrayBuffer) => {
      const file = await root.getFileHandle(sig, { create: true })
      file.bytes = new Uint8Array(bytes)
    },
    fetchLayerFromHost: async () => null,
    putResource: async (blob: Blob) => {
      const bytes = await readBlob(blob)
      const sig = await SignatureService.sign(bytes)
      const file = await root.getFileHandle(sig, { create: true })
      file.bytes = new Uint8Array(bytes)
      return sig
    },
  }
  services.set('@hypercomb.social/Store', store)
  services.set('@hypercomb.social/Lineage', { explorerSegments: () => standingAt, domain: () => 'test.example' })
  const history = withMute(() => new HistoryService())
  services.set('@diamondcoreprocessor.com/HistoryService', history)
  services.set('@diamondcoreprocessor.com/LayerCommitter', committer)
  services.set('@diamondcoreprocessor.com/HistoryCursorService', {
    state: { rewound: false }, onNewLayer: async () => {},
  })
  services.set('@diamondcoreprocessor.com/ClipboardService', new ClipboardService())
  peers = { current: [], byLoc: new Map(), statics: [] }
  brokerFailed = 0
  services.set('@diamondcoreprocessor.com/ContentBrokerDrone', {
    adopt: async () => ({ layers: 1, leaves: 0, failed: brokerFailed }),
    noteDomainsForSig: () => {},
    getKnownDomains: () => [],
  })
  services.set('@diamondcoreprocessor.com/SwarmDrone', {
    peerTilesAtCurrentSig: () => peers.current,
    subscribedTiles: () => [],
    peerTilesAtSig: (sig: string) => peers.byLoc.get(sig) ?? [],
    composeSigForSegments: async (segs: readonly string[]) => 'peer:' + segs.join('/'),
  })
  services.set('@diamondcoreprocessor.com/StaticPeersDrone', {
    peerEntriesAt: () => peers.statics,
  })
  return { root, history, store }
}

afterEach(() => { for (const channel of opened.splice(0)) channel.close() })

// ── authoring, through the app's own writers ───────────────────────────

const putText = async (w: World, text: string): Promise<string> =>
  (w.store['putResource'] as (b: Blob) => Promise<string>)(new Blob([text], { type: 'text/plain' }))

type Spec = {
  kids: string[]
  note: string
  picture: string          // text of the "image"; its sig is what the bag carries
  props: Record<string, unknown>
  /** One level DOWN: a note on a child, and grandchildren under a child. */
  kidNotes: Record<string, string>
  grand: Record<string, string[]>
}

/** Make the page `at` exist (each ancestor a real tile), as a create would. */
const ensurePage = async (at: readonly string[]): Promise<void> => {
  for (let i = 0; i < at.length; i++) {
    await committer.importTree([{ segments: at.slice(0, i + 1), layer: { name: at[i] } }])
  }
}

/** Author a 'susan' tile on the page `at` of the CURRENT world. */
const author = async (w: World, spec: Spec, at: readonly string[]): Promise<string> => {
  await ensurePage(at)
  const here = [...at, 'susan']
  await committer.importTree([
    { segments: here, layer: { name: 'susan', children: spec.kids } },
    ...spec.kids.map(k => ({ segments: [...here, k], layer: { name: k, ...(spec.grand[k] ? { children: spec.grand[k] } : {}) } })),
    ...Object.entries(spec.grand).flatMap(([k, gs]) => gs.map(g => ({ segments: [...here, k, g], layer: { name: g } }))),
  ])
  for (const [k, text] of Object.entries(spec.kidNotes)) await committer.commitSlotSet([...here, k], 'notes', [await putText(w, text)])
  const noteSig = await putText(w, spec.note)
  await committer.commitSlotSet(here, 'notes', [noteSig])
  const pic = await putText(w, spec.picture)
  await writeTilePropertiesAt([...at], 'susan', {
    large: { image: pic }, small: { image: pic }, imageSig: pic, participant: true, ...spec.props,
  }, { onlyHere: true })
  const loc = await w.history.sign({ explorerSegments: () => here })
  return w.history.latestMarkerSigFor(loc, 'susan')
}

const HERS: Spec = {
  kids: ['a', 'b'], note: 'her note: susan likes tea', picture: 'her picture',
  props: { caption: 'hers', herOnly: 'yes' },
  kidNotes: { b: 'her b note' }, grand: { a: ['a1'], b: ['b0'] },
}
const HIS: Spec = {
  kids: ['b', 'c'], note: 'his note: newer, different', picture: 'his picture (newer)',
  props: { caption: 'his', website: 'https://his.example' },
  kidNotes: { b: 'his b note' }, grand: { b: ['b1'], c: ['c1'] },
}

const filesOf = (w: World): Map<string, Uint8Array> => {
  const files = new Map<string, Uint8Array>()
  for (const [name, f] of w.root.files) files.set(name, f.bytes.slice())
  return files
}
const landFiles = async (w: World, files: Map<string, Uint8Array>): Promise<void> => {
  for (const [name, bytes] of files) {
    if (w.root.files.has(name)) continue
    const f = await w.root.getFileHandle(name, { create: true })
    f.bytes = bytes.slice()
  }
}

/** A susan authored in a world of its own: its head sig and layer closure
 *  (every sig-named file at the root) - what a broker lands on another disk. */
const authorElsewhere = async (spec: Spec): Promise<{ sig: string; files: Map<string, Uint8Array> }> => {
  standingAt = []
  const w = await world()
  const head = await author(w, spec, [])
  // PUBLISH it as a publisher does: seal the live heads into one merkle root (a
  // deep edit leaves the page's own listing stale by design; sealing is what
  // folds the live heads back into a closure a reader can walk).
  const sig = (await w.history.sealSubtree(['susan'])) ?? head
  return { sig, files: filesOf(w) }
}

type Scenario = { name: string; at: string[]; bagless: boolean }
type Ctx = { w: World; at: string[]; here: string[]; bSig: string; aSig: string; picA: string; picB: string }

const sigOfText = (t: string): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode(t).buffer as ArrayBuffer)

/** Hive A (hers) authored on page `at`, then B's closure landed beside it.
 *  bagless: her susan exists ONLY as a sig her page lists (a paste or an
 *  earlier adopt) - it has never had a bag of its own. */
const setUp = async (sc: Scenario): Promise<Ctx> => {
  const b = await authorElsewhere(HIS)
  const hers = sc.bagless ? await authorElsewhere(HERS) : null
  standingAt = [...sc.at]
  const w = await world()
  let aSig: string
  if (hers) {
    await landFiles(w, hers.files)
    await ensurePage(sc.at)
    await committer.commitChildrenDeltas(sc.at, { appends: [hers.sig] })
    aSig = hers.sig
  } else {
    aSig = await author(w, HERS, sc.at)
  }
  await landFiles(w, b.files)
  return { w, at: [...sc.at], here: [...sc.at, 'susan'], bSig: b.sig, aSig, picA: await sigOfText(HERS.picture), picB: await sigOfText(HIS.picture) }
}

// ── observation ─────────────────────────────────────────────────────────

type Seen = {
  parentChildren: string[]          // names the PAGE head lists
  susan: Layer | null               // susan as the renderer reaches it: own head, else the page's listing
  kids: string[]                    // names susan's listed children resolve to
  coldKids: number
  props: Record<string, unknown>
  noteText: string[]
  bags: string                      // every bag's marker names - the "no new marker" fingerprint
}

const bagsFingerprint = (root: MemoryDirectory): string => {
  const out: string[] = []
  for (const [name, dir] of root.dirs) out.push(`${name}:${[...dir.files.keys()].sort().join(',')}`)
  return out.sort().join('|')
}

const markersOf = (root: MemoryDirectory): Map<string, string[]> =>
  new Map([...root.dirs].map(([name, dir]) => [name, [...dir.files.keys()].sort()]))

const domainOf = () => 'test.example'

const observe = async (c: Ctx): Promise<Seen> => {
  const { w } = c
  const page = await resolveLayerAt(w.history as never, domainOf, c.at) as Layer | null
  const parentChildren: string[] = []
  for (const s of page?.children ?? []) {
    const n = (await w.history.getLayerBySig(s))?.name
    if (n) parentChildren.push(n)
  }
  const susan = await resolveLayerAt(w.history as never, domainOf, c.here) as Layer | null
  const strict = await childNamesOfStrict(w.history as never, susan as never)
  const props = await readOwnTilePropertiesAt(c.at, 'susan')
  const noteText: string[] = []
  for (const sig of (susan?.['notes'] as string[] | undefined) ?? []) {
    const blob = await (w.store['getResource'] as (s: string) => Promise<Blob | null>)(sig)
    noteText.push(blob ? await textOf(blob) : '(cold)')
  }
  return {
    parentChildren, susan, kids: strict.names.slice().sort(), coldKids: strict.coldMiss ? 1 : 0,
    props, noteText, bags: bagsFingerprint(w.root),
  }
}

/** What a child shows one level down: its grandchildren's names and its notes' text. */
const deepOf = async (c: Ctx, name: string): Promise<{ kids: string[]; notes: string[] }> => {
  const layer = await resolveLayerAt(c.w.history as never, domainOf, [...c.here, name]) as Layer | null
  const strict = await childNamesOfStrict(c.w.history as never, layer as never)
  const notes: string[] = []
  for (const sig of (layer?.['notes'] as string[] | undefined) ?? []) {
    const blob = await (c.w.store['getResource'] as (s: string) => Promise<Blob | null>)(sig)
    notes.push(blob ? await textOf(blob) : '(cold)')
  }
  return { kids: strict.names.slice().sort(), notes }
}

/** Every invariant that must hold after ANY entry, however much it adds. */
const assertHers = async (c: Ctx, label: string, opts: { expectAdds: boolean }): Promise<Seen> => {
  const seen = await observe(c)
  const why = (m: string) => `[${label}] ${m}`
  expect(seen.parentChildren, why('susan still listed by her page head')).toContain('susan')
  expect(seen.susan, why('susan resolves through the parent head')).not.toBeNull()
  // ALL of her children still resolve through the parent head.
  expect(seen.coldKids, why('every child of susan resolves')).toBe(0)
  expect(seen.kids, why('her children a and b survive')).toEqual(expect.arrayContaining(['a', 'b']))
  // Her note, picture and properties are unchanged.
  expect(seen.noteText, why('her note is still there')).toContain(HERS.note)
  expect(seen.props['caption'], why('her caption wins the conflict')).toBe('hers')
  expect(seen.props['herOnly'], why('her own property survives')).toBe('yes')
  expect((seen.props['large'] as { image?: string } | undefined)?.image, why('her picture is still worn')).toBe(c.picA)
  expect((seen.props['small'] as { image?: string } | undefined)?.image, why('her small picture')).toBe(c.picA)
  expect(seen.props['imageSig'], why('her imageSig')).toBe(c.picA)
  // One level down, hers survives too.
  const a = await deepOf(c, 'a'), b = await deepOf(c, 'b')
  expect(a.kids, why('her grandchild a1 survives')).toContain('a1')
  expect(b.kids, why('her grandchild b0 survives')).toContain('b0')
  expect(b.notes, why('her note on b survives')).toContain('her b note')
  // His additions arrive where the entry adds at all.
  if (opts.expectAdds) {
    const cc = await deepOf(c, 'c')
    expect(b.kids, why('his grandchild b1 is added under b')).toContain('b1')
    expect(b.notes, why('his note on b is added beside hers')).toContain('his b note')
    expect(cc.kids, why('his grandchild c1 is added under c')).toContain('c1')
    expect(seen.kids, why('his child c is added')).toContain('c')
    expect(seen.props['website'], why('his property is added')).toBe('https://his.example')
    expect(seen.noteText, why('his note is added beside hers')).toContain(HIS.note)
  }
  // NO ORPHAN: a tile that has a head of its own is a tile her susan lists.
  for (const name of ['a', 'b', 'c']) {
    const loc = await c.w.history.sign({ explorerSegments: () => [...c.here, name] })
    const own = await c.w.history.currentLayerAt(loc) as Layer | null
    if (own) expect(seen.kids, why(`tile ${name} has a head, so her susan lists it (no orphan)`)).toContain(name)
  }
  // ...and every listed child resolves to the tile of that name.
  for (const name of seen.kids) {
    const eff = await resolveLayerAt(c.w.history as never, domainOf, [...c.here, name]) as Layer | null
    expect(eff?.name, why(`child ${name} resolves`)).toBe(name)
  }
  return seen
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)) }
// Detached work (a mesh adopt's fold, a paste's commit cascade) takes a load-
// dependent time, so a fixed sleep is a coin flip on a busy worker. Wait until the
// store has stopped changing (markers + files) for several consecutive ticks.
const storeShape = (): string => {
  const root = liveRoot
  return root ? `${root.files.size}|${bagsFingerprint(root)}` : ''
}
const settleLong = async () => {
  await settle()
  await new Promise(r => setTimeout(r, 60))
  let last = storeShape()
  for (let calm = 0, spent = 0; calm < 4 && spent < 8_000; spent += 50) {
    await new Promise(r => setTimeout(r, 50))
    const now = storeShape()
    calm = now === last ? calm + 1 : 0
    last = now
  }
  await settle()
}

const branchOf = (c: Ctx) => ({ layerSig: c.bSig, at: [...c.at], label: 'susan' })

beforeEach(() => { vi.useRealTimers() })

// ════════════════════════════════════════════════════════════════════════

const SCENARIOS: Scenario[] = [
  { name: 'on the root page, susan has her own bag', at: [], bagless: false },
  { name: 'on a deeper page (home), susan has her own bag', at: ['home'], bagless: false },
  { name: 'on the root page, susan only exists as a sig her page lists (no bag)', at: [], bagless: true },
  { name: 'on a deeper page (home), susan only exists as a sig her page lists (no bag)', at: ['home'], bagless: true },
]

describe.each(SCENARIOS)('the susan incident - $name', (sc) => {
  it('SANITY: the harness really built two divergent susans', async () => {
    const c = await setUp(sc)
    expect(c.bSig).not.toBe(c.aSig)
    const a = await assertHers(c, 'before anything', { expectAdds: false })
    expect(a.kids).toEqual(['a', 'b'])
    expect(a.noteText).toEqual([HERS.note])
    const b = await c.w.history.getLayerBySig(c.bSig)
    expect(b?.name).toBe('susan')
    expect((b?.children as string[]).length).toBe(2)
  })

  it('sync mode: adoptResolvedBranch (the explicit adopt gesture; adopt-branch / hive-visit / example-hives all end here)', async () => {
    const c = await setUp(sc)
    const res = await adoptDrone.adoptResolvedBranch(branchOf(c), { silent: true })
    expect(res).toBe('committed')
    const first = await assertHers(c, 'sync adopt', { expectAdds: true })
    // idempotent: the second adopt writes nothing.
    const again = await adoptDrone.adoptResolvedBranch(branchOf(c), { silent: true })
    expect(['committed', 'exists']).toContain(again)
    expect((await observe(c)).bags, 'second adopt mints no marker').toBe(first.bags)
    await assertHers(c, 'sync adopt (2nd)', { expectAdds: true })
  })

  it('sync mode: syncResolvedBranch (the automatic receiver refresh)', async () => {
    const c = await setUp(sc)
    expect(await adoptDrone.syncResolvedBranch(branchOf(c))).toBe('committed')
    const first = await assertHers(c, 'sync refresh', { expectAdds: true })
    await adoptDrone.syncResolvedBranch(branchOf(c))
    expect((await observe(c)).bags, 'second refresh mints no marker').toBe(first.bags)
  })

  it('fold mode: a legacy pending fold resumed by the retry ladder', async () => {
    const c = await setUp(sc)
    vi.useFakeTimers()
    localStorage.setItem('hc:pending-folds', JSON.stringify([{ sig: c.bSig, at: [...c.at] }]))
    const resumed = new SwarmAdoptDrone()
    await vi.advanceTimersByTimeAsync(21_000)
    vi.useRealTimers()
    // A drone subscribes to the global EffectBus for good. Left alive it would
    // answer every later tile:action in this file too, racing the shared drone
    // (and each other) over the same commits - the source of this spec's
    // run-to-run flakes. Retire it and its pending-fold record.
    resumed.markDisposed()
    localStorage.removeItem('hc:pending-folds')
    await settle()
    // FOLD is documented idempotent: a tile already here is left untouched.
    // Her content must be intact; his additions are NOT required of fold.
    await assertHers(c, 'fold', { expectAdds: false })
  })

  it('mesh adopt: tile:action adopt on a held tile (additive, page children only)', async () => {
    const c = await setUp(sc)
    peers.current = [{ name: 'susan', peerPubkey: '1'.repeat(64), layerSig: c.bSig }]
    peers.byLoc.set('peer:' + c.here.join('/'), [
      { name: 'b', peerPubkey: '1'.repeat(64), layerSig: 'e'.repeat(64) },
      { name: 'c', peerPubkey: '1'.repeat(64), layerSig: 'f'.repeat(64), small: { image: c.picB } },
    ])
    EffectBus.emit('tile:action', { action: 'adopt', label: 'susan' })
    await settleLong()
    const first = await assertHers(c, 'mesh adopt', { expectAdds: false })
    expect(first.kids, 'his child c is added').toContain('c')
    EffectBus.emit('tile:action', { action: 'adopt', label: 'susan' })
    await settleLong()
    expect((await observe(c)).bags, 'second mesh adopt mints no marker').toBe(first.bags)
  })

  it('static sync: tile:action sync on a held tile from a public host\'s offer', async () => {
    const c = await setUp(sc)
    peers.statics = [{
      name: 'susan', peerPubkey: '2'.repeat(64), layerSig: c.bSig,
      small: { image: c.picB }, large: { image: c.picB }, imageSig: c.picB, tags: 'his', link: 'https://his.example',
    }]
    EffectBus.emit('tile:action', { action: 'sync', label: 'susan' })
    await settleLong()
    const first = await assertHers(c, 'static sync', { expectAdds: false })
    EffectBus.emit('tile:action', { action: 'sync', label: 'susan' })
    await settleLong()
    expect((await observe(c)).bags, 'second static sync mints no marker').toBe(first.bags)
  })

  it('clipboard paste of a same-named tile onto the one already here', async () => {
    const c = await setUp(sc)
    const svc = services.get('@diamondcoreprocessor.com/ClipboardService') as InstanceType<typeof ClipboardService>
    const paste = async () => {
      svc.captureEntries([{ label: 'susan', sourceSegments: ['elsewhere'], sig: c.bSig }])
      // EffectBus replays the last value to a late subscriber, so a paste-done from
      // an earlier paste/test would resolve this wait before THIS paste ran. Ignore
      // the synchronous replay and unsubscribe when done.
      let live = false
      let off = () => {}
      const done = new Promise<void>(resolve => {
        off = EffectBus.on('clipboard:paste-done', () => { if (live) resolve() })
      })
      live = true
      EffectBus.emit('controls:action', { action: 'paste', targetSegments: [...c.at] })
      await done
      off()
      await settleLong()
    }
    await paste()
    const first = await assertHers(c, 'clipboard paste', { expectAdds: true })
    await paste()
    expect((await observe(c)).bags, 'second paste mints no marker').toBe(first.bags)
  })

  it('image intake onto an existing tile: hold keeps her picture, children and note', async () => {
    const c = await setUp(sc)
    await holdImagesOnTile(c.at, 'susan', [new Blob(['a new picture'], { type: 'image/png' })])
    await settle()
    await assertHers(c, 'image hold', { expectAdds: false })
  })

  it('image intake onto an existing tile: replacing the worn picture keeps everything else', async () => {
    const c = await setUp(sc)
    await replaceWornPicture(c.at, 'susan', new Blob(['a replacement'], { type: 'image/png' }))
    await settle()
    const seen = await observe(c)
    // The picture is replaced on purpose (the participant's own gesture); every
    // other thing she owns is untouched.
    expect(seen.kids).toEqual(expect.arrayContaining(['a', 'b']))
    expect(seen.noteText).toContain(HERS.note)
    expect(seen.props['caption']).toBe('hers')
    expect(seen.props['herOnly']).toBe('yes')
    expect(seen.coldKids).toBe(0)
    expect((seen.props['large'] as { image?: string } | undefined)?.image).not.toBe(c.picA)
  })
})

describe('the susan incident - a head that cannot be read yet is never overwritten', () => {
  it('sync refuses (and defers) when her own head is cold, and changes nothing', async () => {
    const c = await setUp({ name: 'cold', at: [], bagless: false })
    await assertHers(c, 'before', { expectAdds: false })
    const before = markersOf(c.w.root)
    // Her susan's head bytes are not local (a restored, un-warmed pool): the
    // sig is known, the bytes are not.
    const loc = await c.w.history.sign({ explorerSegments: () => c.here })
    const head = await c.w.history.latestMarkerSigFor(loc, 'susan')
    const file = c.w.root.files.get(head)!
    c.w.root.files.delete(head)
    // A fresh session: nothing parsed in memory, so the missing bytes are really missing.
    // A fresh session restores the head index the old one persisted when it went away.
    window.dispatchEvent(new Event('pagehide'))
    c.w.history = withMute(() => new HistoryService())
    services.set('@diamondcoreprocessor.com/HistoryService', c.w.history)
    const res = await adoptDrone.adoptResolvedBranch(branchOf(c), { silent: true })
    expect(res, 'a cold own head defers instead of overwriting').not.toBe('committed')
    c.w.root.files.set(head, file)
    // Every bag she already had is byte-for-byte the same list of markers. (A
    // location the import only PLANNED to touch may get its empty 00000000 husk
    // before the refusal - that is a name nobody lists, not a marker over hers.)
    const after = markersOf(c.w.root)
    for (const [bag, markers] of before) expect(after.get(bag), `bag ${bag.slice(0, 8)} untouched`).toEqual(markers)
    for (const [bag, markers] of after) if (!before.has(bag)) expect(markers, 'a new bag holds only its empty husk').toEqual(['00000000'])
    await assertHers(c, 'after the refusal', { expectAdds: false })
  })
})
