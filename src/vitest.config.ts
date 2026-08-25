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
    alias: {
      '@hypercomb/core': src('./hypercomb-core/src/index.ts'),
      '@hypercomb/essentials': src('./hypercomb-essentials/src/index.ts'),
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
    exclude: ['node_modules', 'dist', '**/node_modules/**', '**/.claude/**'],
  },
})
