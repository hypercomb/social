// hypercomb-shared/core/interest-registry.spec.ts
//
// The interest registry's contract. Two things carry the weight:
//
//   1. POLARITY — an empty KEEP set is NO FILTER, not an empty hive, and a
//      DROP beats a KEEP. Get either backwards and the feature either does
//      nothing or blanks somebody's screen on upgrade.
//   2. IDENTITY — an interest's signature is a property of the SET, so two
//      participants who assemble the same one independently hold one
//      resource. That is what makes a filter shareable rather than shipped,
//      which is the whole cold-start answer.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g['register'] = () => { /* noop */ }
  g['get'] = () => undefined
  // jsdom's Blob has no `text()`; every real browser does. The registry reads
  // its resources with it (so does `bouquet-registry.ts`, which is why this
  // gap has gone unnoticed — that file has no spec). Polyfilling here makes
  // the environment match the browser rather than hiding anything: without it
  // every write silently returns null through `#putMarks`'s catch, and the
  // failures point at polarity logic that is in fact correct.
  const proto = Blob.prototype as unknown as { text?: () => Promise<string> }
  if (typeof proto.text !== 'function') {
    proto.text = function (this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(reader.error)
        reader.readAsText(this)
      })
    }
  }
})

/** An in-memory Store: a content-addressed resource bag plus one pool of
 *  named pointer files, which is all this registry touches. */
const makeStore = () => {
  const resources = new Map<string, string>()
  const pool = new Map<string, string>()
  return {
    resources,
    pool,
    // REALLY content-addressed, using the same signer the registry does.
    // A counter would still pass most of these tests while making the one
    // that matters — derived signature === stored signature — untestable,
    // and would quietly hide the dedup that makes an interest shareable.
    putResource: async (blob: Blob) => {
      const text = await blob.text()
      const sig = await SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer)
      resources.set(sig, text)
      return sig
    },
    getResource: async (sig: string) =>
      resources.has(sig) ? new Blob([resources.get(sig)!]) : null,
    // A document pool, the shape `registry-document.ts` reads and writes: one
    // current member per meaning. The handle is the pool's identity here.
    getPool: async (meaning: string) => ({ meaning }),
    getPoolDoc: async (p: { meaning: string } | undefined) => {
      const held = p ? pool.get(p.meaning) : undefined
      return held === undefined ? null : new TextEncoder().encode(held).buffer
    },
    putPoolDoc: async (p: { meaning: string } | undefined, bytes: ArrayBuffer) => {
      if (!p) return null
      const text = new TextDecoder().decode(bytes)
      pool.set(p.meaning, text)
      return await SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer)
    },
  }
}

let store: ReturnType<typeof makeStore>
const { InterestRegistry } = await import('./interest-registry')

beforeEach(() => {
  store = makeStore()
  ;(window as any).ioc = { get: (k: string) => (k === '@hypercomb.social/Store' ? store : undefined) }
})

describe('interest registry — polarity', () => {
  it('allows everything before anything is loaded', () => {
    const reg = new InterestRegistry()
    expect(reg.allows(['anything'])).toBe(true)
    expect(reg.allows([])).toBe(true)
  })

  it('an empty KEEP set is no filter, not an empty hive', async () => {
    const reg = new InterestRegistry()
    await reg.save('mine', ['cigars'])
    // Saved, but not assigned to the KEEP role — so it filters nothing.
    expect(reg.allows(['knitting'])).toBe(true)
    expect(reg.allows([])).toBe(true)
  })

  it('once a KEEP interest holds the role, only enrolled marks survive', async () => {
    const reg = new InterestRegistry()
    await reg.save('mine', ['cigars', 'hexagons'])
    await reg.setRole('keep', 'mine')
    expect(reg.allows(['cigars'])).toBe(true)
    expect(reg.allows(['hexagons', 'unrelated'])).toBe(true)
    expect(reg.allows(['knitting'])).toBe(false)
    // Unmarked is NOT a mismatch — see the "unknown is not absent" test below.
    expect(reg.allows([])).toBe(true)
  })

  it('a DROP refuses regardless of a positive match', async () => {
    const reg = new InterestRegistry()
    await reg.save('mine', ['cigars'])
    await reg.save('never', ['malicious'])
    await reg.setRole('keep', 'mine')
    await reg.setRole('drop', 'never')
    expect(reg.allows(['cigars'])).toBe(true)
    expect(reg.allows(['cigars', 'malicious'])).toBe(false)
    expect(reg.allows(['malicious'])).toBe(false)
  })

  // THE BLOCKER AN ADVERSARIAL REVIEW RAISED AND ITS OWN SKEPTICS WRONGLY KILLED.
  // Both mark carriers are participant-LOCAL, so content that just arrived from
  // somebody else presents ZERO marks. If a KEEP set judged that as a mismatch,
  // naming one interest would blank the swarm, kill published-pool discovery and
  // make every offered branch untakeable.
  it('UNKNOWN IS NOT ABSENT — a KEEP set never refuses unmarked content', async () => {
    const reg = new InterestRegistry()
    await reg.save('mine', ['cigars'])
    await reg.setRole('keep', 'mine')
    // A peer's tile: nothing local knows any mark for it.
    expect(reg.allows([])).toBe(true)
    // Something that DOES carry marks, none of them yours, is still refused —
    // that is the filter doing its job rather than a blackout.
    expect(reg.allows(['knitting'])).toBe(false)
    expect(reg.allows(['cigars'])).toBe(true)
  })

  it('a DROP cannot fire on absence — there is nothing to match', async () => {
    const reg = new InterestRegistry()
    await reg.save('never', ['malicious'])
    await reg.setRole('drop', 'never')
    // No marks means nothing to match, so nothing to refuse. A DROP that fired
    // on absence would be refusing everything it has never heard of.
    expect(reg.allows([])).toBe(true)
  })

  it('a DROP alone still lets unmarked content through', async () => {
    const reg = new InterestRegistry()
    await reg.save('never', ['malicious'])
    await reg.setRole('drop', 'never')
    expect(reg.allows(['ordinary'])).toBe(true)
    expect(reg.allows(['malicious'])).toBe(false)
  })

  it('clearing a role restores no-filter', async () => {
    const reg = new InterestRegistry()
    await reg.save('mine', ['cigars'])
    await reg.setRole('keep', 'mine')
    expect(reg.allows(['knitting'])).toBe(false)
    await reg.setRole('keep', '')
    expect(reg.allows(['knitting'])).toBe(true)
  })

  it('removing an interest clears any role pointing at it', async () => {
    const reg = new InterestRegistry()
    await reg.save('mine', ['cigars'])
    await reg.setRole('keep', 'mine')
    await reg.remove('mine')
    expect(reg.roles.keep).toBeUndefined()
    expect(reg.allows(['knitting'])).toBe(true)
  })

  it('a role cannot point at an interest that does not exist', async () => {
    const reg = new InterestRegistry()
    expect(await reg.setRole('keep', 'ghost')).toBe(false)
    expect(reg.roles.keep).toBeUndefined()
  })
})

