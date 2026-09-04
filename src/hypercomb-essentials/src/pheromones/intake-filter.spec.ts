// pheromones/intake-filter.spec.ts
//
// The intake gate's contract, and above all the one that matters most:
// INSTALLING IT CHANGES NOTHING until a participant expresses an interest.
// A filter that quietly starts dropping content on upgrade would be the worst
// possible version of this feature, so that is the first test here.
//
// The registry is a DOUBLE in this file — the gate reaches it through the
// loose-IoC seam, and essentials may not import shared. The double's verdict
// logic is therefore a copy, and a copy that drifts asserts behaviour the real
// thing does not have. The repo-root `intake-filter-seam.spec.ts` drives the
// REAL registry through this same gate for exactly that reason; keep the two
// honest with each other.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

// The sig carrier, stubbed: the real one reads `pheromones:content` from OPFS,
// and what is under test is the GATE, not the pool.
const sigMarks = new Map<string, string[]>()
/** Signatures the gate has "read" — the sync cache the real module keeps. */
const seen = new Set<string>()
/** How many times the async read was performed, so the sync gate's kick and
 *  the cache behind it are both observable. */
let reads = 0

vi.mock('./pheromone-marks.js', () => ({
  sigMarksKnown: (sig: string) =>
    seen.has(sig.toLowerCase()) ? (sigMarks.get(sig.toLowerCase()) ?? []) : undefined,
  sigMarksOf: async (sig: string) => {
    reads++
    await Promise.resolve()
    seen.add(sig.toLowerCase())
    return sigMarks.get(sig.toLowerCase()) ?? []
  },
}))

const { allows, allowsHere } = await import('./intake-filter.js')

/** A FRESH SIGNATURE PER TEST, because the gate's kick-once set is
 *  process-lifetime state by design (the record cache it fronts is permanent
 *  and invalidated only by this participant's own writes). Reusing one
 *  constant let an early test's kick suppress a later test's, and the later
 *  ones then measured nothing. */
let counter = 0
const freshSig = (): string => (++counter).toString(16).padStart(64, 'a')
let SIG_A = ''
let SIG_B = ''

/** The registry seen through the loose-IoC seam, with the real verdict logic
 *  so the gate is tested against the contract it actually consumes.
 *
 * KEEP THIS IDENTICAL TO `InterestRegistry.allows`. It once lacked the
 * unknown-is-not-absent clause below, which meant it encoded the semantics
 * that shipped BEFORE the blocker was fixed: a KEEP set refusing everything
 * foreign. A double that models the bug cannot catch its regression — it
 * asserts it. */
const useInterests = (keep: string[], drop: string[]): void => {
  ;(window as any).__reg = {
    '@hypercomb.social/InterestRegistry': {
      filters: () => keep.length > 0 || drop.length > 0,
      allows: (marks: readonly string[]) => {
        if (drop.length) for (const m of marks) if (drop.includes(m)) return false
        if (!keep.length) return true
        // UNKNOWN IS NOT ABSENT. Foreign content presents zero marks because
        // the carrier is participant-local, so a KEEP set may only exclude
        // something that carries marks and carries none of yours.
        if (!marks.length) return true
        for (const m of marks) if (keep.includes(m)) return true
        return false
      },
    },
  }
}

