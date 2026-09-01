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
import { BARE_WORD_POOL_MEANINGS } from '@hypercomb/core'

const ROOT = __dirname

// Every package + shell; worktrees/dist/node_modules excluded.
//
// A RATCHET ONLY HOLDS WHAT IT CAN SEE, so a package missing from this list is
// not merely unchecked — it is an exit. When `hypercomb-runtime` was split out
// of `hypercomb-shared/core` and this list was not extended with it, three
// ratchets reported their `store.ts` entries as DEBT PAID: the file had not
// been cleaned up, it had walked out of the room, and pruning those entries as
// the message invites would have sealed the debt in permanently. Adding a
// package here is part of creating one.
const SCAN_DIRS = [
  'hypercomb-core/src',
  'hypercomb-shared',
  'hypercomb-runtime/src',
  'hypercomb-shim/src',
  'hypercomb-legacy/src',
  'hypercomb-essentials/src',
  'hypercomb-essentials/scripts',
  'hypercomb-web/src',
  'hypercomb-dev/src',
  'hypercomb-avatars/src',
  'hypercomb-sdk/src',
  'hypercomb-cli/src',
]

const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', '.claude'])

/** SOURCE only. `.d.ts` files are EMITTED ARTIFACTS — a declaration file is a
 *  shadow of the source beside it, so scanning one double-counts a file that
 *  is already scanned (and, being gitignored, it may or may not exist on any
 *  given checkout — a ratchet whose result depends on whether someone has run
 *  `tsc` lately is not a ratchet). Same category as skipping `dist`. */
