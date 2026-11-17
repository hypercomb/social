// @vitest-environment node
//
// source-filters.spec.ts — which files are the package's own source. The
// build and the TypeScript the package hosts ask the same rule, and that rule
// must never keep a file git ignores: it would be signed into the root from
// one checkout and be absent from the next.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isCarriedSource, isEntry, isIndexFile, isKeysFile, isSource, isSpecFile } from './source-filters.js'
import { typescriptCarries, typescriptPaths } from '../src/assistant/package-typescript.js'

const ESSENTIALS = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXCLUDED = ['revolucionstyle.com']

describe('isCarriedSource — the TypeScript the package hosts', () => {
  it('keeps a plain source file in a folder, at any depth', () => {
    for (const rel of ['assistant/a.ts', 'games/solomon/labyrinth.ts', 'sharing/host.service.ts', 'move/move.drone.ts']) {
      expect(isCarriedSource(rel, EXCLUDED), rel).toBe(true)
    }
  })

  it('refuses a file directly in src/: the build compiles none, and prepare.ts rewrites the barrels there', () => {
    for (const rel of ['a.ts', 'side-effects.ts', 'preload-effects.ts', 'sleeping-effects.ts']) {
      expect(isCarriedSource(rel, EXCLUDED), rel).toBe(false)
    }
  })

  it('refuses specs, declarations, generated barrels, keys, entries, types and excluded domains', () => {
    for (const rel of [
      'assistant/a.spec.ts', 'assistant/a.test.ts', 'assistant/a.d.ts', 'assistant/x-keys.ts', 'assistant/x.keys.ts',
      'assistant/essentials-keys.ts', 'assistant/a.entry.ts', 'assistant/a.js',
      'a.spec.ts', 'a.test.ts', 'games/arkanoid/xselftest.ts', 'a.d.ts', 'index.ts', 'assistant/index.ts',
      'x-keys.ts', 'x.keys.ts', 'essentials-keys.ts', 'a.entry.ts', 'types/a.ts', 'types',
      'revolucionstyle.com/a.ts', 'a.json', 'a.js', 'commands/beehive.words.json',
    ]) {
      expect(isCarriedSource(rel, EXCLUDED), rel).toBe(false)
    }
  })

  it('is the build\'s own filters and nothing looser', () => {
    expect(isSource('a.ts') && isSource('a.js') && !isSource('a.d.ts')).toBe(true)
    expect(isSpecFile('a.spec.js') && isSpecFile('selftest.ts')).toBe(true)
    expect(isKeysFile('dir\\essentials-keys.js')).toBe(true)
    expect(isEntry('a.entry.js')).toBe(true)
    expect(isIndexFile('dir\\index.js')).toBe(true)
  })
})

describe('over the real source tree', () => {
  const walk = (dir: string, rel = ''): string[] => readdirSync(join(dir, rel)).flatMap(name => {
    const at = rel ? `${rel}/${name}` : name
    return statSync(join(dir, at)).isDirectory() ? walk(dir, at) : [at]
  })

  it('carries no file directly in src/, whatever a checkout has there', () => {
    const top = readdirSync(join(ESSENTIALS, 'src')).filter(name => statSync(join(ESSENTIALS, 'src', name)).isFile())
    expect(top.length).toBeGreaterThan(0)
    expect(top.filter(name => isCarriedSource(name, EXCLUDED))).toEqual([])
  })

  it('the device\'s copy of the name rule gives the build\'s answer for every file, and for the names that try it', () => {
    // The code view draws its TypeScript button by typescriptCarries
    // (package-typescript.ts), which cannot import this build-only file. A
    // button where the atoms carry nothing, or none where they do, is the
    // two rules apart. Excluded domains are the build's alone, so none here.
    const names = [
      ...walk(join(ESSENTIALS, 'src')),
      'a.ts', 'index.ts', 'side-effects.ts', 'essentials-keys.ts', 'types/a.ts', 'types/deep/a.ts', 'mytypes/a.ts', 'assistant/types/a.ts',
      'assistant/a.ts', 'assistant/index.ts', 'assistant/deep/index.ts', 'assistant/reindex.ts', 'assistant/a.spec.ts', 'assistant/a.test.ts',
      'assistant/selftest.ts', 'assistant/xselftest.ts', 'assistant/a.d.ts', 'assistant/x-keys.ts', 'assistant/x.keys.ts', 'assistant/keys.ts',
      'assistant/essentials-keys.ts', 'assistant/a.entry.ts', 'assistant/entry.ts', 'assistant/a.js', 'assistant/a.json', 'assistant/a.tsx',
    ]
    let carried = 0
    for (const rel of new Set(names)) {
      // A name the section grammar refuses is dropped by the bundler too (carriedFiles).
      const built = isCarriedSource(rel, []) && typescriptPaths(`src/${rel}`) !== null
      expect(typescriptCarries(`src/${rel}`), rel).toBe(built)
      if (built) carried++
    }
    expect(carried).toBeGreaterThan(100)
  })

  it('carries no file git ignores: no generated index.ts and no keys file', () => {
    const carried = walk(join(ESSENTIALS, 'src')).filter(rel => isCarriedSource(rel, EXCLUDED))
    expect(carried.length).toBeGreaterThan(100)
    expect(carried.filter(rel => rel.split('/').pop() === 'index.ts' || rel.endsWith('-keys.ts'))).toEqual([])
  })

  it('.gitignore names exactly the generated source patterns the filter knows', () => {
    // A third generated pattern ignored under src/ means the filter must learn
    // it, or one checkout's generated file is signed into the package.
    const ignored = readFileSync(join(ESSENTIALS, '.gitignore'), 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('src/'))
    expect(ignored).toEqual(['src/**/index.ts', 'src/**/*-keys.ts'])
  })
})
