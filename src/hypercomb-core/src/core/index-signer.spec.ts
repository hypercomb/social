// index-signer.spec.ts — whose index is this? The anchor's own signature, or a
// key the anchor's list names, signing for it.
import { describe, expect, it, vi } from 'vitest'
import { indexStandsFor } from './index-signer.js'

const ANCHOR = 'a'.repeat(64)
const PHONE = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)
const event = (pubkey: string, tags: string[][] = []): Record<string, unknown> => ({ kind: 30564, pubkey, tags, content: '{}' })

describe('indexStandsFor', () => {
  it("takes the anchor's own signature without asking for a list", async () => {
    const listed = vi.fn(async () => new Set<string>())
    expect(await indexStandsFor(event(ANCHOR), ANCHOR, listed)).toBe(true)
    expect(await indexStandsFor(event(ANCHOR.toUpperCase()), ANCHOR, listed)).toBe(true)
    expect(listed).not.toHaveBeenCalled()
  })

  it('takes a listed key on an event tagged for this anchor', async () => {
    expect(await indexStandsFor(event(PHONE, [['anchor', ANCHOR], ['prev', OTHER]]), ANCHOR, async () => new Set([PHONE]))).toBe(true)
  })

  it('refuses a listed key without the anchor tag, or tagged for another anchor', async () => {
    const listed = vi.fn(async () => new Set([PHONE]))
    expect(await indexStandsFor(event(PHONE), ANCHOR, listed)).toBe(false)
    expect(await indexStandsFor(event(PHONE, [['anchor', OTHER]]), ANCHOR, listed)).toBe(false)
    expect(listed).not.toHaveBeenCalled()
  })

  it('refuses a key the list does not name, no list, or a list that throws', async () => {
    const tagged = event(PHONE, [['anchor', ANCHOR]])
    expect(await indexStandsFor(tagged, ANCHOR, async () => new Set([OTHER]))).toBe(false)
    expect(await indexStandsFor(tagged, ANCHOR, async () => null)).toBe(false)
    expect(await indexStandsFor(tagged, ANCHOR, async () => { throw new Error('down') })).toBe(false)
  })

  it('refuses a malformed signer or anchor', async () => {
    expect(await indexStandsFor(event('nope', [['anchor', ANCHOR]]), ANCHOR, async () => new Set(['nope']))).toBe(false)
    expect(await indexStandsFor(event(ANCHOR), 'nope', async () => null)).toBe(false)
  })
})
