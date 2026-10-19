// verify-minified-package.mjs — re-derive the visitor's minified package from
// the readable one and check it is the same tree (hypercomb-runtime/src/
// minified-package.ts). The derivation is only as trustworthy as it is
// repeatable: anyone holding the readable package and the same tool gets the
// same signatures, or this says where they part.
//
//   node scripts/verify-minified-package.mjs [visitor-content-dir] [readable-content-dir]
//
// Defaults: dist/hypercomb-web/visitor/content and dist/hypercomb-web/browser/content.
// Exit 0 when every shipped file hashes to its name, the shipped root names
// the readable root and its derivation record, and re-deriving with the
// record's own tool and options gives the same root.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const shipped = process.argv[2] ?? join(here, '..', 'dist', 'hypercomb-web', 'visitor', 'content')
const readable = process.argv[3] ?? join(here, '..', 'dist', 'hypercomb-web', 'browser', 'content')
const SIG_RE = /^[a-f0-9]{64}$/
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const fail = (why) => { console.error(`[verify-minified] FAIL: ${why}`); process.exit(1) }

const manifest = JSON.parse(await readFile(join(shipped, 'manifest.json'), 'utf8'))
const [root] = Object.keys(manifest.packages ?? {})
if (!SIG_RE.test(root ?? '')) fail('the shipped manifest names no package')
const record = manifest.packages[root]

// 1. Every shipped file is named by the hash of its bytes.
let checked = 0
for (const sig of new Set([...(record.bees ?? []), ...(record.dependencies ?? []), ...(record.layers ?? [])])) {
  const bytes = await readFile(join(shipped, sig))
  if (sha(bytes) !== sig) fail(`${sig.slice(0, 12)}… does not hash to its name`)
  checked++
}

// 2. The root names where it came from and how.
const rootLayer = JSON.parse(await readFile(join(shipped, root), 'utf8'))
if (!rootLayer.derivedFrom) { console.log(`[verify-minified] ${root.slice(0, 12)}… is a readable package (no derivation) — ${checked} files hash to their names`); process.exit(0) }
const derivationBytes = await readFile(join(shipped, rootLayer.derivation))
if (sha(derivationBytes) !== rootLayer.derivation) fail('the derivation record does not hash to its name')
const derivation = JSON.parse(derivationBytes.toString('utf8'))
if (derivation.from !== rootLayer.derivedFrom) fail('the root and its record name different readable roots')

// 3. Re-derive from the readable package with the record's own tool and options.
const esbuild = await import('esbuild')
if (`esbuild@${esbuild.version}` !== derivation.tool) fail(`the record was made by ${derivation.tool}; this machine has esbuild@${esbuild.version}`)
const { tsImport } = await import('tsx/esm/api')
const { deriveMinifiedPackage } = await tsImport('../../hypercomb-runtime/src/minified-package.ts', import.meta.url)
const readableRecord = await (async () => {
  for (const path of [join(here, '..', '..', 'hypercomb-essentials', 'dist', 'manifest.json'), join(readable, 'manifest.json')]) {
    try { const found = JSON.parse(await readFile(path, 'utf8'))?.packages?.[derivation.from]; if (found) return found } catch { /* next */ }
  }
  return null
})()
if (!readableRecord) fail(`no record for the readable root ${derivation.from.slice(0, 12)}…`)
const again = await deriveMinifiedPackage(derivation.from, readableRecord,
  async (sig) => { try { return new Uint8Array(await readFile(join(readable, sig))) } catch { return null } },
  async (body) => (await esbuild.transform(body, derivation.options)).code,
  { name: derivation.tool, options: derivation.options })
if (again.root !== root) fail(`re-derived root ${again.root.slice(0, 12)}… is not the shipped ${root.slice(0, 12)}…`)
if (again.derivation.sig !== rootLayer.derivation) fail('re-derived record differs')
console.log(`[verify-minified] OK — ${checked} files hash to their names; ${root.slice(0, 12)}… re-derives from ${derivation.from.slice(0, 12)}… with ${derivation.tool} (${Object.keys(derivation.modules).length} modules)`)

