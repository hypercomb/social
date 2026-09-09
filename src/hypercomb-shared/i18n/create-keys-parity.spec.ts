import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE CREATE CONTROL SPEAKS EVERY LANGUAGE THE WINDOW DOES.
//
// A key added to en.json and nowhere else does not fail anything: the missing
// locales fall through to the raw key, so the button reads
// "tags.create.commit" in Japanese and nobody notices until a participant
// does. These 14 catalogs have drifted that way before.
//
// This is deliberately NARROW — it guards the create control's keys, not
// whole-catalog parity, because the catalogs carry real historical drift and
// a ratchet that fails on day one gets deleted rather than fixed.

const DIR = __dirname
const CREATE_KEYS = [
  'tags.create',
  'tags.create.hint',
  'tags.create.placeholder',
  'tags.create.commit',
  'tags.create.cancel',
  'tags.create.error.exists',
  'tags.create.error.namespaced',
]

const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))

describe('pheromone create control — catalog parity', () => {
  it('finds every catalog', () => {
    // If this drops, someone deleted a language and the loop below silently
    // stopped checking it.
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
  })

  for (const file of catalogs) {
    it(`${file} carries every create key, non-empty`, () => {
      const json = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
      for (const key of CREATE_KEYS) {
        expect(json[key], `${file} is missing ${key}`).toBeTypeOf('string')
        expect(json[key]?.trim(), `${file} has an empty ${key}`).not.toBe('')
      }
    })
  }
})
