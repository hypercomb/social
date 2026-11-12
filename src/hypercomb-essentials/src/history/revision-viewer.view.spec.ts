// revision-viewer.view.spec.ts — the revision viewer, rendered over a stand-in
// hive: it opens at a tile's newest version, runs each version's page in a
// sandboxed frame with that version's own data, steps and narrows, follows a
// version written while it is open, and closes on Escape.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sig = (ch: string): string => ch.repeat(64)

;(globalThis as unknown as { NodeBlob: unknown }).NodeBlob = (await import('node:buffer')).Blob

type Layer = { name: string; decorations?: string[] }
const hive = vi.hoisted(() => ({
  versions: [] as Array<{ layerSig: string; at: number; index: number }>,
  layers: new Map<string, unknown>(),
  bytes: new Map<string, string>(),
}))

vi.hoisted(() => {
  const services: Record<string, unknown> = {
    '@diamondcoreprocessor.com/HistoryService': {
      sign: async () => 'location-of-the-tile',
      listLayers: async () => hive.versions.slice(),
      getLayerBySig: async (s: string) => hive.layers.get(s) ?? null,
    },
    '@hypercomb.social/Store': {
      // Node's Blob: jsdom's has no arrayBuffer(), which every browser's has.
      getResource: async (s: string) => (hive.bytes.has(s) ? new (globalThis as unknown as { NodeBlob: typeof Blob }).NodeBlob([hive.bytes.get(s)!]) : null),
    },
  }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => services[key],
    has: (key: string) => key in services,
    list: () => Object.keys(services),
    whenReady: () => { /* noop */ },
  }
})

const { EffectBus } = await import('@hypercomb/core')
const { RevisionViewerElement, REVISION_VIEWER_SURFACE } = await import('./revision-viewer.view.js')
if (!customElements.get(REVISION_VIEWER_SURFACE)) customElements.define(REVISION_VIEWER_SURFACE, RevisionViewerElement)

const PAGE_OLD = sig('a'), PAGE_NEW = sig('b')

/** A tile of `count` versions: the first `switchAt` show the old page, the rest the new one. */
function seed(count: number, switchAt: number): void {
  hive.versions = []
  hive.layers.clear()
  hive.bytes.clear()
  hive.bytes.set(PAGE_OLD, '<!doctype html><html><head></head><body><p>old page</p></body></html>')
  hive.bytes.set(PAGE_NEW, '<!doctype html><html><head></head><body><p>new page</p></body></html>')
  for (let i = 0; i < count; i++) addVersion(i < switchAt ? PAGE_OLD : PAGE_NEW)
}

function addVersion(page: string): void {
  const i = hive.versions.length
  const n = String(i).padStart(4, '0')
  const pageRecord = `page-${n}`.padEnd(64, '0').replace(/[^0-9a-f]/g, 'c')
  const cardRecord = `card-${n}`.padEnd(64, '0').replace(/[^0-9a-f]/g, 'd')
  const cardData = `data-${n}`.padEnd(64, '0').replace(/[^0-9a-f]/g, 'e')
  hive.bytes.set(pageRecord, JSON.stringify({ kind: 'visual:website:page', payload: { htmlSig: page } }))
  hive.bytes.set(cardRecord, JSON.stringify({ kind: 'card:data', payload: { dataSig: cardData } }))
  hive.bytes.set(cardData, JSON.stringify({ n: `Version ${i}` }))
  const layerSig = `layer-${n}`.padEnd(64, '0').replace(/[^0-9a-f]/g, 'f')
  hive.layers.set(layerSig, { name: 'jaime-weise', decorations: [pageRecord, cardRecord] } satisfies Layer)
  hive.versions.push({ layerSig, at: 1_790_000_000_000 + i * 60_000, index: i })
}

const settle = async (): Promise<void> => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)) }

let viewer: InstanceType<typeof RevisionViewerElement>

beforeEach(() => {
  seed(10, 6)
  viewer = document.createElement(REVISION_VIEWER_SURFACE) as InstanceType<typeof RevisionViewerElement>
  document.body.appendChild(viewer)
})

afterEach(() => {
  viewer.close()
  viewer.remove()
})

const frame = (): HTMLIFrameElement => viewer.querySelector('iframe.rv-frame') as HTMLIFrameElement