describe('interest registry — identity', () => {
  it('the signature is a property of the SET, not the picking order', async () => {
    const reg = new InterestRegistry()
    const a = await reg.signatureOf(['b', 'a', 'a', ' b '])
    const b = await reg.signatureOf(['a', 'b'])
    expect(a).toBe(b)
    // And the order is code-unit, not collation — the property that lets two
    // participants on different runtimes land on ONE resource.
    expect(await reg.signatureOf(['B', 'a'])).toBe(await reg.signatureOf(['a', 'B']))
  })

  it('an empty set has no signature', async () => {
    const reg = new InterestRegistry()
    expect(await reg.signatureOf([])).toBeNull()
    expect(await reg.signatureOf(['  '])).toBeNull()
  })

  it('the derived signature and the stored one agree', async () => {
    const reg = new InterestRegistry()
    const derived = await reg.signatureOf(['cigars', 'hexagons'])
    const stored = await reg.save('mine', ['hexagons', 'cigars'])
    expect(stored).toBe(derived)
  })

  // The cold-start answer: a filter is a signature somebody can hand you.
  it('adopts an interest by signature alone, with no author and no network', async () => {
    const author = new InterestRegistry()
    const sig = await author.save('theirs', ['malicious', 'spam'])
    expect(sig).toBeTruthy()

    const reader = new InterestRegistry()
    expect(await reader.adopt('borrowed', sig!)).toBe(true)
    expect(reader.marks('borrowed')).toEqual(['malicious', 'spam'])

    await reader.setRole('drop', 'borrowed')
    expect(reader.allows(['spam'])).toBe(false)
    expect(reader.allows(['ordinary'])).toBe(true)
  })

  it('editing an adopted interest makes it a different signature, binding nobody', async () => {
    const author = new InterestRegistry()
    const original = await author.save('theirs', ['malicious'])
    const reader = new InterestRegistry()
    await reader.adopt('borrowed', original!)
    const edited = await reader.save('borrowed', ['malicious', 'also-this'])
    expect(edited).not.toBe(original)
    // The author's resource is untouched — content is immutable.
    expect(author.marks('theirs')).toEqual(['malicious'])
  })

  it('refuses a signature that resolves to nothing', async () => {
    const reg = new InterestRegistry()
    expect(await reg.adopt('nope', 'a'.repeat(64))).toBe(false)
    expect(await reg.adopt('nope', 'not-a-signature')).toBe(false)
  })

  it('survives a reload — roles and marks come back', async () => {
    const first = new InterestRegistry()
    await first.save('mine', ['cigars'])
    await first.save('never', ['malicious'])
    await first.setRole('keep', 'mine')
    await first.setRole('drop', 'never')

    const second = new InterestRegistry()
    await second.ensureLoaded()
    expect(second.names).toEqual(['mine', 'never'])
    expect(second.roles).toEqual({ keep: 'mine', drop: 'never' })
    expect(second.allows(['cigars'])).toBe(true)
    expect(second.allows(['cigars', 'malicious'])).toBe(false)
    expect(second.allows(['knitting'])).toBe(false)
  })
})
