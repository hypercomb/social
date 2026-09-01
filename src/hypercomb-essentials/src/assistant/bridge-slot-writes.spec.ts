import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A BRIDGE OP THAT SETS ONE SLOT MUST TOUCH NO OTHER.
//
// `LayerCommitter.update` is the layer-as-primitive write: the caller passes
// the FULL new layer state and "absent ≡ empty", so every slot it does not
// name is WIPED. That is correct for a caller authoring a whole layer, and
// catastrophic for one that means "add a decoration" or "set the properties":
// `{ name, decorations }` erases `children`, and the cell's subtree is
// orphaned — still resolvable by its own path, simply gone from its parent's
// membership, so nothing draws it and nothing errors. You only notice by eye.
//
// Found 2026-08-30: a `bag-set properties` on a tile with seven children left
// seven orphans. `children` had already been special-cased onto the
// slot-scoped path for a DIFFERENT reason (it is a name slot in `update`, so a
// 64-hex sig would be read as a tile NAME and auto-mint a husk tile) — and
// that special case was quietly hiding how wrong the general case was.
//
// So: every slot writer commits through `commitSlotSet`. This is a ratchet on
// the source, in the same spirit as the doctrine ratchets — it costs one file
// read and it fails the moment someone reintroduces the full-layer write.

const WORKER = join(__dirname, 'claude-bridge.worker.ts')
const source = readFileSync(WORKER, 'utf8')

/** The ops that mean "change ONE slot" — never "replace this layer". */
const SLOT_WRITERS = ['#bagSet', '#bagMutate', '#decorationAdd']

describe('bridge slot writes are slot-scoped', () => {
  it('no slot writer hands committer.update a partial layer', () => {
    // The exact shape that caused it: a `{ name, <slot> }` object passed to
    // update. Any reappearance is the same orphaning bug.
    expect(source).not.toMatch(/committer\.update\(\s*segments,\s*nextLayer\s*\)/)
    expect(source).not.toMatch(/const nextLayer[^=]*=\s*\{\s*name:\s*cellName,/)
  })

  it('every slot writer reaches commitSlotSet', () => {
    for (const writer of SLOT_WRITERS) {
      const at = source.indexOf(`async ${writer}(`)
      expect(at, `${writer} not found — rename it here too`).toBeGreaterThan(-1)
      // The body runs to the next method at the same indentation.
      const rest = source.slice(at)
      const end = rest.indexOf('\n  async #', 1)
      const body = end > 0 ? rest.slice(0, end) : rest
      expect(body, `${writer} must commit through commitSlotSet`).toContain('commitSlotSet')
      expect(body, `${writer} must not full-layer write`).not.toContain('committer.update(')
    }
  })

  it('the layer-as-primitive contract still says absent means empty', () => {
    // If this wording ever changes, the reasoning above has to be re-checked
    // rather than trusted.
    const committer = readFileSync(
      join(__dirname, '..', 'history', 'layer-committer.drone.ts'), 'utf8')
    expect(committer).toMatch(/absent ≡ empty/)
  })
})
