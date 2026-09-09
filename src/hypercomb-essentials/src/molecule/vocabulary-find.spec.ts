// molecule/vocabulary-find.spec.ts
//
// UNKNOWN IS RENDERED, IN ITS OWN WORDS, AND NEVER AS A ZERO OR A BLANK.
//
// Two halves:
//   * the SURFACE — every outcome drawn, per host, with unknown at full
//     weight and the three counters always present;
//   * the MECHANISM — a host that never answers degrades to `unreachable`
//     by its deadline instead of hanging the shell. No test contacts a real
//     host: every dep of `searchVocabulary` is injected.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EffectBus } from '@hypercomb/core'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: () => { /* noop */ },
  }
})

import {
  VocabularyFindElement,
  findingWords,
  localVerdict,
  localWords,
  tallyOf,
} from './vocabulary-find.view.js'
import {
  searchVocabulary,
  unknownCount,
  type VocabularyFinding,
  type VocabularyHorizon,
  type VocabularySearch,
  type VocabularyUnknown,
} from './vocabulary-search.js'
import {
  EMPTY_HORIZON,
  LOCAL_CANNOT_SAY,
  NO_READER,
  UNKNOWN_WORDS,
  VERDICT_LABEL,
} from './vocabulary-words.js'
import type { MoleculeIndexReader } from './molecule-index.service.js'

const ADDRESS = 'f'.repeat(64)
const K1 = '1'.repeat(64)
const K2 = '2'.repeat(64)
const K3 = '3'.repeat(64)

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

const evidence = (seq: number, complete: boolean) => ({
  seq, complete, body: 'e'.repeat(64), surface: 'd'.repeat(64), pubkey: K1, prev: null, count: 1,
}) as never

const declared = (publisher: string, host: string): VocabularyFinding => ({
  publisher, verdict: 'declared', why: null, evidence: evidence(7, true), host,
  seq: 7, complete: true, doors: [{ host, outcome: 'claim', seq: 7 }],
})
const absent = (publisher: string, host: string): VocabularyFinding => ({
  publisher, verdict: 'absent', why: null, evidence: evidence(12, true), host,
  seq: 12, complete: true, doors: [{ host, outcome: 'claim', seq: 12 }],
})
const unknown = (publisher: string, why: VocabularyUnknown, host: string): VocabularyFinding => ({
  publisher, verdict: 'unknown', why, evidence: null, host: null,
  seq: null, complete: null, doors: [{ host, outcome: why, seq: null }],
})

const mount = (): VocabularyFindElement => {
  if (!customElements.get('hc-vocabulary-find-spec')) {
    customElements.define('hc-vocabulary-find-spec', class extends VocabularyFindElement {})
  }
  const el = document.createElement('hc-vocabulary-find-spec') as VocabularyFindElement
  document.body.appendChild(el)
  return el
}

const drive = (
  el: VocabularyFindElement,
  reader: MoleculeIndexReader | undefined,
  horizon: VocabularyHorizon,
  search: VocabularySearch | null,
): void => {
  el.reader = () => reader
  el.gatherHorizon = async () => horizon
  el.searchDeps = async () => ({ surface: 'd'.repeat(64) })
  el.search = async () => {
    if (!search) throw new Error('the search blew up')
    return search
  }
}

beforeEach(() => { document.body.replaceChildren() })

// ---------------------------------------------------------------------------
// THE FOUR OUTCOMES, NEVER MERGED
// ---------------------------------------------------------------------------

describe('the local answer', () => {
  it('a miss under an INCOMPLETE picture is CANNOT SAY, never NOT HELD', async () => {
    const verdict = await localVerdict(
      fakeReader({ holds: async () => false, declaredVocabularyPartial: async () => true }), 'cigar')
    expect(verdict).toBe('cannot-say')
    expect(localWords(verdict).text).toBe(LOCAL_CANNOT_SAY)
  })

  it('a miss under a WHOLE picture is an honest NOT HELD', async () => {
    const verdict = await localVerdict(
      fakeReader({ holds: async () => false, declaredVocabularyPartial: async () => false }), 'cigar')
    expect(verdict).toBe('not-held')
  })

  it('no reader is its own state — never "this hive holds no words"', async () => {
    expect(await localVerdict(undefined, 'cigar')).toBe('no-reader')
    expect(localWords('no-reader').text).toBe(NO_READER)
  })
})

