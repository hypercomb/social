// ui/command-line/reserved-name-gate.spec.ts — the naming gesture refuses a
// reserved pool word, in both mouths that speak it.
//
// documentation/hypergraph-molecule-lineage.md, execution order step 5. The
// create commit is the one path every new tile name passes; the create
// queen's `refuse` is what the model grammar hears. Both consult the same
// core primitive — never a local list.
//
// The commit moved out of the shell on 2026-11-11 (essentials
// commands/create-cells.ts), so a page with no command line can make a tile.
// The gate went with it, and the shell hands every create to that module.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isReservedPoolWord } from '@hypercomb/core'

const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8')

describe('the reserved-name gate', () => {
  it('sits in the create commit, before the first paint or commit', () => {
    const src = read('hypercomb-essentials', 'src', 'commands', 'create-cells.ts')
    const body = src.slice(src.indexOf('export async function createCells('))
    const gate = body.indexOf('isReservedPoolWord(')
    const paint = body.indexOf("EffectBus.emit('cell:added'")
    const commit = body.indexOf('committer.importTree(')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(paint)
    expect(gate).toBeLessThan(commit)
  })

  it('the shell makes no tile of its own: every create goes to that commit, and a refusal keeps the typed name', () => {
    const src = read('hypercomb-shared', 'ui', 'command-line', 'command-line.component.ts')
    const start = src.indexOf('readonly #createCellInPlace = async')
    const body = src.slice(start, src.indexOf('// slash behaviour execution', start))
    expect(body.includes("'@diamondcoreprocessor.com/CreateCells'")).toBe(true)
    // No second commit, and no second gate to drift from the module's.
    expect(body.includes('importTree(')).toBe(false)
    expect(body.includes("EffectBus.emit('cell:added'")).toBe(false)
    // the typed name stays in the line — a refusal returns before anything clears it
    const refused = body.indexOf('if (!outcome.made) return')
    expect(refused).toBeGreaterThan(-1)
    expect(body.slice(body.indexOf('creator.create('), refused).includes('this.clear()')).toBe(false)
  })

  it('is spoken by the create queen as a refusal', () => {
    const src = read('hypercomb-essentials', 'src', 'commands', 'create.queen.ts')
    const refuse = src.slice(src.indexOf('refuse: (args: string)'), src.indexOf('protected async execute('))
    expect(refuse.includes('isReservedPoolWord(')).toBe(true)
  })

  it('both consult the core primitive, and it answers the way a molecule address folds', () => {
    expect(isReservedPoolWord('bees')).toBe(true)
    expect(isReservedPoolWord('Bees')).toBe(true)
    expect(isReservedPoolWord('cigars')).toBe(false)
    expect(isReservedPoolWord('websites')).toBe(false)
  })
})
