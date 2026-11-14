// site-manage.replica.spec.ts — the managed site door's card is the page's own
// tile. On the owner's visit the published head comes in as the tile at
// /<lineage> through the ordinary adopt; the frame follows that tile live; a
// newer publish replaces an unedited replica (the old one a step back) and is
// offered over an edited one; the bar says when the tile holds changes the
// site does not, and publishes them behind the consent dialog; the Chat opens
// on the card tile's own conversation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sig = (ch: string): string => ch.repeat(64)
type Layer = { name?: string; [slot: string]: unknown }
type Head = { sig: string; marker: string; layer: Layer }

const hive = vi.hoisted(() => ({
  bytes: new Map<string, string>(),
  heads: new Map<string, { sig: string; marker: string; layer: Record<string, unknown> }>(),
  docs: new Map<string, { bytes: ArrayBuffer; keep?: string }>(),
  commits: [] as Array<{ loc: string; layer: Record<string, unknown>; marker: string | null | undefined }>,
  adopts: [] as Array<[unknown, unknown]>,
  noted: [] as Array<[string, string[]]>,
  deep: [] as Array<[string, unknown]>,
  published: [] as Array<[string, string]>,
  adoptStatus: 'committed' as string,
  adoptLayer: null as Record<string, unknown> | null,
  publishResult: { ok: true, head: 'd'.repeat(64) } as { ok: boolean; head?: string; error?: string },
  publishPort: false,
  staleOnce: false,
  next: 0,
  reads: 0,
  confirm: true,
  emit: null as null | ((name: string, payload: unknown) => void),
}))

vi.hoisted(() => {
  const nextSig = (): string => (++hive.next).toString(16).padStart(64, '0')
  const services: Record<string, unknown> = {
    '@hypercomb.social/Store': {
      getResource: async (s: string) => (hive.bytes.has(s) ? new (globalThis as unknown as { NodeBlob: typeof Blob }).NodeBlob([hive.bytes.get(s)!]) : null),
      getResourceResolvedLocal: async () => null,
      getPool: async (meaning: string) => ({ name: meaning }),
      getPoolDoc: async (pool: { name: string }, subKey?: string) => hive.docs.get(`${pool.name}/${subKey}`)?.bytes ?? null,
      putPoolDoc: async (pool: { name: string }, bytes: ArrayBuffer, subKey?: string, options?: { keep?: string }) => {
        hive.docs.set(`${pool.name}/${subKey}`, { bytes, keep: options?.keep })
        return 'f'.repeat(64)
      },
    },
    '@hypercomb.social/Lineage': {},
    '@diamondcoreprocessor.com/HistoryService': {
      sign: async (lineage: { explorerSegments: () => string[] }) => `loc:/${lineage.explorerSegments().join('/')}`,
      currentLayerAt: async (loc: string) => { hive.reads++; return hive.heads.get(loc)?.layer ?? null },
      warmHeadSigFor: (loc: string) => hive.heads.get(loc)?.sig ?? null,
      headMarkerOf: (loc: string) => hive.heads.get(loc)?.marker ?? null,
      commitLayer: async (loc: string, layer: Record<string, unknown>, base?: { marker?: string | null }) => {
        hive.commits.push({ loc, layer, marker: base?.marker })
        if (hive.staleOnce) { hive.staleOnce = false; throw new Error('the head moved') }
        const held = hive.heads.get(loc)
        if (base?.marker && held && held.marker !== base.marker) throw new Error('the head moved')
        const next = { sig: nextSig(), marker: String(hive.commits.length).padStart(8, '0'), layer }
        hive.heads.set(loc, next)
        hive.emit?.('history:marker-wrote', { lineageSig: loc, markerName: next.marker })
        return next.sig
      },
    },
    '@diamondcoreprocessor.com/SwarmAdoptDrone': {
      adoptResolvedBranch: async (branch: { label: string }, opts: unknown) => {
        hive.adopts.push([branch, opts])
        if (hive.adoptStatus !== 'committed') {
          hive.emit?.('features:outcome', { cell: branch.label, kind: '', ok: false, message: '"business-card" brings code' })
          return hive.adoptStatus
        }
        // The fold re-homes the branch: the local layer is not the publisher's bytes.
        hive.heads.set(`loc:/${branch.label}`, { sig: nextSig(), marker: '00000001', layer: hive.adoptLayer ?? {} })
        return 'committed'
      },
    },
    '@diamondcoreprocessor.com/ContentBrokerDrone': {
      noteDomainsForSig: (s: string, domains: string[]) => { hive.noted.push([s, domains]) },
      adopt: async (s: string, opts: unknown) => { hive.deep.push([s, opts]); return {} },
    },
  }
  const publish = {
    publishRoot: async (lineage: string, layerSig: string) => { hive.published.push([lineage, layerSig]); return hive.publishResult },
  }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => (key === '@hypercomb.social/ManagedPublish' ? (hive.publishPort ? publish : undefined) : services[key]),
    has: (key: string) => key in services,
    list: () => Object.keys(services),
    whenReady: () => { /* noop */ },
  }
})
;(globalThis as unknown as { NodeBlob: unknown }).NodeBlob = (await import('node:buffer')).Blob

