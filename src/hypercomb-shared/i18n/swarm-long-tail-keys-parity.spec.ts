import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE LONG TAIL SPEAKS EVERY LANGUAGE THE WINDOW DOES (2026-10-10).
//
// The swarm long-tail fixes say things a meeting acts on: which host holds a
// participant's tiles back and why ("hyperccomb.com has never answered — 27
// tiles stay names · did you mean hypercomb.com?"), that the meeting point
// refused this tab's access code, that a publish was refused, that an old
// package cannot meet at a meeting point, that the device is out of space.
// Modules call these keys with an English fallback, so a missing key would
// not show as a raw key — it would show as English to a reader who chose
// another language. Every catalog carries every key with the same tokens.
// (mesh.state.* and presence.room-* are held by presence-status.spec.ts.)

const DIR = __dirname
const read = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
const en = read('en.json')

const KEYS = Object.keys(en).filter(k => /^(share\.held\.|share\.names-only|share\.passed-over|share\.deep-owner|meet\.|zone\.point-)/.test(k))
  .concat(['host.publish.refused', 'storage.full', 'use-live-relay.pick-zone', 'use-live-relay.joined', 'history.commit-conflict', 'drop.image-failed'])
  // NO DEFAULT HOST (2026-10-11): the host field and every door that asks for it.
  .concat(['use-live-relay.pick-host', 'use-live-relay.joined-at', 'mesh-modal.point-label', 'mesh-modal.point-placeholder',
    'mesh-modal.bad-point', 'mesh-modal.needs-point', 'mesh-modal.offer-point',
    'use-live-relay.cleared', 'use-live-relay.cleared-own'])

/** The keys the long-tail lanes call, with the tokens each one fills. */
const CONTRACT: Readonly<Record<string, readonly string[]>> = {
  'share.held.refused': ['{count}', '{host}'],
  'share.held.never-answered': ['{count}', '{host}'],
  'share.held.too-large': ['{count}', '{host}'],
  'share.held.full': ['{count}', '{host}'],
  'share.held.not-here': ['{count}', '{host}'],
  'share.held.did-you-mean': ['{host}'],
  'share.held.deep': ['{count}', '{host}'],
  'share.names-only': ['{count}'],
  'share.passed-over': ['{host}'],
  'share.deep-owner': ['{name}'],
  'host.publish.refused': ['{node}', '{reason}'],
  'meet.needs-update': [],
  'meet.link-unreadable': [],
  'meet.copy-link': [],
  'meet.link-cannot-travel': [],
  'meet.link-copied': [],
  'use-live-relay.pick-zone': [],
  'use-live-relay.joined': ['{relay}', '{room}'],
  'history.commit-conflict': [],
  'drop.image-failed': [],
  'storage.full': [],
  'zone.point-needs-update': [],
  'zone.point-update': [],
  'use-live-relay.pick-host': [],
  'use-live-relay.joined-at': ['{host}', '{room}', '{words}'],
  'mesh-modal.point-label': [],
  'mesh-modal.point-placeholder': [],
  'mesh-modal.bad-point': [],
  'mesh-modal.needs-point': [],
  'mesh-modal.offer-point': ['{host}'],
  'use-live-relay.cleared': [],
  'use-live-relay.cleared-own': ['{host}'],
}

const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))

describe('swarm long tail — catalog parity', () => {
  it('finds every catalog, and en carries the contract', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
    for (const [key, tokens] of Object.entries(CONTRACT)) {
      expect(en[key], `en.json is missing ${key}`).toBeTypeOf('string')
      expect((en[key]!.match(/\{\w+\}/g) ?? []).sort(), `en ${key} tokens`).toEqual([...tokens].sort())
    }
    expect(KEYS.length).toBeGreaterThanOrEqual(Object.keys(CONTRACT).length)
  })

  for (const file of catalogs) {
    it(`${file} carries every long-tail key with the same tokens`, () => {
      const json = read(file)
      for (const key of KEYS) {
        expect(json[key], `${file} is missing ${key}`).toBeTypeOf('string')
        expect(json[key]!.trim(), `${file} has an empty ${key}`).not.toBe('')
        const want = (en[key]!.match(/\{\w+\}/g) ?? []).sort()
        const have = (json[key]!.match(/\{\w+\}/g) ?? []).sort()
        expect(have, `${file} ${key} tokens`).toEqual(want)
      }
    })
  }
})
