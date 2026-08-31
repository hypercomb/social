import { defineConfig } from 'tsup'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Every module is its own entry: consumers import `@hypercomb/runtime/store`
// as readily as the barrel, and a shim that wants only the read side should
// not have to pull the whole package to get it.
const src = resolve(import.meta.dirname, 'src')
const entry = readdirSync(src)
  .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.spec.ts'))
  .map(f => `src/${f}`)

export default defineConfig({
  entry,
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  platform: 'browser',
  external: ['@hypercomb/core'],
})
