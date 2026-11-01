// assistant/external-call.drone.spec.ts
//
// A CALL FROM OUTSIDE RUNS ONLY WHEN THE PARTICIPANT SAYS SO, frozen:
//
//   1. Nothing is said on arrival. The call is shown (EXTERNAL_ASK) and waits.
//   2. Enter (`run`) records the request in a new conversation on the current
//      layer, opens it, says each line through the machine door, and records
//      each verdict there. The caller hears the same verdicts.
//   3. Escape (`decline`) says nothing, records the decline, opens nothing.
//   4. An answer for a call that is not the one shown does nothing.
//   5. A call is refused, not queued, when it has no lines.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => key === '@hypercomb.social/Lineage'
      ? { explorerSegments: () => ['presentation'] }
      : undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

const turns = vi.hoisted(() => [] as Array<{ convoId: string; role: string; text: string }>)
vi.mock('./chat-thread.js', () => ({
  newTileConvoId: (segments: readonly string[], seed?: string) => `chat:tile:/${segments.join('/')}::${seed}`,
  deliverTurn: async (convoId: string, role: string, text: string) => { turns.push({ convoId, role, text }); return true },
}))

import {
  EffectBus, EXTERNAL_ANSWER, EXTERNAL_ASK, EXTERNAL_CALL, REMOTE_SUBMIT,
  type ExternalAsk, type ExternalCallOutcome, type RemoteSubmitRequest,
} from '@hypercomb/core'
import './external-call.drone.js'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

let said: string[] = []
let opened: string[] = []
let shown: (ExternalAsk | null)[] = []

beforeEach(() => {
  turns.length = 0
  said = []
  opened = []
  shown = []
})

EffectBus.on<RemoteSubmitRequest>(REMOTE_SUBMIT, ({ text, accept, complete }) => {
  said.push(text)
  accept?.()
  complete?.(text.startsWith('go ')
    ? { kind: 'unknown', reason: 'the legacy pipeline' }
    : text.includes('remove')
    ? { kind: 'refused', reason: 'a person must say this' }
    : { kind: 'ran', actions: [{ command: text.slice(1).split(' ')[0], args: '', ok: true }] })
})
EffectBus.on<{ convoId?: string }>('chat:open', payload => { if (payload?.convoId) opened.push(payload.convoId) })
EffectBus.on<ExternalAsk | null>(EXTERNAL_ASK, ask => { shown.push(ask) })

const call = (from: string, lines: string[]) => {
  let outcome: ExternalCallOutcome | undefined
  let taken = false
  EffectBus.emitTransient(EXTERNAL_CALL, {
    from, lines,
    accept: () => { taken = true },
    complete: (o: ExternalCallOutcome) => { outcome = o },
  })
  return { taken: () => taken, outcome: () => outcome }
}

const lastAsk = (): ExternalAsk | null => shown[shown.length - 1] ?? null

describe('external calls', () => {
  it('waits for the participant, then runs through the machine door and records the run', async () => {
    const c = call('claude-code', ['/create word', '/remove word'])
    expect(c.taken()).toBe(true)
    expect(said).toEqual([])
    const ask = lastAsk()
    expect(ask).toMatchObject({ from: 'claude-code', lines: ['/create word', '/remove word'], waiting: 0 })

    EffectBus.emitTransient(EXTERNAL_ANSWER, { id: ask!.id, decision: 'run' })
    await flush(); await flush()

    expect(said).toEqual(['/create word', '/remove word'])
    const outcome = c.outcome()
    expect(outcome?.kind).toBe('ran')
    if (outcome?.kind !== 'ran') return
    expect(outcome.convoId.startsWith('chat:tile:/presentation::external-claude-code-')).toBe(true)
    expect(outcome.results).toEqual([
      { text: '/create word', verdict: 'ran /create' },
      { text: '/remove word', verdict: 'refused: a person must say this' },
    ])
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(turns[0].text).toBe('from claude-code:\n/create word\n/remove word')
    expect(turns[2].text).toBe('/remove word\n→ refused: a person must say this')
    expect(opened).toContain(outcome.convoId)
    expect(lastAsk()).toBeNull()
  })

  it('declines without saying anything or opening the chat', async () => {
    const c = call('an agent', ['/create other'])
    EffectBus.emitTransient(EXTERNAL_ANSWER, { id: lastAsk()!.id, decision: 'decline' })
    await flush(); await flush()

    expect(said).toEqual([])
    expect(opened).toEqual([])
    expect(c.outcome()?.kind).toBe('declined')
    expect(turns.map(t => t.text)).toEqual(['from an agent:\n/create other', 'Declined. Nothing ran.'])
  })

  it('shows the next call when one is answered, and ignores an answer for another', async () => {
    const first = call('one', ['/a'])
    const second = call('two', ['/b'])
    const head = lastAsk()!
    expect(head).toMatchObject({ from: 'one', waiting: 1 })

    EffectBus.emitTransient(EXTERNAL_ANSWER, { id: 'not-this-one', decision: 'run' })
    await flush()
    expect(first.outcome()).toBeUndefined()

    EffectBus.emitTransient(EXTERNAL_ANSWER, { id: head.id, decision: 'decline' })
    await flush(); await flush()
    expect(first.outcome()?.kind).toBe('declined')
    expect(lastAsk()).toMatchObject({ from: 'two', waiting: 0 })

    EffectBus.emitTransient(EXTERNAL_ANSWER, { id: lastAsk()!.id, decision: 'decline' })
    await flush(); await flush()
    expect(second.outcome()?.kind).toBe('declined')
    expect(lastAsk()).toBeNull()
  })

  it('lets a go arrive before the next line is said', async () => {
    const c = call('walker', ['go deeper', '/create inside'])
    EffectBus.emitTransient(EXTERNAL_ANSWER, { id: lastAsk()!.id, decision: 'run' })
    await flush(); await flush()
    expect(said).toEqual(['go deeper'])

    EffectBus.emit('activity:log', { message: 'Go: now at /presentation/deeper' })
    await flush()
    window.dispatchEvent(new Event('synchronize'))
    await flush(); await flush()
    expect(said).toEqual(['go deeper', '/create inside'])
    expect(c.outcome()?.kind).toBe('ran')
  })

  it('refuses a call with no lines', () => {
    const c = call('empty', ['  '])
    expect(c.taken()).toBe(false)
    expect(c.outcome()).toEqual({ kind: 'refused', reason: 'no line to say' })
  })
})
