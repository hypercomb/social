// history/child-slots.ratchet.spec.ts
//
// ONE ROSTER, NOT FOUR. `CHILD_SLOTS = ['cells', 'layers', 'children']` is
// declared once, in hypercomb-core/src/core/level-roster.ts, and consumed from
// `@hypercomb/core` everywhere (documentation/life-primitive.md). Four files
// had restated it privately; a fifth would drift the moment the roster grew.
// Empty allowlist: import the roster instead.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SCAN = ['hypercomb-essentials/src', 'hypercomb-shared', 'hypercomb-runtime/src', 'hypercomb-web/src', 'hypercomb-dev/src']
const LITERAL = /\[\s*['"]cells['"]\s*,\s*['"]layers['"]\s*,\s*['"]children['"]\s*\]/

const walk = (dir: string): string[] => {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return [] }
  return entries.flatMap(name => {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) return []
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    if (!name.endsWith('.ts') || name.endsWith('.spec.ts') || name.endsWith('-keys.ts')) return []
    return [full]
  })
}

const codeOnly = (src: string): string =>
  src.split(/\r?\n/).filter(line => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')).join('\n')

describe('the child-slot roster', () => {
  it('is restated nowhere outside core — every consumer imports CHILD_SLOTS', () => {
    const offenders = SCAN.flatMap(dir => walk(join(ROOT, dir)))
      .filter(file => LITERAL.test(codeOnly(readFileSync(file, 'utf8'))))
      .map(file => relative(ROOT, file).replace(/\\/g, '/'))
      .sort()
    expect(offenders, '\nA PRIVATE COPY OF CHILD_SLOTS — import it from @hypercomb/core instead.\n').toEqual([])
  })
})
