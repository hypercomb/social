// hypercomb-web/scripts/build-pixi-vendor.ts
//
// The shell's own Pixi runtime, /vendor/pixi.runtime.js. The recipe (entry,
// WebGL2 probe patch, local transcoder URLs) lives in scripts/pixi-vendor.mjs,
// shared with the copy a package carries as its own dependency.

import { resolve } from 'path'
import { rmSync, mkdirSync, writeFileSync } from 'fs'
import { buildPixiRuntime } from '../../scripts/pixi-vendor.mjs'

(async () => {
  const OUT_DIR = resolve('public/vendor')
  const OUT_FILE = resolve(OUT_DIR, 'pixi.runtime.js')

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  writeFileSync(OUT_FILE, await buildPixiRuntime(process.cwd()))
  console.log('[pixi-vendor] ✔ patched isWebGLSupported to accept WebGL2-only browsers')
  console.log('[pixi-vendor] ✔ localised 4 CDN transcoder URLs')
  console.log('[pixi-vendor] ✔ pixi.runtime.js built successfully')
})().catch(err => {
  console.error('[pixi-vendor] build failed')
  console.error(err)
  process.exit(1)
})
