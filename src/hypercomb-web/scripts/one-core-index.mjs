// ONE CORE, preloaded by its real address.
//
// The shell imports @hypercomb/core as an EXTERNAL (angular.json
// externalDependencies) so it shares the one module every bee imports. Angular
// still writes a preload hint for it — with the bare specifier as its href,
// `<link rel="modulepreload" href="@hypercomb/core">`, which a browser reads as
// a URL: it fetches `/@hypercomb/core`, gets the page back, and logs a failed
// module load on every boot. The hint is worth having, pointed at the files the
// import map sends the specifier to, so core arrives with the shell's own
// chunks instead of after them.
//   node scripts/one-core-index.mjs            (after ng build)

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const index = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'hypercomb-web', 'browser', 'index.html')
const html = await readFile(index, 'utf8')
const bogus = /<link rel="modulepreload" href="@hypercomb\/core">/g
const real = '<link rel="modulepreload" href="/hypercomb-core.runtime.js"><link rel="modulepreload" href="/core/dist/index.js">'
const fixed = html.replace(bogus, real)
if (fixed === html) {
  console.log('[one-core] no specifier preload to fix')
} else {
  await writeFile(index, fixed, 'utf8')
  console.log('[one-core] core preload now points at /hypercomb-core.runtime.js')
}
