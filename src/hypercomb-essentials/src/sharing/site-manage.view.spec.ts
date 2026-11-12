// site-manage.view.spec.ts — a managed site door's card: it reads the record
// the worker put in the page, runs the published head's card in a scripts-only
// frame, lays the bar over it (what is managed, the Chat, the way back), and
// says so when the card is not here yet.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sig = (ch: string): string => ch.repeat(64)
const hive = vi.hoisted(() => ({ bytes: new Map<string, string>() }))

vi.hoisted(() => {
  const services: Record<string, unknown> = {
    '@hypercomb.social/Store': {
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
;(globalThis as unknown as { NodeBlob: unknown }).NodeBlob = (await import('node:buffer')).Blob

const { EffectBus } = await import('@hypercomb/core')
const { SiteManageElement, SITE_MANAGE_SURFACE, siteManageRecord } = await import('./site-manage.view.js')
if (!customElements.get(SITE_MANAGE_SURFACE)) customElements.define(SITE_MANAGE_SURFACE, SiteManageElement)

const HEAD = sig('1'), PAGE_RECORD = sig('2'), CARD_RECORD = sig('3'), CARD_DATA = sig('4'), PAGE = sig('a')

function seed(): void {
  hive.bytes.clear()
  hive.bytes.set(HEAD, JSON.stringify({ name: 'business-card', decorations: [PAGE_RECORD, CARD_RECORD] }))
  hive.bytes.set(PAGE_RECORD, JSON.stringify({ kind: 'visual:website:page', payload: { htmlSig: PAGE } }))
  hive.bytes.set(CARD_RECORD, JSON.stringify({ kind: 'card:data', payload: { dataSig: CARD_DATA } }))
  hive.bytes.set(CARD_DATA, JSON.stringify({ n: 'Jaime' }))
  hive.bytes.set(PAGE, '<!doctype html><html><head></head><body><p>the card</p></body></html>')
}

const record = (value: unknown): HTMLScriptElement => {
  const script = document.createElement('script')
  script.id = 'hc-manage'
  script.type = 'application/json'
  script.textContent = JSON.stringify(value)
  document.head.appendChild(script)
  return script
}
const settle = async (): Promise<void> => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)) }

let element: InstanceType<typeof SiteManageElement>
let script: HTMLScriptElement | null = null

beforeEach(() => { seed() })
afterEach(() => { element?.remove(); script?.remove(); script = null })

const mount = async (): Promise<void> => {
  element = document.createElement(SITE_MANAGE_SURFACE) as InstanceType<typeof SiteManageElement>
  document.body.appendChild(element)
  await settle()
}

describe('the managed site door’s card', () => {
  it('reads the record the worker put in the page, and nothing else', () => {
    expect(siteManageRecord()).toBeNull()
    script = record({ lineage: 'business-card', title: 'business-card', head: HEAD, publisher: 'x' })
    expect(siteManageRecord()).toEqual({ lineage: 'business-card', title: 'business-card', head: HEAD })
    script.textContent = JSON.stringify({ lineage: 'b', head: 'not a signature' })
    expect(siteManageRecord()).toEqual({ lineage: 'b', title: 'b', head: null })
  })

  it('runs the published head’s card in a scripts-only frame, hosted, with its own card data', async () => {
    script = record({ lineage: 'business-card', title: 'business-card', head: HEAD })
    await mount()
    const frame = element.querySelector('iframe.sm-frame') as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.srcdoc).toContain('the card')
    expect(frame.srcdoc).toContain('hc-site-view-host')
    expect(frame.srcdoc).toContain(btoa(JSON.stringify({ n: 'Jaime' })))
  })

  it('lays the bar over it: what is managed, the Chat, and the way back', async () => {
    script = record({ lineage: 'business-card', title: 'business-card', head: HEAD })
    await mount()
    expect(element.querySelector('.sm-title')?.textContent).toBe('Managing business-card')
    expect((element.querySelector('a.sm-btn') as HTMLAnchorElement).getAttribute('href')).toBe('/@hypercomb/leave')
    const asked: unknown[] = []
    const off = EffectBus.on('chat:open', p => asked.push(p))
    ;(element.querySelector('.sm-chat') as HTMLButtonElement).click()
    off()
    expect(asked).toHaveLength(1)
  })

  it('says so when the card is not here yet, and offers to try again', async () => {
    hive.bytes.delete(HEAD)
    script = record({ lineage: 'business-card', title: 'business-card', head: HEAD })
    await mount()
    expect(element.querySelector('.sm-note span')?.textContent).toContain('not on this device')
    expect((element.querySelector('.sm-note button') as HTMLButtonElement).hidden).toBe(false)
    seed()
    ;(element.querySelector('.sm-note button') as HTMLButtonElement).click()
    await settle()
    expect((element.querySelector('iframe.sm-frame') as HTMLIFrameElement).srcdoc).toContain('the card')
  })

  it('says nothing is published when the site has no head', async () => {
    script = record({ lineage: 'business-card', title: 'business-card', head: null })
    await mount()
    expect(element.querySelector('.sm-note span')?.textContent).toContain('Nothing is published')
  })

  it('draws nothing on a page that carries no record', async () => {
    await mount()
    expect(element.children).toHaveLength(0)
  })
})
