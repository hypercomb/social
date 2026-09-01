import { describe, expect, it } from 'vitest'
import { isMetaEnvelope, metaPayloadOf } from '@hypercomb/core'
import {
  legacySlideOrder,
  slideContentEnvelope,
  slideContentRef,
  terminalContentSig,
} from './slide-artifact.js'

const sig = (seed: string): string => seed.repeat(64).slice(0, 64)

const BYTES = sig('a')
const OTHER = sig('b')
const ENVELOPE_AT = sig('e')

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

describe('the Life Primitive content hop', () => {
  it('wraps slide bytes in a typed incidence instead of naming them directly', () => {
    const envelope = slideContentEnvelope(BYTES)
    expect(isMetaEnvelope(envelope)).toBe(true)
    expect(metaPayloadOf(envelope)).toEqual({ kind: 'resource', sig: BYTES })
    expect(envelope['relation']).toBe('slide')
  })

  it('refuses to wrap anything that is not a resource signature', () => {
    expect(() => slideContentEnvelope('not-a-sig')).toThrow()
  })

  it('follows the envelope to the terminal bytes', async () => {
    const store = storeHolding({ [ENVELOPE_AT]: slideContentEnvelope(BYTES) })
    expect(await terminalContentSig(store, ENVELOPE_AT)).toBe(BYTES)
  })

  it('passes a retired raw contentSig straight through', async () => {
    // Nothing is stored at BYTES, which is what a raw image sig looks like to
    // this walk — it must answer with the sig, not null, or the media fetch
    // never gets a chance to reach the host.
    expect(await terminalContentSig(storeHolding({}), BYTES)).toBe(BYTES)
  })

  it('prefers the canonical hop and still reads the retired one', () => {
    expect(slideContentRef({ content: BYTES, contentSig: OTHER })).toBe(BYTES)
    expect(slideContentRef({ contentSig: OTHER })).toBe(OTHER)
    expect(slideContentRef({})).toBeNull()
    expect(slideContentRef(null)).toBeNull()
  })
})

describe('the retired per-slide position', () => {
  it('is readable so container-model decks keep their sequence', () => {
    expect(legacySlideOrder({ order: 7 })).toBe(7)
  })

  it('is absent on a slide authored under the new model', () => {
    // Position lives on the membership mark now — a slide carrying its own
    // order could only ever be in ONE presentation.
    expect(legacySlideOrder({ content: BYTES })).toBeUndefined()
    expect(legacySlideOrder(null)).toBeUndefined()
  })
})
