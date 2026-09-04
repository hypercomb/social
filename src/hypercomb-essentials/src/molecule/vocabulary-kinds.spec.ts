// molecule/vocabulary-kinds.spec.ts
//
// POOL KINDS, WIRED READ-SIDE — and PROVED DELETION-NEUTRAL.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE INVARIANT THIS FILE EXISTS FOR
// ═══════════════════════════════════════════════════════════════════════════
//
// There is exactly ONE production consumer of a pool kind today, and it is a
// REACHABILITY answer: `history.service.ts` resolves the kind of a directory
// and feeds `poolCreditsMemberNames(facts)` into the prune reference walk. A
// kind whose `wipeSafe` is true UN-PINS that pool's member NAMES from the
// walk — which is correct for a derived cache and CATASTROPHIC for a pool
// that is really state, because the collector then reclaims live content.
//
// So: not one meaning declared by this change may be `index`. Asserted
// mechanically below, so a later hand cannot quietly flip one. `index` is the
// tempting declaration — it sounds like "a lookup table" — and it is the only
// kind that can move a byte. Nothing here declares it.
//
// The other direction is guarded by construction: `declarePoolKind` is called
// with a COMPILE-TIME CONSTANT at both sites, never with a parsed value, so a
// `PoolKindClaim` arriving from a stranger's host can never reach the map and
// get a vote on what this participant's collector reclaims.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  poolCreditsMemberNames,
  poolKindOfMeaning,
} from '@hypercomb/core'

// Importing the modules is what runs their `declarePoolKind` calls — the
// declaration lives beside the meaning, so loading the owner IS the wiring.
const iocMap = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (k: string, v: unknown) => { if (!iocMap.has(k)) iocMap.set(k, v) },
    get: (k: string) => iocMap.get(k),
    whenReady: () => { /* no store in a spec */ },
  },
}

const { VOCABULARY_LEDGER_MEANING, VOCABULARY_SEEN_MEANING } = await import('./vocabulary-ledger.js')
const { LLM_PROVIDERS_POOL } = await import('../assistant/providers/provider-discovery.js')

/** Every meaning this change declares a kind for. */
const DECLARED_HERE = [
  VOCABULARY_LEDGER_MEANING,
  VOCABULARY_SEEN_MEANING,
  LLM_PROVIDERS_POOL,
]

describe('the kinds this change declares', () => {
  it('declares the two vocabulary pools as sets, beside their own meanings', () => {
    expect(poolKindOfMeaning(VOCABULARY_LEDGER_MEANING)?.kind).toBe('set')
    expect(poolKindOfMeaning(VOCABULARY_SEEN_MEANING)?.kind).toBe('set')
  })

  it('DELETION-NEUTRAL: every one of them still credits its member names', () => {
    // The one live consumer answers byte-identically to the no-declaration
    // run. This is the whole safety argument for declaring anything at all.
    for (const meaning of DECLARED_HERE) {
      const facts = poolKindOfMeaning(meaning)
      expect(poolCreditsMemberNames(facts), `${meaning} stopped pinning its members`).toBe(true)
      expect(facts?.wipeSafe, `${meaning} was declared wipe-safe`).toBe(false)
    }
  })

  it('introduces NO new `index` declaration anywhere', () => {
    for (const meaning of DECLARED_HERE) {
      expect(poolKindOfMeaning(meaning)?.kind).not.toBe('index')
    }
  })

  it('declares kinds as DATA beside each meaning, never in a central table', () => {
    const ledger = readFileSync(
      join(process.cwd(), 'hypercomb-essentials', 'src', 'molecule', 'vocabulary-ledger.ts'), 'utf8')
    const providers = readFileSync(
      join(process.cwd(), 'hypercomb-essentials', 'src', 'assistant', 'providers', 'provider-discovery.ts'),
      'utf8')
    expect(ledger).toContain("declarePoolKind(VOCABULARY_LEDGER_MEANING, 'set')")
    expect(ledger).toContain("declarePoolKind(VOCABULARY_SEEN_MEANING, 'set')")
    expect(providers).toContain("declarePoolKind(LLM_PROVIDERS_POOL, 'set')")
  })

  it('passes a CONSTANT, never a parsed value — no wire claim can vote', () => {
    for (const file of [
      join('hypercomb-essentials', 'src', 'molecule', 'vocabulary-ledger.ts'),
      join('hypercomb-essentials', 'src', 'assistant', 'providers', 'provider-discovery.ts'),
    ]) {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
      for (const call of src.match(/declarePoolKind\([^)]*\)/g) ?? []) {
        // An identifier and a quoted kind. Anything else — a variable kind, a
        // property access, a `readClaim(...)` result — fails here.
        expect(call, file).toMatch(/^declarePoolKind\([A-Z_][A-Z0-9_]*, '(set|document|succession)'\)$/)
      }
    }
  })
})

describe('a kind never reaches a delete', () => {
  it('no destruction site in this change consults one', () => {
    // The natural-looking wirings are refused on purpose and named in the
    // report: `runtime/store.ts putPoolDoc` (a sibling SWEEP gated on a colon
    // heuristic), `runtime/packed-collect.ts` (crediting names would WIDEN a
    // sweep), `runtime/acquire.ts evict`, and `history.service.ts
    // removeLineageBag` (which answers to the registry, not to a kind).
    for (const file of [
      join('hypercomb-runtime', 'src', 'store.ts'),
      join('hypercomb-runtime', 'src', 'packed-collect.ts'),
      join('hypercomb-runtime', 'src', 'acquire.ts'),
      join('hypercomb-runtime', 'src', 'replication-walker.ts'),
    ]) {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
      expect(/poolKindOf(Meaning|Address)|poolKindFacts|poolCreditsMemberNames/.test(src), file).toBe(false)
    }
  })
})
