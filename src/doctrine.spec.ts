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

  it('shell templates mount only structural chrome — every other surface is registry-fed', () => {
    // The shell-surface registry drain (2026-07-09) emptied app.html of
    // hand-mounted panels: surfaces self-register via registerShellSurface()
    // and the barrel (shared/ui/shell-surfaces/shell-surfaces.barrel.ts) is
    // the ONE list. Only bound/structural chrome may appear as a template
    // tag. Adding a new <hc-*> tag to a shell template reintroduces the
    // web/dev drift bug class — register the surface instead. A structural
    // tag leaving a template = debt paid; remove it here so the ratchet
    // clicks tight.
    const TEMPLATE_ALLOW: Record<string, string[]> = {
      'hypercomb-web/src/app/app.html': [
        'app-header', 'hc-controls-bar', 'hc-edit-actions', 'hc-mesh-header',
        'hc-shell-surfaces', 'hc-sync-indicator', 'hc-upgrade-indicator', 'router-outlet',
      ],
      'hypercomb-dev/src/app/app.html': [
        'hc-command-line', 'hc-controls-bar', 'hc-edit-actions', 'hc-mesh-header',
        'hc-shell-surfaces', 'hc-sync-indicator', 'hc-upgrade-indicator', 'router-outlet',
      ],
    }
    for (const [file, allowed] of Object.entries(TEMPLATE_ALLOW)) {
      const html = readFileSync(join(ROOT, file), 'utf8')
      const tags = [...new Set(
        [...html.matchAll(/<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)[\s>]/g)].map(m => m[1]),
      )].sort()
      assertRatchet(tags, allowed, `template surface (${file})`)
    }
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

  it('children-bearing layer commits ride the LayerCommitter FIFO — no inline-children commitLayer', () => {
    // A direct history.commitLayer(...) whose assembled layer carries a
    // `children` key is a read-modify-write OUTSIDE the committer's
    // serialised commit chain: interleaved with a FIFO commit on the same
    // bag, last-marker-wins silently drops the other commit's child — true
    // tile loss (the reference.queen clobber, fixed 2026-07-11). Children
    // mutations must ride LayerCommitter (update / importTree /
    // commitChildrenDeltas / commitSlot* / bootstrapIfEmpty).
    //
    // Heuristic: a bare `children` token between `commitLayer(` and the
    // first `)`. Catches inline `{ ..., children: [...] }` layer literals
    // (multi-line included), `children` property shorthand, and
    // `children?:` in a commitLayer type member that invites the pattern.
    // KNOWN LIMITS it cannot see: a layer assembled in a variable and
    // passed whole — the committer's own `commitLayer(sig,
    // machine.output())` (sanctioned), flatten.queen's byte-verbatim head
    // re-commit, and history.service's promoteToHead / mergeEntries
    // (frozen debt: they address a one-way locationSig that cannot reach
    // the committer's segments-based API — see the comment block at their
    // definition). Empty allowlist: never write an inline-children
    // commitLayer again.
    const actual = filesMatching(/commitLayer\s*\([^)]*\bchildren\b/)
    assertRatchet(actual, [], 'inline-children commitLayer')
  })

  it('no literal control bytes in source — use escape sequences', () => {
    // A literal NUL (or other C0 control) byte in a string literal is
    // invisible in every editor and gets silently STRIPPED by common
    // tooling. That exact failure turned layer-committer's path
    // separator `join('\u0000')` into `join('')` (22d905a0) — decode
    // split per CHARACTER, every create committed its child under a
    // bogus per-letter path, and tiles vanished on creation. Control
    // characters in source must be written as escape sequences
    // ('\u0000', '\x1f', ...) — never as raw bytes. Empty allowlist:
    // this may never regress.
    const hits = new Set<string>()
    // eslint-disable-next-line no-control-regex
    const control = new RegExp('[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]')
    for (const dir of SCAN_DIRS) {
      let files: string[]
      try { files = walk(join(ROOT, dir)) } catch { continue }
      for (const file of files) {
        // RAW read — comments included; a control byte anywhere is a hazard.
        if (control.test(readFileSync(file, 'utf8'))) {
          hits.add(relative(ROOT, file).replace(/\\/g, '/'))
        }
      }
    }
    assertRatchet([...hits].sort(), [], 'literal control byte')
  })

  it('view:active is emitted only by the ModeRegistry — never a raw boolean broadcast', () => {
    // A full-surface mode (view:active) broadcast as a single-slot boolean by
    // whoever emitted last was a real desync bug class: a modal/photo closing
    // over an open website view emitted view:active{false} and unhid the chrome
    // UNDER the still-open view, which never re-asserted true (2026-07-22). The
    // cure is owner-counted state — ModeRegistry.enter/exit, active while ANY
    // owner holds, aggregate emitted (by dynamic `mode` var, never the literal)
    // only on a 0<->1 transition. Every surface must route through enter()/exit()
    // instead of emitting the literal. Empty allowlist: a direct
    // emit('view:active') may never return — register an owner instead.
    const actual = filesMatching(/(?:emitEffect|EffectBus\.emit(?:Transient)?)\s*(?:<[^>]*>)?\s*\(\s*['"`]view:active['"`]/)
    assertRatchet(actual, [], 'raw view:active emit')
  })
})
