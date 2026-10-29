import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Catalogs are UTF-8. A rewrite that opens them as Windows-1252 and writes
// them back as UTF-8 turns an em dash into â€”, a middle dot into Â·, and
// every non-Latin script into the same kind of garbage. The bytes are still
// there, so the damage round-trips. This fails while any string still does.

const CP1252 = new Map<number, number>([
  [0x20AC, 0x80], [0x0081, 0x81], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88], [0x2030, 0x89],
  [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C], [0x008D, 0x8D], [0x017D, 0x8E],
  [0x008F, 0x8F], [0x0090, 0x90], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93],
  [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02DC, 0x98],
  [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B], [0x0153, 0x9C], [0x009D, 0x9D],
  [0x017E, 0x9E], [0x0178, 0x9F],
])

/** The UTF-8 text this string would be, if it is Windows-1252 mojibake. */
function mojibakeOf(str: string): string | null {
  const bytes: number[] = []
  for (const ch of str) {
    const cp = ch.codePointAt(0)!
    if (cp <= 0x7F) bytes.push(cp)
    else if (cp >= 0xA0 && cp <= 0xFF) bytes.push(cp)
    else {
      const mapped = CP1252.get(cp)
      if (mapped === undefined) return null
      bytes.push(mapped)
    }
  }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes))
    if (decoded === str || decoded.includes('\uFFFD')) return null
    return decoded
  } catch {
    return null
  }
}

const DIR = __dirname
const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))

describe('locale catalogs stay UTF-8', () => {
  it('finds every catalog', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
  })

  for (const file of catalogs) {
    it(`${file} has no Windows-1252 mojibake`, () => {
      const json = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
      const damaged = Object.entries(json)
        .filter(([, value]) => typeof value === 'string' && mojibakeOf(value) !== null)
        .map(([key]) => key)
      expect(damaged, `${file} still has ${damaged.length} mojibake string(s)`).toEqual([])
    })
  }
})