const { EffectBus } = await import('@hypercomb/core')
hive.emit = (name, payload) => EffectBus.emit(name, payload)
const { SiteManageElement, SITE_MANAGE_SURFACE, RELIST_MS } = await import('./site-manage.view.js')
const { SITE_REPLICA_POOL, isHusk, lagging, writeReceipt, readReceipt } = await import('./site-replica.js')
if (!customElements.get(SITE_MANAGE_SURFACE)) customElements.define(SITE_MANAGE_SURFACE, SiteManageElement)

const HEAD = sig('1'), NEWER = sig('7'), LOC = 'loc:/business-card'
const PAGE_RECORD = sig('2'), PAGE = sig('a'), LOCAL_RECORD = sig('3'), LOCAL_PAGE = sig('b'), NEWER_RECORD = sig('4'), NEWER_PAGE = sig('c')
const EDIT_RECORD = sig('5'), EDIT_PAGE = sig('e')

const page = (text: string): string => `<!doctype html><html><head></head><body><p>${text}</p></body></html>`
const pageRecord = (htmlSig: string): string => JSON.stringify({ kind: 'visual:website:page', payload: { htmlSig } })
const PUBLISHED: Layer = { name: 'business-card', decorations: [PAGE_RECORD] }
const ADOPTED: Layer = { name: 'business-card', decorations: [LOCAL_RECORD], children: [] }
const NEWER_LAYER: Layer = { name: 'business-card', decorations: [NEWER_RECORD] }
const EDITED: Layer = { name: 'business-card', decorations: [EDIT_RECORD] }

function seed(): void {
  hive.bytes.clear()
  hive.bytes.set(HEAD, JSON.stringify(PUBLISHED))
  hive.bytes.set(NEWER, JSON.stringify(NEWER_LAYER))
  hive.bytes.set(PAGE_RECORD, pageRecord(PAGE)); hive.bytes.set(PAGE, page('the published card'))
  hive.bytes.set(LOCAL_RECORD, pageRecord(LOCAL_PAGE)); hive.bytes.set(LOCAL_PAGE, page('the replica card'))
  hive.bytes.set(NEWER_RECORD, pageRecord(NEWER_PAGE)); hive.bytes.set(NEWER_PAGE, page('the newer card'))
  hive.bytes.set(EDIT_RECORD, pageRecord(EDIT_PAGE)); hive.bytes.set(EDIT_PAGE, page('the edited card'))
}

const record = (head: string | null = HEAD): HTMLScriptElement => {
  const script = document.createElement('script')
  script.id = 'hc-manage'
  script.type = 'application/json'
  script.textContent = JSON.stringify({ lineage: 'business-card', title: 'business-card', head, publisher: 'x' })
  document.head.appendChild(script)
  return script
}
const settle = async (): Promise<void> => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 0)) }
const relisted = async (): Promise<void> => { await new Promise(r => setTimeout(r, RELIST_MS + 50)); await settle() }
const receipt = async () => readReceipt(((window as unknown as { ioc: { get: (k: string) => never } }).ioc.get('@hypercomb.social/Store')), 'business-card')
const holdReplica = (layer: Layer, at = 'aa'): Head => {
  const head = { sig: at.repeat(32), marker: '00000003', layer }
  hive.heads.set(LOC, head)
  return head
}

