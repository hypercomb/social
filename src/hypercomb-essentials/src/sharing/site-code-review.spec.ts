// site-code-review.spec.ts — the card page's door to the brood: it shows only
// while a draft of your own waits for your hand, says how many, and opens the
// brood. It decides nothing.

import { describe, expect, it } from 'vitest'
import { EffectBus, type BroodRecord } from '@hypercomb/core'
import { codeReviewButton, draftsWaiting, waitsForYou } from './site-code-review.js'

const record = (over: Partial<BroodRecord> & { how?: string } = {}): BroodRecord => ({
  sig: (over.sig ?? 'a'.repeat(64)),
  kind: 'bee',
  arrived: 1,
  source: { kind: 'own', how: over.how ?? 'a draft of src/a.ts at assistant' },
  audits: [],
  vouches: [],
  flags: [{ by: 'trial', reason: 'untried', at: 1 }],
  ...over,
} as BroodRecord)

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('code to review', () => {
  it('counts only your own drafts that are held and unruled', async () => {
    expect(waitsForYou(record())).toBe(true)
    expect(waitsForYou(record({ ruling: { verdict: 'accepted', at: 2 } } as Partial<BroodRecord>))).toBe(false)
    expect(waitsForYou(record({ flags: [] }))).toBe(false)
    expect(waitsForYou(record({ source: { kind: 'stranger', how: 'a draft of x' } }))).toBe(false)
    expect(waitsForYou(record({ how: 'package install' }))).toBe(false)
    // A draft that came home with a card (module-drafts.ts restoreDraft) waits the same way.
    expect(waitsForYou(record({ how: 'a draft of assistant at src/a.ts, carried home with business-card' }))).toBe(true)
    expect(await draftsWaiting(async () => [record(), record({ sig: 'b'.repeat(64) }), record({ flags: [] })])).toBe(2)
    expect(await draftsWaiting(async () => { throw new Error('no brood') })).toBe(0)
  })

  it('hides at zero, says the count, recounts when a draft lands, and opens the brood', async () => {
    let roster: BroodRecord[] = []
    const button = codeReviewButton('x', async () => roster)
    await settle()
    expect(button.element.hidden).toBe(true)

    roster = [record()]
    EffectBus.emit('module:drafted', { sig: 'a'.repeat(64), at: Date.now() })
    await settle()
    expect(button.element.hidden).toBe(false)
    expect(button.element.textContent).toBe('Code to review · 1')

    const opened: unknown[] = []
    const off = EffectBus.on('brood:open', payload => opened.push(payload))
    opened.length = 0 // last-value replay, if any
    button.element.click()
    off()
    expect(opened).toHaveLength(1)
    expect(Math.abs(Date.now() - ((opened[0] as { at: number }).at))).toBeLessThan(4_000)
    button.dispose()
  })
})
