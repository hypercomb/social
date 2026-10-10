import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE ASK SPEAKS EVERY LANGUAGE THE WINDOW DOES.
//
// The line a joined tab shows about a page's private tiles
// (hypercomb-essentials/src/sharing/share-ask.worker.ts) — "Share the 12 tiles
// on this page with downtown?" [Share] [Not now] — is the one moment the
// participant decides what the room sees. A key missing from a catalog falls
// through to the raw key, and a template that lost {count} or {room} asks
// about nothing in particular. Narrow on purpose, like the create parity spec.

const DIR = __dirname
const PLURAL_KEYS = ['swarm.share.ask.one', 'swarm.share.ask.other']
const BUTTON_KEYS = ['swarm.share.ask.share', 'swarm.share.ask.not-now']

const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))

describe('share ask — catalog parity', () => {
  it('finds every catalog', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
  })

  for (const file of catalogs) {
    it(`${file} carries the ask, with its count and its room`, () => {
      const json = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
      for (const key of [...PLURAL_KEYS, ...BUTTON_KEYS]) {
        expect(json[key], `${file} is missing ${key}`).toBeTypeOf('string')
        expect(json[key]?.trim(), `${file} has an empty ${key}`).not.toBe('')
      }
      for (const key of PLURAL_KEYS) {
        expect(json[key], `${file} ${key} lost {count}`).toContain('{count}')
        expect(json[key], `${file} ${key} lost {room}`).toContain('{room}')
      }
    })
  }
})
