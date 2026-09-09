// hypercomb-shim/src/bootstrap/welcome.spec.ts — every host has a front door.
//
// The default is a fact, not an absence: a host with nothing staged presents
// its own name, the platform's sentence, and the platform's doors. A staged
// welcome.json leads where it speaks and is believed only as far as each
// field survives its clamp.

import { describe, expect, it } from 'vitest'
import { DEFAULT_TAGLINE, PLATFORM_LINKS, frontDoorOf, parseWelcome } from './welcome'

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

  it('clamps text, folds a door to a lowercase hostname, and refuses one that is not a hostname', () => {
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
    expect(welcome?.doors).toEqual([
      { title: 'Revolución', host: 'revolucion.hypercomb.com' },
      { title: 'susan', host: 'susan.hypercomb.com' },
    ])
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
    expect(door.doors).toEqual([])
    expect(door.footer).toEqual(PLATFORM_LINKS)
  })

  it('a staged front door leads, and the footer never repeats a door its links already open', () => {
    const door = frontDoorOf({
      title: 'hypercomb',
      tagline: 'An open software platform.',
      links: [
        { label: 'Watch the tour', href: '/tour/', note: '' },
        { label: 'Open hypercomb.io', href: 'https://hypercomb.io', note: '' },
      ],
      doorsLabel: '',
      doors: [{ title: 'susan', host: 'susan.hypercomb.com' }],
    }, 'hypercomb.com', 'https://hypercomb.com')
    expect(door.title).toBe('hypercomb')
    expect(door.tagline).toBe('An open software platform.')
    expect(door.footer.map(link => link.label)).toEqual(['documentation', 'source', 'licensing'])
  })

  it('a staged title or tagline that is empty falls back to the default, field by field', () => {
    const door = frontDoorOf({ title: '', tagline: '', links: [], doorsLabel: '', doors: [{ title: 'a', host: 'a.example.com' }] },
      'host.example', 'https://host.example')
    expect(door.title).toBe('host.example')
    expect(door.tagline).toBe(DEFAULT_TAGLINE)
    expect(door.doors).toHaveLength(1)
  })
})
