// molecule/vocabulary-misleading.skeptic.spec.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// ADVERSARIAL. THESE TESTS CURRENTLY FAIL, AND EACH ONE IS A DEFECT.
// ═══════════════════════════════════════════════════════════════════════════
//
// `vocabulary-search.ts` is scrupulous: the row set is fixed before any I/O, a
// "no" is minted in exactly one place and only against a COMPLETE signed claim,
// and every leg fails toward UNKNOWN. `vocabulary-find.spec.ts` and
// `vocabulary.view.spec.ts` then check the SURFACE against the same rule.
//
// The rule leaks at the seams NEITHER file covers: the places where the
// surface writes its OWN `.catch()` and lets a caught failure fall through
// into a confident answer. Four of them, in order of how badly they lie:
//
//   1. `localVerdict` — a THROWN `holds()` becomes `false`, and `false` under a
//      whole picture is rendered "NOT HELD HERE".
//   2. `readVocabularyPanel` — a THROWN `declaredVocabulary()` becomes an
//      empty set, and the panel says "declares 0 word addresses" beside
//      "This picture is whole."
//   3. `VocabularyFindElement.look` — a THROWN `gatherHorizon()` becomes
//      `{publishers: []}`, and an empty horizon is rendered "NOBODY TO ASK —
//      you follow no publisher and carry no key of your own."
//   4. `VocabularyFindElement.look` — when no address could be derived, no
//      door is opened at all and the panel still reports "Asked N publishers
//      across D doors."
//
// Reachability of 1 and 2 is not theoretical: `molecule-index.service.ts:112`
// opens the record pool OUTSIDE `readRecord`'s try/catch — `this.store` is an
// IoC getter and `getPool` is awaited on that line — so a rejection there
// propagates out of `readRecord`, out of `declaredVocabulary()`, and out of
// `holds()`. `declaredVocabularyPartial()` is a SEPARATE call that retries the
// pool open (`#pool` is left `undefined` on a rejection), so one transient
// failure lands exactly on the split these two seams straddle.

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: () => { /* noop */ },
  }
})

import { VocabularyFindElement, localVerdict } from './vocabulary-find.view.js'
import { VocabularyElement, readVocabularyPanel } from './vocabulary.view.js'
import { EMPTY_HORIZON, LOCAL_NOT_HELD, PANEL_WHOLE } from './vocabulary-words.js'
import type { MoleculeIndexReader } from './molecule-index.service.js'

const ADDRESS = 'f'.repeat(64)
const SURFACE = 'd'.repeat(64)
const K1 = '1'.repeat(64)

const fakeReader = (over: Partial<MoleculeIndexReader> = {}): MoleculeIndexReader => ({
  addressOf: async () => ADDRESS,
  holds: async () => false,
  vocabulary: async () => new Map(),
  fallbackVocabulary: async () => new Map(),
  declaredVocabulary: async () => new Set<string>(),
  declaredVocabularyPartial: async () => false,
  readRecord: async () => null,
  subtreeVocabulary: async () => null,
  rootSig: async () => null,
  ...over,
} as MoleculeIndexReader)

const mountFind = (): VocabularyFindElement => {
  if (!customElements.get('hc-vocab-find-skeptic')) {
    customElements.define('hc-vocab-find-skeptic', class extends VocabularyFindElement {})
  }
  const el = document.createElement('hc-vocab-find-skeptic') as VocabularyFindElement
  document.body.appendChild(el)
  return el
}

const mountPanel = (): VocabularyElement => {
  if (!customElements.get('hc-vocab-skeptic')) {
    customElements.define('hc-vocab-skeptic', class extends VocabularyElement {})
  }
  const el = document.createElement('hc-vocab-skeptic') as VocabularyElement
  document.body.appendChild(el)
  return el
}

const flat = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ')

beforeEach(() => { document.body.replaceChildren() })

// ---------------------------------------------------------------------------
// 1. A CRASHED LOCAL READ IS RENDERED AS A CONFIDENT LOCAL "NO"
// ---------------------------------------------------------------------------

