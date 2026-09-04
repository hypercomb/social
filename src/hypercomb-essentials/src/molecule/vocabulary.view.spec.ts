// molecule/vocabulary.view.spec.ts
//
// READING IS FREE. PUBLISHING IS AN ACT. The two are proved apart here.
//
// Every dep of the publish routine is spied, and the spy log is asserted EMPTY
// after a full open-and-read. That is the mechanical form of "a participant
// who does nothing publishes nothing".

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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  VocabularyElement,
  readVocabularyPanel,
  resultWords,
  type VocabularyAct,
  type VocabularyPanelIo,
} from './vocabulary.view.js'
import { NAME_UNKNOWN_LOCALLY, NO_READER, PANEL_PARTIAL, PANEL_WHOLE } from './vocabulary-words.js'
import type { MoleculeIndexReader } from './molecule-index.service.js'
import type { VocabularyPublishDeps, VocabularyPublishResult } from './vocabulary-publish.deps.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

const word = (a: string, n: string) => ({ a, n, c: 1 })

const fakeReader = (over: Partial<MoleculeIndexReader> = {}): MoleculeIndexReader => ({
  addressOf: async () => null,
  holds: async () => false,
  vocabulary: async () => new Map(),
  fallbackVocabulary: async () => new Map(),
  declaredVocabulary: async () => new Set<string>(),
  declaredVocabularyPartial: async () => true,
  readRecord: async () => null,
  subtreeVocabulary: async () => null,
  rootSig: async () => null,
  ...over,
} as MoleculeIndexReader)

/** Every dep the routine could reach, each one recording that it was reached. */
const spiedDeps = (): { deps: VocabularyPublishDeps; log: string[] } => {
  const log: string[] = []
  const mark = <T,>(name: string, value: T) => (...args: unknown[]): T => {
    log.push(name); void args; return value
  }
  const deps = {
    surface: mark('surface', Promise.resolve(A)),
    publicKey: mark('publicKey', Promise.resolve(B)),
    host: mark('host', Promise.resolve('content.example.com')),
    publicBranches: mark('publicBranches', [] as readonly string[]),
    publishedKeys: mark('publishedKeys', Promise.resolve(new Set<string>())),
    lineageKeyOf: mark('lineageKeyOf', ''),
    headOf: mark('headOf', Promise.resolve(null)),
    readRecord: mark('readRecord', Promise.resolve(null)),
    hash: mark('hash', Promise.resolve(C)),
    readHeld: mark('readHeld', Promise.resolve(null)),
    readMinted: mark('readMinted', Promise.resolve(null)),
    confirm: mark('confirm', Promise.resolve(false)),
    sign: mark('sign', Promise.resolve({ ok: false, reason: 'no signer' })),
    putResource: mark('putResource', Promise.resolve(C)),
    markPublic: mark('markPublic', Promise.resolve(undefined)),
    available: mark('available', Promise.resolve(false)),
    setRoot: mark('setRoot', Promise.resolve({ ok: false })),
    writeRecord: mark('writeRecord', Promise.resolve(true)),
  } as unknown as VocabularyPublishDeps
  return { deps, log }
}

const stubAct = (result: VocabularyPublishResult) => {
  const calls: { verb: string; options: unknown }[] = []
  const { deps, log: depLog } = spiedDeps()
  const act: VocabularyAct = {
    defaultVocabularyPublishDeps: () => deps,
    publishVocabulary: async (options) => { calls.push({ verb: 'publish', options }); return result },
    withdrawVocabulary: async (options) => { calls.push({ verb: 'withdraw', options }); return result },
  }
  return { act, calls, depLog }
}

const mount = (io: VocabularyPanelIo, act?: VocabularyAct): VocabularyElement => {
  if (!customElements.get('hc-vocabulary-spec')) {
    customElements.define('hc-vocabulary-spec', class extends VocabularyElement {})
  }
  const el = document.createElement('hc-vocabulary-spec') as VocabularyElement
  el.io = io
  if (act) el.loadAct = async () => act
  document.body.appendChild(el)
  return el
}

