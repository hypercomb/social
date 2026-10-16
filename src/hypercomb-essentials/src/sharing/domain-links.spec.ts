// domain-links.spec.ts — the copy is the navigation.
//
// The rule is proven on a detached DOM: a name in a hosted page's copy
// becomes a link to the creation's address, coloured by its domain and never
// underlined; names fold to doors by the LAST result per creation, so an
// unpublish takes a name out of the copy as surely as a publish put it in.

import { describe, expect, it } from 'vitest'

;(globalThis as unknown as { window: { ioc: unknown } }).window ??= { ioc: { register() {}, get() { return undefined } } }

import { compileDoors, domainColour, linkControl, linkify, nameMatcher } from './domain-links.js'
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

  it('reads the same doors off a signed index', () => {
    const doors = doorsOfIndex({
      roots: { 'business-card': 'a', 'games/arkanoid': 'b', 'stage:live': 'c', unopened: 'd' },
      doors: { 'business-card': ['jwize.com'], 'games/arkanoid': ['jwize.com'] },
      addresses: { 'business-card.jwize.com': 'business-card' },
      createdAt: 10,
    })
    expect(doors.map(d => [d.name, d.address])).toEqual([
      ['business-card', 'https://business-card.jwize.com'],
      ['arkanoid', 'https://games.jwize.com/arkanoid'],
    ])
  })

  it('links a top-level creation to its subdomain even when the result recorded a root path', () => {
    const doors = doorsOfResults([
      r('publish', 'Meetings', 1, 'https://jwize.com/Meetings'),
      { v: 1, op: 'publish', at: 2, segments: ['games', 'arkanoid'], lineageKey: 'games/arkanoid', host: 'jwize.com', address: 'https://jwize.com/games/arkanoid' },
      { v: 1, op: 'publish', at: 3, segments: ['card'], lineageKey: 'card', host: 'jwize.com', address: 'https://me.jwize.com' },
    ])
    expect(doors.map(d => d.address)).toEqual([
      'https://meetings.jwize.com',
      'https://jwize.com/games/arkanoid',
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
    expect(domainColour('jwize.com')).toMatch(/^hsl\(\d+ 62% 46%\)$/)
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
})
