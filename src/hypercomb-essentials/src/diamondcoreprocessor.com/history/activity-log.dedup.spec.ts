// activity-log.dedup.spec.ts — the feed announces TRANSITIONS, not deliveries.
//
// WHAT THIS PINS, and why it is worth a spec of its own.
//
// `cell:added` / `cell:removed` are STATE ASSERTIONS. One participant gesture
// delivers each of them at least twice — the gesture's own eager emit, then
// the commit's post-commit reconcile re-announcing the same difference
// (layer-committer.drone.ts :944/:947, :1302/:1306, :1338/:1341). Measured on
// the live app before this fix: a create made two rows, a nested create four
// for one Enter, and an undo left THREE rows including a phantom offering to
// undo an already-undone create. With MAX_ENTRIES at 10, that halved the
// history a participant could actually see.
//
// The obvious fix — drop anything carrying `fromCascade` — is WRONG, and this
// spec exists partly to record why so nobody re-derives it. The cascade is not
// noise; it is the reconcile channel, and for several real write paths it is
// the ONLY announcement there is: swarm-adopt.drone.ts, groups/aggregation-
// layer.ts and groups/mixed-group-bag.ts all commit through importTree /
// update / commitSlotSet while emitting no cell effect of their own. Filtering
// the flag would trade a duplicate row for a MISSING one — adopting a hive, or
// changing a group's membership, would pass in total silence.
//
// So the feed buys idempotence instead, which is what every other subscriber
// gets for free by being a set write. The rule under test: a delivery is news
// only when it CHANGES the direction last announced for that cell in that
// place.
//
// Driven through the real element rather than a copy of the rule, so the spec
// fails if the wiring is dropped as readily as if the logic is.
//
// PROVEN AGAINST A MUTATION BATTERY, because a green suite guarding a
// behaviour change is worth nothing until you know what it can catch. Eight
// plausible wrong versions of the fix were each built and run: the dedup off
// entirely, the wildcard read without being consumed, the exact-place record
// consumed on first use, the root `[]` treated as an absence, direction
// ignored, no clear on disconnect, place ignored, and `if (p.fromCascade)
// return` — the fix that was suggested first and ruled out. All eight are
// killed, and all fifteen tests below kill at least one, so none is dead
// weight. Two earlier versions of this file were NOT: a remount test that
// mounted a second element (a private instance field starts empty either way,
// so it passed with the clear commented out) and an undo test that could not
// tell which of two identical rows survived. Both are rewritten below to be
// able to fail.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

/** Mount a fresh feed and let its `#ready` microtask land.
 *
 *  The element gates on `#ready` precisely so the subscribe-time replay of the
 *  last value does not re-announce stale news at boot — so a test must clear
 *  the bus first, then wait, or it is testing the replay instead of the rule. */
async function mount(): Promise<HTMLElement> {
  await import('./activity-log.view.js')
  const el = document.createElement('hc-activity-log')
  document.body.append(el)
  await Promise.resolve()
  await Promise.resolve()
  return el
}

const rows = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('.activity-entry')].map(n => (n.textContent ?? '').trim())

/** Rows whose text names this cell. Counting rows that name the cell — rather
 *  than the panel's total — means an unrelated line drifting into the feed can
 *  never mask a regression here. */
const naming = (el: HTMLElement, cell: string): string[] =>
  rows(el).filter(text => text.includes(cell))

