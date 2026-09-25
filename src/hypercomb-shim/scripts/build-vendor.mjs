// hypercomb-shim/scripts/build-vendor.mjs
//
// The two BUILT pieces of the shim's static root, plus the env stub.
// Everything else in public/ is checked in; these three are generated, which
// is why .gitignore holds them. Run once after a core rebuild or a pixi bump:
//
//   node scripts/build-vendor.mjs      (npm run build:vendor)
//
//   public/core/dist/       ← hypercomb-core/dist, verbatim. `@hypercomb/core`
//                             resolves to /hypercomb-core.runtime.js, which
//                             re-exports ./core/dist/index.js.
//   public/vendor/          ← pixi.runtime.js, one import-free ESM file.
//                             `pixi.js` resolves to /vendor/pixi.runtime.js.
//   public/env.js           ← a stub. NEVER a key: an earlier version of the
//                             web script baked ANTHROPIC_API_KEY into the
//                             shipped bundle and leaked it to every visitor.
//
// The core step mirrors hypercomb-web/scripts/build-core-vendor, narrowed to
// the shim's own output dir, so the shim builds with no reference to
// hypercomb-web. The Pixi recipe is shared by every build of it
// (scripts/pixi-vendor.mjs), including the copy a package carries.

import { buildPixiRuntime } from '../../scripts/pixi-vendor.mjs'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const shim = resolve(here, '..')
const publicDir = resolve(shim, 'public')

// ── core ─────────────────────────────────────────────────────────────────────
const coreDist = resolve(shim, '..', 'hypercomb-core', 'dist')
const coreOut = resolve(publicDir, 'core', 'dist')
if (!existsSync(coreDist)) {
  throw new Error(`[shim-vendor] hypercomb-core/dist is missing — run \`npm run build:core\` first (${coreDist})`)
}
rmSync(coreOut, { recursive: true, force: true })
mkdirSync(coreOut, { recursive: true })
cpSync(coreDist, coreOut, { recursive: true })
console.log('[shim-vendor] ✔ core → public/core/dist')

// ── pixi ─────────────────────────────────────────────────────────────────────
const vendorOut = resolve(publicDir, 'vendor')
const pixiFile = resolve(vendorOut, 'pixi.runtime.js')
rmSync(vendorOut, { recursive: true, force: true })
mkdirSync(vendorOut, { recursive: true })

// `pixi.js/unsafe-eval` swaps the new-Function uniform-sync for a static
// parser, so the renderer constructs under a CSP with no 'unsafe-eval' —
// published hosts serve exactly that CSP, and without this import
// PixiHostWorker dies at Application.init. The recipe (that entry, the WebGL2
// probe patch, local transcoder URLs) is shared: scripts/pixi-vendor.mjs.
writeFileSync(pixiFile, await buildPixiRuntime(shim))
console.log('[shim-vendor] ✔ pixi → public/vendor/pixi.runtime.js (WebGL2 probe patched, transcoder URLs localised)')

// ── env stub ─────────────────────────────────────────────────────────────────
writeFileSync(
  resolve(publicDir, 'env.js'),
  '// env.js stub — no secrets are embedded in shipped builds\n',
  'utf8',
)
console.log('[shim-vendor] ✔ env.js stub')
