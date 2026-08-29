import { describe, expect, it } from 'vitest'
import { isMetaEnvelope, metaPayloadOf } from '@hypercomb/core'
import { contentEnvelope, contentRefOf, terminalContentSig } from './artifact-content.js'

const sig = (seed: string): string => seed.repeat(64).slice(0, 64)

const BYTES = sig('a')
const OTHER = sig('b')
const AT = sig('e')

/** A blob stand-in: this environment's Blob exposes no `text()`. */
const jsonBlob = (value: unknown): Blob => {
  const text = JSON.stringify(value)
  return { size: text.length, text: async () => text } as unknown as Blob
}

const storeHolding = (records: Record<string, unknown>) => ({
  async getResourceLocal(s: string): Promise<Blob | null> {
    return s in records ? jsonBlob(records[s]) : null
  },
})

describe('the content hop is one rule, not one per artifact', () => {
  it('wraps bytes in a typed incidence instead of naming them directly', () => {
    const envelope = contentEnvelope(BYTES, 'slide')
    expect(isMetaEnvelope(envelope)).toBe(true)
    expect(metaPayloadOf(envelope)).toEqual({ kind: 'resource', sig: BYTES })
    expect(envelope['relation']).toBe('slide')
  })

  it('keeps the same bytes in two ROLES apart', () => {
    // A diagram used as a slide and as a picture is two incidences, so the two
    // roles dedup independently instead of colliding on one record.
    expect(contentEnvelope(BYTES, 'slide')).not.toEqual(contentEnvelope(BYTES, 'picture'))
  })

  it('is deterministic, so two authors attaching one file converge', () => {
    expect(contentEnvelope(BYTES, 'picture')).toEqual(contentEnvelope(BYTES, 'picture'))
  })

  it('refuses to wrap anything that is not a resource signature', () => {
    expect(() => contentEnvelope('not-a-sig', 'slide')).toThrow()
  })

  it('follows the envelope to the terminal bytes', async () => {
    const store = storeHolding({ [AT]: contentEnvelope(BYTES, 'picture') })
    expect(await terminalContentSig(store, AT)).toBe(BYTES)
  })

  it('passes a retired raw signature straight through', async () => {
    // Nothing is stored at BYTES, which is what a raw image sig looks like to
    // this walk — it must answer with the sig, not null, or the media fetch
    // never gets a chance to reach the host.
    expect(await terminalContentSig(storeHolding({}), BYTES)).toBe(BYTES)
  })

  it('prefers the canonical field and still reads the retired one', () => {
    expect(contentRefOf({ content: BYTES, contentSig: OTHER })).toBe(BYTES)
    expect(contentRefOf({ contentSig: OTHER })).toBe(OTHER)
    expect(contentRefOf({})).toBeNull()
    expect(contentRefOf(null)).toBeNull()
  })
})
