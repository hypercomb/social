// domain-links.drone.spec.ts — the drone on a mounted page.
//
// The rule is proven on its own in domain-links.spec.ts; this proves the
// wiring around it, in the drone as the app constructs it: a page seated in
// the site view host is linked from the door table, a page that changes is
// linked again, resting on a name shows its words and a word is said as a
// sentence, a click on one of our own creations moves inside the hive, a
// publish result relinks, and the optimize phase mints what the page named.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublishedDoor } from './publish-results.js'

const label = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const door = (name: string, zone: string, segments: string[] = [name]): PublishedDoor => ({
  name,
  segments,
  lineageKey: segments.join('/').toLowerCase(),
  zone,
  address: `https://${label(segments[0]!)}.${zone}${segments.length > 1 ? '/' + segments.slice(1).join('/') : ''}`,
  at: 1,
})

let doors: PublishedDoor[] = []
const minted: unknown[] = []
const went: (readonly string[])[] = []
const invoked: [string, string][] = []

// The zone a visitor's host is on: jsdom serves localhost, which has none;
// a test that needs a real zone names one.
let zoneHere = ''
vi.mock('./community-hosts.js', () => ({
  hostsOfBranchKnown: async () => null,
  hostZone: (h: string) => zoneHere || String(h ?? '').toLowerCase(),
}))
// A visitor's index: what the next reads answer (null = the read failed).
let served: (PublishedDoor[] | null)[] = []
let asked = 0
vi.mock('./hive-pointer.js', () => ({
  fetchHiveManifestFromAny: async () => { asked++; const next = served.length > 1 ? served.shift()! : served[0] ?? null; return next ? { doors: next } : null },
}))
vi.mock('./publish-results.js', async (original) => ({
  ...(await original<typeof import('./publish-results.js')>()),
  publishedDoors: async () => doors,
  doorsOfIndex: (manifest: { doors: PublishedDoor[] }) => manifest.doors,
}))
vi.mock('./link-incidences.js', async (original) => ({
  ...(await original<typeof import('./link-incidences.js')>()),
  hasIncidenceRecord: async () => false,
  mintIncidenceRecord: async (record: unknown) => { minted.push(record); return true },
}))

const queen = (word: string) => ({ invoke: async (args: string) => { invoked.push([word, args]) } })
const registered = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered.set(key, value) },
  get: (key: string): unknown => {
    if (key === '@hypercomb.social/Navigation') return { goRaw: (s: readonly string[]) => went.push(s) }
    if (key === '@hypercomb.social/Lineage') return { explorerSegments: () => [] }
    if (key === '@diamondcoreprocessor.com/RaiseQueenBee') return queen('raise')
    if (key === '@diamondcoreprocessor.com/HoldQueenBee') return queen('hold')
    return undefined
  },
}

const { EffectBus } = await import('@hypercomb/core')
const { DomainLinksDrone } = await import('./domain-links.drone.js')
type Drone = InstanceType<typeof DomainLinksDrone>
const { DOMAIN_LINK_CLASS, LINK_CONTROL_CLASS } = await import('./domain-links.js')

const PAGE_SIG = 'e'.repeat(64)

// The site view stamps the page's content sig on the host itself.
const mount = (html: string): HTMLElement => {
  document.getElementById('hc-site-view-host')?.remove()
  const host = document.createElement('div')
  host.id = 'hc-site-view-host'
  host.setAttribute('data-hc-cell-page', PAGE_SIG)
  host.innerHTML = `<div>${html}</div>`
  document.body.appendChild(host)
  return host
}

const links = (host: HTMLElement): HTMLAnchorElement[] =>
  Array.from(host.querySelectorAll<HTMLAnchorElement>('a.' + DOMAIN_LINK_CLASS))

