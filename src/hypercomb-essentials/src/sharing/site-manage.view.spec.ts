// site-manage.view.spec.ts — a managed site door's card: it reads the record
// the worker put in the page, runs the published head's card in a scripts-only
// frame, lays the bar over it (what is managed, the Chat, the way back), and
// says so when the card is not here yet.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sig = (ch: string): string => ch.repeat(64)
const hive = vi.hoisted(() => ({
  bytes: new Map<string, string>(), modes: [] as string[], backs: [] as Array<() => void>,
  installed: 'e'.repeat(64) as string | null,
  acquired: [] as Array<[string, readonly string[]]>,
  outcome: { ok: true, fetched: 0, present: 0 } as { ok: boolean; fetched: number; present: number; error?: string },
}))

vi.hoisted(() => {
  const services: Record<string, unknown> = {
    '@hypercomb.social/Store': {
      // The site door's hive is empty: every byte is the host's, nothing is on this device.
      getResource: async (s: string) => (hive.bytes.has(s) ? new (globalThis as unknown as { NodeBlob: typeof Blob }).NodeBlob([hive.bytes.get(s)!]) : null),
      getResourceResolvedLocal: async () => null,
    },
    '@diamondcoreprocessor.com/ModeRegistry': {
      enter: (mode: string, owner: string) => { hive.modes.push(`enter ${mode} ${owner}`) },
      exit: (mode: string, owner: string) => { hive.modes.push(`exit ${mode} ${owner}`) },
    },
    '@hypercomb.social/Install': {
      installedSig: () => hive.installed,
      acquire: async (root: string, zones: readonly string[]) => { hive.acquired.push([root, zones]); return hive.outcome },
    },
    '@diamondcoreprocessor.com/BackGesture': {
      register: (entry: { owner: string; exact?: boolean; back: () => void }) => {
        hive.modes.push(`back ${entry.owner} exact=${entry.exact === true}`)
        hive.backs.push(entry.back)
        return () => { hive.modes.push(`unback ${entry.owner}`) }
      },
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
const { SiteManageElement, SITE_MANAGE_OWNER, SITE_MANAGE_SURFACE, siteManageRecord, managedSiteZone, updateSources, restartPage } = await import('./site-manage.view.js')
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

beforeEach(() => {
  seed()
  // The scout's offer replays to a late listener: each case starts from none.
  EffectBus.clear()
  hive.acquired.length = 0
  hive.outcome = { ok: true, fetched: 0, present: 0 }
})
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

  it('carries the card’s own data from the host when nothing is on this device', async () => {
    // A cold site door: the card:data record names its data, and only the host
    // holds it. Read local-only, it never arrived and the page showed its list.
    script = record({ lineage: 'business-card', title: 'business-card', head: HEAD })
    await mount()
    const frame = element.querySelector('iframe.sm-frame') as HTMLIFrameElement
    expect(frame.srcdoc).toContain(btoa(JSON.stringify({ n: 'Jaime' })))
  })

  it('covers the canvas while it is shown, and says Back leaves the page', async () => {
    hive.modes.length = 0
    hive.backs.length = 0
    script = record({ lineage: 'business-card', title: 'business-card', head: HEAD })
    await mount()
    // The way out is registered before the claim, so no Back press finds one without the other.
    expect(hive.modes).toEqual([`back ${SITE_MANAGE_OWNER} exact=true`, `enter view:active ${SITE_MANAGE_OWNER}`])
    // Back: one step through the browser's history — the page the owner came from.
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => { /* no traversal in a test */ })
    try { hive.backs[0]!(); expect(back).toHaveBeenCalledOnce() } finally { back.mockRestore() }
    element.remove()
    expect(hive.modes.slice(-2)).toEqual([`exit view:active ${SITE_MANAGE_OWNER}`, `unback ${SITE_MANAGE_OWNER}`])
  })

  it('offers the publisher’s newer build in the bar, and only that', async () => {
    script = record({ lineage: 'business-card', title: 'business-card', head: HEAD })
    await mount()
    const update = element.querySelector('.sm-update') as HTMLButtonElement
    expect(update.hidden).toBe(true)
    // What already runs here, or an offer that is not the signed channel's, is no offer.
    EffectBus.emit('update:available', { available: true, packageSig: hive.installed, source: 'channel' })
    expect(update.hidden).toBe(true)
    EffectBus.emit('update:available', { available: true, packageSig: 'f'.repeat(64), source: 'bundled' })
    expect(update.hidden).toBe(true)
    EffectBus.emit('update:available', { available: true, packageSig: 'f'.repeat(64), source: 'channel' })
    expect(update.hidden).toBe(false)
    expect(update.textContent).toBe('Update')
  })

  it('sees an offer the scout made before the card was here', async () => {
    EffectBus.emit('update:available', { available: true, packageSig: 'f'.repeat(64), source: 'channel' })
    script = record({ lineage: 'business-card', title: 'business-card', head: HEAD })
    await mount()
    expect((element.querySelector('.sm-update') as HTMLButtonElement).hidden).toBe(false)
  })

  it('takes exactly the offered package, from the site’s zone and the hosts the offer came from', async () => {
    const PUB = 'a'.repeat(64)
    localStorage.setItem('hc:install-follow', JSON.stringify({ pubkey: PUB, hosts: ['follow.example'] }))
    const restart = vi.spyOn(restartPage, 'run').mockImplementation(() => { /* the page would start again here */ })
    try {
      script = record({ lineage: 'business-card', title: 'business-card', head: HEAD })
      await mount()
      EffectBus.emit('update:available', { available: true, packageSig: 'f'.repeat(64), source: 'channel' })
      const update = element.querySelector('.sm-update') as HTMLButtonElement
      update.click()
      expect(update.disabled).toBe(true)
      expect(update.textContent).toBe('Updating…')
      await settle()
      // jsdom's host is localhost (a zone of its own); the follow record adds its host.
      expect(hive.acquired).toEqual([['f'.repeat(64), ['localhost', 'follow.example']]])
      expect(restart).toHaveBeenCalledOnce()
      expect(update.disabled).toBe(true)        // it is starting again: no second press
    } finally {
      restart.mockRestore()
      localStorage.removeItem('hc:install-follow')
    }
  })

  it('says a failed update over the card for a moment, then gives the card its note back', async () => {
    hive.bytes.delete(HEAD)                     // a cold card: its note offers Try again
    script = record({ lineage: 'business-card', title: 'business-card', head: HEAD })
    await mount()
    const note = (): string => element.querySelector('.sm-note span')?.textContent ?? ''
    const retry = element.querySelector('.sm-note button') as HTMLButtonElement
    expect(note()).toContain('not on this device')
    EffectBus.emit('update:available', { available: true, packageSig: 'f'.repeat(64), source: 'channel' })
    hive.outcome = { ok: false, fetched: 0, present: 0, error: 'a host did not answer' }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      ;(element.querySelector('.sm-update') as HTMLButtonElement).click()
      await vi.advanceTimersByTimeAsync(0)
      expect(note()).toBe('The update did not complete. a host did not answer')
      expect(retry.hidden).toBe(false)          // the card's own Try again stays
      expect((element.querySelector('.sm-update') as HTMLButtonElement).disabled).toBe(false)
      await vi.advanceTimersByTimeAsync(8000)
      expect(note()).toContain('not on this device')
      expect(retry.hidden).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks the site’s zone and the followed hosts, once each', () => {
    const storage = (value: string | null) => ({ getItem: () => value })
    expect(updateSources('business-card.jwize.com', storage(JSON.stringify({ pubkey: 'b'.repeat(64), hosts: ['hypercomb.com', 'jwize.com'] }))))
      .toEqual(['jwize.com', 'hypercomb.com'])
    expect(updateSources('business-card.jwize.com', storage('off'))).toEqual(['jwize.com'])
    expect(updateSources('business-card.jwize.com', null)).toEqual(['jwize.com'])
  })

  it('names the zone a site door hangs off', () => {
    expect(managedSiteZone('business-card.jwize.com')).toBe('jwize.com')
    expect(managedSiteZone('BUSINESS-CARD.jwize.com:443')).toBe('jwize.com')
    expect(managedSiteZone('jwize.com')).toBe('jwize.com')
  })

  it('claims nothing on a page that carries no record', async () => {
    hive.modes.length = 0
    await mount()
    expect(hive.modes).toEqual([])
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