describe('the host rows', () => {
  it('renders declared, not held and cannot say — each with its own label and doors', async () => {
    const el = mount()
    const search: VocabularySearch = {
      address: ADDRESS,
      findings: [
        declared(K1, 'content.one.com'),
        absent(K2, 'content.two.com'),
        unknown(K3, 'no-index', 'content.three.com'),
      ],
    }
    drive(el, fakeReader(), {
      publishers: [
        { pubkey: K1, hosts: ['content.one.com'] },
        { pubkey: K2, hosts: ['content.two.com'] },
        { pubkey: K3, hosts: ['content.three.com'] },
      ],
    }, search)
    await el.look('cigar')

    const text = el.textContent ?? ''
    expect(text).toContain(VERDICT_LABEL.declared)
    expect(text).toContain(VERDICT_LABEL.absent)
    expect(text).toContain(VERDICT_LABEL.unknown)
    // The unknown's OWN sentence, not a shared "no".
    expect(text).toContain(UNKNOWN_WORDS['no-index'])
    // WHICH HOST ANSWERED WHAT — the aggregate would hide exactly this.
    expect(text).toContain('content.one.com')
    expect(text).toContain('content.three.com')
    expect(text).toContain('served the claim')
  })

  it('draws an UNKNOWN row at full weight — never faded, collapsed or disclosed', async () => {
    const el = mount()
    drive(el, fakeReader(), { publishers: [{ pubkey: K3, hosts: ['content.three.com'] }] },
      { address: ADDRESS, findings: [unknown(K3, 'unreachable', 'content.three.com')] })
    await el.look('cigar')

    const row = el.querySelector('.hc-find-row.is-unknown')
    expect(row).not.toBeNull()
    expect(row?.closest('details')).toBeNull()
    expect((row as HTMLElement).hidden).toBe(false)
    expect(el.querySelectorAll('.hc-find-doors').length).toBeGreaterThan(0)
  })

  it('always shows three labelled counters, including the zeroes', async () => {
    const el = mount()
    drive(el, fakeReader(), { publishers: [{ pubkey: K3, hosts: ['h.example.com'] }] },
      { address: ADDRESS, findings: [unknown(K3, 'unreachable', 'h.example.com')] })
    await el.look('cigar')
    const tally = el.querySelector('.hc-find-tally')?.textContent ?? ''
    expect(tally).toContain('declares it 0')
    expect(tally).toContain('does not hold it 0')
    expect(tally).toContain('cannot say 1')
  })

  it('says "unknown is not no" whenever any row did not answer', async () => {
    const el = mount()
    drive(el, fakeReader(), {
      publishers: [{ pubkey: K1, hosts: ['a.example.com'] }, { pubkey: K3, hosts: ['b.example.com'] }],
    }, {
      address: ADDRESS,
      findings: [declared(K1, 'a.example.com'), unknown(K3, 'unreachable', 'b.example.com')],
    })
    await el.look('cigar')
    expect(el.textContent).toContain('Unknown is not')
    expect(el.textContent).toContain('1 of 2')
  })

  it('an EMPTY HORIZON gets its own words, never an empty list that reads as a miss', async () => {
    const el = mount()
    drive(el, fakeReader(), { publishers: [] }, { address: ADDRESS, findings: [] })
    await el.look('cigar')
    expect(el.textContent).toContain(EMPTY_HORIZON)
    expect((el.textContent ?? '').toLowerCase()).not.toContain('not found')
  })

  it('a THROWN search leaves every row standing as ASKED-AND-UNANSWERED', async () => {
    const el = mount()
    drive(el, fakeReader(), { publishers: [{ pubkey: K1, hosts: ['a.example.com'] }] }, null)
    await el.look('cigar')
    // The rows are never deleted — a failure cannot shrink into an absence.
    expect(el.querySelectorAll('.hc-find-row').length).toBe(1)
    expect(el.textContent).toContain('This is not an absence')
  })
})

