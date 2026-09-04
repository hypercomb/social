// pheromones/intake-filter.spec.ts
//
// The intake gate's contract, and above all the one that matters most:
// INSTALLING IT CHANGES NOTHING until a participant expresses an interest.
// A filter that quietly starts dropping content on upgrade would be the worst
// possible version of this feature, so that is the first test here.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g['get'] = () => undefined
  g['register'] = () => { /* noop */ }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => (window as any).__reg?.[key],
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

// The location carrier, stubbed: the real index is populated by decoration
// scans, and what is under test is the GATE, not the index.
const locationMarks = new Map<string, string[]>()
vi.mock('../commands/decoration-kind-index.js', () => ({
  tagsForSegments: (segments: readonly string[]) => locationMarks.get(segments.join('/')) ?? [],
  tagsForLabel: (label: string) => locationMarks.get(label) ?? [],
}))

const sigMarks = new Map<string, string[]>()
vi.mock('./pheromone-marks.js', () => ({
  marksOf: async (t: { segments?: readonly string[]; label?: string; sig?: string }) => {
    const out = new Set<string>()
    for (const m of locationMarks.get(t.segments?.join('/') ?? t.label ?? '') ?? []) out.add(m)
    if (t.sig) for (const m of sigMarks.get(t.sig) ?? []) out.add(m)
    return [...out].sort()
  },
}))

const { allows, allowsHere } = await import('./intake-filter.js')

/** The registry seen through the loose-IoC seam, with the real verdict logic
 *  (drop beats keep; empty keep = no filter) so the gate is tested against the
 *  contract it actually consumes. */
const useInterests = (keep: string[], drop: string[]): void => {
  ;(window as any).__reg = {
    '@hypercomb.social/InterestRegistry': {
      allows: (marks: readonly string[]) => {
        if (drop.length) for (const m of marks) if (drop.includes(m)) return false
        if (!keep.length) return true
        for (const m of marks) if (keep.includes(m)) return true
        return false
      },
    },
  }
}

describe('intake filter', () => {
  beforeEach(() => {
    locationMarks.clear()
    sigMarks.clear()
    ;(window as any).__reg = {}
  })

  it('allows everything when no registry is present', async () => {
    locationMarks.set('a/b', ['anything'])
    expect(allowsHere({ segments: ['a', 'b'] })).toBe(true)
    expect(await allows({ segments: ['a', 'b'] })).toBe(true)
  })

  it('allows everything when the participant has expressed no interest', async () => {
    useInterests([], [])
    locationMarks.set('a/b', ['spam', 'whatever'])
    expect(allowsHere({ segments: ['a', 'b'] })).toBe(true)
    expect(await allows({ segments: ['a', 'b'] })).toBe(true)
  })

  it('drops content carrying an excluded mark', async () => {
    useInterests([], ['malicious'])
    locationMarks.set('a/b', ['malicious'])
    expect(allowsHere({ segments: ['a', 'b'] })).toBe(false)
    expect(await allows({ segments: ['a', 'b'] })).toBe(false)
  })

  it('keeps only what carries an enrolled mark once a KEEP interest exists', () => {
    useInterests(['cigars'], [])
    locationMarks.set('a/wanted', ['cigars'])
    locationMarks.set('a/unwanted', ['knitting'])
    expect(allowsHere({ segments: ['a', 'wanted'] })).toBe(true)
    expect(allowsHere({ segments: ['a', 'unwanted'] })).toBe(false)
  })

  it('a drop beats a keep — a refusal is not overridable by a positive match', async () => {
    useInterests(['cigars'], ['malicious'])
    locationMarks.set('a/b', ['cigars', 'malicious'])
    expect(allowsHere({ segments: ['a', 'b'] })).toBe(false)
    expect(await allows({ segments: ['a', 'b'] })).toBe(false)
  })

  // The load-bearing difference between the two gates. A mark carried ONLY by
  // the signature is invisible to the sync location read — deliberately, since
  // that read runs per tile per frame — so the tile still DRAWS and is refused
  // at the commit. Hide first, delete second.
  it('a signature-only mark passes the sync gate and is refused by the async one', async () => {
    useInterests([], ['malicious'])
    sigMarks.set('f'.repeat(64), ['malicious'])
    const target = { segments: ['a', 'b'], sig: 'f'.repeat(64) }
    expect(allowsHere(target)).toBe(true)
    expect(await allows(target)).toBe(false)
  })

  // THE GAP THAT SHIPPED INERT. Nothing else in the tree calls ensureLoaded, so
  // if the gate does not kick it the registry's sets stay empty forever and
  // every verdict is `true` — a filter that is present, tested and never once
  // refuses anything. These four tests are the ones that would have caught it.
  describe('loading the registry', () => {
    /** A registry whose sets only populate once ensureLoaded resolves. */
    const lazyRegistry = (drop: string[]) => {
      let loaded = false
      const reg = {
        calls: 0,
        allows: (marks: readonly string[]) => !loaded || !marks.some(m => drop.includes(m)),
        // The `await` matters: the real ensureLoaded does OPFS work, so it
        // cannot finish before it returns. Without it the body runs to
        // completion synchronously during the call and the "still cold"
        // assertion below can never be reached.
        ensureLoaded: async () => { reg.calls++; await Promise.resolve(); loaded = true },
      }
      ;(window as any).__reg = { '@hypercomb.social/InterestRegistry': reg }
      return reg
    }

    it('the async gate AWAITS the load, so the first commit is judged by a loaded filter', async () => {
      lazyRegistry(['malicious'])
      locationMarks.set('a/b', ['malicious'])
      // Without the await this is `true` — the filter is still cold.
      expect(await allows({ segments: ['a', 'b'] })).toBe(false)
    })

    it('the sync gate kicks the load without awaiting it', async () => {
      const reg = lazyRegistry(['malicious'])
      locationMarks.set('a/b', ['malicious'])
      expect(allowsHere({ segments: ['a', 'b'] })).toBe(true)   // still cold — allowed
      expect(reg.calls).toBe(1)                                  // but the load was started
      await new Promise(resolve => setTimeout(resolve, 0))       // flush the load
      expect(allowsHere({ segments: ['a', 'b'] })).toBe(false)   // warm now — refused
    })

    it('loads once per registry, however many times the gates are called', async () => {
      const reg = lazyRegistry([])
      allowsHere({ segments: ['a'] })
      allowsHere({ segments: ['b'] })
      await allows({ segments: ['c'] })
      await allows({ segments: ['d'] })
      expect(reg.calls).toBe(1)
    })

    it('a registry that cannot load still allows — intake never breaks on it', async () => {
      ;(window as any).__reg = {
        '@hypercomb.social/InterestRegistry': {
          allows: () => true,
          ensureLoaded: async () => { throw new Error('OPFS unavailable') },
        },
      }
      locationMarks.set('a/b', ['whatever'])
      expect(await allows({ segments: ['a', 'b'] })).toBe(true)
      expect(allowsHere({ segments: ['a', 'b'] })).toBe(true)
    })
  })

  it('falls back to the label carrier when no segments are given', () => {
    useInterests([], ['malicious'])
    locationMarks.set('lonely', ['malicious'])
    expect(allowsHere({ label: 'lonely' })).toBe(false)
    expect(allowsHere({ label: 'other' })).toBe(true)
  })
})
