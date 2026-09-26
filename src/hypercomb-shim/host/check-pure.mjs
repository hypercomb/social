#!/usr/bin/env node
// Refuse to package an application snapshot as the installable cold harness.
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILDS_MEANING, installFilesOf, readSignatures, sign, signaturesOf, SIGNATURES_MEANING } from './builds.mjs'

const dist = resolve(process.env.HYPERCOMB_HOST_OUT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist'))
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const metadata = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
if (Object.keys(metadata.dependencies || {}).length) {
  throw new Error('pure host: the installed npm package must have no runtime dependencies')
}
const required = ['index.html', 'theme.css', 'main.js', 'hypercomb.worker.js', 'hypercomb-core.runtime.js']
for (const name of required) await stat(resolve(dist, name))

const pin = (await readFile(resolve(dist, 'pin'), 'utf8')).trim()
if (!/^[a-f0-9]{64}$/.test(pin)) throw new Error('pure host: invalid bootstrap pin')
const bytes = await readFile(resolve(dist, pin))
if (createHash('sha256').update(bytes).digest('hex') !== pin) {
  throw new Error('pure host: bootstrap bytes do not match the pin')
}

const names = await readdir(dist)
for (const name of ['content', 'vendor', 'pixi.js']) {
  if (names.includes(name)) throw new Error(`pure host: ${name} belongs to a package, not the harness`)
}
const locales = JSON.parse(await readFile(resolve(dist, 'locales.json'), 'utf8'))
if (Object.keys(locales).length !== 0) throw new Error('pure host: bundled locale content')
// CORE IS THE PROCESSOR in the install; the library is content the kernel
// resolves. Every signature-named file must hash to its name and be one the
// kernel knows — an unknown one is dead weight or a second install.
if (names.includes('core')) throw new Error('pure host: core ships as the processor, not core/dist')
const processorBytes = (await stat(resolve(dist, 'hypercomb-core.runtime.js'))).size
if (processorBytes > 8192) throw new Error(`pure host: the processor grew to ${processorBytes} bytes — the rest of core belongs in the library`)
const kernel = await readFile(resolve(dist, 'main.js'), 'utf8')
// Signature-named FILES; a 64-hex directory is a pool (build signatures).
const signed = (await readdir(dist, { withFileTypes: true })).filter(e => e.isFile() && /^[a-f0-9]{64}$/.test(e.name)).map(e => e.name)
for (const sig of signed) {
  if (createHash('sha256').update(await readFile(resolve(dist, sig))).digest('hex') !== sig) {
    throw new Error(`pure host: ${sig.slice(0, 12)} does not hash to its name`)
  }
}
// The kernel knows two: the host bundle and the core library. The host bundle
// knows one more: the host package's root, whose tile and console bee are the
// rest. Anything else signed here is dead weight or a second install.
const known = signed.filter(sig => kernel.includes(sig))
if (known.length !== 2) throw new Error(`pure host: the kernel should know the host bundle and the core library, knows ${known.length}`)
const hostBundle = await readFile(resolve(dist, pin), 'utf8')
const hostRoot = signed.find(sig => !known.includes(sig) && hostBundle.includes(sig))
if (!hostRoot) throw new Error('pure host: the host bundle names no host package')
const rootLayer = JSON.parse(await readFile(resolve(dist, hostRoot), 'utf8'))
const closure = new Set([hostRoot, ...(rootLayer.bootBees ?? [])])
for (const tile of rootLayer.cells ?? []) {
  closure.add(tile)
  for (const bee of JSON.parse(await readFile(resolve(dist, tile), 'utf8')).bees ?? []) closure.add(bee)
}
// THE BUILD RECORD (host/builds.mjs) names this origin exactly: the host
// bundle, the core library, the host package, and the install layer — every
// other file here, by path and signature.
const buildSig = (await readFile(resolve(dist, 'build'), 'utf8')).trim()
if (!signed.includes(buildSig)) throw new Error('pure host: /build names no build record here')
const record = JSON.parse(await readFile(resolve(dist, buildSig), 'utf8'))
if (record.name !== 'build' || !/^\d{4}\.\d{1,2}\.\d{1,2}\.\d+$/.test(record.version)) throw new Error('pure host: /build is not a build record')
if (record.host !== pin || record.hostPackage !== hostRoot || !known.includes(record.library) || record.library === pin) {
  throw new Error('pure host: the build record does not name this host bundle, core library and host package')
}
if (JSON.stringify(record.atoms) !== JSON.stringify(signed.filter(sig => sig !== buildSig).sort())) {
  throw new Error('pure host: the build record does not name exactly the signed files here')
}
const installFiles = {}
for (const [path, bytes] of [...await installFilesOf(dist)].sort(([a], [b]) => a < b ? -1 : 1)) installFiles[path] = sign(bytes)
if (sign(JSON.stringify({ name: 'install', files: installFiles })) !== record.install) {
  throw new Error(`pure host: the origin's files are not the install ${record.version} recorded`)
}
// The version pools an origin may carry (host/builds.mjs): every member must
// hash to its name, and a signature of this build must verify.
for (const meaning of [BUILDS_MEANING, SIGNATURES_MEANING]) {
  const pool = resolve(dist, sign(meaning))
  for (const name of await readdir(pool).catch(() => [])) {
    if (name === 'index.html') continue
    if (!/^[a-f0-9]{64}$/.test(name) || sign(await readFile(resolve(pool, name))) !== name) {
      throw new Error(`pure host: ${meaning} carries ${name.slice(0, 12)}, which does not hash to its name`)
    }
  }
}
const forged = (await signaturesOf(buildSig, record.version, await readSignatures(resolve(dist, sign(SIGNATURES_MEANING))))).filter(s => !s.ok)
if (forged.length) throw new Error(`pure host: ${forged.length} build signature(s) do not verify (${forged.map(s => s.role + ' ' + s.pubkey.slice(0, 12)).join(', ')})`)
closure.add(buildSig)
const unnamed = signed.filter(sig => !known.includes(sig) && !closure.has(sig))
if (unnamed.length) throw new Error(`pure host: signed files nothing names (${unnamed.map(s => s.slice(0, 12)).join(', ')})`)
for (const sig of closure) if (!signed.includes(sig)) throw new Error(`pure host: the host package names ${sig.slice(0, 12)}, which is not here`)
if (/customElements\.define\(/.test(hostBundle) && hostBundle.includes('hc-shim-hosts')) {
  throw new Error('pure host: the host bundle defines the host console — it belongs to the host package')
}
if (names.includes('main.js.map')) throw new Error('pure host: source map belongs to the source checkout')
// THE KERNEL stays a one-pager: it knows one signature, verifies, and runs it.
// Anything more belongs in the signed host bundle, not in the install.
const kernelBytes = (await stat(resolve(dist, 'main.js'))).size
if (kernelBytes > 4096) throw new Error(`pure host: the kernel grew to ${kernelBytes} bytes — keep main.js to the signature loader`)
const fontsCss = await readFile(resolve(dist, 'fonts', 'fonts.css'), 'utf8')
// The host renders Inter and upright Source Serif 4; icon and italic faces
// belong to the packages that render them.
const HOST_FAMILIES = new Set(['Inter', 'Source Serif 4'])
const families = new Set([...fontsCss.matchAll(/font-family:\s*'([^']+)'/g)].map(m => m[1]))
const extra = [...families].filter(family => !HOST_FAMILIES.has(family))
if (extra.length) throw new Error(`pure host: application fonts belong to their packages (${extra.join(', ')})`)
if (/font-style:\s*italic/.test(fontsCss)) throw new Error('pure host: italic faces belong to their packages')
const named = new Set([...fontsCss.matchAll(/url\(\.\/([^?)]+)/g)].map(m => m[1]))
const fontFiles = (await readdir(resolve(dist, 'fonts'))).filter(name => name !== 'fonts.css')
const stray = fontFiles.filter(name => !named.has(name))
if (stray.length) throw new Error(`pure host: font files no face names (${stray.join(', ')})`)

console.log('[host] pure install verified')
