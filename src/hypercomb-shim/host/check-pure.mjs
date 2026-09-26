#!/usr/bin/env node
// Refuse to package an application snapshot as the installable cold harness.
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
const signed = names.filter(name => /^[a-f0-9]{64}$/.test(name))
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
