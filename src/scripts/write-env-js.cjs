#!/usr/bin/env node
// scripts/write-env-js.cjs
//
// Writes a stub public/env.js for one or more apps. Used by CI to ensure the
// file exists in production builds (the front-end loads it unconditionally
// from index.html, so a missing file = 404 spam in the console).
//
// SECURITY: This script deliberately does NOT embed any API key. An earlier
// version read ANTHROPIC_API_KEY from the environment and baked it into the
// deployed bundle, which leaked the key to every site visitor. Never restore
// that behaviour — keys belong in a backend proxy, not in shipped JS.
//
// Usage:
//   node scripts/write-env-js.cjs <app-public-dir> [<app-public-dir> ...]

const fs = require('fs')
const path = require('path')

const targets = process.argv.slice(2)
if (targets.length === 0) {
  console.error('[write-env-js] no target directories provided')
  process.exit(1)
}

const content = '// env.js stub — no secrets are embedded in shipped builds\n'

let wrote = 0
for (const target of targets) {
  if (!fs.existsSync(target)) {
    console.warn(`[write-env-js] target directory does not exist, skipping: ${target}`)
    continue
  }
  const dest = path.join(target, 'env.js')
  fs.writeFileSync(dest, content, 'utf8')
  console.log(`[write-env-js] wrote ${dest} (stub)`)
  wrote++
}

if (wrote === 0) {
  console.error('[write-env-js] no env.js files were written')
  process.exit(1)
}