const isSource = (name: string): boolean =>
  name.endsWith('.ts')
  && !name.endsWith('.d.ts')
  && !name.endsWith('.spec.ts')
  && !name.endsWith('.test.ts')

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out)
    } else if (isSource(entry.name)) {
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

  // ─── bridge scripts: a child sig is a LAYER sig, not a resource ──────
  //
  // `scripts/` is scanned on its own here (NOT added to SCAN_DIRS — the other
  // ratchets are about shipped source). Two patterns, one bug, verified live
  // 2026-08-30 against the authoring hive:
  //
  //   1. Decoding a child's NAME with `get-resource`. A parent's `children`
  //      slot holds LAYER sigs; `get-resource` on one answers "resource not
  //      found" for every entry, so the reader reports an EMPTY parent for a
  //      healthy hive — silently, and positively.
  //   2. Growing a parent with `update(..., { children: [...] })`. That is a
  //      SET op; the committer REPLACES the slot. It is only ever as safe as
  //      the read that fed it, and (1) made every such read a lie.
  //
  // Both are retired by scripts/lib/hive-children.mjs: existence per CHILD
  // PATH, creation via `op:'add'` (an APPEND). Anything matching below is a
  // new copy of the bug.

  const scriptFiles = (): string[] => {
    const out: string[] = []
    const walkScripts = (dir: string): void => {
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walkScripts(join(dir, entry.name))
        } else if (/\.(ts|cjs|mjs|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
          out.push(join(dir, entry.name))
        }
      }
    }
    walkScripts(join(ROOT, 'scripts'))
    return out
  }

  const scriptsMatching = (pattern: RegExp): string[] => {
    const hits = new Set<string>()
    for (const file of scriptFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'))
      if (pattern.test(code)) hits.add(relative(ROOT, file).replace(/\\/g, '/'))
    }
    return [...hits].sort()
  }

  it('no bridge script decodes a CHILD signature with get-resource', () => {
    // A `children` entry is a LAYER sig. Resolve it with `layer-by-sig` (one
    // hop) or `inflate` (whole subtree) — never `get-resource`, which cannot
    // answer for a layer and whose failure is indistinguishable from an empty
    // parent. Twelve scripts had this, several feeding the empty result into
    // an `update` carrying `children`, which the committer applies by
    // REPLACING the slot. All now read through scripts/lib/hive-children.mjs,
    // which throws rather than under-report.
    //
    // This matches only a LOOP OVER a children array that calls get-resource
    // inside it — `get-resource` on a properties or decoration sig is correct
    // and common, and is not matched.
    const actual = scriptsMatching(
      /(?:of|in)\s*\(?[^\n]{0,60}children[^\n]{0,40}\)?\s*\)?\s*\{?[\s\S]{0,160}?op:\s*['"`]get-resource['"`]/,
    )
    assertRatchet(actual, [], 'child sig decoded as a resource')
  })


  it('synchronize is dispatched only by the processor (plus frozen boot-kick debt)', () => {
    // hypercomb.act()'s finally block is the sole sanctioned dispatcher.
    // (The three shell boot kicks were routed through act('') — debt paid.)
    const actual = filesMatching(/dispatchEvent\s*\(\s*new\s+(?:Custom)?Event\s*\(\s*['"`]synchronize['"`]/)
    assertRatchet(actual, [
      'hypercomb-core/src/core/hypercomb.ts',   // the processor — sanctioned
    ], 'synchronize dispatch')
  })

  it('no behaviour declares an alias in code — aliases are the participant\'s to give', () => {
    // A behaviour's name is its ONE name. The 54 code-declared alias lists
    // (removed 2026-09-01) put every spelling into autocomplete, the common
    // tongue, and the help surfaces at once — three names for one verb,
    // polluting the census and making the command line harder to read, not
    // easier. The `aliases` seam stays (QueenBee.aliases, SlashBehaviour.
    // aliases) so PARTICIPANT-given aliases can ride it at runtime, but no
    // source file may ever assign one again. Matches any aliases
    // declaration whose array holds a string literal; argument-value
    // normalization maps (LOCALE_ALIASES etc.) are not behaviour names and
    // do not match. Empty allowlist, and it stays empty.
    const actual = filesMatching(
      /\baliases\s*(?::\s*\[\s*['"`]|(?::[^=\n]{0,60})?=\s*\[\s*['"`])/,
    )
    assertRatchet(actual, [], 'code-declared behaviour alias')
  })

  it('no hardcoded 64-hex signatures outside the documented empty-content sentinels', () => {
    // Pool addresses are DERIVED via Store.poolSignature(meaning) /
    // sign(meaning) — never hardcoded. The two allowed files hold the
    // documented sha256-of-empty sentinels only.
    const actual = filesMatching(/['"`][0-9a-f]{64}['"`]/)
    assertRatchet(actual, [
      'hypercomb-runtime/src/store.ts',                                              // EMPTY_CONTENT_SIG
      'hypercomb-essentials/src/history/history.service.ts', // EMPTY_LAYER_*_SIG
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
      'hypercomb-runtime/src/store.ts',
      'hypercomb-essentials/scripts/copy-content.ts',
      'hypercomb-essentials/src/clipboard/clipboard.worker.ts',
      'hypercomb-essentials/src/commands/website-archive.queen.ts',
      'hypercomb-essentials/src/editor/viewport-store.ts',
      'hypercomb-essentials/src/history/history.service.ts',
      'hypercomb-essentials/src/move/layout.queen.ts',
      'hypercomb-essentials/src/move/layout.service.ts',
      'hypercomb-essentials/src/sharing/content-broker.drone.ts',
      'hypercomb-essentials/src/sharing/feedback-channel.drone.ts',
      'hypercomb-essentials/src/sharing/host-sync.service.ts',
      'hypercomb-essentials/src/sharing/push-queue.service.ts',
      'hypercomb-essentials/src/sharing/swarm.drone.ts',
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

  it('the shell-surface barrel may only shrink — new chrome is an element drone, not a component', () => {
    // THE MIGRATION SCOREBOARD, made mechanical.
    //
    // Every entry here is a shell surface that still lives in the Angular
    // shell instead of being an `element:` drone in essentials, and is
    // therefore UNREACHABLE from the framework-free harness
    // (hypercomb-shim). The shim boots, acquires signed content and runs
    // every behaviour — but mounts none of this chrome, because it cannot
    // load Angular at all (field decorators throw in JIT and the build
    // guard fails the bundle).
    //
    // The list went 47 -> 48 -> 52 across three sessions while exactly ONE
    // element-shaped surface existed in all of essentials
    // (tutorial/tutorial-overlay.view.ts). Migration that loses ground is
    // not migration, and nothing was watching. Now something is:
    //
    //   a new entry  -> NEW DRIFT. Contribute the surface as a custom
    //                   element through the ShellSurfaceRegistry
    //                   (`element:` shape) from essentials instead. If it
    //                   genuinely cannot be one yet, adding a line here is
    //                   a deliberate act with a reason, not a default.
    //   a gone entry -> DEBT PAID. Remove it so the ratchet clicks tight.
    //
    // `hypercomb-shim/build.mjs` counts the same lines and prints them as
    // the scoreboard on every shim build; this makes the count a test.
    const barrel = readFileSync(
      join(ROOT, 'hypercomb-shared/ui/shell-surfaces/shell-surfaces.barrel.ts'), 'utf8')
    const entries = [...barrel.matchAll(/^import '([^']+)'/gm)]
      .map(m => m[1].replace(/^\.\.\//, ''))
      .sort()
    assertRatchet(entries, [
      "action-card/action-card.component",
      "activity-log/activity-log.component",
      "aggregate-index/aggregate-index.component",
      "aggregate-index/sources/collections.source",
      "aggregate-index/sources/websites.source",
      "aliases-panel/aliases-panel.component",
      "backgrounds-window/backgrounds-window.component",
      "camera-capture/camera-capture.component",
      "chat-window/chat-window.component",
      "clipboard-panel/clipboard-panel.component",
      "comfy-panel/comfy-panel.component",
      "command-palette/command-palette.component",
      "confirm-dialog/confirm-dialog.component",
      "contact-card/contact-form.component",
      "contact-card/contact-hover.component",
      "context-window/context-window.component",
      "docs-overlay/docs-overlay.component",
      "example-hives/example-hives-offer.component",
      "features-viewer/features-viewer.component",
      "feedback-viewer/feedback-viewer.component",
      "files-viewer/files-viewer.component",
      "flex-editor/flex-editor.component",
      "format-painter/format-painter.component",
      "history-viewer/history-viewer.component",
      "hosts-panel/hosts-panel.component",
      "icon-picker/icon-picker.component",
      "landing-badge/landing-badge.component",
      "layer-cycle-strip/layer-cycle-strip.component",
      "layout-designer/layout-designer.component",
      "markup-overlay/markup-overlay.component",
      "mesh-modal/mesh-modal.component",
      "notes-strip/notes-strip.component",
      "notes-viewer/notes-viewer.component",
      "observe-viewer/observe-viewer.component",
      "pheromone-tiles/pheromone-tiles.component",
      "portal/portal-overlay.component",
      "presence-banner/presence-banner.component",
      "preview-banner/preview-banner.component",
      "publish-panel/publish-panel.component",
      "references-window/references-window.component",
      "rewind-window/rewind-window.component",
      "sensitivity-bar/sensitivity-bar.component",
      "sequence-viewer/sequence-viewer.component",
      "shortcut-sheet/shortcut-sheet.component",
      "tags-viewer/tags-viewer.component",
      "tile-editor/tile-editor.component",
      "toast/toast.component",
      "trust-prompt/trust-prompt.component",
      "tutorials-window/tutorials-window.component",
      "website-nav/website-nav.component",
      "workflow-designer/workflow-designer.component",
      "youtube-viewer/youtube-viewer.component",
    ], 'Angular-shaped shell surface')
  })

  it('derived-cache manifests are written only by the store, the optimize phase, and the render backfill', () => {
    // The commit path mints truth only. writeChildrenManifest is called
    // from the ManifestOptimizerDrone (processor optimize phase) and the
    // show-cell resolveChildNames backfill; store.ts defines it.
    const actual = filesMatching(/writeChildrenManifest/)
    assertRatchet(actual, [
      'hypercomb-runtime/src/store.ts',
      'hypercomb-essentials/src/history/manifest-optimizer.drone.ts',
      'hypercomb-essentials/src/presentation/tiles/show-cell.drone.ts',
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

  it("viewport source 'user' means a GESTURE — automatic paths that merely persist use 'auto-persist'", () => {
    // `source: 'user'` answers TWO questions at once: persist this framing, AND
    // the participant asked for it. The second half makes zoomToFit announce
    // `viewport:fit`, which the control bar reads as permission to DISCARD the
    // page's hand framing and hand it back to the global fit switch. Automatic
    // callers only ever wanted the first half, and every one of them said so in
    // its own comment ("'user' so it STICKS") while taking both — so a
    // first-tile add, a first-visit render, or a tutorial zoom demo silently
    // stripped a framing the participant had set, and the page re-fitted (i.e.
    // "shrank") from then on. 'auto-persist' is the honest half: it persists,
    // it never announces.
    //
    // Allowlist = the paths that really are a gesture. If you are adding a
    // caller and reaching for 'user' to make a fit STICK, you want
    // 'auto-persist' — do not extend this list.
    const actual = filesMatching(/zoomToFit\s*\?*\.?\s*\(\s*[^)]*['"`]user['"`]/)
    assertRatchet(actual, [
      'hypercomb-essentials/src/navigation/zoom/fit.queen.ts',        // /fit
      'hypercomb-essentials/src/navigation/zoom/zoom.drone.ts',       // `0`/`r` keymap + pinch-below-min
      'hypercomb-essentials/src/sequence/sequence-cycle.drone.ts',    // the `a` recompose keypress
      'hypercomb-shared/ui/controls-bar/controls-bar.component.ts',                            // the fit button
    ], "automatic zoomToFit claiming source 'user'")
  })

  it('multi-anchor producers end their pass with build-record — atomicity is not optional', () => {
    // The build-revisions standard (documentation/build-revisions.md): a
    // pass that mints resources AND stamps more than one anchor must end
    // with `build-record`, so the whole build is ONE restorable step.
    // Heuristic: a script under scripts/ containing `put-resource` plus
    // `decoration-add`/`bag-set` is a producer; lacking `build-record` it
    // appears here. The allowlist has two frozen tiers: single-anchor
    // producers where a build record is n/a by design, and KNOWN DEBT —
    // multi-anchor producers not yet wired. Wiring one = remove it here
    // AND in scripts/audit-atomicity.cjs (the live twin) so both click.
    // The debt tier is now EMPTY: every multi-anchor producer in the tree
    // ends its pass with a record, so what remains below is only the
    // single-anchor set. A new name in either list means a producer shipped
    // unsealed.
    const scriptsDir = join(ROOT, 'scripts')
    const files: string[] = []
    const walkScripts = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walkScripts(full)
        else if (/\.(cjs|mjs|ts|js)$/.test(entry.name)) files.push(full)
      }
    }
    walkScripts(scriptsDir)

    const unwired: string[] = []
    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, '/')
      if (rel === 'scripts/audit-atomicity.cjs') continue        // the auditor names every token
      let code: string
      try { code = readFileSync(file, 'utf8') } catch { continue }
      const producer = code.includes('put-resource') && (code.includes('decoration-add') || code.includes('bag-set'))
      if (producer && !code.includes('build-record')) unwired.push(rel)
    }

    assertRatchet(unwired.sort(), [
      // single-anchor by design — build record n/a (page-slot chain already versions them)
      'scripts/ai-inside/test-edge-aihive.cjs',
      'scripts/bridge/_dashboard-refresh.cjs',
      'scripts/bridge/_put-file.cjs',
      'scripts/bridge/_tutor-deck.cjs',
      'scripts/build-hypercomb-articles.cjs',
      'scripts/meaning-loop-phase1.ts',
    ].sort(), 'unwired multi-anchor producer')
  })

  it('referent-field skips live in the edge registry — never inline in a walker', () => {
    // Sig-shaped fields split into EDGES (dependencies whose bytes must
    // travel: children/content/refs) and REFERENTS (addresses/identities
    // with NO bytes behind them: groupSig, targetSig). Treating a referent
    // as an edge is the permanent-404 bug class; missing an edge strands
    // content on fresh adopters. The edge registry
    // (hypercomb-core/src/core/edge-registry.ts) is the ONE declaration —
    // walkers consult isReferentField()/EDGE_FIELDS, never an inline
    // comparison. This catches `=== 'groupSig'`-style skips creeping back
    // into a walker (or a new walker minting its own local list). Empty
    // allowlist: register the field instead.
    const actual = filesMatching(/[=!]==\s*['"`](?:groupSig|targetSig)['"`]/)
    assertRatchet(actual, [], 'inline referent-field comparison')
  })

  it('no NEW bare-word pool meaning — a new pool meaning must carry a colon', () => {
    // Pools of meaning and lineage sigbags share ONE flat OPFS root
    // namespace:
    //   pool address = sign(meaning)              = sha256(meaning)
    //   bag address  = sign(lineageKey(segments)) = sha256(<slug>)
    // `lineageKey` preserves letters and digits, so a BARE-WORD meaning
    // hashes to exactly the same directory as a same-named root tile —
    // sign('clipboard') IS the bag of a root tile called `clipboard`.
    // Committing there writes markers into the pool, and /flatten then
    // HARD-DELETES every sig-named member it finds (the pool's contents).
    //
    // A colon fixes this by construction: lineageKey folds every
    // non-letter/number to '-', so no location can ever produce one.
    // Every NEW pool meaning must be scoped (`websites:menu`,
    // `usage:dwell`). The bare-word list is FROZEN — it may only shrink,
    // as existing meanings are migrated away WITH a drain plan (sign() of
    // a new spelling mints a different address forever, so an unplanned
    // rename strands every existing member).
    // Fail LOUDLY and accurately if the frozen list didn't load. Run from
    // a directory without vitest.config.ts and `@hypercomb/core` resolves
    // to the nearest node_modules — in a worktree, the MAIN checkout's
    // dist — where this export may not exist. `new Set(undefined)` is an
    // empty set, which would report every pre-existing meaning as new
    // drift and send you hunting a regression that isn't there.
    expect(
      Array.isArray(BARE_WORD_POOL_MEANINGS) && BARE_WORD_POOL_MEANINGS.length > 0,
      'BARE_WORD_POOL_MEANINGS did not load from @hypercomb/core — run vitest from `src/` ' +
      '(where vitest.config.ts maps @hypercomb/* to source), not from the repo root.',
    ).toBe(true)

    const frozen = new Set(BARE_WORD_POOL_MEANINGS)
    const found = new Map<string, string>()  // meaning → first file
    const decl = /(?:^|\b)[A-Z_]*MEANING[A-Z_]*\s*(?::[^=]*)?=\s*'([^']+)'/gm
    for (const dir of SCAN_DIRS) {
      let files: string[]
      try { files = walk(join(ROOT, dir)) } catch { continue }
      for (const file of files) {
        const raw = readFileSync(file, 'utf8')
        // Skip auto-generated facades. `essentials-keys.ts` mirrors EVERY
        // exported symbol name to its module path, so any export named
        // `*_MEANING` reappears there as `MEANING = '@domain/path/module'` —
        // a module path, colon-less, and not a declaration at all. Scanning
        // it reports a false bare-word meaning for a pool whose real
        // spelling is perfectly fine. The frozen list is untouched.
        if (/^\/\/\s*auto-generated/.test(raw)) continue
        const code = stripComments(raw)
        for (const m of code.matchAll(decl)) {
          const meaning = m[1]
          if (meaning.includes(':')) continue           // collision-proof
          if (!found.has(meaning)) found.set(meaning, relative(ROOT, file).replace(/\\/g, '/'))
        }
      }
    }
    const drift = [...found].filter(([meaning]) => !frozen.has(meaning))
    expect(
      drift.map(([meaning, file]) => `${meaning}  (${file})`),
      '\nNEW BARE-WORD POOL MEANING — it collides with a same-named root tile.\n' +
      'Give it a colon (e.g. "thing:records") instead of adding it to the list.\n',
    ).toEqual([])
  })

  it('no plaintext credential in a content-addressed write, a decoration payload, or an EffectBus payload', () => {
    // A KEY IS NEVER CONTENT. An API key that reaches `putResource` is
    // signed, deduplicated, and cached forever under an address anyone
    // holding the signature can fetch; one that reaches a decoration payload
    // or a layer slot rides the merkle tree into every peer that adopts the
    // tile; one that reaches an EffectBus payload is replayed to every late
    // subscriber, including surfaces that log what they receive. All three
    // are unrecoverable — content is immutable, and a shared hive cannot be
    // un-shared. Rotating the key is the only remedy, and only if anyone
    // notices.
    //
    // So credentials have exactly ONE home: the core LlmKeyStore
    // (hypercomb-core/src/core/llm-keys.ts), which writes localStorage and
    // nothing else. This ratchet is the negative half of that contract,
    // enforced mechanically before the hive learns to hold N provider keys.
    //
    // Heuristic: a credential-shaped identifier appearing inside the argument
    // list of a write that leaves the device's own volatile memory. `[^)]`
    // bounds each match to the first close-paren, so a later unrelated
    // `apiKey` in the same function cannot trip it. Reads (`getItem`) and
    // storage-key CONSTANTS (`*_KEY`/`*_STORAGE`, matched as whole words that
    // these patterns deliberately do not contain) are not credentials.
    //
    // Empty allowlist, and it stays empty. If you need to persist something
    // key-shaped, it belongs in LlmKeyStore; if you need to ANNOUNCE that a
    // key changed, emit the provider id and let the listener re-read.
    const SINKS =
      'putResource|putPoolDoc|putBee|putLayer|commitLayer|commitSlot[A-Za-z]*|writeChildrenManifest'
      + '|emitEffect|EffectBus\\.emit(?:Transient)?|decorationAdd|addDecoration'
    const CREDENTIALS = 'apiKey|api_key|apikey|secretValue|password|credential|bearerToken|accessToken|authToken'
    const actual = filesMatching(
      new RegExp(`(?:${SINKS})\\s*(?:<[^>]*>)?\\s*\\([^)]{0,400}?\\b(?:${CREDENTIALS})\\b`, 'i'),
    )
    assertRatchet(actual, [], 'plaintext credential in a persisted or broadcast payload')
  })

  it('no tool window closes a SIBLING by name — the lane decides what fits, and it parks', () => {
    // A window that shuts another one runs the OTHER's `close()`, which is the
    // participant's own verb: it empties gathered lists, selections, brushes
    // and drafts. Sharing an edge is the LANE's business (dock-lanes.ts), and
    // the lane PARKS what it displaces so the displacement costs nothing.
    //
    // This rule has had to be deleted TWICE — once from the command line's
    // notes/feedback/pheromones trio, once from files/features/observe — so it
    // is mechanical from here. A window may still emit its OWN close (that is
    // the channel the Escape cascade and the tutorial drive); what it may not
    // do is emit somebody else's.
    const UI = join(ROOT, 'hypercomb-shared/ui')
    const offenders: string[] = []
    let dirs: string[] = []
    try { dirs = readdirSync(UI, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) } catch { dirs = [] }

    for (const dir of dirs) {
      let files: string[] = []
      try { files = walk(join(UI, dir)) } catch { continue }
      // Scoped to LANE OCCUPANTS. Free-floating chrome (the controls bar, the
      // format painter) legitimately closes the strip it launches — it is that
      // strip's toggle, not a rival for its edge.
      const isDockedWindow = files.some(f =>
        f.endsWith('.html') && /hcDockedPanel/.test(readFileSync(f, 'utf8')))
      if (!isDockedWindow) continue
      // 'files-viewer' owns 'files:*'; 'notes-strip' owns 'notes:*'.
      const own = dir.split('-')[0]
      for (const file of files) {
        if (file.endsWith('.spec.ts')) continue
        const code = stripComments(readFileSync(file, 'utf8'))
        for (const m of code.matchAll(/emit\s*(?:<[^>]*>)?\s*\(\s*['"`]([a-z-]+):(?:viewer-)?close['"`]/g)) {
          if (m[1] !== own) offenders.push(`${relative(ROOT, file).replace(/\\/g, '/')} → ${m[1]}`)
        }
      }
    }
    assertRatchet(offenders.sort(), [], 'sibling window close')
  })

  it('no listener binds every interface by default', () => {
    // A listening socket with no `host` binds 0.0.0.0 — the whole LAN. For the
    // claude bridge that is not a config nit: the broker relays ops that create
    // tiles, write resources and commit layers on a LIVE hive, so a remote
    // sender that reaches the port can ask the machine to do work on its
    // owner's data. Every listener therefore names its bind address, and the
    // default is loopback; going wide is an explicit env opt-in guarded by
    // HYPERCOMB_BRIDGE_TOKEN.
    //
    // Scanned separately from SCAN_DIRS/isSource: servers live in `scripts/`
    // as .cjs, which the main walk deliberately skips.
    const SERVER_DIRS = ['scripts', 'hypercomb-cli/src', 'hypercomb-relay', 'hypercomb-essentials/scripts']
    const isServerSource = (name: string): boolean =>
      /\.(ts|cjs|mjs|js)$/.test(name) && !name.endsWith('.d.ts') && !name.endsWith('.spec.ts')
    const walkAll = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            // Dot-dirs here are vendored browser profiles (bundled third-party
          // extension code), not our source.
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walkAll(join(dir, entry.name), out)
        } else if (isServerSource(entry.name)) out.push(join(dir, entry.name))
      }
      return out
    }

    // `port:` in a server options literal with no `host:` beside it, or a
    // `.listen(port, …)` whose second argument is not a bind-address string.
    const PORT_NO_HOST = /new\s+WebSocketServer\s*\(\s*\{(?![^}]*\bhost\s*:)[^}]*\bport\s*:/
    const LISTEN_NO_HOST = /\.listen\s*\(\s*[^,)]+\s*(?:\)|,(?!\s*['"]))/

    const offenders: string[] = []
    for (const dir of SERVER_DIRS) {
      let files: string[]
      try { files = walkAll(join(ROOT, dir)) } catch { continue }
      for (const file of files) {
        const code = stripComments(readFileSync(file, 'utf8'))
        if (PORT_NO_HOST.test(code) || LISTEN_NO_HOST.test(code)) {
          offenders.push(relative(ROOT, file).replace(/\\/g, '/'))
        }
      }
    }
    assertRatchet(offenders.sort(), [
      // The deployed public nostr relay — being reachable IS its job.
      'hypercomb-relay/relay.js',
      // Dev swarm/content relay: a phone on the same wifi must reach it to
      // test peer sync, so loopback would defeat the only thing it is for.
      // It serves and accepts sig-addressed bytes (PUT verifies the hash) and
      // relays nostr events — it can NOT drive the hive the way the bridge can.
      'scripts/local-relay.ts',
    ], 'default-wide listener bind')
  })

  it('border-radius stays on the shape ladder (rounded is reserved for round things)', () => {
    // THE SHAPE LADDER — hypercomb-shared/ui/_shape.scss.
    //
    // Hypercomb is drawn out of hexagons, so the chrome around them is square
    // by default and rounds only where roundness MEANS something. The ladder
    // tops out at 4px on a rectangle (control 2 / card 3 / floating 4); above
    // that a corner stops reading as "lifted" and starts disagreeing with the
    // canvas underneath it.
    //
    // The vocabulary existed before this ratchet, but only inside
    // `_toolwindow.scss` — so it governed the tool windows while everything
    // else drifted to 8px, 12px, 14px and 2rem, one component at a time. That
    // is precisely the failure mode a ratchet exists for.
    //
    // EXEMPT: `50%`, `999px`, `99px`, and elliptical percentage forms. Those
    // are genuinely round things — avatars, dots, knobs, status pills, toggle
    // tracks — which the ladder never claimed. Only px/rem lengths on
    // rectangles are drift.
    const STYLE_DIRS = [
      'hypercomb-shared',
      'hypercomb-essentials/src',
      'hypercomb-web/src',
      'hypercomb-dev/src',
    ]
    const isStyleSource = (name: string): boolean =>
      /\.(scss|css|html|ts)$/.test(name) && !name.endsWith('.d.ts') && !name.endsWith('.spec.ts')
    const walkStyles = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walkStyles(join(dir, entry.name), out)
        } else if (isStyleSource(entry.name)) out.push(join(dir, entry.name))
      }
      return out
    }

    // Parse the VALUES rather than pattern-matching them: a regex that tries
    // to say "a number 6 or over" also says 999px, and squaring every pill in
    // the app is the one way this ratchet could do harm. So: pull each
    // border-radius value, read its px/rem lengths as numbers, and let the
    // exemptions be exemptions.
    //
    // The value ends at a quote as well as at `;`/`{`/`}`: a drone view writes
    // its styles as an ARRAY of fragments — `'border-radius:…', 'font-size:…'`
    // — with no semicolons until `.join(';')`, so a value that stopped only at
    // `;` swallowed every fragment after it and read their lengths as this
    // declaration's. That accused three already-swept files of drift they do
    // not have, which is the one way a ratchet loses its authority.
    // TWO SPELLINGS, because both are used and only one used to be checked.
    // The CSS form stops at a quote or a newline as well as `;{}`: a drone view
    // writes its styles as an ARRAY of fragments joined later, so a value with
    // no trailing semicolon would otherwise run past the closing quote and read
    // the NEXT fragment's lengths as its own.
    // The JS form — `borderRadius: '10px'` inside an Object.assign(el.style, …)
    // — is where every miss in the first sweep hid, because a CSS-shaped scan
    // cannot see it at all. It gets its own pattern rather than a footnote.
    const RADIUS_DECL = /border-radius:([^;{}'"`\n]+)/g
    const RADIUS_PROP = /borderRadius\s*[:=]\s*(['"`][^'"`\n]*['"`])/g
    const LENGTH = /(-?[0-9]*\.?[0-9]+)(px|rem)/g
    const overLadder = (code: string): boolean => {
      for (const decl of [...code.matchAll(RADIUS_DECL), ...code.matchAll(RADIUS_PROP)]) {
        const value = decl[1]
        for (const len of value.matchAll(LENGTH)) {
          const n = Number(len[1])
          const px = len[2] === 'rem' ? n * 16 : n
          // 999px / 99px are the pill: a length so large it can only mean
          // "round this end off entirely", which is the exemption, not drift.
          if (px >= 48) continue
          if (px > 4) return true
        }
      }
      return false
    }

    const offenders: string[] = []
    for (const dir of STYLE_DIRS) {
      let files: string[]
      try { files = walkStyles(join(ROOT, dir)) } catch { continue }
      for (const file of files) {
        const code = stripComments(readFileSync(file, 'utf8'))
        if (overLadder(code)) {
          offenders.push(relative(ROOT, file).replace(/\\/g, '/'))
        }
      }
    }
    assertRatchet(offenders.sort(), [
      // THE ARCADE IS ITS OWN ROOM. The game overlays are not app chrome —
      // they are a cabinet screen laid over it, with their own vector-juice
      // rules (chunky HUD panels, fat score plates). The ladder governs the
      // hive's interface; it does not govern a game's.
      'hypercomb-essentials/src/games/arkanoid/overlay.ts',
      'hypercomb-essentials/src/games/bubble/overlay.ts',
      'hypercomb-essentials/src/games/roper/overlay.ts',
      'hypercomb-essentials/src/games/solomon/overlay.ts',
    ], 'border-radius above the shape ladder')
  })

  // ─── a tool window never names an INK ────────────────────────────────
  //
  // Every panel used to paint its labels from a literal picked against a dark
  // pane — `#eaf3f9` for a title, `rgba(207, 226, 238, 0.62)` for a lede, the
  // authored pastel for an icon. Under a bright look the pane goes cream and
  // the text stays where it was: 625 such declarations, measuring as low as
  // 1.09:1 — present in the DOM, invisible on screen.
  //
  // The vocabulary that replaced them is in `ui/_toolwindow.scss`:
  //   weight   → var(--hc-window-ink-quiet | -plain | -loud)
  //   identity → var(--hc-window-accent | -quiet), --hc-window-on-accent
  //   ground   → var(--hc-window-tint | -strong), --hc-window-wash
  //   a colour that is the POINT → tw.ink(<colour>)  (the --hc-deepen knob)
  //
  // This guards the ink side, which is where the damage was: a `color`,
  // `fill` or `stroke` set to a LIGHT literal. Dark literals are left alone —
  // they read correctly on the bright panes and the dark themes measure clean.
  // 0.28 luminance is the floor because the band from there to 0.35 is where
  // the semantic violets and reds sit (#b48ad8 is 0.33), light enough to
  // measure ~3.5:1 on cream while looking safe in the source.
  //
  // Empty allowlist, and it stays empty. Proof for the whole surface is
  // `node scripts/drive-toolwindow-contrast.cjs`, which opens each window in
  // each theme and composites every run of text over the ground it actually
  // has; it reported 0 runs under target when this was frozen.
  it('no tool-window stylesheet paints text from a light literal', () => {
    const walkStyles = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walkStyles(join(dir, entry.name), out)
        } else if (entry.name.endsWith('.scss')) out.push(join(dir, entry.name))
      }
      return out
    }

    const parseColour = (raw: string): [number, number, number] | null => {
      const c = raw.trim()
      let m = /^#([0-9a-f]{3})$/i.exec(c)
      if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)]
      m = /^#([0-9a-f]{6})$/i.exec(c)
      if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)]
      m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(c)
      if (m) return [+m[1], +m[2], +m[3]]
      return null
    }
    // WCAG relative luminance — the same number the driver measures with, so
    // the ratchet and the reading can never disagree about what "light" is.
    const luminance = ([r, g, b]: [number, number, number]): number => {
      const chan = (v: number): number => {
        const x = v / 255
        return x > 0.03928 ? Math.pow((x + 0.055) / 1.055, 2.4) : x / 12.92
      }
      return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
    }

    const offenders: string[] = []
    let files: string[]
    try { files = walkStyles(join(ROOT, 'hypercomb-shared/ui')) } catch { files = [] }
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'))
      const decl = /(^|[\s;{])(color|fill|stroke)\s*:\s*(#[0-9a-f]{3,6}|rgba?\([\d.,\s]*\))\s*(?=[;}])/gim
      let hit
      while ((hit = decl.exec(code))) {
        const rgb = parseColour(hit[3])
        if (rgb && luminance(rgb) > 0.28) {
          offenders.push(relative(ROOT, file).replace(/\\/g, '/'))
          break
        }
      }
    }
    assertRatchet(offenders.sort(), [], 'a light ink literal in a tool window')
  })
})
