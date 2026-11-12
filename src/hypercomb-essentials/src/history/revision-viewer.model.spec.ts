// revision-viewer.model.spec.ts — what one version of a website tile shows,
// the runs of versions that show the same page, narrowing a range down, and
// the document a version runs in.

import { describe, expect, it } from 'vitest'
import {
  carriedSigsOf, changedAt, FRAME_POLICY, frameDocument, judge, leftBetween, NARROWING_START, nextToLook, pageSigOf,
  pictureSigsOf, pictureUrl, runsOf, scriptSafeJson, toBase64, WEBSITE_PAGE_KIND,
} from './revision-viewer.model.js'

/** A signature-shaped string, never a literal one (the doctrine forbids hardcoded hex). */
const sig = (ch: string): string => ch.repeat(64)

describe('pageSigOf — the page a version shows', () => {
  const records = new Map<string, Record<string, unknown>>([
    [sig('1'), { kind: 'tag', payload: { name: 'website' } }],
    [sig('2'), { kind: WEBSITE_PAGE_KIND, payload: { htmlSig: sig('a'), label: 'Business card' } }],
  ])
  const read = async (s: string) => records.get(s) ?? null

  it('reads the website decoration’s htmlSig', async () => {
    expect(await pageSigOf({ name: 'card', decorations: [sig('1'), sig('2')] }, read)).toBe(sig('a'))
  })

  it('prefers the newest entry of the website slot, as the website view does', async () => {
    expect(await pageSigOf({ name: 'card', website: [sig('b'), sig('c')], decorations: [sig('2')] }, read)).toBe(sig('c'))
  })

  it('says null for a version with no page, and for no layer', async () => {
    expect(await pageSigOf({ name: 'card', decorations: [sig('1')] }, read)).toBeNull()
    expect(await pageSigOf(null, read)).toBeNull()
  })

  it('reads past a record it cannot read', async () => {
    const flaky = async (s: string) => { if (s === sig('1')) throw new Error('cold'); return records.get(s) ?? null }
    expect(await pageSigOf({ name: 'card', decorations: [sig('1'), sig('2')] }, flaky)).toBe(sig('a'))
  })
})

describe('carriedSigsOf — what a record declares it reads', () => {
  it('takes the declared refs when there are any', () => {
    expect(carriedSigsOf({ kind: 'card:data', payload: { dataSig: sig('d') }, refs: [sig('d'), sig('f')] }).sort()).toEqual([sig('d'), sig('f')])
  })

  it('else the payload fields named …Sig and …Sigs, never every hex string', () => {
    const record = { kind: 'x', payload: { dataSig: sig('d'), imageSigs: [sig('e')], targetSig: sig('a'), owner: sig('b'), nested: { artSig: sig('c') } } }
    expect(carriedSigsOf(record).sort()).toEqual([sig('a'), sig('d'), sig('e')])
  })
})

describe('runsOf — versions that show the same page', () => {
  it('groups consecutive versions by page', () => {
    expect(runsOf(['a', 'a', 'b', 'b', 'b', 'a'])).toEqual([
      { page: 'a', from: 0, to: 1 }, { page: 'b', from: 2, to: 4 }, { page: 'a', from: 5, to: 5 },
    ])
  })

  it('keeps a version with no page as its own run', () => {
    expect(runsOf([null, 'a', null])).toEqual([{ page: null, from: 0, to: 0 }, { page: 'a', from: 1, to: 1 }, { page: null, from: 2, to: 2 }])
  })
})

describe('narrowing a range down', () => {
  it('waits for one right and one wrong before it picks', () => {
    const one = judge(NARROWING_START, 169, false)
    expect(nextToLook(one)).toBeNull()
    expect(changedAt(one)).toBeNull()
  })

  it('looks at the middle until the two marks are side by side', () => {
    let state = judge(judge(NARROWING_START, 100, true), 169, false)
    expect(nextToLook(state)).toBe(134)
    expect(leftBetween(state)).toBe(68)
    let steps = 0
    // Say the change happened at 140: everything before looks right.
    while (nextToLook(state) !== null && steps < 20) {
      const look = nextToLook(state)!
      state = judge(state, look, look < 140)
      steps++
    }
    expect(changedAt(state)).toBe(140)
    expect(leftBetween(state)).toBe(0)
    expect(steps).toBeLessThanOrEqual(7)
  })

  it('finds a fix as well as a break (wrong before, right after)', () => {
    let state = judge(judge(NARROWING_START, 10, false), 20, true)
    while (nextToLook(state) !== null) { const look = nextToLook(state)!; state = judge(state, look, look >= 15) }
    expect(changedAt(state)).toBe(15)
  })
})

