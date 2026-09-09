// sharing/visitor-door.spec.ts — the outside-in door.
//
// "I go to somebody's domain, I like that package, I click that link, and it
// brings me back to MY domain and redirects me back to adopting that package
// from where I was originally." (Jaime, 2026-09-09)
//
// The whole path, pinned: what the door says, what survives the boot capture,
// and what arrives — an OFFER at the route the reader came from, never a
// branch folded into their hive.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  HIVE_APP_ORIGIN,
  HIVE_DOOR_PARAM,
  MY_HIVE_KEY,
  PENDING_DOOR_KEY,
  hiveDoorFrom,
  hiveDoorOf,
  hiveDoorUrl,
} from './hive-link.js'
import { routeWithin } from './visitor-door.view.js'

const here = dirname(fileURLToPath(import.meta.url))
const CAPTURE = readFileSync(join(here, '..', '..', '..', 'hypercomb-shared', 'core', 'invite-capture.ts'), 'utf8')
const WORKER = readFileSync(join(here, 'meeting-invite.worker.ts'), 'utf8')
const VISIT = readFileSync(join(here, 'hive-visit.drone.ts'), 'utf8')
const DOOR = readFileSync(join(here, 'visitor-door.view.ts'), 'utf8')

const K = 'e'.repeat(64)

