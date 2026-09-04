// molecule/vocabulary.queen.spec.ts
//
// THE COMMAND LINE CANNOT PUBLISH — proved, not asserted in a comment.
//
// The behaviour modules are imported DIRECTLY here, so everything below is
// verified without the `side-effects.ts` registration line a human still has
// to add. That line is reported in `deviations`; nothing in this file depends
// on it.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The queens self-register at import, so the shell global must exist first.
vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

import { EffectBus } from '@hypercomb/core'
import { VocabularyFindQueenBee } from './vocabulary-find.queen.js'
import { VOCABULARY_FIND, VOCABULARY_OPEN } from './vocabulary-words.js'
import { VocabularyQueenBee, readIntent } from './vocabulary.queen.js'

let emitted: { effect: string; payload: unknown }[] = []
let spy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  emitted = []
  spy = vi.spyOn(EffectBus, 'emit').mockImplementation((effect: string, payload: unknown) => {
    emitted.push({ effect, payload })
  })
})
afterEach(() => { spy.mockRestore() })

describe('/vocabulary — the handle, and nothing more', () => {
  it('emits ONE open request and performs no act', async () => {
    const queen = new VocabularyQueenBee()
    await queen.invoke('')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.effect).toBe(VOCABULARY_OPEN)
    expect(emitted[0]?.payload).toMatchObject({ intent: '' })
  })

  it('`/vocabulary publish` AIMS the window — the payload carries no confirmation', async () => {
    const queen = new VocabularyQueenBee()
    await queen.invoke('publish')
    const payload = emitted[0]?.payload as Record<string, unknown>
    expect(payload['intent']).toBe('publish')
    // The word the participant typed travels no further than a focus.
    expect('confirmed' in payload).toBe(false)
    expect(Object.keys(payload).sort()).toEqual(['at', 'intent'])
  })

  it('refuses to carry an intent it does not offer', async () => {
    expect(readIntent('publish')).toBe('publish')
    expect(readIntent('withdraw')).toBe('withdraw')
    expect(readIntent('PUBLISH now')).toBe('publish')
    expect(readIntent('yes-do-it')).toBe('')
    expect(readIntent('')).toBe('')
  })

  it('completes only its two verbs, synchronously', () => {
    const queen = new VocabularyQueenBee()
    expect(queen.slashComplete('')).toEqual(['publish', 'withdraw'])
    expect(queen.slashComplete('w')).toEqual(['withdraw'])
    expect(queen.slashComplete('zz')).toEqual([])
  })

  it('carries NO machine grammar — a model may not reach an irreversible public act', () => {
    expect(new VocabularyQueenBee().machine).toBeUndefined()
    expect(new VocabularyFindQueenBee().machine).toBeUndefined()
  })

  it('declares no alias — aliases are the participant’s to give', () => {
    expect(new VocabularyQueenBee().aliases).toEqual([])
    expect(new VocabularyFindQueenBee().aliases).toEqual([])
  })
})

describe('/find-word — free text, and never a rewritten argument', () => {
  it('offers NOTHING for completion, so `a.b` is never silently split into `a b`', () => {
    // `dottedToSpaced` rewrites a dotted argument whenever EVERY segment is a
    // word the completer offers. An empty completer makes that unreachable.
    const queen = new VocabularyFindQueenBee()
    expect(queen.slashComplete('')).toEqual([])
    expect(queen.slashComplete('cig')).toEqual([])
    expect(queen.options).toBeUndefined()
  })

  it('emits the word it was given, verbatim and trimmed', async () => {
    await new VocabularyFindQueenBee().invoke('  cigar  ')
    expect(emitted[0]?.effect).toBe(VOCABULARY_FIND)
    expect(emitted[0]?.payload).toMatchObject({ word: 'cigar' })
  })
})

// ---------------------------------------------------------------------------
// A NEW RATCHET OF MY OWN — not an extension of anyone's allowlist
// ---------------------------------------------------------------------------

describe('the publish door has exactly one caller', () => {
  it('no module outside the routine names publishVocabulary except the window', () => {
    const ROOT = process.cwd()
    const allowed = new Set([
      'hypercomb-essentials/src/molecule/vocabulary-publish.ts',
      'hypercomb-essentials/src/molecule/vocabulary-publish.deps.ts',
      // THE ONE SURFACE. `confirmed: true` is built at the press and nowhere
      // above it; a second caller is a second place that could stop asking.
      'hypercomb-essentials/src/molecule/vocabulary.view.ts',
    ])
    const hits: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name.startsWith('dist')) continue
          walk(full)
          continue
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue
        // `essentials-keys.ts` is auto-generated and gitignored: a facade that
        // lists EVERY exported symbol in the package, `publishVocabulary`
        // included. A ratchet that walks generated output is red the moment
        // the generator runs. Generated key facades are not callers.
        if (entry.name.endsWith('-keys.ts')) continue
        if (statSync(full).size > 2_000_000) continue
        const rel = full.slice(ROOT.length + 1).replace(/\\/g, '/')
        if (allowed.has(rel)) continue
        if (/\b(publishVocabulary|withdrawVocabulary)\b/.test(readFileSync(full, 'utf8'))) hits.push(rel)
      }
    }
    walk(join(ROOT, 'hypercomb-essentials', 'src'))
    walk(join(ROOT, 'hypercomb-shared'))
    expect(hits).toEqual([])
  })

  it('the QUEEN does not name it at all — the command line is not a caller', () => {
    const queen = readFileSync(
      join(process.cwd(), 'hypercomb-essentials', 'src', 'molecule', 'vocabulary.queen.ts'), 'utf8')
    // Comments stripped: the file EXPLAINS why it never publishes, and the
    // explanation must not be mistaken for the act.
    const code = queen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    expect(/publishVocabulary|withdrawVocabulary|confirmed/.test(code)).toBe(false)
  })
})
