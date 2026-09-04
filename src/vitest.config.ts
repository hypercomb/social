import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const src = (p: string): string => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  // Resolve `@hypercomb/*` to SOURCE, mirroring the `paths` contract in
  // tsconfig.base.json. Without this, Node's resolver walks up to the
  // nearest node_modules and loads each package's built `dist/` — which in
  // a git worktree is the MAIN checkout's dist, so tests silently exercise
  // stale code from another branch and a source change appears to do
  // nothing. Tests run against the source they are testing.
  resolve: {
    // `.ts` BEFORE `.js`, which inverts Vite's default. Stale compiled
    // droppings sit beside their sources in the working tree — five of them
    // in hypercomb-shared/core alone, all matched by that package's
    // `*.js` gitignore — and with the default order a DEEP import
    // (`@hypercomb/shared/core/store`) resolves to the built `store.js`
    // instead of `store.ts`. The suite then tests whatever was last built,
    // and fails in ways that have nothing to do with the code under test
    // (a module-scope `register()` throwing ReferenceError, for instance).
    // CI never sees it — a fresh checkout has no droppings — so the failure
    // only ever reproduces on a developer's machine. Same intent as the
    // alias block below: tests run against the source they are testing.
    extensions: ['.ts', '.mts', '.mjs', '.js', '.tsx', '.jsx', '.json'],
    alias: {
      '@hypercomb/core': src('./hypercomb-core/src/index.ts'),
      '@hypercomb/essentials': src('./hypercomb-essentials/src/index.ts'),
      // `@hypercomb/runtime` is in tsconfig.base.json's paths but was never
      // added here, so any spec that reached it — directly or through the
      // `@hypercomb/shared/core/*` stubs that re-export it — failed to LOAD,
      // with a resolver error rather than a test failure. That is why
      // ensure-install's own native branch could only be imported
      // dynamically, inside a try/catch, to keep the suite loading at all.
      '@hypercomb/runtime': src('./hypercomb-runtime/src'),
      '@hypercomb/shared/core': src('./hypercomb-shared/core'),
      // Deep UI imports resolve too — the shell reaches past the barrel for
      // single lenses (`ui/features-viewer/behavior-enablement`), and without
      // this the spec that covers such a file can't even LOAD, which reads as
      // one red file of unknown cause rather than a missing alias.
      '@hypercomb/shared/ui': src('./hypercomb-shared/ui'),
      '@hypercomb/shared': src('./hypercomb-shared/index.ts'),
      '@hypercomb/sdk': src('./hypercomb-sdk/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['**/*.spec.ts'],
    // `.claude/**` keeps agent worktrees (full repo copies under
    // .claude/worktrees/) out of collection — their stale spec copies
    // re-run against old code and fail the suite from the main tree.
    //
    // `.tmp/**` is the same failure one directory over. `AGENTS.md` names
    // repo-root `.tmp/<tool>-<id>/` as the sanctioned scratch space and
    // `.gitignore` ignores it, so git never sees what lands there — but
    // `include: ['**/*.spec.ts']` did, and a throwaway `probe.spec.ts` written
    // by an agent verifying a claim then failed the suite from a path no
    // `git status` would ever show. Ignored by git and collected by the runner
    // is the worst of both: invisible AND load-bearing.
    exclude: ['node_modules', 'dist', '**/node_modules/**', '**/.claude/**', '**/.tmp/**'],
  },
})