beforeEach(() => { document.body.replaceChildren() })

// ---------------------------------------------------------------------------

describe('reading the vocabulary triggers no write', () => {
  it('opening the window reaches NOT ONE dep of the publish routine', async () => {
    const { act, calls, depLog } = stubAct({ ok: false, failure: 'declined' })
    const el = mount({
      reader: () => fakeReader({ declaredVocabulary: async () => new Set([A, B]) }),
      records: async () => [],
      pubkey: () => null,
    }, act)

    el.open()
    await el.refresh()

    // THE WHOLE ASSERTION. `putResource` is the first irreversible byte, and
    // `publicKey` mints and persists a secp256k1 secret on a miss — a preview
    // that touched either would be a leak, not an optimisation.
    expect(depLog).toEqual([])
    expect(calls).toEqual([])
    expect(el.open$).toBe(true)
  })

  it('does not even LOAD the act module until a button is pressed', async () => {
    let loaded = 0
    const el = mount({
      reader: () => fakeReader(),
      records: async () => [],
      pubkey: () => null,
    })
    el.loadAct = async () => { loaded++; return stubAct({ ok: false, failure: 'declined' }).act }
    el.open()
    await el.refresh()
    expect(loaded).toBe(0)
  })

  it('reaches the door exactly once, with `confirmed: true`, only on the press', async () => {
    const { act, calls } = stubAct({ ok: false, failure: 'declined' })
    const el = mount({ reader: () => fakeReader(), records: async () => [], pubkey: () => null }, act)
    el.open()
    await el.refresh()
    await el.act('publish')
    expect(calls).toEqual([{ verb: 'publish', options: { confirmed: true } }])
  })

  it('withdraw is a SEPARATE verb, never a flag on publish', async () => {
    const { act, calls } = stubAct({ ok: true, claim: A, body: B, seq: 8, count: 0, complete: true, host: 'h', pubkey: C })
    const el = mount({ reader: () => fakeReader(), records: async () => [], pubkey: () => null }, act)
    el.open()
    await el.act('withdraw')
    expect(calls.map(c => c.verb)).toEqual(['withdraw'])
  })
})

describe('an unconfirmed publish writes nothing', () => {
  it('a decline leaves the dep spy log empty and says so QUIETLY', async () => {
    const { act, calls, depLog } = stubAct({ ok: false, failure: 'declined' })
    const el = mount({ reader: () => fakeReader(), records: async () => [], pubkey: () => null }, act)
    el.open()
    const result = await el.act('publish')
    expect(result).toEqual({ ok: false, failure: 'declined' })
    // The stub never runs the routine, so no dep is reached — the point being
    // that the SURFACE contributes no write of its own either.
    expect(depLog).toEqual([])
    expect(calls).toHaveLength(1)
    expect(el.textContent).toContain('You said no.')
  })

  it('never merges the human guard with the API guard', () => {
    const declined = resultWords({ ok: false, failure: 'declined' }, false)
    const unconfirmed = resultWords({ ok: false, failure: 'not-confirmed' }, false)
    expect(declined.text).not.toBe(unconfirmed.text)
    expect(declined.tone).toBe('quiet')
    expect(unconfirmed.tone).toBe('bad')
    expect(unconfirmed.text).toContain('bug')
  })

  it('gives every failure its own words', () => {
    const failures = [
      'not-confirmed', 'declined', 'nothing-published', 'no-signer', 'no-host',
      'sign-failed', 'mint-failed', 'not-available', 'index-unsafe',
    ] as const
    const said = failures.map(f => resultWords({ ok: false, failure: f }, false).text)
    expect(new Set(said).size).toBe(failures.length)
  })
})

