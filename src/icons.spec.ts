// icons.spec.ts — the icon subset must match the icons the UI renders
//
// The Material Symbols font ships SUBSET (documentation/no-third-party-
// requests.md): ~375 of ~4300 glyphs, 397K instead of 3.9MB. The subset is
// derived from source by scripts/icon-names.cjs and baked by
// scripts/fetch-fonts.cjs, which writes the list it asked for to
// `<shell>/public/fonts/icons.txt`.
//
// Nothing enforces that the baked font is still level with the source. That
// gap is not theoretical — `nearby` and `subject`, both returned by
// controls-bar's `#rawIconSymbol`, were absent from the subset and reached
// the shell as the literal WORDS. fetch-fonts.cjs has claimed since it was
// written that "icons.spec.ts fails if you don't [rerun]". This is that file,
// written after the drift it was supposed to prevent had already shipped.
//
// A glyph outside the subset does NOT render as blank space: `.mat-sym` falls
// back to `system-ui`, so the ligature name renders as readable text in the
// middle of the UI. That is what makes this worth a test rather than a glance
// — the failure looks like a layout bug, not a missing font.

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'node:module'

const ROOT = __dirname

// `require` rather than `import`: icon-names.cjs is the one input
// fetch-fonts.cjs itself consumes, and the test must read the SAME module
// rather than a re-implementation of it.
const derived: readonly string[] = createRequire(join(ROOT, 'icons.spec.ts'))(
  './scripts/icon-names.cjs',
) as string[]

// Every shell that ships a self-hosted icon font. A shell with no icons.txt
// does not subset and is skipped — but one that HAS the file and is missing
// from this list is unchecked, so add a shell here when you give it fonts.
const SHELLS = ['hypercomb-dev', 'hypercomb-web', 'hypercomb-shim'] as const

const shippedAt = (shell: string): string => join(ROOT, shell, 'public', 'fonts', 'icons.txt')

const readShipped = (shell: string): string[] =>
  readFileSync(shippedAt(shell), 'utf8')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)

// Mirrors the request fetch-fonts.cjs builds. Google silently IGNORES
// ?icon_names= past roughly 4.3KB and serves the whole 3.9MB font instead, so
// the real ceiling is a URL length, not a name count.
const URL_LIMIT = 4000 // keep level with URL_LIMIT in scripts/fetch-fonts.cjs
const subsetUrl = (names: readonly string[]): string =>
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined'
  + ':opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200'
  + `&icon_names=${names.join(',')}&display=block`

describe('icon subset', () => {
  const present = SHELLS.filter(s => existsSync(shippedAt(s)))

  it('has at least one shell shipping a subset', () => {
    // If this fails the rest of the suite is vacuously green.
    expect(present.length).toBeGreaterThan(0)
  })

  for (const shell of present) {
    it(`${shell} ships exactly the icons the source renders`, () => {
      const shipped = readShipped(shell)
      const shippedSet = new Set(shipped)
      const derivedSet = new Set(derived)

      // Missing is the one that breaks the UI: the name renders as a word.
      const missing = derived.filter(n => !shippedSet.has(n))
      expect(
        missing,
        `${shell}: ${missing.length} icon(s) used in source are NOT in the baked font — `
        + `they will render as their own NAMES. Re-run:\n`
        + `  node scripts/fetch-fonts.cjs ${shell}/public/fonts <families…>\n`
        + `  (the exact family list is in ${shell}/src/index.html, beside the stylesheet link)`,
      ).toEqual([])

      // Stale is harmless on screen but means the font was baked from a list
      // that no longer exists, so the next regeneration silently changes size.
      const stale = shipped.filter(n => !derivedSet.has(n))
      expect(
        stale,
        `${shell}: ${stale.length} icon(s) are baked into the font but no longer used in source. `
        + `Re-run fetch-fonts.cjs to drop them.`,
      ).toEqual([])
    })
  }

  it('all shells ship the identical subset', () => {
    // They are derived from ONE source list, so any difference means a shell
    // was not regenerated — the drift is invisible until that shell renders a
    // glyph the others have.
    const byShell = present.map(s => [s, readShipped(s).join('\n')] as const)
    const [, first] = byShell[0]
    for (const [shell, list] of byShell) {
      expect(list, `${shell} ships a different subset from ${byShell[0][0]}`).toBe(first)
    }
  })

  it('stays under the URL ceiling that silently disables subsetting', () => {
    const len = subsetUrl(derived).length
    expect(
      len,
      `the icon_names request is ${len} bytes (limit ${URL_LIMIT}). Past roughly 4.3KB `
      + `Google ignores it and serves the full 3.9MB font — a 10x regression no render `
      + `check can catch, because the full font resolves every name. Trim `
      + `scripts/icon-names.extra.txt or the picker list.`,
    ).toBeLessThanOrEqual(URL_LIMIT)
  })

  it('derives the glyphs that resolvers return, not just template literals', () => {
    // Regression pin for the drift above. `nearby` and `subject` exist ONLY as
    // `return` values inside controls-bar's `#rawIconSymbol` — no template
    // mentions either — so they are the proof that rule 4 in icon-names.cjs is
    // still doing its job. Every compound name in that switch is also written
    // literally in some template, which is exactly why the hole went unnoticed.
    expect(derived).toContain('nearby')
    expect(derived).toContain('subject')
  })

  it('does not send resolver sentinels to the font service', () => {
    // `opaque` is websites-group's "unknowable site" marker, returned from an
    // icon-named function. It is not a Material glyph, and asking for it puts
    // a name in the subset request that no font has.
    expect(derived).not.toContain('opaque')
  })
})
