// context-window.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// The three `context.count.*` families carry .one/.other plural variants. A
// plural key whose base does not exist resolves ONLY through the count path,
// so dropping a variant breaks the surface for exactly one cardinality —
// the kind of bug that survives a manual look.

import { describe, expect, it } from 'vitest'
import { CONTEXT_WINDOW_TRANSLATIONS } from './context-window.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'context.ask',
  'context.close',
  'context.count.branches.one',
  'context.count.branches.other',
  'context.count.signatures.one',
  'context.count.signatures.other',
  'context.count.tiles.one',
  'context.count.tiles.other',
  'context.detach',
  'context.row.truncated',
  'context.row.unreadable',
  'context.window.broken',
  'context.window.empty',
  'context.window.loading',
  'context.window.title',
  'context.window.truncated',
].sort()

describe('context-window catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(CONTEXT_WINDOW_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(CONTEXT_WINDOW_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(CONTEXT_WINDOW_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["context."]
    for (const catalog of Object.values(CONTEXT_WINDOW_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
