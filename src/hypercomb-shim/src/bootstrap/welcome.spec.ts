// hypercomb-shim/src/bootstrap/welcome.spec.ts — every host has a front door.
//
// The default is a fact, not an absence: a host with nothing staged presents
// its own name, the platform's sentence, and the platform's doors. A staged
// welcome.json leads where it speaks and is believed only as far as each
// field survives its clamp.

import { describe, expect, it } from 'vitest'
import { DEFAULT_TAGLINE, PLATFORM_LINKS, frontDoorOf, parseWelcome, publicDoorsIn } from './welcome'

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
      'host.example', 'https://host.example', true)
    expect(door.title).toBe('host.example')
    expect(door.tagline).toBe(DEFAULT_TAGLINE)
    expect(door.doors).toHaveLength(1)
  })

  it('the deployed nodes stay off the card unless the browser asks for them; every other detail shows', () => {
    const staged = {
      title: 'hypercomb', tagline: 'An open software platform.',
      links: [{ label: 'Watch the tour', href: '/tour/', note: '' }],
      doorsLabel: 'live on hypercomb.com · 1 hive',
      doors: [{ title: 'susan', host: 'susan.hypercomb.com' }],
    }
    const visitor = frontDoorOf(staged, 'hypercomb.com', 'https://hypercomb.com')
    expect(visitor.doors).toEqual([])
    expect(visitor.title).toBe('hypercomb')
    expect(visitor.links).toHaveLength(1)
    expect(frontDoorOf(staged, 'hypercomb.com', 'https://hypercomb.com', true).doors).toEqual(staged.doors)
  })
})

describe('publicDoorsIn — the apex lists the hives switched on for it', () => {
  const ledger = {
    sites: [
      { title: 'Susan', lineage: 'susan', hosts: [{ host: 'susan.realones.online' }, { host: 'susan.hypercomb.com' }], publishers: [{ head: 'a'.repeat(64) }] },
      { title: 'Dylan', lineage: 'dylan', hosts: [{ host: 'dylan.hypercomb.com' }], publishers: [{ head: 'b'.repeat(64) }] },
      { title: 'Held', lineage: 'held', hosts: [{ host: 'held.realones.online' }], publishers: [{ head: null }] },
      { title: 'Apex', lineage: 'realones.online', hosts: [{ host: 'realones.online' }], publishers: [{ head: 'c'.repeat(64) }] },
    ],
  }

  it('keeps only published hives with a door under this domain', () => {
    expect(publicDoorsIn(ledger, 'realones.online')).toEqual([{ title: 'Susan', host: 'susan.realones.online' }])
    expect(publicDoorsIn(ledger, 'hypercomb.com').map(d => d.host)).toEqual(['dylan.hypercomb.com', 'susan.hypercomb.com'])
  })

  it('an SPA fallback or garbage is no directory', () => {
    expect(publicDoorsIn('<!doctype html>', 'realones.online')).toEqual([])
    expect(publicDoorsIn({ sites: 'nope' }, 'realones.online')).toEqual([])
  })
})
