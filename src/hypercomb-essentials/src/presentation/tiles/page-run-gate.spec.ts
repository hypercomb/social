// presentation/tiles/page-run-gate.spec.ts — a TRIAL runs sealed wherever the
// gate is asked (2026-11-27, documentation/inline-code-in-input-audit.md H2).
// The site view shows a trial's own door first; the room view, a part seated in
// a page and a post-it asked only `pageRunsSealed`, and ran a model's trial as
// the hive. Trials written before then were marked authored, so the trial is
// asked by the gate itself, not left to authorship.

import { afterEach, describe, expect, it } from 'vitest'
import { pageRunsSealed } from './page-run-gate.js'
import { forgetTrials, releaseTrial, rememberTrial } from '../../files/try-page.js'
import { markAuthored } from '../../sharing/authored-sigs.js'

afterEach(() => { forgetTrials(); localStorage.removeItem('hc:authored-sigs') })

describe('the page gate and a trial', () => {
  const sig = '5a'.repeat(32)

  it('runs a page of the hive\'s own in the page itself', () => {
    markAuthored(sig)
    expect(pageRunsSealed(['studio'], sig, '')).toBe(false)
  })

  it('seals a trial even when it was marked authored, until a person brings it home', () => {
    markAuthored(sig)
    rememberTrial(sig, 'try-studio', { own: true })
    expect(pageRunsSealed(['studio'], sig, '')).toBe(true)
    expect(releaseTrial(sig)).toBe(true)
    expect(pageRunsSealed(['studio'], sig, '')).toBe(false)
  })

  it('seals a trial that is not authored, and after it comes home as someone else\'s', () => {
    rememberTrial(sig, 'try-studio')
    expect(pageRunsSealed(['studio'], sig, '')).toBe(true)
    releaseTrial(sig)
    expect(pageRunsSealed(['studio'], sig, '')).toBe(true)
  })
})
