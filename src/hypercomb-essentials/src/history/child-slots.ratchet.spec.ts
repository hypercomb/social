// history/child-slots.ratchet.spec.ts
//
// ONE ROSTER, NOT FOUR. `CHILD_SLOTS = ['cells', 'layers', 'children']` is
// declared once, in hypercomb-core/src/core/level-roster.ts, and consumed from
// `@hypercomb/core` everywhere (documentation/life-primitive.md). Four files
// had restated it privately; a fifth would drift the moment the roster grew.
// Empty allowlist: import the roster instead.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SCAN = ['hypercomb-essentials/src', 'hypercomb-shared', 'hypercomb-runtime/src', 'hypercomb-web/src', 'hypercomb-dev/src']
const LITERAL = /\[\s*['"]cells['"]\s*,\s*['"]layers['"]\s*,\s*['"]children['"]\s*\]/

// A directory that cannot be listed throws: every SCAN root is tracked, so a
// silent `return []` could only ever pass a scan that did not happen.
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) return []
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    if (!name.endsWith('.ts') || name.endsWith('.spec.ts') || name.endsWith('-keys.ts')) return []
    return [full]
  })

const codeOnly = (src: string): string =>
  src.split(/\r?\n/).filter(line => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')).join('\n')

describe('the child-slot roster', () => {
  // READ IN A HOOK, WITH ITS OWN BUDGET. This walk reads ~1200 files. Warm
  // that is well under a second, but on a cold disk — the first run after
  // the machine boots — it took longer than one test's 5 s, and the ratchet
  // timed out with nothing wrong. The scan is unchanged; only its reading
  // moved out of the test's budget (same fix as doctrine.spec.ts).
  let offenders: string[] = []
  beforeAll(() => {
    offenders = SCAN.flatMap(dir => walk(join(ROOT, dir)))
      .filter(file => LITERAL.test(codeOnly(readFileSync(file, 'utf8'))))
      .map(file => relative(ROOT, file).replace(/\\/g, '/'))
      .sort()
  }, 120_000)

  it('is restated nowhere outside core — every consumer imports CHILD_SLOTS', () => {
    expect(offenders, '\nA PRIVATE COPY OF CHILD_SLOTS — import it from @hypercomb/core instead.\n').toEqual([])
  })
})