let element: InstanceType<typeof SiteManageElement>
let script: HTMLScriptElement | null = null
const frame = (): string => (element.querySelector('iframe.sm-frame') as HTMLIFrameElement).srcdoc
const bar = (selector: string): HTMLElement => element.querySelector(selector) as HTMLElement
const note = (): string => element.querySelector('.sm-note span')?.textContent ?? ''

beforeEach(() => {
  seed()
  EffectBus.clear()
  hive.heads.clear(); hive.docs.clear()
  hive.commits.length = 0; hive.adopts.length = 0; hive.noted.length = 0; hive.deep.length = 0; hive.published.length = 0
  hive.adoptStatus = 'committed'; hive.adoptLayer = ADOPTED
  hive.publishResult = { ok: true, head: sig('d') }; hive.publishPort = false; hive.staleOnce = false; hive.confirm = true
  hive.reads = 0
  localStorage.removeItem('hc:synced-publisher-roots')
  EffectBus.on<{ id: string }>('confirm:request', req => { EffectBus.emit('confirm:response', { id: req.id, confirmed: hive.confirm }) })
})
afterEach(() => { element?.remove(); script?.remove(); script = null })

const mount = async (): Promise<void> => {
  element = document.createElement(SITE_MANAGE_SURFACE) as InstanceType<typeof SiteManageElement>
  document.body.appendChild(element)
  await settle()
}

describe('the card comes in on the owner’s visit', () => {
  it('adopts the published head as the tile at /<lineage>, silently, and holds its closure', async () => {
    script = record()
    await mount()
    expect(hive.noted[0]?.[0]).toBe(HEAD)
    expect(hive.noted[0]?.[1]).toContain('localhost')
    expect(hive.adopts).toEqual([[{ layerSig: HEAD, at: [], domain: 'localhost', label: 'business-card' }, { silent: true }]])
    expect(hive.deep).toEqual([[HEAD, { deepResources: true, quiet: true }]])
    // The receipt: taken from HEAD, leaving the adopted (re-homed) layer.
    const kept = await receipt()
    expect(kept).toMatchObject({ published: HEAD, local: hive.heads.get(LOC)!.sig, past: [] })
    expect(hive.docs.get(`${SITE_REPLICA_POOL}/business-card`)?.keep).toBe('current')
    // The frame runs the hive's own tile now, not the published bytes.
    expect(frame()).toContain('the replica card')
    expect(bar('.sm-state').hidden).toBe(true)
  })

  it('treats the empty marker the cursor mints as nothing held', async () => {
    holdReplica({ name: 'business-card' })
    expect(isHusk({ name: 'business-card', decorations: [] })).toBe(true)
    script = record()
    await mount()
    expect(hive.adopts).toHaveLength(1)
  })

  it('says so in the bar when the adopt refuses, with the adopt’s own reason', async () => {
    hive.adoptStatus = 'unavailable'
    script = record()
    await mount()
    expect(bar('.sm-state').hidden).toBe(false)
    expect(bar('.sm-state').textContent).toBe('Your card could not be brought onto this device. "business-card" brings code')
    // The published card still shows while the replica is not here.
    expect(frame()).toContain('the published card')
    expect(await receipt()).toBeNull()
  })

  it('owes the receipt of a deferred adopt, and pays it when the tile lands', async () => {
    hive.adoptStatus = 'unavailable'
    script = record()
    await mount()
    holdReplica(ADOPTED, 'ab')
    EffectBus.emit('history:marker-wrote', { lineageSig: LOC, markerName: '00000003' })
    await relisted()
    expect(await receipt()).toMatchObject({ published: HEAD, local: 'ab'.repeat(32) })
    expect(bar('.sm-state').hidden).toBe(true)
    expect(frame()).toContain('the replica card')
  })

  it('does nothing when the replica is the published head’s, as taken', async () => {
    const held = holdReplica(ADOPTED)
    script = record()
    await writeReceipt(window.ioc.get('@hypercomb.social/Store') as never, 'business-card', HEAD, held.sig)
    await mount()
    expect(hive.adopts).toEqual([])
    expect(hive.commits).toEqual([])
    expect(frame()).toContain('the replica card')
    expect(bar('.sm-state').hidden).toBe(true)
    expect(bar('.sm-use-newer').hidden).toBe(true)
  })

  it('baselines a replica SwarmAdopt took before this page kept receipts', async () => {
    const held = holdReplica(ADOPTED)
    localStorage.setItem('hc:synced-publisher-roots', JSON.stringify({ 'business-card': HEAD }))
    script = record()
    await mount()
    expect(hive.commits).toEqual([])
    expect(await receipt()).toMatchObject({ published: HEAD, local: held.sig })
    expect(bar('.sm-state').hidden).toBe(true)
  })
})

