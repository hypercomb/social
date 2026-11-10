// word-enablement.spec.ts — EVERY WORD IS A BEHAVIOUR.
//
// A word's light is `word:<word>`. The build's own words read lit until they
// are switched off — a fresh install starts dark, and a hive with no words
// would have no way to say anything — while anyone else's read dark until
// lit, like every foreign kind. A handful can never go dark: they are the
// way back to every other light. And a desk goes with its word.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

;(window as unknown as { ioc: unknown }).ioc = {
  get: () => undefined,
  register: () => void 0,
  list: () => [],
  whenReady: () => void 0,
  onRegister: () => void 0,
}

const {
  ALWAYS_LIT_WORDS, closeWhenDark, isShippedNamespace, isWordDark, refuseWhileDark, wordKind, wordOfKind,
} = await import('./word-enablement.js')

/** Write the lists the way the shell's writer does, and say so. */
const lights = (on: string[] | null, off: string[] = []): void => {
  if (on) localStorage.setItem('hc:behavior-global-on', JSON.stringify(on))
  else localStorage.removeItem('hc:behavior-global-on')
  localStorage.setItem('hc:behavior-global-off', JSON.stringify(off))
  EffectBus.emit('behavior:enablement-changed', {})
}

const toasts = (): { message?: string; actionEffect?: string; actionPayload?: unknown }[] => {
  const seen: { message?: string; actionEffect?: string; actionPayload?: unknown }[] = []
  EffectBus.on<{ message?: string; actionEffect?: string; actionPayload?: unknown }>('toast:show', p => { if (p) seen.push(p) })
  seen.length = 0 // the bus replays its last toast to a new listener
  return seen
}

describe('a word and its light', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset['hypercombMode']
    lights([])
  })

  it('names a word as a kind of its own, and reads it back', () => {
    expect(wordKind('mail')).toBe('word:mail')
    expect(wordKind('/Mail')).toBe('word:mail')
    expect(wordKind('')).toBe('')
    expect(wordOfKind('word:mail')).toBe('mail')
    expect(wordOfKind('game:solomon')).toBe('')
  })

  it('reads a word the build ships as lit on a hive that started dark — nothing has switched it off', () => {
    lights([])
    expect(isWordDark('mail', 'diamondcoreprocessor.com')).toBe(false)
    expect(isWordDark('mail')).toBe(false)
  })

  it('reads a shipped word dark exactly when it was switched off', () => {
    lights([], ['word:mail'])
    expect(isWordDark('mail', 'diamondcoreprocessor.com')).toBe(true)
    expect(isWordDark('chat', 'diamondcoreprocessor.com')).toBe(false)
  })

  it("counts the shell's own words as the build's", () => {
    lights([])
    expect(isShippedNamespace('hypercomb.social')).toBe(true)
    expect(isWordDark('header', 'hypercomb.social')).toBe(false)
  })

  it("reads anyone else's word dark until it is lit", () => {
    lights([])
    expect(isShippedNamespace('lightbox.example')).toBe(false)
    expect(isWordDark('gallery', 'lightbox.example')).toBe(true)
    lights(['word:gallery'])
    expect(isWordDark('gallery', 'lightbox.example')).toBe(false)
  })

  it('never darkens the way back — the roster word, help, create, undo and redo', () => {
    const every = [...ALWAYS_LIT_WORDS].map(word => 'word:' + word)
    lights([], every)
    for (const word of ALWAYS_LIT_WORDS) expect(isWordDark(word)).toBe(false)
    expect(ALWAYS_LIT_WORDS.has('beehaviors')).toBe(true)
  })

  it('has no roster to consult on a published visitor shell', () => {
    lights([], ['word:mail'])
    document.documentElement.dataset['hypercombMode'] = 'visitor'
    expect(isWordDark('mail')).toBe(false)
    expect(isWordDark('gallery', 'lightbox.example')).toBe(false)
  })
})

describe('a desk and its word', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset['hypercombMode']
    lights([])
  })

  it('closes the moment its word goes dark, and only on that change', () => {
    let closed = 0
    const off = closeWhenDark('mail', () => { closed++ })
    expect(closed).toBe(0) // the replayed flip on subscribe is no change
    lights([], ['word:mail'])
    expect(closed).toBe(1)
    lights([], ['word:mail', 'word:chat'])
    expect(closed).toBe(1) // still dark is not going dark again
    lights([])
    lights([], ['word:mail'])
    expect(closed).toBe(2)
    off()
    lights([])
    lights([], ['word:mail'])
    expect(closed).toBe(2)
  })

  it('refuses every other door while dark, out loud, with the way to its light', () => {
    const said = toasts()
    expect(refuseWhileDark('mail')).toBe(false)
    expect(said).toHaveLength(0)
    lights([], ['word:mail'])
    expect(refuseWhileDark('mail')).toBe(true)
    expect(said).toHaveLength(1)
    expect(said[0].message).toContain('mail')
    expect(said[0].actionEffect).toBe('features:roster-open')
    expect(said[0].actionPayload).toEqual({ query: 'mail' })
  })
})
