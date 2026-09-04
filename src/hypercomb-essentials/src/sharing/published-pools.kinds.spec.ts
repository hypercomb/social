// sharing/published-pools.kinds.spec.ts
//
// THE READ DECISION A KIND NOW ANSWERS: may this pool be OFFERED at all?
//
// `registerPublishedPool` had one structural guard — "the meaning must carry a
// colon" — standing in for "is this safe to publish". That guard is about
// address collision with a lineage bag, a different question, and it stays.
// Beside it now: `replicates`.
//
// It only ever REFUSES. The offered set can only get smaller, no byte moves,
// no reference is removed, and nothing here reaches a delete. UNDECLARED IS
// PERMITTED — the conservative direction, preserving today's behaviour exactly.

import { describe, expect, it } from 'vitest'

const iocMap = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (k: string, v: unknown) => { if (!iocMap.has(k)) iocMap.set(k, v) },
    get: (k: string) => iocMap.get(k),
    whenReady: () => { /* noop */ },
  },
}

const { declarePoolKind } = await import('@hypercomb/core')
const { registerPublishedPool, publishedPoolMeanings } = await import('./published-pools.js')

const handler = (meaning: string) => ({ meaning, accept: async () => null })

describe('what a domain may be allowed to offer', () => {
  it('accepts a `set` — a pool whose members are meant to travel', () => {
    declarePoolKind('spec:offerable', 'set')
    expect(() => registerPublishedPool(handler('spec:offerable'))).not.toThrow()
    expect(publishedPoolMeanings()).toContain('spec:offerable')
  })

  it('REFUSES a derived cache — an index is recomputable and is never sent', () => {
    // This is the case that matters: `molecule:index` is SEED-declared
    // `index`, and serving a wipe-safe GC-able record as if it were an answer
    // is the exact mistake the vocabulary claim exists to prevent. The
    // argument was doctrine; now it is a mechanism.
    expect(() => registerPublishedPool(handler('molecule:index'))).toThrow(/derived cache is never sent/)
    expect(publishedPoolMeanings()).not.toContain('molecule:index')
  })

  it('REFUSES a per-participant document', () => {
    expect(() => registerPublishedPool(handler('viewport'))).toThrow()
    declarePoolKind('spec:mine', 'document')
    expect(() => registerPublishedPool(handler('spec:mine'))).toThrow(/document is never sent/)
  })

  it('PERMITS an undeclared meaning — absence of a kind is not a licence to guess', () => {
    // Today's behaviour, preserved byte for byte. A kind is a declaration by
    // whoever mints the pool; nobody else may supply one on their behalf.
    expect(() => registerPublishedPool(handler('spec:undeclared'))).not.toThrow()
    expect(publishedPoolMeanings()).toContain('spec:undeclared')
  })

  it('still refuses a bare word — that guard was never about kinds', () => {
    expect(() => registerPublishedPool(handler('bareword'))).toThrow(/must carry a colon/)
  })

  it('addresses a pool through the REGISTRY, so `isPoolAddress` can see it', async () => {
    // It used to derive `sign(meaning)` through a private memo and a raw
    // `SignatureService.sign`, so a meaning known only through a handler never
    // entered the core registry — blinding the swarm walk's pool exclusion,
    // history's bag-removal refusal and folder-sync's labelling for that
    // address.
    const { isPoolAddress, registerPoolMeaning } = await import('@hypercomb/core')
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).join(process.cwd(), 'hypercomb-essentials', 'src', 'sharing', 'published-pools.ts'),
      'utf8')
    expect(src).toContain('const poolAddress = (meaning: string): Promise<string> => registerPoolMeaning(meaning)')
    expect(await isPoolAddress(await registerPoolMeaning('spec:offerable'))).toBe(true)
  })
})
