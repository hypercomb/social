// commands/remote-refusal.spec.ts
//
// WHAT A REMOTE CALLER MAY NOT SAY, and why it is read off the census rather
// than a list. The bridge's destructive guard used to be a four-name set —
// `remove, rm, delete, del` — which is the same mistake as the retired
// CALLABLE_FORMS table: a second copy of a truth that lives elsewhere. It had
// already drifted, because `/cut` drops a child from its parent exactly as
// `/remove` does and was never on it.
//
// SINCE THEN the decision itself moved OFF this door: `admitMachineCall` in
// core answers for every machine surface, and the rule is asserted there
// (hypercomb-core/src/core/machine-admission.spec.ts). What is left here is the
// half only this project can see — that the shipped behaviours declare what the
// gate reads — plus a source guard proving this door ASKS rather than judges.
// The guard itself lives in an Angular component (hypercomb-shared/ui/
// command-line), which this project may not import.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (key: string, value: unknown) => registrations.set(key, value),
    get: (key: string) => registrations.get(key),
  },
}

const { CutQueenBee } = await import('../clipboard/clipboard.queen.js')
const { HideQueenBee } = await import('../presentation/tiles/hide.queen.js')

describe('the declarations a remote refusal keys on', () => {
  it('/cut declares itself destructive — the name set never had it', () => {
    // It calls commitChildrenDeltas with `removes`: the parent stops holding
    // the tile. Same shape as /remove, and the four-name list missed it.
    expect(new CutQueenBee().machine?.reach).toBe('destructive')
  })

  it('/hide stays editing, so the gentle verb is not refused with the harsh one', () => {
    // HIDE FIRST, DELETE SECOND. If hiding were labelled destructive, a remote
    // caller would be refused the reversible verb and left nothing safer.
    expect(new HideQueenBee().machine?.reach).toBe('editing')
  })
})

const guard = readFileSync(
  join(process.cwd(), 'hypercomb-shared', 'ui', 'command-line', 'command-line.component.ts'),
  'utf8',
)
/** The remote-submit listener, where the refusals live. */
const remoteBlock = (): string => {
  const at = guard.indexOf('REMOTE_SUBMIT, ({ text, accept, complete })')
  expect(at).toBeGreaterThan(-1)
  // Wide enough to reach both refusals (~4.6k in) and stop before the next
  // listener. Measured rather than guessed — a window that silently falls
  // short would make these assertions pass for the wrong reason.
  return guard.slice(at, at + 6000)
}

describe('the remote door asks the gate, and does not judge for itself', () => {
  it('resolves the caller as an OPERATOR and hands the verdict to core', () => {
    // DEFAULT-ELSEWHERE. Judging here is how four surfaces came to disagree —
    // each door deciding in the order the doors were written. The rule is
    // core's `machine-admission`; this door supplies only who is calling and
    // which census row the word resolves to.
    const block = remoteBlock()
    expect(block).toContain("'operator'")
    expect(block).toContain('admitMachineCall(')
    // Neither refusal may be re-derived here. A second copy of an admission
    // rule does not fail safe — it fails OPEN at whichever door was not
    // updated, which is exactly what the audit found.
    expect(block).not.toContain("machine?.reach === 'destructive'")
    expect(block).not.toContain('DESTRUCTIVE_COMMANDS.has')
  })

  it('resolves participant aliases, so a second name cannot walk around a refusal', () => {
    // `rm` must inherit `remove`'s reach rather than be absent from a list.
    // Resolution stays at the door because it differs by door ON PURPOSE: the
    // model channel resolves primary names only.
    expect(remoteBlock()).toContain('spokenEntry(')
  })

  it('judges EVERY verb in the line, and the first refusal answers', () => {
    // A prose reading can carry several actions. Admitting a prefix and
    // refusing a tail would leave the hive half-changed under a refusal.
    expect(remoteBlock()).toMatch(/for \(const verb of spokenVerbs\)/)
  })

  it('leaves the keyboard path alone — typing still gets a confirmation', () => {
    expect(guard).toContain('DESTRUCTIVE_COMMANDS.has(a.command)')
  })
})
