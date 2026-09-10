import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE CHAT WINDOW SPEAKS EVERY LANGUAGE THE SHELL DOES.
//
// The chat window grows faster than any other surface — providers, goals,
// the rail, the unattended state, message actions, the link line — and each
// key added to en.json alone reads as "chat.act.retry" in thirteen languages
// until a participant notices. Twenty-six such keys had drifted before this
// ratchet existed.
//
// en.json is the reference: every `chat.*` key it carries must exist, non-empty,
// in every other catalog. The list is DERIVED from en.json, not frozen here, so
// the next chat key added to en.json alone fails the suite the same day.

const DIR = __dirname
const REFERENCE = 'en.json'

const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))
const read = (file: string) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
const chatKeys = Object.keys(read(REFERENCE)).filter(k => k.startsWith('chat.'))

describe('chat window — catalog parity', () => {
  it('finds every catalog', () => {
    // If this drops, someone deleted a language and the loop below silently
    // stopped checking it.
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
  })

  it('en.json carries chat keys to compare against', () => {
    expect(chatKeys.length).toBeGreaterThan(0)
  })

  for (const file of catalogs) {
    if (file === REFERENCE) continue
    it(`${file} carries every chat.* key en.json does, non-empty`, () => {
      const json = read(file)
      const missing = chatKeys.filter(key => typeof json[key] !== 'string')
      expect(missing, `${file} is missing ${missing.length} chat key(s)`).toEqual([])
      const empty = chatKeys.filter(key => typeof json[key] === 'string' && json[key].trim() === '')
      expect(empty, `${file} has empty chat key(s)`).toEqual([])
    })
  }
})
