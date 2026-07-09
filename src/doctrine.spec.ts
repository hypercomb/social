// doctrine.spec.ts — signature-primitive ratchets
//
// Mechanical guards against backward drift on the core doctrine
// (see documentation/optimize-phase.md and documentation/
// signature-primitive-audit-2026-07.md). Each check compares the set of
// files matching a forbidden pattern against a FROZEN allowlist:
//
//   - a file appearing that is NOT in the list  → new drift. Fix the
//     code; never extend the list.
//   - a listed file no longer matching          → debt paid. Remove it
//     from the list so the ratchet clicks tight.
//
// The lists may only shrink.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

const ROOT = __dirname

// the five-tier packages + shells; worktrees/dist/node_modules excluded
const SCAN_DIRS = [
  'hypercomb-core/src',
  'hypercomb-shared',
  'hypercomb-essentials/src',
  'hypercomb-essentials/scripts',
  'hypercomb-web/src',
  'hypercomb-dev/src',
  'hypercomb-avatars/src',
  'hypercomb-sdk/src',
  'hypercomb-cli/src',
]

const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', '.claude'])

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out)
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

type Hit = { file: string }

const filesMatching = (pattern: RegExp): string[] => {
  const hits = new Set<string>()
  for (const dir of SCAN_DIRS) {
    let files: string[]
    try { files = walk(join(ROOT, dir)) } catch { continue }
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'))
      if (pattern.test(code)) hits.add(relative(ROOT, file).replace(/\\/g, '/'))
    }
  }
  return [...hits].sort()
}

const assertRatchet = (actual: string[], allowed: string[], rule: string): void => {
  const allowedSet = new Set(allowed)
  const actualSet = new Set(actual)
  const drift = actual.filter(f => !allowedSet.has(f))
  const paid = allowed.filter(f => !actualSet.has(f))
  const msg =
    (drift.length ? `\nNEW DRIFT (${rule}) — fix the code, never extend the allowlist:\n  ${drift.join('\n  ')}\n` : '') +
    (paid.length ? `\nDEBT PAID (${rule}) — remove from the allowlist so the ratchet clicks:\n  ${paid.join('\n  ')}\n` : '')
  expect(drift.concat(paid), msg).toEqual([])
}

describe('doctrine ratchets', () => {

  it('synchronize is dispatched only by the processor (plus frozen boot-kick debt)', () => {
    // hypercomb.act()'s finally block is the sole sanctioned dispatcher.
    // (The three shell boot kicks were routed through act('') — debt paid.)
    const actual = filesMatching(/dispatchEvent\s*\(\s*new\s+(?:Custom)?Event\s*\(\s*['"`]synchronize['"`]/)
    assertRatchet(actual, [
      'hypercomb-core/src/core/hypercomb.ts',   // the processor — sanctioned
    ], 'synchronize dispatch')
  })

  it('no hardcoded 64-hex signatures outside the documented empty-content sentinels', () => {
    // Pool addresses are DERIVED via Store.poolSignature(meaning) /
    // sign(meaning) — never hardcoded. The two allowed files hold the
    // documented sha256-of-empty sentinels only.
    const actual = filesMatching(/['"`][0-9a-f]{64}['"`]/)
    assertRatchet(actual, [
      'hypercomb-shared/core/store.ts',                                              // EMPTY_CONTENT_SIG
      'hypercomb-essentials/src/diamondcoreprocessor.com/history/history.service.ts', // EMPTY_LAYER_*_SIG
    ], 'hardcoded signature')
  })

  it('no new typed-folder (__x__) string literals — legacy names are drain-source constants only', () => {
    // Typed folders are eradicated. The only dirs in OPFS are
    // signature-named (lineage sigbags, sign(meaning) pools). This
    // catches BARE `'__x__'` dir-name literals in code (URL-path
    // fragments like '/content/__bees__/' are legacy fetch aliases, a
    // separate drain). Files below carry legacy names as read-fallback
    // drain constants (or known write debt: layout.service
    // `__layout__`, clipboard `__meta__`); they may only leave this
    // list as drains complete.
    const actual = filesMatching(/['"`]__[a-z][a-z0-9_-]*__['"`]/)
    assertRatchet(actual, [
      'hypercomb-shared/core/initializers/location-parser.ts',
      'hypercomb-shared/core/store.ts',
      'hypercomb-essentials/scripts/copy-to-dcp.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/assistant/structure-drop.worker.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/clipboard/clipboard.worker.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/commands/website-archive.queen.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/editor/viewport-store.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/history/history.service.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/move/layout.queen.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/move/layout.service.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/sharing/content-broker.drone.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/sharing/feedback-channel.drone.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/sharing/host-sync.service.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/sharing/push-queue.service.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/sharing/swarm.drone.ts',
    ], 'typed-folder literal')
  })

  it('derived-cache manifests are written only by the store, the optimize phase, and the render backfill', () => {
    // The commit path mints truth only. writeChildrenManifest is called
    // from the ManifestOptimizerDrone (processor optimize phase) and the
    // show-cell resolveChildNames backfill; store.ts defines it.
    const actual = filesMatching(/writeChildrenManifest/)
    assertRatchet(actual, [
      'hypercomb-shared/core/store.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/history/manifest-optimizer.drone.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/show-cell.drone.ts',
    ], 'children-manifest writer')
  })
})