describe('frameDocument — the document a version runs in', () => {
  const data = { segments: ['jaime-weise'], layer: { name: 'jaime-weise', decorations: [sig('1')] }, resources: { [sig('1')]: 'e30=' } }
  const hosting = { pageSig: sig('a') }
  const parse = (doc: string): Document => new DOMParser().parseFromString(doc, 'text/html')

  it('puts the network policy first, then the data and the stand-in, before any of the page’s own scripts', () => {
    const doc = frameDocument('<!doctype html><html><head><title>Card</title><script>page()</script></head><body><p>x</p></body></html>', data, hosting)
    const policy = doc.indexOf('Content-Security-Policy'), dataAt = doc.indexOf('id="hc-revision-data"')
    const standIn = doc.indexOf('window.ioc'), page = doc.indexOf('page()')
    expect(policy).toBeGreaterThan(0)
    expect(dataAt).toBeGreaterThan(policy)
    expect(standIn).toBeGreaterThan(dataAt)
    expect(page).toBeGreaterThan(standIn)
  })

  it('refuses every network request', () => {
    expect(FRAME_POLICY).toContain("default-src 'none'")
    expect(FRAME_POLICY).toContain("connect-src 'none'")
    expect(FRAME_POLICY).not.toMatch(/https?:/)
  })

  it('makes the body the website view’s host, with the marks the website view puts on it', () => {
    const body = parse(frameDocument('<html><head></head><body class="x"><p>x</p></body></html>', data, hosting)).body
    expect(body.id).toBe('hc-site-view-host')
    expect(body.className).toBe('x')
    expect(body.getAttribute('data-hc-site-entry')).toBe('/jaime-weise')
    expect(body.getAttribute('data-hc-cell-page')).toBe(sig('a'))
  })

  it('runs the page’s head scripts inside the host, as the website view does', () => {
    const doc = parse(frameDocument('<html><head><script>first()</script><script>second()</script></head><body><p>x</p><script>third()</script></body></html>', data, hosting))
    const inHost = [...doc.body.querySelectorAll('script')].map(s => s.textContent)
    expect(inHost).toEqual(['first()', 'second()', 'third()'])
    // Only the viewer's own two stay in <head>: the data and the stand-in.
    expect([...doc.head.querySelectorAll('script')].map(s => s.id || 'stand-in')).toEqual(['hc-revision-data', 'stand-in'])
  })

  it('hosts a body that has an id of its own too', () => {
    expect(parse(frameDocument('<html><head></head><body id="mine"></body></html>', data, hosting)).body.id).toBe('hc-site-view-host')
  })

  it('wraps a fragment in a whole document', () => {
    const doc = frameDocument('<p>only a fragment</p>', data, hosting)
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(parse(doc).body.innerHTML).toContain('only a fragment')
  })

  it('inlines the pictures the page embeds by signature, and leaves the rest as they were', () => {
    const page = `<html><head></head><body><img src="resource:${sig('c')}"><img src="${sig('d')}"></body></html>`
    expect(pictureSigsOf(page).sort()).toEqual([sig('c'), sig('d')])
    const doc = parse(frameDocument(page, data, { pageSig: sig('a'), pictures: { [sig('c')]: 'data:image/png;base64,AAAA' } }))
    const sources = [...doc.querySelectorAll('img')].map(img => img.getAttribute('src'))
    expect(sources[0]).toBe('data:image/png;base64,AAAA')
    expect(sources[1]).toContain(sig('d'))
  })

  it('cannot be ended early by what the data says', () => {
    const hostile = { ...data, segments: ['</script><script>alert(1)</script>'] }
    const parsed = parse(frameDocument('<html><head></head><body></body></html>', hostile, hosting))
    // No script appears beyond the viewer's own two, and the data reads back whole.
    expect(parsed.querySelectorAll('script')).toHaveLength(2)
    expect(JSON.parse(parsed.getElementById('hc-revision-data')!.textContent!).segments).toEqual(hostile.segments)
    // In the host's entry mark the same text is an attribute value: inert.
    expect(parsed.body.getAttribute('data-hc-site-entry')).toBe('/' + hostile.segments[0])
    expect(scriptSafeJson('</script>')).not.toContain('</')
  })

  it('runs the stand-in: the page finds its tile, its layer and its bytes through window.ioc', async () => {
    const doc = frameDocument('<html><head></head><body></body></html>', data, hosting)
    const standIn = doc.match(/<script>(\(function \(\) \{[\s\S]*?\}\)\(\);)<\/script>/)![1]!
    const json = doc.match(/<script type="application\/json" id="hc-revision-data">([\s\S]*?)<\/script>/)![1]!
    const holder = document.createElement('script')
    holder.type = 'application/json'
    holder.id = 'hc-revision-data'
    holder.textContent = json
    document.head.appendChild(holder)
    const before = (window as { ioc?: unknown }).ioc
    try {
      // eslint-disable-next-line no-new-func
      new Function(standIn)()
      const ioc = (window as unknown as { ioc: { get(k: string): any } }).ioc
      expect(ioc.get('@hypercomb.social/Lineage').explorerSegments()).toEqual(['jaime-weise'])
      const layer = await ioc.get('@diamondcoreprocessor.com/HistoryService').currentLayerAt('anything')
      expect(layer).toEqual(data.layer)
      const blob = await ioc.get('@hypercomb.social/Store').getResource(sig('1'))
      // jsdom's Blob has no text(); a FileReader reads it as a browser would.
      const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob) })
      expect(text).toBe('{}')
      expect(await ioc.get('@hypercomb.social/Store').getResource(sig('9'))).toBeNull()
      expect(() => window.localStorage.setItem('k', 'v')).not.toThrow()
    } finally {
      holder.remove()
      ;(window as { ioc?: unknown }).ioc = before
    }
  })
})

describe('pictureUrl', () => {
  it('reads the picture’s type from its first bytes', () => {
    expect(pictureUrl(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toMatch(/^data:image\/png;base64,/)
    expect(pictureUrl(new Uint8Array([0xff, 0xd8, 0xff]))).toMatch(/^data:image\/jpeg;base64,/)
    expect(pictureUrl(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toMatch(/^data:image\/svg\+xml;base64,/)
  })
})

describe('toBase64', () => {
  it('round-trips bytes, a large picture included', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251)
    const back = Uint8Array.from(atob(toBase64(bytes)), c => c.charCodeAt(0))
    expect(back).toEqual(bytes)
  })
})