describe('activity feed: one transition, one row', () => {

  beforeEach(() => {
    document.body.replaceChildren()
    EffectBus.clear()
    vi.useRealTimers()
  })

  it('collapses the commit echo of a create into the gesture’s own row', async () => {
    const el = await mount()

    // Exactly what the live trace measured for typing a name and pressing
    // Enter: the command line's eager emit, then importTree's reconcile
    // re-asserting the same fact after the commit.
    EffectBus.emit('cell:added', { cell: 'alpha', segments: [], viaUpdate: true })
    EffectBus.emit('cell:added', { cell: 'alpha', segments: [], fromCascade: true })

    expect(naming(el, 'alpha')).toHaveLength(1)
  })

  it('collapses the echo of a remove too', async () => {
    const el = await mount()
    EffectBus.emit('cell:removed', { cell: 'alpha', segments: [], viaUpdate: true })
    EffectBus.emit('cell:removed', { cell: 'alpha', segments: [], fromCascade: true })
    expect(naming(el, 'alpha')).toHaveLength(1)
  })

  it('keeps the row that carries the UNDO — the gesture’s, not the echo’s', async () => {
    const el = await mount()
    EffectBus.emit('cell:added', { cell: 'alpha', segments: [] })
    EffectBus.emit('cell:added', { cell: 'alpha', segments: [], fromCascade: true })

    // The surviving row must still be undoable. Suppressing the wrong one of
    // the pair would leave a line the participant cannot take back — the one
    // way this change could do real harm.
    const entries = [...el.querySelectorAll('.activity-entry')]
      .filter(n => (n.textContent ?? '').includes('alpha'))
    expect(entries).toHaveLength(1)
    expect(entries[0]?.querySelector('.entry-revert')).not.toBeNull()
  })

  it('keeps the FIRST arrival, proven by the one case where the two differ', async () => {
    // The test above cannot tell first from second: both deliveries build an
    // identical row, so it passes either way. `#reverting` is the one lever
    // that makes them distinguishable — it strips the arrow off a revert's own
    // row for exactly one synchronous statement. Drive it directly: if the
    // SECOND arrival were the survivor, the row would come back arrowed.
    const el = await mount()
    EffectBus.emit('cell:removed', { cell: 'alpha', segments: [] })
    const first = [...el.querySelectorAll('.activity-entry')]
      .filter(n => (n.textContent ?? '').includes('alpha'))
    expect(first).toHaveLength(1)
    const arrowedBefore = !!first[0]?.querySelector('.entry-revert')

    EffectBus.emit('cell:removed', { cell: 'alpha', segments: [], fromCascade: true })
    const after = [...el.querySelectorAll('.activity-entry')]
      .filter(n => (n.textContent ?? '').includes('alpha'))
    expect(after).toHaveLength(1)
    // Same NODE, untouched — not a replacement built by the echo.
    expect(after[0]).toBe(first[0])
    expect(!!after[0]?.querySelector('.entry-revert')).toBe(arrowedBefore)
  })

  it('does NOT go deaf after an unnamed delivery — the wildcard is consumed', async () => {
    // THE BUG THIS EXISTS FOR. An earlier version READ the unnamed-place
    // wildcard without consuming it, so one segment-less `removed` left it set
    // for the session and every later named `removed` of that name was
    // swallowed. Both of these are real payload shapes: several emitters omit
    // `segments` entirely, and the committer's echo carries the address it
    // bound at enqueue.
    const el = await mount()
    EffectBus.emit('cell:removed', { cell: 'notes' })
    EffectBus.emit('cell:removed', { cell: 'notes', segments: ['work'], fromCascade: true })
    // The pair collapsed…
    expect(naming(el, 'notes')).toHaveLength(1)

    // …and a DIFFERENT tile of the same name, somewhere else, is still news.
    // Swallowing this one loses the row AND its undo, on a delete.
    EffectBus.emit('cell:removed', { cell: 'notes', segments: ['home'], viaUpdate: true })
    expect(naming(el, 'notes')).toHaveLength(2)
  })

  it('resolves an unnamed assertion onto the place its echo names', async () => {
    const el = await mount()
    EffectBus.emit('cell:added', { cell: 'alpha' })
    EffectBus.emit('cell:added', { cell: 'alpha', segments: ['deep'], fromCascade: true })
    expect(naming(el, 'alpha')).toHaveLength(1)

    // Having been resolved onto `deep`, a further repeat THERE is still
    // redundant — the record must survive the resolution, not be consumed by
    // it. (An exact-place match is idempotent for any number of repeats; only
    // the wildcard is one-shot.)
    EffectBus.emit('cell:added', { cell: 'alpha', segments: ['deep'], fromCascade: true })
    expect(naming(el, 'alpha')).toHaveLength(1)
  })

  it('survives more than one reconcile of the same gesture', async () => {
    // Some commit paths reconcile twice. An exact-place match must therefore
    // stay recorded rather than being consumed on first use, or the second
    // echo would print a row.
    const el = await mount()
    EffectBus.emit('cell:added', { cell: 'alpha', segments: ['x'], viaUpdate: true })
    EffectBus.emit('cell:added', { cell: 'alpha', segments: ['x'], fromCascade: true })
    EffectBus.emit('cell:added', { cell: 'alpha', segments: ['x'], fromCascade: true })
    expect(naming(el, 'alpha')).toHaveLength(1)
  })

  it('still announces a genuine add → remove → add, which is three transitions', async () => {
    const el = await mount()
    EffectBus.emit('cell:added', { cell: 'alpha', segments: [] })
    EffectBus.emit('cell:added', { cell: 'alpha', segments: [], fromCascade: true })
    EffectBus.emit('cell:removed', { cell: 'alpha', segments: [] })
    EffectBus.emit('cell:removed', { cell: 'alpha', segments: [], fromCascade: true })
    EffectBus.emit('cell:added', { cell: 'alpha', segments: [] })

    // Nothing can be added twice without being removed in between, so only the
    // re-assertion is redundant — never a real change of direction.
    expect(naming(el, 'alpha')).toHaveLength(3)
  })

  it('treats the same name in two PLACES as two different facts', async () => {
    const el = await mount()
    EffectBus.emit('cell:added', { cell: 'notes', segments: ['work'] })
    EffectBus.emit('cell:added', { cell: 'notes', segments: ['home'] })
    expect(naming(el, 'notes')).toHaveLength(2)
  })

  it('treats the hive ROOT as a real place, not an absent one', async () => {
    // `[]` is an ADDRESS — you are standing at the root — while a missing
    // `segments` is a refusal to name one. Collapsing the two (the tempting
    // `segments.length > 0` shortcut in placeKey) would make a root-level
    // create behave like an unnamed one, so it would swallow the later
    // same-named create inside a tile. Nothing else in this suite can see
    // that difference.
    const el = await mount()
    EffectBus.emit('cell:added', { cell: 'notes', segments: [] })
    EffectBus.emit('cell:added', { cell: 'notes', segments: ['deep'] })
    expect(naming(el, 'notes')).toHaveLength(2)
  })

  it('collapses a move’s pair even though it arrives cascade-first', async () => {
    const el = await mount()
    // move.drone emits AFTER its commits, so the reconcile lands before the
    // gesture — the opposite order from a create. A direction map collapses
    // either order; a time-ordered "was the last one recent" check would not.
    EffectBus.emit('cell:removed', { cell: 'alpha', segments: ['from'], fromCascade: true })
    EffectBus.emit('cell:added', { cell: 'alpha', segments: ['to'], fromCascade: true })
    EffectBus.emit('cell:removed', { cell: 'alpha', segments: ['from'], viaUpdate: true })
    EffectBus.emit('cell:added', { cell: 'alpha', segments: ['to'], viaUpdate: true })

    // One line for leaving, one for arriving — not four.
    expect(naming(el, 'alpha')).toHaveLength(2)
  })

  it('matches an unnamed place against a named one, in EITHER order', async () => {
    // Several emitters omit `segments` while their echo carries the address
    // the committer bound at enqueue. If "unnamed" were its own place, exactly
    // those pairs would slip through as duplicates.
    const first = await mount()
    EffectBus.emit('cell:added', { cell: 'alpha' })
    EffectBus.emit('cell:added', { cell: 'alpha', segments: ['deep'], fromCascade: true })
    expect(naming(first, 'alpha')).toHaveLength(1)

    document.body.replaceChildren()
    EffectBus.clear()

    const second = await mount()
    EffectBus.emit('cell:added', { cell: 'beta', segments: ['deep'], fromCascade: true })
    EffectBus.emit('cell:added', { cell: 'beta' })
    expect(naming(second, 'beta')).toHaveLength(1)
  })

  it('announces a cascade-ONLY write — the row a flag filter would have eaten', async () => {
    const el = await mount()
    // Adopting a swarm hive, an aggregation layer's children write and a group
    // bag's membership all commit without emitting any cell effect of their
    // own, so the reconcile IS the announcement. This is the case that rules
    // out `if (p.fromCascade) return`.
    EffectBus.emit('cell:added', { cell: 'adopted', segments: ['shared'], fromCascade: true })
    expect(naming(el, 'adopted')).toHaveLength(1)
  })

  it('announces the mutation ROLLBACK, which is the opposite direction', async () => {
    const el = await mount()
    // A failed child-name op emits the INVERSE event with fromCascade set
    // (layer-committer.drone.ts:447). It is a different direction, so it is a
    // transition and must be announced — otherwise the feed reads "added x"
    // while the tile is gone.
    EffectBus.emit('cell:added', { cell: 'doomed', segments: [] })
    EffectBus.emit('cell:removed', { cell: 'doomed', segments: [], fromCascade: true })
    expect(naming(el, 'doomed')).toHaveLength(2)
  })

  it('forgets its transitions on disconnect, so a REATTACHED element is not deaf', async () => {
    // MUST re-attach the SAME element. Creating a second one proves nothing:
    // `#announced` is a private INSTANCE field, so a fresh element starts
    // empty whether or not disconnect clears anything — which is exactly how
    // the first version of this test passed with the clear commented out.
    const el = await mount()
    EffectBus.emit('cell:added', { cell: 'alpha', segments: [] })
    expect(naming(el, 'alpha')).toHaveLength(1)

    el.remove()
    document.body.append(el)
    await Promise.resolve()
    await Promise.resolve()

    // The feed came back EMPTY (disconnect drops every entry), so the same
    // fact is news again. A memory that outlived the rows would leave the
    // first gesture after a remount unannounced — a blank feed that stays
    // blank.
    EffectBus.emit('cell:added', { cell: 'alpha', segments: [] })
    expect(naming(el, 'alpha')).toHaveLength(1)
  })
})
