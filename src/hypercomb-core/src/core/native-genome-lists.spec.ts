// native-genome-lists.spec.ts — the desktop host's gate keeps two lists of
// core's in Rust (hypercomb-client/crates/serve/src/genome.rs): which slots
// hold a location's children, and which fields are referents (pointers at the
// past, never carried). A host that drifted from core would either refuse
// current pages or serve history, so the TypeScript suite reads the Rust
// source and fails the moment the copies disagree.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REFERENT_FIELDS } from './edge-registry.js'
import { CHILD_SLOTS } from './level-roster.js'
import { HOME_MOLECULE_NAME } from './molecule-address.js'

const rust = readFileSync(
  join(__dirname, '..', '..', '..', 'hypercomb-client', 'crates', 'serve', 'src', 'genome.rs'),
  'utf8',
)

const listed = (constant: string): string[] => {
  const match = new RegExp(`const ${constant}: &\\[&str\\] = &\\[([^\\]]*)\\]`).exec(rust)
  if (!match) throw new Error(`${constant} not found in genome.rs`)
  return [...match[1].matchAll(/"([^"]*)"/g)].map(found => found[1])
}

describe('the desktop host gate reads core’s lists, not its own', () => {
  it('names the same child slots', () => {
    expect(listed('CHILD_SLOTS').sort()).toEqual([...CHILD_SLOTS].sort())
  })

  it('skips the same referent fields', () => {
    expect(listed('REFERENT_FIELDS').sort()).toEqual([...REFERENT_FIELDS].sort())
  })

  it('roots the hive at the same home molecule', () => {
    expect(/const HOME_MOLECULE: &str = "([^"]*)"/.exec(rust)?.[1]).toBe(HOME_MOLECULE_NAME)
  })
})
