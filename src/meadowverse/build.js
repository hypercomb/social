import { buildSync } from 'esbuild'
import { cpSync, mkdirSync } from 'fs'

mkdirSync('dist', { recursive: true })

buildSync({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/main.js',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  external: ['three'],
  tsconfig: 'tsconfig.json'
})

cpSync('public', 'dist', { recursive: true })

console.log('[meadowverse] build complete → dist/')
