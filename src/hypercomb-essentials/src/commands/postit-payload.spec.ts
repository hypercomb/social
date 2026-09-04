import { describe, expect, it } from 'vitest'

// The queen self-registers at import, so `window.ioc` must exist first — the
// same order create.queen.spec.ts uses.
const registrations = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (key: string, value: unknown) => registrations.set(key, value),
    get: (key: string) => registrations.get(key),
  },
}

const { mergePostitPayload } = await import('./postit.queen.js')

// THE DATA LOSS THIS GUARDS. `/postit here <text>` is the only machine-callable
// form of the verb, and its rebuild used to name the fields it kept — text,
// title, pin, size. Everything it did not name was silently dropped. A post-it
// holding an authored one-page site lost the page, and the receipt read as an
// ordinary note edit, because nothing threw and nothing was logged.
//
// These assert the RULE — carry everything, override only what changed — rather
// than the one field, because the defect was the shape of the rebuild.

describe('a post-it rebuild keeps what it was not asked to change', () => {
  it('keeps an authored page when the text is set', () => {
    const merged = mergePostitPayload(
      { version: 1, htmlSig: 'a'.repeat(64), title: 'Menu' },
      { text: 'just a note' },
    )
    expect(merged.htmlSig).toBe('a'.repeat(64))
    expect(merged.text).toBe('just a note')
    expect(merged.title).toBe('Menu')
  })

  it('keeps pin and size, so setting text never snaps a note back to the dock', () => {
    const merged = mergePostitPayload(
      { version: 1, pin: { x: 0.25, y: 0.5 }, size: { w: 300, h: 200 }, text: 'old' },
      { text: 'new' },
    )
    expect(merged.pin).toEqual({ x: 0.25, y: 0.5 })
    expect(merged.size).toEqual({ w: 300, h: 200 })
    expect(merged.text).toBe('new')
  })

  it('keeps a field nobody has thought of yet — the defect was the shape, not htmlSig', () => {
    const prior = { version: 1 as const, text: 'old', futureField: 'must survive' }
    const merged = mergePostitPayload(prior as never, { text: 'new' })
    expect((merged as unknown as Record<string, unknown>)['futureField']).toBe('must survive')
  })

  it('overrides title when one is given, and keeps the prior title when none is', () => {
    expect(mergePostitPayload({ version: 1, title: 'Old' }, { title: 'New' }).title).toBe('New')
    expect(mergePostitPayload({ version: 1, title: 'Old' }, { text: 'x' }).title).toBe('Old')
  })

  it('mints a clean record when there is no prior note', () => {
    const merged = mergePostitPayload(undefined, { text: 'first' })
    expect(merged).toEqual({ version: 1, text: 'first' })
  })

  it('always stamps version 1, even over a prior that claimed otherwise', () => {
    const merged = mergePostitPayload({ version: 0 as never, text: 'old' }, { text: 'new' })
    expect(merged.version).toBe(1)
  })
})