describe('a THROWN local read', () => {
  it('is CANNOT SAY, never NOT HELD — catch(() => false) is an inversion', async () => {
    // The reader raised. It did not answer "no".
    const verdict = await localVerdict(fakeReader({
      holds: async () => { throw new Error('the record pool would not open') },
      // The SECOND call succeeded — that is the whole point: they are two
      // independent awaits and only one has to fail.
      declaredVocabularyPartial: async () => false,
    }), 'cigar')

    expect(verdict).toBe('cannot-say')
  })

  it('never draws "this hive does not hold this word" for a read that raised', async () => {
    const el = mountFind()
    el.reader = () => fakeReader({
      holds: async () => { throw new Error('the record pool would not open') },
      declaredVocabularyPartial: async () => false,
    })
    el.gatherHorizon = async () => ({ publishers: [] })
    el.searchDeps = async () => ({ surface: SURFACE })
    el.search = async () => ({ address: ADDRESS, findings: [] })
    await el.look('cigar')

    expect(flat(el)).not.toContain(LOCAL_NOT_HELD)
  })
})

// ---------------------------------------------------------------------------
// 2. A CRASHED VOCABULARY READ IS RENDERED AS A COMPLETE ZERO
// ---------------------------------------------------------------------------

describe('a THROWN declaredVocabulary()', () => {
  it('is not an empty vocabulary — the panel must not call that picture WHOLE', async () => {
    const model = await readVocabularyPanel({
      reader: () => fakeReader({
        declaredVocabulary: async () => { throw new Error('the record pool would not open') },
        declaredVocabularyPartial: async () => false,
      }),
      records: async () => [],
      pubkey: () => null,
    })

    // `partial` defaults pessimistically to TRUE when the PARTIALITY check
    // throws; the same pessimism is owed when the VOCABULARY read throws.
    expect(model.partial).toBe(true)
  })

  it('never renders "declares 0 word addresses" beside "This picture is whole"', async () => {
    const el = mountPanel()
    el.io = {
      reader: () => fakeReader({
        declaredVocabulary: async () => { throw new Error('the record pool would not open') },
        declaredVocabularyPartial: async () => false,
      }),
      records: async () => [],
      pubkey: () => null,
    }
    // The write half is never reached on a read; make that structural here.
    el.loadAct = () => { throw new Error('the read path must not load the act') }
    el.open()
    await el.refresh()

    const text = flat(el)
    expect(text).toContain('declares 0 word address')
    expect(text).not.toContain(PANEL_WHOLE)
  })
})

// ---------------------------------------------------------------------------
// 3. A HORIZON THAT COULD NOT BE GATHERED IS RENDERED AS "YOU FOLLOW NOBODY"
// ---------------------------------------------------------------------------

describe('a horizon that could not be gathered', () => {
  it('is not an empty horizon — "nobody to ask" is a claim about the participant', async () => {
    const el = mountFind()
    el.reader = () => fakeReader()
    // localStorage denied, or one of the three dynamic imports failed.
    el.gatherHorizon = async () => { throw new Error('localStorage is not available') }
    el.searchDeps = async () => ({ surface: SURFACE })
    el.search = async () => ({ address: ADDRESS, findings: [] })
    await el.look('cigar')

    // `vocabulary-horizon.ts` says it in writing: `findings: []` is rendered
    // with EMPTY_HORIZON's words "for an empty horizon and ONLY for an empty
    // horizon". A caught exception manufactures one.
    expect(flat(el)).not.toContain(EMPTY_HORIZON)
  })
})

// ---------------------------------------------------------------------------
// 4. THE PANEL REPORTS DOORS IT NEVER OPENED
// ---------------------------------------------------------------------------

describe('a lookup that never left the device', () => {
  it('does not say "Asked 1 publisher across 2 doors" when it asked nobody', async () => {
    const el = mountFind()
    let searched = 0
    // No address could be derived, so `look()` returns before any I/O.
    el.reader = () => fakeReader({ addressOf: async () => null })
    el.gatherHorizon = async () => ({ publishers: [{ pubkey: K1, hosts: ['content.a.com', 'content.b.com'] }] })
    el.searchDeps = async () => ({ surface: SURFACE })
    el.search = async () => { searched++; return { address: ADDRESS, findings: [] } }
    await el.look('cigar')

    expect(searched).toBe(0)
    expect(flat(el)).not.toContain('Asked 1 publisher across 2 doors')
  })
})
