// commands/remote-refusal.spec.ts
//
// WHAT A REMOTE CALLER MAY NOT SAY, and why it is read off the census rather
// than a list. The bridge's destructive guard used to be a four-name set —
// `remove, rm, delete, del` — which is the same mistake as the retired
// CALLABLE_FORMS table: a second copy of a truth that lives elsewhere. It had
// already drifted, because `/cut` drops a child from its parent exactly as
// `/remove` does and was never on it.
//
// These assert the PROPERTIES the guard now keys on, at their source. The guard
// itself lives in an Angular component (hypercomb-shared/ui/command-line), which
// this project may not import — so this pins the declarations the guard reads,
// and a source guard pins the guard.

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

describe('the remote guard reads declarations, not a list', () => {
  it('refuses on the declared reach rather than a hand-kept name set', () => {
    const block = remoteBlock()
    expect(block).toContain("machine?.reach === 'destructive'")
    // The old set must not be what the REMOTE path consults any more.
    expect(block).not.toContain('DESTRUCTIVE_COMMANDS.has')
  })

  it('refuses concealed verbs — hidden is a discoverability flag, not an authorization one', () => {
    // /flatten, /prune, /sweep, /collapse-history, /consolidate-* sit behind
    // `slashHidden`, documented as "must be typed in full on purpose" — a
    // human-typing assumption a machine defeats for free.
    const block = remoteBlock()
    expect(block).toMatch(/entry\.hidden \|\| entry\.prototype/)
  })

  it('resolves aliases, so a second name cannot walk around either refusal', () => {
    // `rm` must inherit `remove`'s reach rather than be absent from a list.
    expect(remoteBlock()).toContain('aliases')
  })

  it('leaves the keyboard path alone — typing still gets a confirmation', () => {
    expect(guard).toContain('DESTRUCTIVE_COMMANDS.has(a.command)')
  })
})