describe('the row copy', () => {
  it('names the reason on every unknown, and the evidence on every absence', () => {
    expect(findingWords(unknown(K3, 'partial', 'h.example.com'))).toBe(UNKNOWN_WORDS['partial'])
    expect(findingWords(absent(K2, 'h.example.com'))).toContain('signed a complete list at seq 12')
    expect(findingWords(declared(K1, 'h.example.com'))).toContain('seq 7')
  })

  it('counts every verdict, so no row can be off-screen', () => {
    const findings = [declared(K1, 'a'), absent(K2, 'b'), unknown(K3, 'no-claim', 'c')]
    expect(tallyOf(findings)).toEqual({ declared: 1, absent: 1, unknown: 1 })
    expect(unknownCount({ address: ADDRESS, findings })).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// THE MECHANISM — a slow host degrades to unknown rather than hanging
// ---------------------------------------------------------------------------

describe('a slow host', () => {
  it('becomes an UNKNOWN row on its deadline and never hangs the shell', async () => {
    let settled = false
    const hang = new Promise<never>(() => { /* never resolves — the point */ })

    const started = Date.now()
    const search = searchVocabulary(ADDRESS, {
      publishers: [{ pubkey: K1, hosts: ['slow.example.com'] }],
    }, {
      surface: 'd'.repeat(64),
      // A host that accepts the connection and then says nothing at all.
      readIndex: () => hang,
      readAtom: () => hang,
      // The SAME deadline machinery, wound down so the suite does not wait
      // eight real seconds to watch a hang expire.
      deadlines: { index: 60, atom: 60, publisher: 200, search: 500 },
    })
    void search.then(() => { settled = true })

    const result = await search
    const elapsed = Date.now() - started
    expect(settled).toBe(true)
    // It ANSWERED by its deadline. The shell is never parked on a dead host.
    expect(elapsed).toBeLessThan(3_000)

    // ONE row, and it is an UNKNOWN with a named reason — never an empty list.
    expect(result.findings).toHaveLength(1)
    const only = result.findings[0] as VocabularyFinding
    expect(only.verdict).toBe('unknown')
    expect(only.why).toBe('unreachable')
    expect(UNKNOWN_WORDS[only.why as 'unreachable']).toBe('no door answered in time')
  }, 10_000)

  it('a malformed address answers one UNKNOWN per publisher, not an empty result', async () => {
    const result = await searchVocabulary('not-an-address', {
      publishers: [{ pubkey: K1, hosts: ['a.example.com'] }, { pubkey: K2, hosts: ['b.example.com'] }],
    }, { surface: 'd'.repeat(64) })
    expect(result.findings).toHaveLength(2)
    expect(result.findings.every(f => f.verdict === 'unknown' && f.why === 'malformed')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// THE ONE ACT ON A RESULT — an offer, never an adoption
// ---------------------------------------------------------------------------
//
// A finding says a PUBLISHER declares the word; what a reader can hold is a
// CREATION. The switch is therefore the same offer the community page and the
// host directory make: one creation, shaded in your hive, taken by walking
// into it. It must never remove, reorder, fade or collapse a row — the whole
// file exists to stop an unknown reading as an absence.

/** The table is filled ON THE WAY to the horizon, so a spec fills it where
 *  production does — inside the seam, after look() has cleared it. */
const fills = (el: VocabularyFindElement, offers: ReturnType<typeof offerOf>[]): void => {
  const horizon = { publishers: [{ pubkey: K1, hosts: ['one.example.com'] }] }
  el.gatherHorizon = async () => {
    el.takeable = new Map([[K1, offers]])
    return horizon
  }
}

const offerOf = (pubkey: string, name: string) => ({
  name, pubkey, hosts: ['one.example.com'], lineageKey: name, segments: [name], head: 'a'.repeat(64),
})

describe('a result carries the switch that offers what the publisher publishes', () => {
  it('draws one chip per creation, after the doors, and never touches the rows', async () => {
    const el = mount()
    drive(el, fakeReader(), { publishers: [{ pubkey: K1, hosts: ['one.example.com'] }] },
      { address: ADDRESS, findings: [declared(K1, 'one.example.com')] })
    fills(el, [offerOf(K1, 'revolucion'), offerOf(K1, 'meetup')])
    await el.look('cigar')

    const rows = [...document.querySelectorAll('.hc-find-row')]
    expect(rows).toHaveLength(1)
    const chips = [...rows[0]!.querySelectorAll('.hc-find-take')]
    expect(chips.map(c => c.textContent)).toEqual([
      'revolucion · show in my hive', 'meetup · show in my hive',
    ])
    // After the evidence, never inside it.
    const strip = rows[0]!.querySelector('.hc-find-takes')!
    const doors = rows[0]!.querySelector('.hc-find-doors')!
    expect(doors.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a publisher with no creations this reader has seen gets no strip at all', async () => {
    const el = mount()
    drive(el, fakeReader(), { publishers: [{ pubkey: K1, hosts: ['one.example.com'] }] },
      { address: ADDRESS, findings: [unknown(K1, 'unreachable', 'one.example.com')] })
    await el.look('cigar')
    expect(document.querySelector('.hc-find-takes')).toBeNull()
    // and the row itself is untouched — full weight, its own words
    expect(document.querySelector('.hc-find-row.is-unknown')).toBeTruthy()
  })

  it('offers a creation and withdraws it — one creation, never a branch', async () => {
    const emitted: { name: string; payload: unknown }[] = []
    const spy = vi.spyOn(EffectBus, 'emit').mockImplementation(((name: string, payload: unknown) => {
      emitted.push({ name, payload })
    }) as never)
    try {
      const el = mount()
      drive(el, fakeReader(), { publishers: [{ pubkey: K1, hosts: ['one.example.com'] }] },
        { address: ADDRESS, findings: [declared(K1, 'one.example.com')] })
      fills(el, [offerOf(K1, 'revolucion')])
      await el.look('cigar')

      ;(document.querySelector('.hc-find-take') as HTMLButtonElement).click()
      expect(emitted.filter(e => e.name === 'community:offer')).toHaveLength(1)
      expect(emitted.find(e => e.name === 'community:offer')?.payload).toMatchObject({
        name: 'revolucion', pubkey: K1, lineageKey: 'revolucion',
      })
      expect(emitted.some(e => e.name.includes('adopt'))).toBe(false)
    } finally { spy.mockRestore() }
  })

  it('reads the switch state from the offers authority, so an offer made elsewhere already shows', async () => {
    const held = new Set(['revolucion'])
    const previous = (window as unknown as { ioc: { get: (k: string) => unknown } }).ioc
    ;(window as unknown as { ioc: unknown }).ioc = {
      ...previous,
      get: (key: string) => key === '@diamondcoreprocessor.com/StaticPeersDrone'
        ? { isOffered: (name: string) => held.has(name), offers: () => [] }
        : undefined,
    }
    try {
      const el = mount()
      drive(el, fakeReader(), { publishers: [{ pubkey: K1, hosts: ['one.example.com'] }] },
        { address: ADDRESS, findings: [declared(K1, 'one.example.com')] })
      fills(el, [offerOf(K1, 'revolucion'), offerOf(K1, 'meetup')])
      await el.look('cigar')

      const chips = [...document.querySelectorAll('.hc-find-take')]
      expect(chips[0]!.textContent).toBe('revolucion · shown in your hive')
      expect(chips[0]!.getAttribute('aria-pressed')).toBe('true')
      expect(chips[1]!.textContent).toBe('meetup · show in my hive')
      expect(chips[1]!.getAttribute('aria-pressed')).toBe('false')
    } finally { (window as unknown as { ioc: unknown }).ioc = previous }
  })

  it('forgets a stale search’s creations before the next one draws', async () => {
    const el = mount()
    drive(el, fakeReader(), { publishers: [{ pubkey: K1, hosts: ['one.example.com'] }] },
      { address: ADDRESS, findings: [declared(K1, 'one.example.com')] })
    fills(el, [offerOf(K1, 'revolucion')])
    await el.look('cigar')
    expect(document.querySelectorAll('.hc-find-take')).toHaveLength(1)
    // look() clears the table first; a horizon gathered with no ledger behind
    // it puts nothing back, which is what a search with no ledger looks like.
    el.gatherHorizon = async () => ({ publishers: [{ pubkey: K1, hosts: ['one.example.com'] }] })
    await el.look('maduro')
    expect(document.querySelectorAll('.hc-find-take')).toHaveLength(0)
  })
})
