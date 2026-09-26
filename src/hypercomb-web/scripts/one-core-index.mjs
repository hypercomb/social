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

const project = join(dirname(fileURLToPath(import.meta.url)), '..')
const browser = join(project, 'dist', 'hypercomb-web', 'browser')
const index = join(browser, 'index.html')

// THE SHELL AND THE CORE IT WILL LOAD MUST AGREE. With one core the shell no
// longer carries its own copy, so a shell compiled against a newer core source
// than the core file it ships dies at load ("does not provide an export named
// …", every page). Every name the bundle imports from @hypercomb/core must be
// an export of the core file served beside it — or the build fails here.
{
  const { readdir } = await import('node:fs/promises')
  const { pathToFileURL } = await import('node:url')
  const { coreImportsOf } = await import(pathToFileURL(join(project, '..', 'hypercomb-runtime', 'src', 'core-surface.ts')).href)
    .catch(async () => (await import('tsx/esm/api')).tsImport('../../hypercomb-runtime/src/core-surface.ts', import.meta.url))
  const needed = new Set()
  for (const name of await readdir(browser)) {
    if (!name.endsWith('.js')) continue
    for (const exported of coreImportsOf(await readFile(join(browser, name), 'utf8'))) needed.add(exported)
  }
  const served = new Set(Object.keys(await import(pathToFileURL(join(browser, 'core', 'dist', 'index.js')).href)))
  const missing = [...needed].filter(name => !served.has(name))
  if (missing.length) {
    throw new Error(`[one-core] the shell imports ${missing.length} name(s) the shipped core does not export: ${missing.slice(0, 8).join(', ')} — rebuild core (npm run build:core, then runtime:core)`)
  }
  console.log(`[one-core] shell and core agree: ${needed.size} core names, all exported`)
}

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
