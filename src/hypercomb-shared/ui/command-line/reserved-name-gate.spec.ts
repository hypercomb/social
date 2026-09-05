// ui/command-line/reserved-name-gate.spec.ts — the naming gesture refuses a
// reserved pool word, in both mouths that speak it.
//
// documentation/hypergraph-molecule-lineage.md, execution order step 5. The
// shell's create commit is the one path every new tile name passes; the
// create queen's `refuse` is what the model grammar hears. Both consult the
// same core primitive — never a local list.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isReservedPoolWord } from '@hypercomb/core'

const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8')

describe('the reserved-name gate', () => {
  it('sits in the shell create commit, before the first paint or commit', () => {
    const src = read('hypercomb-shared', 'ui', 'command-line', 'command-line.component.ts')
    const start = src.indexOf('private readonly commitCreateCellInPlace = async')
    const body = src.slice(start)
    const gate = body.indexOf('isReservedPoolWord(')
    const paint = body.indexOf("EffectBus.emit('cell:added'")
    const commit = body.indexOf('committer.importTree(')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(paint)
    expect(gate).toBeLessThan(commit)
    // the typed name stays in the line — a refusal does not clear it
    const between = body.slice(gate, body.indexOf('\n    }\n', gate))
    expect(between.includes('this.clear()')).toBe(false)
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