describe('the domain links drone on a mounted page', () => {
  // The one the module constructs and registers, as the app has it.
  const drone = registered.get('@diamondcoreprocessor.com/DomainLinksDrone') as Drone

  beforeEach(() => {
    doors = [door('Point Blank Solutions', 'pointblanksolutions.ca'), door('arkanoid', 'jwize.com', ['games', 'arkanoid'])]
    served = []
    minted.length = 0
    went.length = 0
    invoked.length = 0
    document.querySelectorAll('.' + LINK_CONTROL_CLASS).forEach(c => c.remove())
    EffectBus.emit('publish:result', { at: Math.random() })
  })

  it('links the names in a page that mounts, and the names in copy added later', async () => {
    const host = mount('<p>Built by Point Blank Solutions.</p>')
    await vi.waitFor(() => expect(links(host).map(a => a.textContent)).toEqual(['Point Blank Solutions']))
    expect(links(host)[0]!.getAttribute('href')).toBe('https://point-blank-solutions.pointblanksolutions.ca')

    const more = document.createElement('p')
    more.textContent = 'Play arkanoid.'
    host.firstElementChild!.appendChild(more)
    await vi.waitFor(() => expect(links(host).map(a => a.textContent)).toEqual(['Point Blank Solutions', 'arkanoid']))
  })

  it('shows the words on a resting name, and a click says the sentence to its queen', async () => {
    const host = mount('<p>Built by Point Blank Solutions.</p>')
    await vi.waitFor(() => expect(links(host)).toHaveLength(1))
    links(host)[0]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    const control = document.querySelector<HTMLElement>('.' + LINK_CONTROL_CLASS)!
    expect(control).not.toBeNull()
    control.querySelector<HTMLButtonElement>('button[data-word="hold"]')!.click()
    await vi.waitFor(() => expect(invoked).toEqual([['hold', 'https://point-blank-solutions.pointblanksolutions.ca']]))
    expect(document.querySelector('.' + LINK_CONTROL_CLASS)).toBeNull()
  })

  it('moves inside the hive on a click on one of our own creations', async () => {
    const host = mount('<p>Play arkanoid.</p>')
    await vi.waitFor(() => expect(links(host)).toHaveLength(1))
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    links(host)[0]!.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(went).toEqual([['games', 'arkanoid']])
  })

  it('relinks when a publish result opens a new door', async () => {
    const host = mount('<p>Read the meetings page.</p>')
    await new Promise(r => setTimeout(r, 50))
    expect(links(host)).toHaveLength(0)
    doors = [...doors, door('meetings', 'jwize.com')]
    EffectBus.emit('publish:result', { at: Math.random() })
    await vi.waitFor(() => expect(links(host).map(a => a.textContent)).toEqual(['meetings']))
  })

  it('mints what the page named in the optimize phase, once', async () => {
    const host = mount('<p>Point Blank Solutions made arkanoid.</p>')
    await vi.waitFor(() => expect(links(host)).toHaveLength(2))
    await vi.waitFor(async () => {
      await drone.optimize()
      expect(minted).toHaveLength(1)
    })
    const record = minted[0] as { page: string; names: { lineageKey: string }[] }
    expect(record.page).toBe(PAGE_SIG)
    expect(record.names.map(n => n.lineageKey).sort()).toEqual(['games/arkanoid', 'point blank solutions'])
    await drone.optimize()
    expect(minted).toHaveLength(1)
  })

  // ── a table that changes takes back what it no longer says ──────────────

  it('a withdrawn door goes back to plain text, the last one too', async () => {
    const host = mount('<p>Play arkanoid at Point Blank Solutions.</p>')
    await vi.waitFor(() => expect(links(host)).toHaveLength(2))
    doors = doors.filter(d => d.name !== 'arkanoid')
    EffectBus.emit('publish:result', { at: Math.random() })
    await vi.waitFor(() => expect(links(host).map(a => a.textContent)).toEqual(['Point Blank Solutions']))
    doors = []
    EffectBus.emit('publish:result', { at: Math.random() })
    await vi.waitFor(() => expect(links(host)).toHaveLength(0))
    // The copy reads as authored: one text node, nothing lost.
    expect(host.querySelector('p')!.childNodes).toHaveLength(1)
    expect(host.querySelector('p')!.textContent).toBe('Play arkanoid at Point Blank Solutions.')
  })

  it('a longer name opened later wins over the shorter one already linked', async () => {
    doors = [door('Point Blank', 'jwize.com')]
    EffectBus.emit('publish:result', { at: Math.random() })
    const host = mount('<p>By Point Blank Solutions.</p>')
    await vi.waitFor(() => expect(links(host).map(a => a.textContent)).toEqual(['Point Blank']))
    doors = [...doors, door('Point Blank Solutions', 'pointblanksolutions.ca')]
    EffectBus.emit('publish:result', { at: Math.random() })
    await vi.waitFor(() => expect(links(host).map(a => a.textContent)).toEqual(['Point Blank Solutions']))
  })

  it('a door that moves takes its new address, and the incidences name only the doors open now', async () => {
    const host = mount('<p>Play arkanoid at Point Blank Solutions.</p>')
    await vi.waitFor(() => expect(links(host)).toHaveLength(2))
    await vi.waitFor(async () => { await drone.optimize(); expect(minted).toHaveLength(1) })
    doors = [door('arkanoid', 'games.ca', ['games', 'arkanoid'])]
    EffectBus.emit('publish:result', { at: Math.random() })
    await vi.waitFor(() => expect(links(host).map(a => a.getAttribute('href'))).toEqual(['https://games.games.ca/arkanoid']))
    await vi.waitFor(async () => { await drone.optimize(); expect(minted).toHaveLength(2) })
    const record = minted[1] as { names: { lineageKey: string; zone: string }[] }
    expect(record.names.map(n => `${n.lineageKey}@${n.zone}`)).toEqual(['games/arkanoid@games.ca'])
  })

  // ── a click on our own creation is ours alone ───────────────────────────

  it('our own creation moves inside the hive and never also opens as a web link', async () => {
    const host = mount('<p>Play arkanoid.</p>')
    // The site view's capture listener on the host, as it mounts one.
    const opened: string[] = []
    host.addEventListener('click', e => {
      const a = (e.target as Element).closest('a')
      if (a) { e.preventDefault(); opened.push(a.getAttribute('href') ?? '') }
    }, true)
    await vi.waitFor(() => expect(links(host)).toHaveLength(1))
    links(host)[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(went).toEqual([['games', 'arkanoid']])
    expect(opened).toEqual([])
    // A modified click (a new tab) is the site view's to open.
    links(host)[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
    expect(went).toHaveLength(1)
    expect(opened).toEqual(['https://games.jwize.com/arkanoid'])
  })

  // ── the words, said and typed ───────────────────────────────────────────

  it('a word with no queen awake goes to the command line transiently, never stored to replay', async () => {
    const { REMOTE_SUBMIT } = await import('@hypercomb/core')
    const host = mount('<p>Built by Point Blank Solutions.</p>')
    await vi.waitFor(() => expect(links(host)).toHaveLength(1))
    const say = (): void => {
      links(host)[0]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      const control = document.querySelector<HTMLElement>('.' + LINK_CONTROL_CLASS)!
      control.querySelector<HTMLButtonElement>('button[data-word="recommend"]')!.click()
      const input = control.querySelector<HTMLInputElement>('input')!
      input.value = 'cigars'
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    }
    // Nobody listening: nothing is kept for a command line that mounts later.
    say()
    const late: string[] = []
    const offLate = EffectBus.on<{ text: string }>(REMOTE_SUBMIT, r => { late.push(r.text) })
    expect(late).toEqual([])
    // A command line open: it hears the sentence once.
    say()
    offLate()
    expect(late).toEqual(['recommend https://point-blank-solutions.pointblanksolutions.ca cigars'])
  })

  it('the control sits right after its name, and keeps a word being typed when the pointer leaves', async () => {
    const host = mount('<p>Built by Point Blank Solutions.</p>')
    await vi.waitFor(() => expect(links(host)).toHaveLength(1))
    const a = links(host)[0]!
    a.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    const control = document.querySelector<HTMLElement>('.' + LINK_CONTROL_CLASS)!
    expect(a.nextElementSibling).toBe(control)
    expect(control.hasAttribute('data-escape-local')).toBe(true)
    control.querySelector<HTMLButtonElement>('button[data-word="recommend"]')!.click()
    expect(document.activeElement?.tagName).toBe('INPUT')
    control.dispatchEvent(new MouseEvent('mouseleave'))
    await new Promise(r => setTimeout(r, 420))
    expect(document.querySelector('.' + LINK_CONTROL_CLASS)).toBe(control)
    ;(document.activeElement as HTMLElement).blur()
    control.dispatchEvent(new MouseEvent('mouseleave'))
    await vi.waitFor(() => expect(document.querySelector('.' + LINK_CONTROL_CLASS)).toBeNull())
  })
})

describe('the domain links drone on a visitor page', () => {
  // A visitor has no publish results; the page carries its publisher's door.
  const top = (name: string, address: string, segments: string[] = [name]): PublishedDoor =>
    ({ name, segments, lineageKey: segments.join('/'), zone: location.hostname, address, at: 1 })
  const origin = location.origin

  beforeEach(() => {
    doors = []
    minted.length = 0
    zoneHere = ''
    asked = 0
    document.getElementById('hc-door')?.remove()
    const record = document.createElement('script')
    record.id = 'hc-door'
    record.type = 'application/json'
    record.textContent = JSON.stringify({ pubkey: 'a'.repeat(64) })
    document.head.appendChild(record)
  })

  afterAll(() => {
    document.getElementById('hc-door')?.remove()
    history.replaceState(null, '', '/')
  })

  it('a nested page is its own creation: it links its parent, never itself, and is credited as itself', async () => {
    served = [[top('games', origin), top('arkanoid', `${origin}/arkanoid`, ['games', 'arkanoid'])]]
    history.replaceState(null, '', '/arkanoid/')
    EffectBus.emit('publish:result', { at: Math.random() })
    const host = mount('<p>More games like arkanoid.</p>')
    await vi.waitFor(() => expect(links(host).map(a => a.textContent)).toEqual(['games']))
    expect(links(host)[0]!.hasAttribute('data-cross')).toBe(false)
    const drone = registered.get('@diamondcoreprocessor.com/DomainLinksDrone') as Drone
    await vi.waitFor(async () => { await drone.optimize(); expect(minted).toHaveLength(1) })
    expect((minted[0] as { from?: { lineageKey: string } }).from?.lineageKey).toBe('games/arkanoid')
  })

  it('a page deeper inside a creation never links that creation to itself', async () => {
    served = [[top('games', origin), top('arkanoid', `${origin}/arkanoid`, ['games', 'arkanoid'])]]
    history.replaceState(null, '', '/arkanoid/levels')
    EffectBus.emit('publish:result', { at: Math.random() })
    const host = mount('<p>More arkanoid levels in games.</p>')
    await vi.waitFor(() => expect(links(host).map(a => a.textContent)).toEqual(['games']))
  })

  it('an index read that fails is asked again, and the page links when it answers', async () => {
    // A door elsewhere: one at this origin would be the page's own.
    zoneHere = 'games.jwize.com'
    served = [null, [top('games', 'https://games.jwize.com')]]
    history.replaceState(null, '', '/elsewhere')
    EffectBus.emit('publish:result', { at: Math.random() })
    const host = mount('<p>See the games.</p>')
    await new Promise(r => setTimeout(r, 100))
    expect(links(host)).toHaveLength(0)
    await vi.waitFor(() => expect(links(host).map(a => a.textContent)).toEqual(['games']), { timeout: 4000 })
  })

  it('a host with no zone to ask is not asked again', async () => {
    served = [null]
    history.replaceState(null, '', '/elsewhere')
    EffectBus.emit('publish:result', { at: Math.random() })
    mount('<p>See the games.</p>')
    await vi.waitFor(() => expect(asked).toBeGreaterThan(0))
    const first = asked
    // Past the first retry (2 s): nothing more was asked.
    await new Promise(r => setTimeout(r, 2_500))
    expect(asked).toBe(first)
  }, 6_000)
})

afterAll(() => {
  document.getElementById('hc-site-view-host')?.remove()
  ;(registered.get('@diamondcoreprocessor.com/DomainLinksDrone') as { dispose(): void }).dispose()
})