describe('what the door says', () => {
  it('carries the publisher, their hosts, their route and the reader’s route', () => {
    const url = hiveDoorUrl(
      'https://hypercomb.io',
      { pubkey: K, hosts: ['revolucion.hypercomb.com', 'content.hypercomb.com'], segments: ['revolucion'] },
      ['cigars', 'cohiba'],
    )
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://hypercomb.io')
    expect(parsed.pathname).toBe('/')
    expect(parsed.searchParams.get(HIVE_DOOR_PARAM)).toBe(K)
    expect(parsed.searchParams.get('on')).toBe('revolucion.hypercomb.com,content.hypercomb.com')
    expect(parsed.searchParams.get('of')).toBe('revolucion')
    expect(parsed.searchParams.get('at')).toBe('cigars/cohiba')
  })

  // A visitor shell may not fetch across origins (readonly-network.ts), so it
  // could not mint or verify a bundle atom even if it wanted one. Coordinates
  // are what it already has on screen.
  it('carries COORDINATES, never a signature to go and fetch', () => {
    expect(hiveDoorUrl('https://hypercomb.io', { pubkey: K, hosts: ['a.example.com'], segments: ['x'] }))
      .not.toMatch(/rootSig|sig=/)
    expect(DOOR).not.toMatch(/fetch\(/)
  })

  it('refuses to name a door it cannot complete', () => {
    expect(hiveDoorUrl('https://hypercomb.io', { pubkey: 'nope', hosts: ['a.example.com'], segments: ['x'] })).toBe('')
    expect(hiveDoorUrl('https://hypercomb.io', { pubkey: K, hosts: [], segments: ['x'] })).toBe('')
    expect(hiveDoorUrl('https://hypercomb.io', { pubkey: K, hosts: ['a.example.com'], segments: [] })).toBe('')
  })

  it('lands somewhere real when the reader’s hive is not a web address', () => {
    for (const origin of ['', 'javascript:alert(1)', 'not a url']) {
      const url = hiveDoorUrl(origin, { pubkey: K, hosts: ['a.example.com'], segments: ['x'] })
      expect(new URL(url).origin).toBe(HIVE_APP_ORIGIN)
    }
  })

  it('encodes every part whole — a tile name cannot smuggle a second parameter', () => {
    const url = hiveDoorUrl('https://hypercomb.io',
      { pubkey: K, hosts: ['a.example.com'], segments: ['x'] }, ['a&at=b', 'c d'])
    expect(new URL(url).searchParams.get('at')).toBe('a&at=b/c d')
    expect(hiveDoorFrom(new URL(url).search)?.at).toEqual(['a&at=b', 'c d'])
  })
})

describe('what the door means on arrival', () => {
  it('reads back as a bundle the rest of the path already agreed to', () => {
    const url = hiveDoorUrl('https://hypercomb.io',
      { pubkey: K, hosts: ['Revolucion.Hypercomb.com'], segments: ['revolucion'] }, ['cigars'])
    const door = hiveDoorFrom(new URL(url).search)
    expect(door?.bundle).toMatchObject({
      kind: 'hypercomb.hive-link', pubkey: K, hosts: ['revolucion.hypercomb.com'], segments: ['revolucion'],
    })
    expect(door?.at).toEqual(['cigars'])
  })

  // The head is read from the publisher's SIGNED INDEX at arrival — a door
  // says who and where, never what the head is now.
  it('names no head at all', () => {
    const door = hiveDoorFrom(`?${HIVE_DOOR_PARAM}=${K}&on=a.example.com&of=x`)
    expect(door?.bundle.rootSig).toBeUndefined()
  })

  it('a query that is not a door is not one', () => {
    expect(hiveDoorFrom('')).toBeNull()
    expect(hiveDoorFrom('?theme=dark')).toBeNull()
    expect(hiveDoorFrom(`?${HIVE_DOOR_PARAM}=nope&on=a.example.com&of=x`)).toBeNull()
    expect(hiveDoorFrom(`?${HIVE_DOOR_PARAM}=${K}&on=&of=x`)).toBeNull()
    expect(hiveDoorOf(null)).toBeNull()
  })
})

describe('the boot capture', () => {
  it('stashes the query verbatim and decides nothing about it', () => {
    expect(CAPTURE).toMatch(/const PENDING_DOOR_KEY = 'hc:pending-door'/)
    expect(PENDING_DOOR_KEY).toBe('hc:pending-door')
    expect(CAPTURE).toMatch(/sessionStorage\.setItem\(PENDING_DOOR_KEY, search\)/)
    // No second validator in the shell: one place decides what a door means,
    // and the shell may not import essentials to borrow it either.
    expect(CAPTURE).not.toMatch(/hiveDoor\w*\(|validateHiveLinkBundle\(/)
    expect(CAPTURE).not.toMatch(/from '@hypercomb\/essentials/)
  })

  it('settles the URL as a clean root, keeping anything that was not the door', () => {
    expect(CAPTURE).toMatch(/for \(const key of \[DOOR_PARAM, 'on', 'of', 'at'\]\) params\.delete\(key\)/)
    expect(CAPTURE).toMatch(/window\.history\.replaceState\(window\.history\.state, '', clean\)/)
  })

  it('is drained once, by the worker that drains the invite link', () => {
    expect(WORKER).toMatch(/sessionStorage\.getItem\(PENDING_DOOR_KEY\)/)
    expect(WORKER).toMatch(/sessionStorage\.removeItem\(PENDING_DOOR_KEY\)/)
    expect(WORKER).toMatch(/this\.emitEffect\('hive:link'/)
  })
})

describe('what arrives is an offer, at the route the reader came from', () => {
  it('lands INSIDE the offered creation when the door said where they were', () => {
    expect(VISIT).toMatch(/go\(name && at\.length \? \[name, \.\.\.at\] : \[\]\)/)
    expect(VISIT).toMatch(/const routeBeside = \(raw: unknown\): string\[\] =>/)
  })

  it('offers, and never folds a branch', () => {
    expect(VISIT).toMatch(/EffectBus\.emit\('community:offer', offer\)/)
    // The door itself does nothing to the reader's hive — it cannot: it is a
    // link on somebody else's read-only origin. It emits no effect at all.
    expect(DOOR).not.toMatch(/EffectBus\.emit/)
    // The route rides beside the bundle: a bundle reads the same for everyone
    // handed it, so putting the reader's route inside would change its
    // signature and land everyone in the same place.
    expect(WORKER).toMatch(/door\.at\.length \? \{ \.\.\.door\.bundle, at: \[\.\.\.door\.at\] \} : door\.bundle/)
  })

  it('the route within is what the reader added to the publisher’s mount', () => {
    expect(routeWithin(['revolucion'], ['revolucion', 'cigars', 'cohiba'])).toEqual(['cigars', 'cohiba'])
    expect(routeWithin(['revolucion'], ['revolucion'])).toEqual([])
    expect(routeWithin([], ['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('the door on somebody else’s site', () => {
  it('is a drone element surface — the visitor build has no Angular surfaces at all', () => {
    expect(DOOR).toMatch(/registry\.add\(\{ name: SURFACE, owner: OWNER, element: SURFACE/)
    expect(DOOR).not.toMatch(/@Component|registerShellSurface/)
  })

  it('asks the browser where the reader’s hive is and never tells it', () => {
    expect(MY_HIVE_KEY).toBe('hc:my-hive')
    expect(DOOR).toMatch(/localStorage\?\.getItem\(MY_HIVE_KEY\)/)
    expect(DOOR).not.toMatch(/setItem\(MY_HIVE_KEY/)
  })

  it('leaves the site in its own tab rather than taking the page', () => {
    expect(DOOR).toMatch(/anchor\.target = '_blank'/)
    expect(DOOR).toMatch(/anchor\.rel = 'noopener'/)
  })

  it('guards the i18n echo — a runtime miss answers with the key itself', () => {
    expect(DOOR).toMatch(/text && text !== key \? text : interpolate\(fallback, params\)/)
  })
})
