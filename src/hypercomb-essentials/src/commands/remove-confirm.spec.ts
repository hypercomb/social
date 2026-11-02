// commands/remove-confirm.spec.ts
//
// THE ONE DIALOG /remove RAISES, AND WHEN IT DOES NOT.
//
// `confirmRemoval` skips its dialog whenever nothing is nested beneath the
// target — a leaf removal is meant to stay frictionless, and that is a
// deliberate choice, not an oversight. It becomes a bug in two ways, and this
// file guards both:
//
//   1. Anything that PROMISES a confirmation is lying for the common case. The
//      machine catalogue did exactly that until 2026-09-03.
//   2. The count that decides it must look where children actually live.
//      `countSubtree` read `layer.children` alone while the canonical order is
//      `CHILD_SLOTS = ['cells', 'layers', 'children']` — built modules emit
//      `cells`, some trees use `layers`. A tile whose subtree hung off either
//      counted ZERO nested, so the dialog was skipped precisely when a whole
//      branch was about to leave the page.

import { afterEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { confirmRemoval, countTilesBeneath, isMuted, unmute } from './remove-confirm.js'

/** A tiny content-addressed store: sig → layer. */
const historyOf = (layers: Record<string, unknown>) => ({
  getLayerBySig: async (sig: string) => (layers[sig] ?? null) as never,
})

describe('counting what a removal would take with it', () => {
  it('counts a subtree hanging off children', async () => {
    const history = historyOf({
      'sig-drafts': { name: 'drafts', children: ['sig-a', 'sig-b'] },
      'sig-a': { name: 'a' },
      'sig-b': { name: 'b', children: ['sig-c'] },
      'sig-c': { name: 'c' },
    })
    const parent = { children: ['sig-drafts'] }
    expect(await countTilesBeneath(history, parent, ['drafts'])).toBe(3)
  })

  it('counts a subtree hanging off cells or layers — the slots it used to miss', async () => {
    // This is the regression. Installed and built content emits `cells`; some
    // trees carry `layers`. Both returned 0 before, so the branch left the page
    // with no dialog at all.
    for (const slot of ['cells', 'layers']) {
      const history = historyOf({
        'sig-pack': { name: 'pack', [slot]: ['sig-x', 'sig-y'] },
        'sig-x': { name: 'x' },
        'sig-y': { name: 'y', [slot]: ['sig-z'] },
        'sig-z': { name: 'z' },
      })
      const parent = { children: ['sig-pack'] }
      expect(await countTilesBeneath(history, parent, ['pack']), `slot ${slot}`).toBe(3)
    }
  })

  it('finds the targets through a parent addressed by any child slot', async () => {
    const history = historyOf({
      'sig-pack': { name: 'pack', children: ['sig-x'] },
      'sig-x': { name: 'x' },
    })
    expect(await countTilesBeneath(history, { cells: ['sig-pack'] } as never, ['pack'])).toBe(1)
  })

  it('counts a leaf as zero — which is what lets the dialog be skipped', async () => {
    // The behaviour every caller must respect: a leaf removal raises nothing.
    // Anything that tells a participant or a model otherwise is wrong.
    const history = historyOf({ 'sig-leaf': { name: 'leaf' } })
    expect(await countTilesBeneath(history, { children: ['sig-leaf'] }, ['leaf'])).toBe(0)
  })

  it('counts nothing for a name the parent does not hold, and nothing with no parent', async () => {
    const history = historyOf({ 'sig-leaf': { name: 'leaf', children: ['sig-x'] }, 'sig-x': { name: 'x' } })
    expect(await countTilesBeneath(history, { children: ['sig-leaf'] }, ['absent'])).toBe(0)
    expect(await countTilesBeneath(history, null, ['leaf'])).toBe(0)
  })
})

describe('the delete question', () => {
  const tree = historyOf({
    'sig-drafts': { name: 'drafts', children: ['sig-a'] },
    'sig-a': { name: 'a' },
  })
  const parent = { children: ['sig-drafts'] }

  /** Answer every question asked until the returned stop is called. */
  const answering = (answer: { confirmed: boolean; optedOut?: boolean }) => {
    const asked: Record<string, unknown>[] = []
    const off = EffectBus.on<{ id: string }>('confirm:request', req => {
      asked.push(req as never)
      EffectBus.emit('confirm:response', { id: req.id, ...answer })
    })
    asked.length = 0 // the bus replays the last request to a new listener
    return { asked, stop: off }
  }

  afterEach(() => unmute('remove'))

  it('says where the tiles come back, and offers a box to stop being asked', async () => {
    const q = answering({ confirmed: true })
    expect(await confirmRemoval(tree, parent, ['drafts'])).toBe(true)
    q.stop()
    expect(q.asked).toHaveLength(1)
    expect(q.asked[0]).toMatchObject({ hint: 'confirm.remove-hint', optOut: 'confirm.dont-remind', danger: true })
    expect(isMuted('remove')).toBe(false)
  })

  it('a cancel never mutes the question, even with the box ticked', async () => {
    const q = answering({ confirmed: false, optedOut: true })
    expect(await confirmRemoval(tree, parent, ['drafts'])).toBe(false)
    q.stop()
    expect(isMuted('remove')).toBe(false)
  })

  it('once asked not to ask, it deletes with a word in the corner instead — and Ask again undoes it', async () => {
    const first = answering({ confirmed: true, optedOut: true })
    expect(await confirmRemoval(tree, parent, ['drafts'])).toBe(true)
    first.stop()
    expect(isMuted('remove')).toBe(true)

    const toasts: { message: string; actions?: { label: string; effect: string }[] }[] = []
    const offToast = EffectBus.on<{ message: string }>('toast:show', t => { toasts.push(t as never) })
    toasts.length = 0
    const second = answering({ confirmed: false })
    expect(await confirmRemoval(tree, parent, ['drafts'])).toBe(true)
    second.stop()
    offToast()
    expect(second.asked).toHaveLength(0)
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.message).toBe('Deleted "drafts" and 1 nested. Nothing is lost.')
    expect(toasts[0]!.actions!.map(a => a.label)).toEqual(['Undo', 'Recents', 'Ask again'])
    expect(toasts[0]!.actions!.find(a => a.label === 'Recents')).toMatchObject({ effect: 'recents:open', payload: { filter: 'drafts' } })

    EffectBus.emit('confirm:unmute', { question: 'remove' })
    expect(isMuted('remove')).toBe(false)
  })

  it('a leaf with nothing beneath it is still not asked about', async () => {
    const q = answering({ confirmed: false })
    expect(await confirmRemoval(historyOf({ 'sig-x': { name: 'x' } }), { children: ['sig-x'] }, ['x'])).toBe(true)
    q.stop()
    expect(q.asked).toHaveLength(0)
  })
})
