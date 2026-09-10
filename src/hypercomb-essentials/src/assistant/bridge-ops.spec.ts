// assistant/bridge-ops.spec.ts
//
// THE VERB SETS ARE PINNED. Two decisions read from them that must never
// change by accident: which ops hold the participant's surface behind a
// quiet badge (the worker), and which recorded steps a conversation's route
// draws as work (chat-route.ts). A repaint decision that quietly added or
// dropped a verb would change what the route SHOWS — a piece appearing or
// vanishing on old conversations with nothing in the ledger having changed.
// So the contents are spelled out here, and a change to the leaf has to be
// a change to this file too.

import { describe, expect, it } from 'vitest'
import { MUTATING_OPS, ROUTE_HIDDEN_OPS, STEP_SILENT_OPS, isRouteWork } from './bridge-ops.js'

describe('the bridge verb sets', () => {
  it('pins the mutating set — the quiet-landing writers', () => {
    expect([...MUTATING_OPS].sort()).toEqual([
      'add', 'bag-add', 'bag-remove', 'bag-set', 'build-record',
      'chat-goal-reached', 'chat-reply', 'decoration-add',
      'note-add', 'note-delete', 'note-split',
      'optimization-add', 'optimization-remove', 'put-resource',
      'remove', 'stamp', 'submit', 'summary-add', 'update',
    ])
  })

  it('pins the step-silent set — rejoining the loop is not a move in it', () => {
    expect([...STEP_SILENT_OPS].sort()).toEqual(['agent-progress', 'thread-read'])
  })

  it('pins the route-hidden set — the reply, the receipt and every retire', () => {
    expect([...ROUTE_HIDDEN_OPS].sort()).toEqual([
      'chat-goal-reached', 'chat-reply', 'optimization-remove',
    ])
  })

  it('hides only verbs that are mutating — a hidden read would be a contradiction', () => {
    for (const verb of ROUTE_HIDDEN_OPS) expect(MUTATING_OPS.has(verb), verb).toBe(true)
  })

  it('keeps the silent set and the mutating set apart', () => {
    for (const verb of STEP_SILENT_OPS) expect(MUTATING_OPS.has(verb), verb).toBe(false)
  })

  it('draws exactly the mutating verbs that are not hidden', () => {
    expect(isRouteWork('note-add')).toBe(true)
    expect(isRouteWork('update')).toBe(true)
    expect(isRouteWork('put-resource')).toBe(true)
    // Bookkeeping, not work.
    expect(isRouteWork('chat-reply')).toBe(false)
    expect(isRouteWork('chat-goal-reached')).toBe(false)
    expect(isRouteWork('optimization-remove')).toBe(false)
    // Reads are recorded and never drawn.
    expect(isRouteWork('get-resource')).toBe(false)
    expect(isRouteWork('layer-at')).toBe(false)
    expect(isRouteWork('thread-read')).toBe(false)
    // A UI intent is not hive work, and is deliberately in neither set.
    expect(MUTATING_OPS.has('effect-emit')).toBe(false)
    expect(isRouteWork('effect-emit')).toBe(false)
  })
})
