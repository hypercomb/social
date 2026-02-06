// scripts/build-pixi-vendor.ts
// builds a single-file, import-free ESM pixi vendor runtime

import { build } from 'esbuild'
import { resolve } from 'path'
import { rmSync, mkdirSync } from 'fs'

(async () => {
  const OUT_DIR = resolve('public/vendor')
  const OUT_FILE = resolve(OUT_DIR, 'pixi.runtime.js')

  // clean output
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  await build({
    entryPoints: ['pixi.js'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    outfile: OUT_FILE,

    splitting: false,
    treeShaking: false,

    mainFields: ['module', 'browser', 'main'],

    define: {
      'process.env.NODE_ENV': '"production"'
    },

    minify: false,
    sourcemap: false,

    logLevel: 'info'
  })

  console.log('[pixi-vendor] ✔ pixi.runtime.js built successfully')
})().catch(err => {
  console.error('[pixi-vendor] build failed')
  console.error(err)
  process.exit(1)
})
