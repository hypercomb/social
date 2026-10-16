// domain-links.spec.ts — the copy is the navigation.
//
// The rule is proven on a detached DOM: a name in a hosted page's copy
// becomes a link to the creation's address, coloured by its domain and never
// underlined; names fold to doors by the LAST result per creation, so an
// unpublish takes a name out of the copy as surely as a publish put it in.

import { describe, expect, it } from 'vitest'

;(globalThis as unknown as { window: { ioc: unknown } }).window ??= { ioc: { register() {}, get() { return undefined } } }

import { compileDoors, domainColour, LINK_CONTROL_CLASS, PAPER_INK_LUMINANCE, linkControl, linkify, nameMatcher, nameWords } from './domain-links.js'
import { doorsOfIndex, doorsOfResults, type PublishResultRecord, type PublishedDoor } from './publish-results.js'

const door = (name: string, zone: string, extra: Partial<PublishedDoor> = {}): PublishedDoor => ({
  name,
  segments: [name],
  lineageKey: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  zone,
  address: `https://${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${zone}`,
  at: 1,
  ...extra,
})

const page = (html: string): HTMLDivElement => {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

describe('nameMatcher', () => {
  it('matches the name as a phrase, case-blind, with any gap between its words', () => {
    const re = nameMatcher('Point Blank Solutions')!
    for (const copy of ['point blank solutions', 'Point-Blank  Solutions', 'POINT_BLANK SOLUTIONS!']) {
      re.lastIndex = 0
      expect(re.test(copy), copy).toBe(true)
    }
  })

  it('matches whole words only', () => {
    const re = nameMatcher('card')!
    expect(re.test('a cardigan')).toBe(false)
    re.lastIndex = 0
    expect(re.test('my card.')).toBe(true)
  })

  it('has nothing to match for a name with no words', () => {
    expect(nameMatcher('---')).toBeNull()
  })

  it('reads a mixed-script name by its last letter at the tail', () => {
    const re = nameMatcher('ABC会議')!
    expect(re.test('ABC会議は明日です')).toBe(true)
    re.lastIndex = 0
    expect(re.test('XABC会議は')).toBe(false)
  })
})

describe('doorsOfResults', () => {
  const r = (op: 'publish' | 'unpublish', name: string, at: number, address?: string): PublishResultRecord => ({
    v: 1, op, at, segments: [name], lineageKey: name, host: 'jwize.com', ...(address ? { address } : {}),
  })

  it('keeps the last result per creation: an unpublish takes the door away', () => {
    const doors = doorsOfResults([
      r('publish', 'meetings', 1, 'https://meetings.jwize.com'),
      r('publish', 'business-card', 2, 'https://business-card.jwize.com'),
      r('unpublish', 'meetings', 3),
    ])
    expect(doors.map(d => d.name)).toEqual(['business-card'])
    expect(doors[0]?.zone).toBe('jwize.com')
  })

  it('orders by time, not by position in the list', () => {
    const doors = doorsOfResults([
      r('unpublish', 'meetings', 5),
      r('publish', 'meetings', 2, 'https://meetings.jwize.com'),
    ])
    expect(doors).toEqual([])
  })

  it('reads the same doors off a signed index — a nested one only through its open top place', () => {
    const doors = doorsOfIndex({
      roots: { 'business-card': 'a', 'games/arkanoid': 'b', 'stage:live': 'c', unopened: 'd', games: 'e', 'cards/solo': 'f' },
      doors: { 'business-card': ['jwize.com'], 'games/arkanoid': ['jwize.com'], games: ['jwize.com'], 'cards/solo': ['jwize.com'] },
      addresses: { 'business-card.jwize.com': 'business-card' },
      createdAt: 10,
    })
    expect(doors.map(d => [d.name, d.address])).toEqual([
      ['business-card', 'https://business-card.jwize.com'],
      ['arkanoid', 'https://games.jwize.com/arkanoid'],
      ['games', 'https://games.jwize.com'],
    ])
  })

  it('links only where the host opens: a root path is never one, a cased key has no subdomain, an own address stands', () => {
    const doors = doorsOfResults([
      r('publish', 'Meetings', 1, 'https://jwize.com/Meetings'),
      r('publish', 'notes', 2, 'https://jwize.com/notes'),
      { v: 1, op: 'publish', at: 3, segments: ['games', 'arkanoid'], lineageKey: 'games/arkanoid', host: 'jwize.com', address: 'https://jwize.com/games/arkanoid' },
      { v: 1, op: 'publish', at: 4, segments: ['card'], lineageKey: 'card', host: 'jwize.com', address: 'https://me.jwize.com' },
    ])
    expect(doors.map(d => d.address)).toEqual([
      'https://notes.jwize.com',
      'https://me.jwize.com',
    ])
  })
})

describe('linkify', () => {
  const entries = compileDoors([
    door('Business Card', 'jwize.com'),
    door('Point Blank Solutions', 'pointblanksolutions.ca'),
    door('Point', 'jwize.com'),
  ])

  it('turns a name in the copy into a link coloured by its domain, with no underline', () => {
    const host = page('<p>See my business card for details.</p>')
    expect(linkify(host, entries, { pageZone: 'jwize.com' })).toBe(1)
    const a = host.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://business-card.jwize.com')
    expect(a.textContent).toBe('business card')
    // jsdom serialises colours as rgb(); the hue is proven through the rule itself.
    expect(a.style.color).not.toBe('')
    expect(domainColour('jwize.com')).toMatch(/^hsl\(\d+ 62% \d+%\)$/)
    expect(a.style.textDecoration).toBe('none')
    expect(a.hasAttribute('data-cross')).toBe(false)
    expect(host.textContent).toBe('See my business card for details.')
  })

  it('marks a link to another zone as cross-domain and colours it with that zone', () => {
    const host = page('<p>Built with Point Blank Solutions.</p>')
    linkify(host, entries, { pageZone: 'jwize.com' })
    const a = host.querySelector('a')!
    expect(a.hasAttribute('data-cross')).toBe(true)
    expect(a.getAttribute('data-domain')).toBe('pointblanksolutions.ca')
    const own = page('<p>business card</p>')
    linkify(own, entries, { pageZone: 'jwize.com' })
    expect(a.style.color).not.toBe(own.querySelector('a')!.style.color)
    expect(domainColour('pointblanksolutions.ca')).not.toBe(domainColour('jwize.com'))
  })

  it('lets the longest name win where two overlap', () => {
    const host = page('<p>Point Blank Solutions and a point.</p>')
    expect(linkify(host, entries)).toBe(2)
    const [long, short] = Array.from(host.querySelectorAll('a'))
    expect(long?.textContent).toBe('Point Blank Solutions')
    expect(short?.textContent).toBe('point')
  })

  it('leaves links, code and editable text alone, and never links a page to itself', () => {
    const host = page(
      '<a href="x">business card</a><code>business card</code><div contenteditable><span>business card</span></div>' +
      '<p>business card</p>',
    )
    expect(linkify(host, entries, { selfAddress: 'https://business-card.jwize.com/' })).toBe(0)
    expect(linkify(host, entries)).toBe(1)
  })

  it('the control is the words: raise says the address, recommend asks a word first', () => {
    const said: string[] = []
    const control = linkControl(document, door('Business Card', 'jwize.com'), s => said.push(s))
    const buttons = Array.from(control.querySelectorAll('button')).map(b => b.textContent)
    expect(buttons).toEqual(['raise', 'hold', 'recommend'])
    ;(control.querySelector('button[data-word="raise"]') as HTMLButtonElement).click()
    ;(control.querySelector('button[data-word="hold"]') as HTMLButtonElement).click()
    expect(said).toEqual(['raise https://business-card.jwize.com', 'hold https://business-card.jwize.com'])
    said.length = 0
    ;(control.querySelector('button[data-word="recommend"]') as HTMLButtonElement).click()
    const input = control.querySelector('input') as HTMLInputElement
    expect(input.placeholder).toBe('a word')
    input.value = 'cigars'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(said).toEqual(['recommend https://business-card.jwize.com cigars'])
    expect(control.querySelector('input')).toBeNull()
  })

  it('changes nothing the second time', () => {
    const host = page('<p>business card, business card</p>')
    expect(linkify(host, entries)).toBe(2)
    expect(linkify(host, entries)).toBe(0)
    expect(host.querySelectorAll('a').length).toBe(2)
  })

  it('settles an overlap by the longest name, not the leftmost', () => {
    const pizza = compileDoors([door('New York', 'jwize.com'), door('York Pizza', 'jwize.com')])
    const host = page('<p>New York Pizza</p>')
    expect(linkify(host, pizza)).toBe(1)
    expect(host.querySelector('a')!.textContent).toBe('York Pizza')
    expect(host.textContent).toBe('New York Pizza')
  })

  it('sees the whole word across inline markup', () => {
    const card = compileDoors([door('card', 'jwize.com')])
    const split = page('<p><b>card</b>igan and <i>re</i>card</p>')
    expect(linkify(split, card)).toBe(0)
    const apart = page('<p><b>card</b> igan</p><p>x</p><p>card</p>')
    expect(linkify(apart, card)).toBe(2)
    // A block ends the run: a paragraph after the word is not its tail.
    const blocks = page('<div><p>card</p>igan</div>')
    expect(linkify(blocks, card)).toBe(1)
  })

  it('links names inside running text written without spaces', () => {
    const meeting = compileDoors([door('会議', 'jwize.com')])
    const host = page('<p>明日の会議は十時です</p>')
    expect(linkify(host, meeting)).toBe(1)
    expect(host.querySelector('a')!.textContent).toBe('会議')
    expect(host.textContent).toBe('明日の会議は十時です')
  })

  it('counts combining marks as letters and reads names and copy in NFC', () => {
    expect(nameWords('हिन्दी')).toEqual(['हिन्दी'])
    const hindi = compileDoors([door('हिन्दी', 'jwize.com'), door('हिन्दू', 'jwize.com')])
    expect(hindi.length).toBe(2)
    const host = page('<p>मैं हिन्दू हूँ</p>')
    expect(linkify(host, hindi)).toBe(1)
    expect(host.querySelector('a')!.textContent).toBe('हिन्दू')
    const cafe = compileDoors([door('Caf\u00e9', 'jwize.com')])
    const nfd = page('<p>the Cafe\u0301 and the Cafe</p>')
    expect(linkify(nfd, cafe)).toBe(1)
    expect(nfd.querySelector('a')!.textContent).toBe('Caf\u00e9')
    const decomposed = compileDoors([door('Cafe\u0301', 'jwize.com')])
    const nfc = page('<p>the Caf\u00e9.</p>')
    expect(linkify(nfc, decomposed)).toBe(1)
  })

  it("links the door on the page's own zone when two zones share a name", () => {
    const shared = compileDoors([
      door('Meetings', 'jwize.com', { at: 1 }),
      door('Meetings', 'pblank.ca', { at: 2 }),
    ])
    expect(shared.length).toBe(1)
    const onJwize = page('<p>Meetings</p>')
    linkify(onJwize, shared, { pageZone: 'jwize.com' })
    expect(onJwize.querySelector('a')!.getAttribute('data-domain')).toBe('jwize.com')
    expect(onJwize.querySelector('a')!.hasAttribute('data-cross')).toBe(false)
    const elsewhere = page('<p>Meetings</p>')
    linkify(elsewhere, shared, { pageZone: 'other.org' })
    expect(elsewhere.querySelector('a')!.getAttribute('data-domain')).toBe('pblank.ca')
    // On either zone's own Meetings page the name stays text, whichever came last.
    for (const self of ['https://meetings.jwize.com', 'https://meetings.pblank.ca']) {
      const own = page('<p>Meetings</p>')
      expect(linkify(own, shared, { pageZone: 'jwize.com', selfAddress: self })).toBe(0)
    }
  })

  it("never links the control's own words", () => {
    const raise = compileDoors([door('raise', 'jwize.com')])
    const host = page('')
    host.appendChild(linkControl(document, door('Business Card', 'jwize.com'), () => {}))
    expect(linkify(host, raise)).toBe(0)
  })

  it('the recommend input ignores an IME Enter and keeps Escape to itself', () => {
    const said: string[] = []
    const control = linkControl(document, door('Business Card', 'jwize.com'), s => said.push(s))
    expect(control.classList.contains(LINK_CONTROL_CLASS)).toBe(true)
    expect(control.closest('[data-escape-local]')).toBe(control)
    const outside: string[] = []
    const wrap = document.createElement('div')
    wrap.addEventListener('keydown', e => outside.push(e.key))
    wrap.appendChild(control)
    ;(control.querySelector('button[data-word="recommend"]') as HTMLButtonElement).click()
    const input = control.querySelector('input') as HTMLInputElement
    input.value = 'かいぎ'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    expect(said).toEqual([])
    expect(control.querySelector('input')).toBe(input)
    outside.length = 0
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(control.querySelector('input')).toBeNull()
    expect(outside).toEqual([])
  })
})

describe('domainColour', () => {
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = ([r, g, b]: number[]): number => 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!)
  const hsl = (h: number, s: number, l: number): number[] => {
    const k = (n: number): number => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    return [0, 8, 4].map(n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))
  }
  const hex = (x: string): number[] => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16) / 255)
  const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

  it('reads on the ivory plate and on a dark page, for every zone', () => {
    const ivory = lum(hex('#ede4d1'))
    const dark = lum(hex('#141210'))
    for (const zone of ['hypercomb.com', 'jwize.com', 'pointblanksolutions.ca', ...Array.from({ length: 400 }, (_, i) => `z${i}.org`)]) {
      const m = /^hsl\((\d+) 62% (\d+)%\)$/.exec(domainColour(zone))!
      expect(m, zone).not.toBeNull()
      const l = lum(hsl(Number(m[1]), 0.62, Number(m[2]) / 100))
      expect(contrast(l, ivory), zone).toBeGreaterThanOrEqual(3.8)
      expect(contrast(l, dark), zone).toBeGreaterThanOrEqual(3.4)
    }
  })

  it('inks every zone to 4.5:1 on the ivory plate when asked for paper ink', () => {
    const ivory = lum(hex('#ede4d1'))
    for (const zone of ['hypercomb.com', 'jwize.com', ...Array.from({ length: 400 }, (_, i) => `z${i}.org`)]) {
      const plain = /^hsl\((\d+) 62% (\d+)%\)$/.exec(domainColour(zone))!
      const m = /^hsl\((\d+) 62% (\d+)%\)$/.exec(domainColour(zone, PAPER_INK_LUMINANCE))!
      expect(m[1], zone).toBe(plain[1])
      const l = lum(hsl(Number(m[1]), 0.62, Number(m[2]) / 100))
      expect(contrast(l, ivory), zone).toBeGreaterThanOrEqual(4.5)
    }
  })
})
