import { describe, it, expect } from 'vitest'
import { EffectBus } from './effect-bus.js'
import {
  REMOTE_SUBMIT,
  formatRemoteSubmitOutcome,
  type RemoteSubmitRequest,
  type RemoteSubmitOutcome,
} from './remote-submit.types.js'

describe('remote-submit outcome wording', () => {
  it('names what ran, and never more', () => {
    expect(formatRemoteSubmitOutcome({
      kind: 'ran',
      actions: [
        { command: 'create', args: 'roadmap', ok: true },
        { command: 'title', args: 'roadmap = Road map', ok: true },
      ],
    })).toBe('ran /create /title')
  })

  it('reports a thrown action instead of hiding it behind the ones that worked', () => {
    const line = formatRemoteSubmitOutcome({
      kind: 'ran',
      actions: [
        { command: 'create', args: 'roadmap', ok: true },
        { command: 'title', args: 'nope', ok: false, error: 'no such tile' },
      ],
    })
    expect(line).toContain('ran /create')
    expect(line).toContain('/title threw: no such tile')
  })

  it('says "ran nothing" rather than "ran" when every action failed', () => {
    expect(formatRemoteSubmitOutcome({
      kind: 'ran',
      actions: [{ command: 'wat', args: '', ok: false, error: 'no behaviour claims that name' }],
    })).toContain('ran nothing')
  })

  it('hands back the claimants so a caller can choose and say it again', () => {
    expect(formatRemoteSubmitOutcome({
      kind: 'ambiguous', word: 'images', candidates: ['images', 'lightbox'],
    })).toBe('"images" is claimed by images, lightbox — nothing ran; say which')
  })

  it('distinguishes refused from unknown — one is a decision, the other is ignorance', () => {
    expect(formatRemoteSubmitOutcome({ kind: 'refused', reason: '/remove needs a person' }))
      .toBe('refused: /remove needs a person')
    expect(formatRemoteSubmitOutcome({ kind: 'unknown', reason: 'legacy pipeline' }))
      .toBe('unknown: legacy pipeline')
  })
})

describe('the transport discipline this contract depends on', () => {
  // THE LANDMINE. `emit` stores a last value that replays to every later
  // subscriber. A request emitted that way would re-run on any re-subscribe —
  // and a RESULT emitted that way would settle the NEXT caller with the
  // PREVIOUS caller's receipt. These tests exist so a refactor from
  // emitTransient to emit fails here instead of in production.
  it('emitTransient does not replay to a later subscriber', () => {
    const seen: string[] = []
    EffectBus.emitTransient<RemoteSubmitRequest>(REMOTE_SUBMIT, { text: 'create alpha' })
    const off = EffectBus.on<RemoteSubmitRequest>(REMOTE_SUBMIT, req => { seen.push(req.text) })
    off()
    expect(seen).toEqual([])
  })

  it('emit DOES replay — which is exactly why this channel must not use it', () => {
    const channel = 'test:replay-proof'
    const seen: string[] = []
    EffectBus.emit<{ text: string }>(channel, { text: 'stale' })
    const off = EffectBus.on<{ text: string }>(channel, req => { seen.push(req.text) })
    off()
    expect(seen).toEqual(['stale'])
  })

  it('a listener is reached synchronously, so accept() is observable right after emit', () => {
    let accepted = false
    const off = EffectBus.on<RemoteSubmitRequest>(REMOTE_SUBMIT, req => req.accept?.())
    EffectBus.emitTransient<RemoteSubmitRequest>(REMOTE_SUBMIT, {
      text: 'create beta', accept: () => { accepted = true },
    })
    off()
    // This is what lets #submit answer "the command line is unavailable"
    // without a timeout: no listener means accept was never called.
    expect(accepted).toBe(true)
  })

  it('with no listener, accept is never called — the unavailable case', () => {
    let accepted = false
    EffectBus.emitTransient<RemoteSubmitRequest>(REMOTE_SUBMIT, {
      text: 'create gamma', accept: () => { accepted = true },
    })
    expect(accepted).toBe(false)
  })

  it('a request carrying no callbacks still reaches a listener — older emitters keep working', () => {
    const seen: string[] = []
    const off = EffectBus.on<RemoteSubmitRequest>(REMOTE_SUBMIT, req => {
      req.accept?.()
      seen.push(req.text)
      req.complete?.({ kind: 'unknown', reason: 'test' })
    })
    expect(() => EffectBus.emitTransient<RemoteSubmitRequest>(REMOTE_SUBMIT, { text: 'no callbacks' }))
      .not.toThrow()
    off()
    expect(seen).toEqual(['no callbacks'])
  })

  it('settles exactly once even when a listener tries to complete twice', () => {
    // The guard lives in the command line, but the shape it must hold is
    // stated here: a caller awaiting a promise only ever sees the first.
    const outcomes: RemoteSubmitOutcome[] = []
    let settled = false
    const settle = (o: RemoteSubmitOutcome): void => { if (settled) return; settled = true; outcomes.push(o) }
    settle({ kind: 'ran', actions: [] })
    settle({ kind: 'unknown', reason: 'second call must be ignored' })
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]!.kind).toBe('ran')
  })
})
