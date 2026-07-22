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
      '@hypercomb/shared': src('./hypercomb-shared/index.ts'),
      '@hypercomb/sdk': src('./hypercomb-sdk/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['**/*.spec.ts'],
    exclude: ['node_modules', 'dist', '**/node_modules/**'],
  },
})
