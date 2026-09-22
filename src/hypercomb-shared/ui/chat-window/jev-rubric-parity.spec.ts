// jev-rubric-parity.spec.ts — THE SHELL STAMPS WHAT REPLAY ADMITS.
//
// The shell stamps every decision receipt with a rubric version
// (hypercomb-jev.ts persistJevInput) and essentials replay admits only its own
// (jev-replay.ts, JEV_RUBRIC in jev-decision.ts). The shell may not import a
// module, so the constant lives twice; when they drift, every stored decision
// is skipped as "older rubric" and the golden set silently goes empty. Read as
// text, so this spec imports nothing across the boundary either.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JEV_RUBRIC } from './hypercomb-jev'

describe('the Jev rubric version', () => {
  it('is the same in the shell that stamps receipts and the module that replays them', () => {
    const source = readFileSync(join(__dirname, '../../../hypercomb-essentials/src/assistant/jev-decision.ts'), 'utf8')
    const declared = /export const JEV_RUBRIC = (\d+)/.exec(source)?.[1]
    expect(Number(declared)).toBe(JEV_RUBRIC)
  })
})