describe('the revision viewer', () => {
  it('opens at the tile’s newest version, its page running in a scripts-only frame', async () => {
    await viewer.open(['jaime-weise'])
    await settle()
    expect(viewer.isOpen).toBe(true)
    expect(viewer.versions).toHaveLength(10)
    expect(viewer.position).toBe(9)
    expect(frame().getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame().srcdoc).toContain('new page')
    expect(frame().srcdoc).toContain('id="hc-site-view-host"')
    // The version's own card travels with it, under the signature the page asks for.
    expect(frame().srcdoc).toContain(btoa(JSON.stringify({ n: 'Version 9' })))
    expect(viewer.querySelector('.rv-position')?.textContent).toContain('Version 10 of 10')
  })

  it('steps to an older version and shows that version’s page and card', async () => {
    await viewer.open(['jaime-weise'])
    await settle()
    viewer.show(2)
    await settle()
    expect(frame().srcdoc).toContain('old page')
    expect(frame().srcdoc).toContain(btoa(JSON.stringify({ n: 'Version 2' })))
    viewer.newer()
    await settle()
    expect(viewer.position).toBe(3)
  })

  it('draws the runs of versions that show the same page', async () => {
    await viewer.open(['jaime-weise'])
    await settle()
    const runs = [...viewer.querySelectorAll('.rv-run')]
    expect(runs).toHaveLength(2)
    expect(runs[0]!.getAttribute('aria-label')).toContain('1–6')
    expect(runs[1]!.getAttribute('aria-label')).toContain('7–10')
  })

  it('narrows a range down to the version where it changed', async () => {
    await viewer.open(['jaime-weise'])
    await settle()
    viewer.mark(true) // the newest (index 9) looks right
    viewer.show(0)
    await settle()
    viewer.mark(false) // the oldest looks wrong
    // From here, mark by what the frame shows: the new page is "right".
    for (let i = 0; i < 8 && viewer.querySelector('.rv-narrow')?.textContent?.includes('Next'); i++) {
      await settle()
      viewer.mark(frame().srcdoc.includes('new page'))
    }
    expect(viewer.querySelector('.rv-narrow')?.textContent).toContain('It changed at version 7')
  })

  it('follows a version written while it is open, when it was on the newest', async () => {
    await viewer.open(['jaime-weise'])
    await settle()
    // The real order: the hive says the marker was written, THEN its list holds it.
    EffectBus.emit('history:marker-wrote', { lineageSig: 'location-of-the-tile', markerName: '00000011' })
    addVersion(PAGE_OLD)
    await new Promise(r => setTimeout(r, 450))
    await settle()
    expect(viewer.versions).toHaveLength(11)
    expect(viewer.position).toBe(10)
    expect(frame().srcdoc).toContain('old page')
  })

  it('ignores versions written to other tiles', async () => {
    await viewer.open(['jaime-weise'])
    await settle()
    EffectBus.emit('history:marker-wrote', { lineageSig: 'some-other-tile', markerName: '00000011' })
    addVersion(PAGE_OLD)
    await new Promise(r => setTimeout(r, 450))
    await settle()
    expect(viewer.versions).toHaveLength(10)
  })

  it('says so when a version’s layer is not on this device yet, and offers to try again', async () => {
    hive.layers.delete(hive.versions[4]!.layerSig)
    await viewer.open(['jaime-weise'])
    await settle()
    viewer.show(4)
    await settle()
    expect(viewer.querySelector('.rv-note span')?.textContent).toContain('not on this device')
    expect((viewer.querySelector('.rv-note button') as HTMLButtonElement).hidden).toBe(false)
  })

it('keeps focus on the slider, so the arrow keys flip versions and never reach the hive', async () => {
    await viewer.open(['jaime-weise'])
    await settle()
    expect(document.activeElement).toBe(viewer.querySelector('input.rv-slider'))
    ;(viewer.querySelector('.rv-wrong') as HTMLButtonElement).click()
    expect(document.activeElement).toBe(viewer.querySelector('input.rv-slider'))
  })

  it('closes when the page in the frame hands up Escape, and only from its own frame', async () => {
    await viewer.open(['jaime-weise'])
    await settle()
    window.dispatchEvent(new MessageEvent('message', { data: { hcRevisionKey: 'Escape' }, source: window }))
    expect(viewer.isOpen).toBe(true)
    window.dispatchEvent(new MessageEvent('message', { data: { hcRevisionKey: 'Escape' }, source: frame().contentWindow }))
    expect(viewer.isOpen).toBe(false)
  })

  it('names its controls for a screen reader', async () => {
    await viewer.open(['jaime-weise'])
    await settle()
    const named = [...viewer.querySelectorAll('.rv-bar button, .rv-bar input')].map(n => n.getAttribute('aria-label') || n.textContent)
    expect(named.every(Boolean)).toBe(true)
    expect(viewer.querySelector('.rv')?.getAttribute('aria-label')).toBe('Revisions')
  })

  it('closes on Escape, and the frame stops running', async () => {
    await viewer.open(['jaime-weise'])
    await settle()
    viewer.querySelector('.rv')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(viewer.isOpen).toBe(false)
    expect((viewer.querySelector('.rv') as HTMLElement).hidden).toBe(true)
    expect(frame().srcdoc).toBe('')
  })
})
