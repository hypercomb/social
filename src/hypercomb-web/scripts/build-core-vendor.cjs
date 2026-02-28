const { cpSync, mkdirSync, rmSync } = require('fs')
const { resolve } = require('path')

const sourceDir = resolve('..', 'hypercomb-core', 'dist')
const outDir = resolve('public', 'core', 'dist')

try {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  cpSync(sourceDir, outDir, { recursive: true })
  console.log('[core-vendor] ✔ synced hypercomb-core dist to public/core/dist')
} catch (error) {
  console.error('[core-vendor] sync failed')
  console.error(error)
  process.exit(1)
}
