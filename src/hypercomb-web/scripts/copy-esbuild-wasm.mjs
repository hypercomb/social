// copy-esbuild-wasm.mjs — put the pinned esbuild-wasm where a hive's shell
// serves it: public/esbuild-wasm/<version>/{browser.min.js, esbuild.wasm}, in
// the web shell and the dev shell.
//
// The hive's `derive verify` word (essentials sharing/derive-verify.ts)
// re-derives a `minify` record with esbuild compiled to WebAssembly, and loads
// it ONLY from the shell's own origin: esbuild's WebAssembly is compiled Go,
// which can call into the page, so the transform is trusted exactly as the
// shell is — never fetched from what a record names. The version folder pins
// it: a record made by esbuild@X is re-run only by esbuild-wasm X.
//
// Generated, never committed (13 MB): both folders are in .gitignore, and the
// shell's build runs this (hypercomb-web `npm run runtime`, the live deploy's
// "Build web runtime assets" step, the dev shell's prestart).

import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const pkgJson = require.resolve('esbuild-wasm/package.json')
const pkgDir = dirname(pkgJson)
const { version } = require('esbuild-wasm/package.json')

const shells = [join(here, '..', 'public'), join(here, '..', '..', 'hypercomb-dev', 'public')]
for (const publicDir of shells) {
  const out = join(publicDir, 'esbuild-wasm', version)
  await mkdir(out, { recursive: true })
  await copyFile(join(pkgDir, 'esm', 'browser.min.js'), join(out, 'browser.min.js'))
  await copyFile(join(pkgDir, 'esbuild.wasm'), join(out, 'esbuild.wasm'))
}
console.log(`[esbuild-wasm] ${version} → ${shells.length} shells (public/esbuild-wasm/${version}/)`)