describe('intake filter', () => {
  beforeEach(() => {
    sigMarks.clear()
    seen.clear()
    reads = 0
    SIG_A = freshSig()
    SIG_B = freshSig()
    ;(window as any).__reg = {}
  })

  it('allows everything when no registry is present', async () => {
    sigMarks.set(SIG_A, ['anything'])
    expect(allowsHere({ sig: SIG_A })).toBe(true)
    expect(await allows({ sig: SIG_A })).toBe(true)
  })

  it('allows everything when the participant has expressed no interest', async () => {
    useInterests([], [])
    sigMarks.set(SIG_A, ['spam', 'whatever'])
    expect(allowsHere({ sig: SIG_A })).toBe(true)
    expect(await allows({ sig: SIG_A })).toBe(true)
  })

  // INERT ON DISK, not merely in its verdicts. A gate that answers "allow"
  // after opening `pheromones:content` has still changed the hive of a
  // participant who never used the feature — an empty pool directory in a root
  // that walkers, the collector and /flatten all enumerate.
  it('a participant who filters nothing is never read from at all', async () => {
    useInterests([], [])
    sigMarks.set(SIG_A, ['malicious'])
    allowsHere({ sig: SIG_A })
    expect(await allows({ sig: SIG_A })).toBe(true)
    expect(reads).toBe(0)
  })

  // ...and a registry too old to say gets asked anyway. Paying for a read
  // beats skipping a refusal.
  it('a registry that does not report whether it filters is still consulted', async () => {
    ;(window as any).__reg = {
      '@hypercomb.social/InterestRegistry': { allows: (m: readonly string[]) => !m.includes('malicious') },
    }
    sigMarks.set(SIG_A, ['malicious'])
    expect(await allows({ sig: SIG_A })).toBe(false)
    expect(reads).toBe(1)
  })

  it('drops content carrying an excluded mark', async () => {
    useInterests([], ['malicious'])
    sigMarks.set(SIG_A, ['malicious'])
    expect(await allows({ sig: SIG_A })).toBe(false)
  })

  it('keeps only what carries an enrolled mark once a KEEP interest exists', async () => {
    useInterests(['cigars'], [])
    sigMarks.set(SIG_A, ['cigars'])
    sigMarks.set(SIG_B, ['knitting'])
    expect(await allows({ sig: SIG_A })).toBe(true)
    expect(await allows({ sig: SIG_B })).toBe(false)
  })

  // The blocker, at the gate rather than in the registry. Everything arriving
  // from a stranger is unmarked until this participant marks it, so a KEEP set
  // that judged unmarked content would empty the swarm on the day somebody
  // named one interest.
  it('unmarked foreign content survives a KEEP set', async () => {
    useInterests(['cigars'], [])
    expect(allowsHere({ sig: SIG_A })).toBe(true)
    expect(await allows({ sig: SIG_A })).toBe(true)
  })

  it('a drop beats a keep — a refusal is not overridable by a positive match', async () => {
    useInterests(['cigars'], ['malicious'])
    sigMarks.set(SIG_A, ['cigars', 'malicious'])
    expect(await allows({ sig: SIG_A })).toBe(false)
  })

  // ── the address ─────────────────────────────────────────────────────────
  //
  // THE COLLISION THIS REPLACED. The gate used to read the LOCATION carrier:
  // a peer's tile was judged by whatever the participant had painted at the
  // path the tile would land on. Co-located same-name is ordinary — the tile
  // source's kind:name dedup exists for it, and a reference tile is named
  // after its target by construction — so a stranger's tile inherited a
  // verdict earned by yours, in both directions. Only a content address
  // survives crossing a hive boundary, so only a signature is admissible.
  describe('judged by the content address', () => {
    it('an offering with no signature carries no marks and is allowed', async () => {
      useInterests([], ['malicious'])
      expect(allowsHere({})).toBe(true)
      expect(await allows({})).toBe(true)
      expect(await allows({ sig: 'not-a-signature' })).toBe(true)
    })

    it('two offerings that would land at one path are judged separately', async () => {
      useInterests([], ['malicious'])
      sigMarks.set(SIG_A, ['malicious'])   // yours, marked
      // SIG_B is a stranger's, arriving at the same place, unmarked.
      expect(await allows({ sig: SIG_A })).toBe(false)
      expect(await allows({ sig: SIG_B })).toBe(true)
    })

    // A RATCHET, not a preference. Nothing about a location read LOOKS wrong at
    // a call site — `tagsForSegments([...loc.segments, name])` reads like the
    // obvious thing to ask — so the defect is one import away from returning
    // and no verdict test can see it coming. The import is the thing to hold.
    it('the gate cannot reach the location carrier at all', () => {
      const source = readFileSync(join(__dirname, 'intake-filter.ts'), 'utf8')
      const imports = (source.match(/^import[\s\S]*?from\s*'[^']*'/gm) ?? []).join(' ')
      expect(imports).not.toMatch(/decoration-kind-index/)
      expect(imports).not.toMatch(/tagsFor(Segments|Label)/)
      // `marksOf` is the UNION read — it folds the location carrier back in,
      // so reaching for it undoes this just as completely as the import would.
      expect(source).not.toMatch(/\bmarksOf\b/)
    })

    it('a signature is judged the same wherever it arrives', async () => {
      useInterests([], ['malicious'])
      sigMarks.set(SIG_A, ['malicious'])
      expect(await allows({ sig: SIG_A })).toBe(false)
      expect(await allows({ sig: SIG_A.toUpperCase() })).toBe(false)
    })
  })

  // The load-bearing difference between the two gates. A mark the participant
  // has not yet read is invisible to the sync gate — deliberately, since that
  // read runs per tile per frame — so the tile still DRAWS and is refused at
  // the commit. Hide first, delete second.
  describe('the sync gate', () => {
    it('allows an unread signature, and is refused by the async one', async () => {
      useInterests([], ['malicious'])
      sigMarks.set(SIG_A, ['malicious'])
      expect(allowsHere({ sig: SIG_A })).toBe(true)
      expect(await allows({ sig: SIG_A })).toBe(false)
    })

    // `hide first` has to become true at SOME point or the sync gate is
    // ceremony. The miss kicks the read; the next pass refuses.
    it('kicks the read on a miss, so the next pass refuses', async () => {
      useInterests([], ['malicious'])
      sigMarks.set(SIG_A, ['malicious'])
      expect(allowsHere({ sig: SIG_A })).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(allowsHere({ sig: SIG_A })).toBe(false)
    })

    it('kicks a signature once, however many frames render it', async () => {
      useInterests([], ['malicious'])
      for (let i = 0; i < 20; i++) allowsHere({ sig: SIG_A })
      await new Promise(resolve => setTimeout(resolve, 0))
      for (let i = 0; i < 20; i++) allowsHere({ sig: SIG_A })
      expect(reads).toBe(1)
    })
  })

  // THE GAP THAT SHIPPED INERT. Nothing else in the tree calls ensureLoaded, so
  // if the gate does not kick it the registry's sets stay empty forever and
  // every verdict is `true` — a filter that is present, tested and never once
  // refuses anything. These tests are the ones that would have caught it.
  describe('loading the registry', () => {
    /** A registry whose sets only populate once ensureLoaded resolves. */
    const lazyRegistry = (drop: string[]) => {
      let loaded = false
      const reg = {
        calls: 0,
        filters: () => true,
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
      sigMarks.set(SIG_A, ['malicious'])
      // Without the await this is `true` — the filter is still cold.
      expect(await allows({ sig: SIG_A })).toBe(false)
    })

    it('the sync gate kicks the load without awaiting it', async () => {
      const reg = lazyRegistry(['malicious'])
      sigMarks.set(SIG_A, ['malicious'])
      expect(allowsHere({ sig: SIG_A })).toBe(true)   // still cold — allowed
      expect(reg.calls).toBe(1)                        // but the load was started
      await new Promise(resolve => setTimeout(resolve, 0))   // flush load + kick
      expect(allowsHere({ sig: SIG_A })).toBe(false)   // warm now — refused
    })

    it('loads once per registry, however many times the gates are called', async () => {
      const reg = lazyRegistry([])
      allowsHere({ sig: SIG_A })
      allowsHere({ sig: SIG_B })
      await allows({ sig: SIG_A })
      await allows({ sig: SIG_B })
      expect(reg.calls).toBe(1)
    })

    // The registry keeps its own retry open when the Store is not in IoC yet.
    // Caching the ATTEMPT here closed that door: one intake beating Store
    // registration left the filter inert for the whole session.
    it('a load that did not land is retried, not latched', async () => {
      let loaded = false
      const reg = {
        calls: 0,
        filters: () => true,
        allows: (marks: readonly string[]) => !loaded || !marks.includes('malicious'),
        isLoaded: () => loaded,
        ensureLoaded: async () => {
          reg.calls++
          await Promise.resolve()
          if (reg.calls >= 2) loaded = true      // the Store showed up late
        },
      }
      ;(window as any).__reg = { '@hypercomb.social/InterestRegistry': reg }
      sigMarks.set(SIG_A, ['malicious'])

      expect(await allows({ sig: SIG_A })).toBe(true)   // cold, allowed
      expect(reg.calls).toBe(1)
      expect(await allows({ sig: SIG_A })).toBe(false)  // asked again, now warm
      expect(reg.calls).toBe(2)
    })

    it('stops asking once the load has landed', async () => {
      const reg = {
        calls: 0,
        filters: () => false,
        allows: () => true,
        isLoaded: () => true,
        ensureLoaded: async () => { reg.calls++; await Promise.resolve() },
      }
      ;(window as any).__reg = { '@hypercomb.social/InterestRegistry': reg }
      await allows({ sig: SIG_A })
      await allows({ sig: SIG_B })
      await allows({ sig: SIG_A })
      expect(reg.calls).toBe(1)
    })

    it('a registry that cannot load still allows — intake never breaks on it', async () => {
      ;(window as any).__reg = {
        '@hypercomb.social/InterestRegistry': {
          filters: () => true,
          allows: () => true,
          ensureLoaded: async () => { throw new Error('OPFS unavailable') },
        },
      }
      sigMarks.set(SIG_A, ['whatever'])
      expect(await allows({ sig: SIG_A })).toBe(true)
      expect(allowsHere({ sig: SIG_A })).toBe(true)
    })
  })
})