describe('a newer publish', () => {
  it('replaces an unedited replica, guarded on its head, the old one a step back', async () => {
    const held = holdReplica(ADOPTED)
    await writeReceipt(window.ioc.get('@hypercomb.social/Store') as never, 'business-card', HEAD, held.sig)
    script = record(NEWER)
    await mount()
    expect(hive.commits).toHaveLength(1)
    expect(hive.commits[0]).toEqual({ loc: LOC, layer: NEWER_LAYER, marker: held.marker })
    const kept = await receipt()
    expect(kept).toMatchObject({ published: NEWER, local: hive.heads.get(LOC)!.sig, past: [HEAD] })
    expect(hive.deep.map(([s]) => s)).toContain(NEWER)
    await relisted()
    expect(frame()).toContain('the newer card')
    expect(bar('.sm-state').hidden).toBe(true)
  })

  it('never drops local edits: it offers the newer card, and Use it takes it', async () => {
    holdReplica(EDITED, 'ee')
    await writeReceipt(window.ioc.get('@hypercomb.social/Store') as never, 'business-card', HEAD, 'aa'.repeat(32))
    script = record(NEWER)
    await mount()
    expect(hive.commits).toEqual([])
    expect(frame()).toContain('the edited card')
    expect(bar('.sm-state').textContent).toBe('A newer card is published.')
    const use = bar('.sm-use-newer') as HTMLButtonElement
    expect(use.hidden).toBe(false)
    expect(use.textContent).toBe('Use it')
    use.click()
    await settle()
    expect(hive.commits).toEqual([{ loc: LOC, layer: NEWER_LAYER, marker: '00000003' }])
    await relisted()
    expect(frame()).toContain('the newer card')
    expect(bar('.sm-state').hidden).toBe(true)
    expect(use.hidden).toBe(true)
  })

  it('says so when another tab moved the head under Use it, and keeps the offer', async () => {
    holdReplica(EDITED, 'ee')
    await writeReceipt(window.ioc.get('@hypercomb.social/Store') as never, 'business-card', HEAD, 'aa'.repeat(32))
    script = record(NEWER)
    await mount()
    hive.staleOnce = true
    ;(bar('.sm-use-newer') as HTMLButtonElement).click()
    await settle()
    expect(note()).toBe('The newer card could not be taken. the head moved')
    expect(bar('.sm-use-newer').hidden).toBe(false)
    expect(frame()).toContain('the edited card')
  })

  it('never takes back a head this replica moved past (a page record lagging a publish)', async () => {
    const held = holdReplica(ADOPTED)
    const store = window.ioc.get('@hypercomb.social/Store') as never
    const first = await writeReceipt(store, 'business-card', HEAD, held.sig)
    await writeReceipt(store, 'business-card', NEWER, held.sig, first)
    expect(lagging(await receipt(), HEAD)).toBe(true)
    script = record(HEAD)
    await mount()
    expect(hive.commits).toEqual([])
    expect(bar('.sm-state').hidden).toBe(true)
  })
})

