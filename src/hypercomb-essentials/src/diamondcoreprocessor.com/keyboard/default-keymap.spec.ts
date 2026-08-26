// diamondcoreprocessor.com/keyboard/default-keymap.spec.ts
//
// BARE LETTERS ARE THE SCARCEST THING IN THIS MAP. There are twenty-six of
// them and most are already spoken for, so which act gets one is a decision
// worth writing down — and a second act quietly taking a letter that is
// already bound is the failure this pins.
//
// `a` opens the ASSISTANT. It used to cycle the arrangements, which moved to
// `l`: one is the thing you reach for mid-thought, the other is a view you
// set once and leave.

import { describe, it, expect } from 'vitest'
import { globalKeyMap, defaultKeyMap } from './default-keymap.js'
import type { KeyMapLayer } from '@hypercomb/core'

const layers: KeyMapLayer[] = [globalKeyMap, defaultKeyMap]

/** Every binding in both layers, flattened. */
const bindings = layers.flatMap(layer => layer.bindings)

const chordsOf = (cmd: string) =>
  bindings.find(b => b.cmd === cmd)?.sequence.flat() ?? []

describe('default keymap — who holds which letter', () => {

  it('`a` opens the assistant, and nothing else claims it', () => {
    const chords = chordsOf('chat.toggle')
    expect(chords).toHaveLength(1)
    expect(chords[0]?.key).toBe('a')
    // Global, not the default layer: a conversation is about wherever you are
    // standing, so it opens from anywhere.
    expect(globalKeyMap.bindings.some(b => b.cmd === 'chat.toggle')).toBe(true)
  })

  it('`l` steps the arrangements, shifted steps back', () => {
    expect(chordsOf('sequence.cycle')[0]).toMatchObject({ key: 'l', shift: false })
    expect(chordsOf('sequence.cyclePrev')[0]).toMatchObject({ key: 'l', shift: true })
  })

  it('nothing is still bound to `a` for arranging', () => {
    const arranging = ['sequence.cycle', 'sequence.cyclePrev']
      .flatMap(chordsOf)
      .map(chord => chord.key)
    expect(arranging).not.toContain('a')
  })

  it('no two commands share the same single-key chord', () => {
    // The shape a chord is claimed by: key plus every modifier that matters.
    // `shift: false` and `shift: undefined` are the same claim, so a missing
    // modifier normalises to false — otherwise a real collision reads as two
    // different chords and this test would never fire.
    const claim = (c: { key: string; shift?: boolean; ctrl?: boolean; alt?: boolean; primary?: boolean }): string =>
      [c.key, !!c.shift, !!c.ctrl, !!c.alt, !!c.primary].join('|')

    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const binding of bindings) {
      // Only single-STEP bindings can collide outright; a multi-step sequence
      // is a different thing and is not what this guards.
      if (binding.sequence.length !== 1) continue
      // The two layers are allowed to disagree — that is what priority is
      // for. Only a collision INSIDE one layer is drift.
      const layer = layers.find(l => l.bindings.includes(binding))?.id ?? ''
      for (const chord of binding.sequence[0] ?? []) {
        const scoped = `${layer}::${claim(chord)}`
        const held = seen.get(scoped)
        if (held === undefined) { seen.set(scoped, binding.cmd); continue }
        clashes.push(`${scoped} — ${held} and ${binding.cmd}`)
      }
    }
    expect(clashes).toEqual([])
    // Proof the sweep actually looked at something: a lookup keyed
    // differently from the write would make the check above vacuous.
    expect(seen.size).toBeGreaterThan(10)
    expect([...seen.values()]).toContain('chat.toggle')
  })

  it('every binding says what it does, so the shortcut sheet can read it out', () => {
    const mute = bindings.filter(b => !b.description?.trim()).map(b => b.cmd)
    expect(mute).toEqual([])
  })
})
