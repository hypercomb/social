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
const core = await readdir(resolve(dist, 'core', 'dist'))
if (core.length !== 1 || core[0] !== 'index.js') throw new Error('pure host: core runtime must be ESM only')
if (names.includes('main.js.map')) throw new Error('pure host: source map belongs to the source checkout')

console.log('[host] pure install verified')
