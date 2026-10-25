// hypercomb-shim/src/bootstrap/welcome.spec.ts — every host has a front door.
//
// The default is a fact, not an absence: a host with nothing staged presents
// its own name, the platform's sentence, and the platform's doors. A staged
// welcome.json leads where it speaks and is believed only as far as each
// field survives its clamp.

import { describe, expect, it } from 'vitest'
import { DEFAULT_TAGLINE, PLATFORM_LINKS, frontDoorOf, parseWelcome, readWelcome } from './welcome'

describe('parseWelcome — the staged file is data', () => {
  it('keeps a path on this origin and a plain web address; drops anything that could become script', () => {
    const welcome = parseWelcome({
      title: 'hypercomb',
      links: [
        { label: 'tour', href: '/tour/' },
        { label: 'app', href: 'https://hypercomb.io', note: 'the app' },
        { label: 'bad', href: 'javascript:alert(1)' },
        { label: 'bad', href: 'data:text/html,hi' },
        { label: 'bad', href: '//evil.example/' },
        { label: '', href: '/nameless' },
      ],
    })
    expect(welcome?.links).toEqual([
      { label: 'tour', href: '/tour/', note: '' },
      { label: 'app', href: 'https://hypercomb.io/', note: 'the app' },
    ])
  })

  it('clamps text and ignores the former staged door list', () => {
    const welcome = parseWelcome({
      title: 'x'.repeat(80),
      tagline: '  two   words  ',
      doors: [
        { title: 'Revolución', host: 'Revolucion.Hypercomb.com' },
        { host: 'susan.hypercomb.com' },
        { title: 'nope', host: 'install:essentials' },
      ],
    })
    expect(welcome?.title).toHaveLength(60)
    expect(welcome?.tagline).toBe('two words')
    expect('doors' in (welcome ?? {})).toBe(false)
    expect(parseWelcome({ doors: [{ host: 'susan.hypercomb.com' }] })).toBeNull()
  })

  it('a file with nothing usable in it is no front door at all', () => {
    expect(parseWelcome({})).toBeNull()
    expect(parseWelcome({ links: [{ label: 'x', href: 'javascript:1' }] })).toBeNull()
    expect(parseWelcome(['not', 'an', 'object'])).toBeNull()
    expect(parseWelcome('text')).toBeNull()
  })
})

describe('frontDoorOf — the default experience, and a staged one on top', () => {
  it('a bare host presents its own name, the platform’s sentence, and every platform door', () => {
    const door = frontDoorOf(null, 'my-hive.pages.dev', 'https://my-hive.pages.dev')
    expect(door.title).toBe('my-hive.pages.dev')
    expect(door.tagline).toBe(DEFAULT_TAGLINE)
    expect(door.links).toEqual([])
    expect(door.footer).toEqual(PLATFORM_LINKS)
  })

  it('a card at host.<zone> is the host of the zone, and goes by the zone', () => {
    expect(frontDoorOf(null, 'host.pointblanksolutions.ca', 'https://host.pointblanksolutions.ca').title).toBe('pointblanksolutions.ca')
    expect(frontDoorOf(null, 'host.ca', 'https://host.ca').title).toBe('host.ca')
  })

  it('a staged front door leads, and the footer never repeats a door its links already open', () => {
    const door = frontDoorOf({
      title: 'hypercomb',
      tagline: 'An open software platform.',
      links: [
        { label: 'Watch the tour', href: '/tour/', note: '' },
        { label: 'Open hypercomb.io', href: 'https://hypercomb.io', note: '' },
      ],
    }, 'hypercomb.com', 'https://hypercomb.com')
    expect(door.title).toBe('hypercomb')
    expect(door.tagline).toBe('An open software platform.')
    expect(door.footer.map(link => link.label)).toEqual(['documentation', 'source', 'licensing'])
  })

  it('a staged title or tagline that is empty falls back to the default, field by field', () => {
    const door = frontDoorOf({ title: '', tagline: '', links: [] },
      'host.example', 'https://host.example')
    expect(door.title).toBe('host.example')
    expect(door.tagline).toBe(DEFAULT_TAGLINE)
  })
})

describe("readWelcome — a zone's signed card before the shared file", () => {
  it('reads the card the worker carries in the page, and never asks the origin for welcome.json', async () => {
    const script = document.createElement('script')
    script.id = 'hc-welcome'
    script.type = 'application/json'
    script.textContent = JSON.stringify({ title: 'Real Ones', tagline: 'People, not profiles', links: [{ label: 'bad', href: 'javascript:alert(1)' }] })
    document.head.append(script)
    const asked: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string) => { asked.push(String(url)); return new Response('{}') }) as typeof fetch
    try {
      const welcome = await readWelcome()
      expect(welcome).toEqual({ title: 'Real Ones', tagline: 'People, not profiles', links: [], swarm: '' })
      expect(asked).toEqual([])
    } finally {
      globalThis.fetch = realFetch
      script.remove()
    }
  })
})

describe('the room at the top — a card may carry its zone\'s sealed swarm link', () => {
  const LINK = 'https://swarm.hypercomb.com/#swarm=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@hypercomb.com~KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK'

  it('keeps a sealed swarm link on an https page, and nothing else that looks like one', () => {
    expect(parseWelcome({ title: 'x', swarm: LINK })?.swarm).toBe(LINK)
    for (const bad of [
      'https://swarm.hypercomb.com/#meet=lecture/rose',
      'http://swarm.hypercomb.com/#swarm=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@hypercomb.com~KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK',
      'javascript:alert(1)//#swarm=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@hypercomb.com~KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK',
      LINK + '&x=1',
      'https://swarm.hypercomb.com/#swarm=' + 'a'.repeat(63) + '@hypercomb.com~KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK',
    ]) expect(parseWelcome({ title: 'x', swarm: bad })?.swarm, bad).toBe('')
  })

  it('a card that carries only its room keeps the staged name around it, as the worker does', async () => {
    const script = document.createElement('script')
    script.id = 'hc-welcome'
    script.type = 'application/json'
    script.textContent = JSON.stringify({ title: '', tagline: '', links: [], swarm: LINK })
    document.head.append(script)
    const realFetch = globalThis.fetch
    try {
      globalThis.fetch = (async () => new Response(JSON.stringify({ title: 'Staged', tagline: 'line', swarm: '' }),
        { headers: { 'content-type': 'application/json' } })) as typeof fetch
      expect(await readWelcome()).toEqual({ title: 'Staged', tagline: 'line', links: [], swarm: LINK })
      globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch
      expect(await readWelcome()).toEqual({ title: '', tagline: '', links: [], swarm: LINK })
    } finally {
      globalThis.fetch = realFetch
      script.remove()
    }
  })

  it('the shared staged file never carries a room — only a signed card does', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ title: 'Staged', swarm: LINK }),
      { headers: { 'content-type': 'application/json' } })) as typeof fetch
    try {
      expect(await readWelcome()).toEqual({ title: 'Staged', tagline: '', links: [], swarm: '' })
    } finally { globalThis.fetch = realFetch }
  })

  it('a card that carries only its room is still a card, and the front door draws it', () => {
    const welcome = parseWelcome({ swarm: LINK })
    expect(welcome).toEqual({ title: '', tagline: '', links: [], swarm: LINK })
    expect(frontDoorOf(welcome, 'realones.online', 'https://realones.online').swarm).toBe(LINK)
    expect(frontDoorOf(null, 'realones.online', 'https://realones.online').swarm).toBe('')
  })
})