describe('a partial vocabulary is reported as partial', () => {
  it('says INCOMPLETE above the list, not as a footnote', async () => {
    const el = mount({
      reader: () => fakeReader({
        declaredVocabulary: async () => new Set([A]),
        declaredVocabularyPartial: async () => true,
        fallbackVocabulary: async () => new Map([[A, word(A, 'cigar')]]),
      }),
      records: async () => [],
      pubkey: () => null,
    })
    el.open()
    await el.refresh()
    expect(el.textContent).toContain(PANEL_PARTIAL)
    expect(el.textContent).not.toContain(PANEL_WHOLE)
  })

  it('a THROWN partial check reads as partial, never as complete', async () => {
    const model = await readVocabularyPanel({
      reader: () => fakeReader({ declaredVocabularyPartial: async () => { throw new Error('nope') } }),
      records: async () => [],
      pubkey: () => null,
    })
    expect(model.partial).toBe(true)
  })

  it('a whole picture says so', async () => {
    const el = mount({
      reader: () => fakeReader({ declaredVocabularyPartial: async () => false }),
      records: async () => [],
      pubkey: () => null,
    })
    el.open()
    await el.refresh()
    expect(el.textContent).toContain(PANEL_WHOLE)
  })
})

describe('the panel never shows a full hive as holding nothing', () => {
  it('takes the SET from declaredVocabulary and spellings from the union', async () => {
    // `vocabulary()` is EMPTY ON A MISS. A panel that listed it alone would
    // show a cold hive as holding no words at all.
    const model = await readVocabularyPanel({
      reader: () => fakeReader({
        declaredVocabulary: async () => new Set([A, B]),
        vocabulary: async () => new Map(),
        fallbackVocabulary: async () => new Map([[A, word(A, 'cigar')]]),
      }),
      records: async () => [],
      pubkey: () => null,
    })
    expect(model.addresses).toEqual([A, B])
    expect(model.spellings.get(A)).toBe('cigar')
    expect(model.nameless).toBe(1)
  })

  it('renders an address with no local spelling as itself, never as a blank row', async () => {
    const el = mount({
      reader: () => fakeReader({ declaredVocabulary: async () => new Set([A]) }),
      records: async () => [],
      pubkey: () => null,
    })
    el.open()
    await el.refresh()
    expect(el.textContent).toContain(NAME_UNKNOWN_LOCALLY)
    expect(el.textContent).toContain('still declared')
  })

  it('says the index is not running rather than "no words"', async () => {
    const el = mount({ reader: () => undefined, records: async () => [], pubkey: () => null })
    el.open()
    await el.refresh()
    expect(el.textContent).toContain(NO_READER)
    expect(el.textContent).toContain(PANEL_PARTIAL)
  })

  it('says NEVER PUBLISHED rather than leaving the ledger line blank', async () => {
    const el = mount({ reader: () => fakeReader(), records: async () => [], pubkey: () => null })
    el.open()
    await el.refresh()
    expect(el.textContent).toContain('NEVER PUBLISHED')
    expect(el.textContent).toContain('No signing identity yet')
  })
})

describe('the write half is not in the module graph until the press', () => {
  it('the live deps are reached only through an `await import` inside a handler', () => {
    const src = readFileSync(
      join(process.cwd(), 'hypercomb-essentials', 'src', 'molecule', 'vocabulary.view.ts'), 'utf8')
    // A VALUE import at top level would drag `tile-actions.drone.ts` — which
    // registers a drone at module load — into the boot graph and into every
    // spec's graph. A TYPE import is erased and is fine.
    expect(/^import\s+(?!type\b)[^\n]*vocabulary-publish\.deps\.js/m.test(src)).toBe(false)
    expect(src).toContain("import('./vocabulary-publish.deps.js')")
  })

  it('never resolves a signing key on the read path', () => {
    const src = readFileSync(
      join(process.cwd(), 'hypercomb-essentials', 'src', 'molecule', 'vocabulary.view.ts'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    // `readerPubkey()` MINTS AND PERSISTS a secret on a miss. `cachedPubkey()`
    // is the read-safe twin, and null from it is "no identity yet".
    expect(/\breaderPubkey\b/.test(code)).toBe(false)
    expect(code).toContain('cachedPubkey()')
  })
})
