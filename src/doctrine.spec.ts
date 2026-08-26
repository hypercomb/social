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
      // #pixi-host is an id, invisible to the tag scan above — and it was the
      // single most load-bearing template node. The renderer MINTS it now
      // (pixi-host.worker.ts creates the node on <body> when absent), so no
      // template may reintroduce a <div id="pixi-host"> DOM contract.
      expect(
        /id\s*=\s*["']pixi-host["']/.test(html),
        `${file}: #pixi-host is minted by the pixi worker — never a template node`,
      ).toBe(false)
    }
  })

  it('shell-side IoC registrations may only shrink — every entry here is migration debt', () => {
    // The everything-is-a-beehavior campaign
    // (documentation/everything-is-a-beehavior.md): implementations bees
    // reach through IoC should live in signature-addressed modules, not in
    // shared/shell code compiled into the shim. This census freezes every
    // IoC registration made from hypercomb-shared and the two shells.
    // Migrating a service down to essentials removes its entry (the ratchet
    // clicks tight); adding a NEW shell-side registration is drift — put the
    // implementation in a module instead.
    //
    // Three registration shapes are counted: string-literal keys (only
    // IoC-shaped ones — containing '@' or ':' — so serviceWorker.register
    // URLs don't trip it), ALL-CAPS *KEY constants, and template literals
    // with interpolation (recorded by their raw source text). A
    // registration this scan cannot see is a registration a reader cannot
    // grep either — keep keys literal or *KEY-constant.
    const SHELL_DIRS = ['hypercomb-shared', 'hypercomb-web/src', 'hypercomb-dev/src']
    const LITERAL = /\bregister\s*\(\s*['"]([^'"]+)['"]/g
    const BACKTICK = /\bregister\s*\(\s*`([^`$]+)`/g
    const CONSTANT = /\bregister\s*\(\s*([A-Z][A-Z0-9_]*KEY)\b/g
    const TEMPLATE = /\bregister\s*\(\s*(`[^`]*\$\{[^`]*`)/g

    const found: string[] = []
    for (const dir of SHELL_DIRS) {
      let files: string[]
      try { files = walk(join(ROOT, dir)) } catch { continue }
      for (const file of files) {
        const rel = relative(ROOT, file).replace(/\\/g, '/')
        const code = stripComments(readFileSync(file, 'utf8'))
        for (const m of code.matchAll(LITERAL)) {
          if (m[1].includes('@') || m[1].includes(':')) found.push(`${m[1]} (${rel})`)
        }
        for (const m of code.matchAll(BACKTICK)) {
          if (m[1].includes('@') || m[1].includes(':')) found.push(`${m[1]} (${rel})`)
        }
        for (const m of code.matchAll(CONSTANT)) found.push(`${m[1]} (${rel})`)
        for (const m of code.matchAll(TEMPLATE)) found.push(`${m[1]} (${rel})`)
      }
    }

    assertRatchet([...new Set(found)].sort(), [
      '@hypercomb.social/AppRoutes (hypercomb-dev/src/app/app.routes.ts)',
      '@hypercomb.social/BootstrapHistory (hypercomb-shared/core/bootstrap-history.ts)',
      '@hypercomb.social/CommandLineBehaviors (hypercomb-shared/ui/command-line/command-line.component.ts)',
      '@hypercomb.social/DependencyLoader (hypercomb-shared/core/dependency-loader.ts)',
      '@hypercomb.social/DevLayerSource (hypercomb-shared/core/layer-install-sources/dev-layer.source.ts)',
      '@hypercomb.social/DirectoryWalker (hypercomb-shared/core/directory-walker.ts)',
      '@hypercomb.social/DomainLayerSource (hypercomb-shared/core/layer-install-sources/domain-layer.source.ts)',
      '@hypercomb.social/DroneRegistry (hypercomb-shared/core/drone-registry.ts)',
      '@hypercomb.social/HeaderSizeQueenBee (hypercomb-shared/core/header-size.ts)',
      '@hypercomb.social/I18n (hypercomb-shared/core/i18n.service.ts)',
      '@hypercomb.social/InitHistory (hypercomb-dev/src/app/core/init-history.ts)',
      '@hypercomb.social/InstallMonitor (hypercomb-shared/core/install-monitor.ts)',
      '@hypercomb.social/LayerInstaller (hypercomb-shared/core/layer-installer.ts)',
      '@hypercomb.social/LayerService (hypercomb-web/src/app/layer-service.ts)',
      '@hypercomb.social/OpfsInstallFileSource (hypercomb-shared/core/layer-install-sources/opfs-install-file.source.ts)',
      '@hypercomb.social/OpfsTreeLogger (hypercomb-shared/core/tree-logger.ts)',
      '@hypercomb.social/RegistrySnapshot (hypercomb-shared/core/registry-snapshot.ts)',
      '@hypercomb.social/ResourceMessageHandler (hypercomb-shared/core/resource-message-handler.ts)',
      '@hypercomb.social/RouteSinkComponent (hypercomb-dev/src/app/router/route-sink.component.ts)',
      '@hypercomb.social/RuntimeMediator (hypercomb-shared/ui/runtime-mediator.ts)',
      '@hypercomb.social/ScriptPreloader (hypercomb-shared/core/script-preloader.ts)',
      '@hypercomb.social/ServerInitializer (hypercomb-shared/core/initializers/server-initializer.service.ts)',
      '@hypercomb.social/Store (hypercomb-shared/core/store.ts)',
      '@hypercomb/SignatureStore (hypercomb-dev/src/main.ts)',
      '@hypercomb/SignatureStore (hypercomb-web/src/setup/ensure-install.ts)',
      'BEE_RESOLVER_KEY (hypercomb-dev/src/app/app.config.ts)',
      'BEE_RESOLVER_KEY (hypercomb-web/src/app.config.ts)',
      'SHELL_SURFACE_REGISTRY_KEY (hypercomb-shared/core/shell-surface-registry.ts)',
      'TOOL_WINDOWS_IOC_KEY (hypercomb-shared/ui/tool-windows.ts)',
      '`${ATOMIZABLE_TARGET_PREFIX}input:command-line` (hypercomb-shared/ui/command-line/command-line.atomizer.ts)',
    ], 'shell-side IoC registration')
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
      'hypercomb-essentials/src/diamondcoreprocessor.com/navigation/zoom/fit.queen.ts',        // /fit
      'hypercomb-essentials/src/diamondcoreprocessor.com/navigation/zoom/zoom.drone.ts',       // `0`/`r` keymap + pinch-below-min
      'hypercomb-essentials/src/diamondcoreprocessor.com/sequence/sequence-cycle.drone.ts',    // the `a` recompose keypress
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
      // KNOWN DEBT — multi-anchor producers awaiting their end-of-pass build-record
      'scripts/bridge/_ai-privacy-build.cjs',
      'scripts/bridge/_ai-privacy-chart.cjs',
      'scripts/bridge/_generate-dolphin-pages.cjs',
      'scripts/bridge/_pheromone-workflow.cjs',
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
      'hypercomb-essentials/src/diamondcoreprocessor.com/games/arkanoid/overlay.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/games/bubble/overlay.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/games/roper/overlay.ts',
      'hypercomb-essentials/src/diamondcoreprocessor.com/games/solomon/overlay.ts',
    ], 'border-radius above the shape ladder')
  })
})