describe('the frame follows the replica live', () => {
  it('re-runs the card when a marker lands at its location, and only there', async () => {
    const held = holdReplica(ADOPTED)
    await writeReceipt(window.ioc.get('@hypercomb.social/Store') as never, 'business-card', HEAD, held.sig)
    script = record()
    await mount()
    expect(frame()).toContain('the replica card')
    // An edit elsewhere in the hive is not the card.
    hive.heads.set(LOC, { sig: 'ee'.repeat(32), marker: '00000004', layer: EDITED })
    EffectBus.emit('history:marker-wrote', { lineageSig: 'loc:/elsewhere', markerName: '00000009' })
    await relisted()
    expect(frame()).toContain('the replica card')
    // The chat's edit at the card's location shows as it lands…
    EffectBus.emit('history:marker-wrote', { lineageSig: LOC, markerName: '00000004' })
    await relisted()
    expect(frame()).toContain('the edited card')
    // …and is a change the site does not have yet.
    expect(bar('.sm-state').textContent).toBe('Unpublished changes')
  })

  it('follows another tab’s move too, and stops listening once it is gone', async () => {
    const held = holdReplica(ADOPTED)
    await writeReceipt(window.ioc.get('@hypercomb.social/Store') as never, 'business-card', HEAD, held.sig)
    script = record()
    await mount()
    hive.heads.set(LOC, { sig: 'ee'.repeat(32), marker: '00000004', layer: EDITED })
    EffectBus.emitTransient('history:head-external', { lineageSig: LOC })
    await relisted()
    expect(frame()).toContain('the edited card')
    element.remove()
    const before = hive.reads
    EffectBus.emit('history:marker-wrote', { lineageSig: LOC, markerName: '00000005' })
    await relisted()
    expect(hive.reads).toBe(before)
  })
})

describe('publishing from the card', () => {
  const edited = async (): Promise<void> => {
    holdReplica(EDITED, 'ee')
    await writeReceipt(window.ioc.get('@hypercomb.social/Store') as never, 'business-card', HEAD, 'aa'.repeat(32))
    script = record(HEAD)
  }

  it('shows Unpublished changes, and Publish only once the page’s publish port is here', async () => {
    await edited()
    await mount()
    expect(bar('.sm-state').textContent).toBe('Unpublished changes')
    expect(bar('.sm-publish').hidden).toBe(true)
    hive.publishPort = true
    EffectBus.emit('history:marker-wrote', { lineageSig: LOC, markerName: '00000003' })
    await relisted()
    expect(bar('.sm-publish').hidden).toBe(false)
    expect(bar('.sm-publish').textContent).toBe('Publish')
  })

  it('asks first, then publishes the replica’s head, and says it is live', async () => {
    hive.publishPort = true
    await edited()
    await mount()
    const asked: Array<{ title?: string; messageParams?: unknown }> = []
    EffectBus.on<{ title?: string; messageParams?: unknown }>('confirm:request', req => { asked.push(req) })
    asked.length = 0
    ;(bar('.sm-publish') as HTMLButtonElement).click()
    await settle()
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ title: 'site-manage.publish-confirm.title', messageParams: { title: 'business-card' } })
    expect(hive.published).toEqual([['business-card', 'ee'.repeat(32)]])
    expect(note()).toBe('Your card is live.')
    expect(bar('.sm-state').hidden).toBe(true)
    expect(bar('.sm-publish').hidden).toBe(true)
    // The page record still names HEAD until it reloads: the receipt says the
    // replica moved past it, so a lagging record never takes it back.
    expect(await receipt()).toMatchObject({ published: sig('d'), local: 'ee'.repeat(32) })
    expect((await receipt())?.past).toContain(HEAD)
  })

  it('publishes nothing on a no', async () => {
    hive.publishPort = true
    hive.confirm = false
    await edited()
    await mount()
    ;(bar('.sm-publish') as HTMLButtonElement).click()
    await settle()
    expect(hive.published).toEqual([])
    expect(bar('.sm-state').textContent).toBe('Unpublished changes')
  })

  it('says why a publish did not complete', async () => {
    hive.publishPort = true
    hive.publishResult = { ok: false, error: 'the key is not listed' }
    await edited()
    await mount()
    ;(bar('.sm-publish') as HTMLButtonElement).click()
    await settle()
    expect(note()).toBe('The publish did not complete. the key is not listed')
    expect(bar('.sm-state').textContent).toBe('Unpublished changes')
  })
})

describe('the chat', () => {
  it('opens on the card tile’s own conversation', async () => {
    script = record()
    await mount()
    const asked: unknown[] = []
    const off = EffectBus.on('chat:open', p => asked.push(p))
    ;(element.querySelector('.sm-chat') as HTMLButtonElement).click()
    off()
    expect(asked).toEqual([{ convoId: 'chat:tile:/business-card' }])
  })
})
