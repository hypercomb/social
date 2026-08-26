// ui/chat-window/host-stream.spec.ts
//
// A QUESTION IS DURABLE UNTIL IT IS ANSWERED — mechanical proof.
//
// The failure this freezes: a streamed answer used to live and die with the
// component that asked for it. Destroy the window mid-stream — fold the panel,
// swap the surface, leave the route — and the fetch was aborted and the words
// already on screen were dropped, unstored. The person had asked, the host had
// answered, and nothing was kept.
//
// What these tests freeze:
//   1. the turn is stored by the RUN — nobody has to be awaiting or watching
//   2. a component destroy is not a stop: the run carries on and still files
//   3. stopping KEEPS the partial (the host really did say those words)
//   4. the partial is CHECKPOINTED while it streams, and cleared only once the
//      turn really landed — a threads pool that refused the write leaves the
//      checkpoint on disk for the next boot
//   5. a re-attaching window finds the text exactly as far along as it is

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { liveHostRun, isHostRunLive, liveHostConvos, startHostRun, stopHostRun } from './host-stream'

/** A host whose answer arrives one chunk at a time, on demand. */
const scriptedHost = (chunks: string[], opts: { hang?: boolean } = {}) => {
  let released: (() => void) | null = null
  const gate = (): Promise<void> => new Promise<void>(resolve => { released = resolve })
  let waiting: Promise<void> | null = null
  return {
    /** Let the next chunk through (only meaningful with `hang`). */
    release(): void { released?.(); released = null },
    ask: async function* (_question: string, options?: { signal?: AbortSignal }) {
      for (const chunk of chunks) {
        if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
        if (opts.hang) { waiting = gate(); await waiting }
        if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
        yield chunk
      }
      return chunks.join('')
    },
  }
}

/** The threads module's half — what a run needs and nothing else. */
const makeStore = (options: { refuse?: boolean } = {}) => {
  const turns: Array<{ convoId: string; role: string; text: string }> = []
  const checkpoints = new Map<string, string>()
  return {
    turns,
    checkpoints,
    appendTurn: async (convoId: string, role: string, text: string) => {
      if (options.refuse) return false
      turns.push({ convoId, role, text })
      return true
    },
    saveStreamCheckpoint: async (convoId: string, text: string) => {
      if (text) checkpoints.set(convoId, text)
      else checkpoints.delete(convoId)
      return true
    },
  }
}

describe('host-stream — the answer outlives the window that asked for it', () => {
  let seen: Array<{ effect: string; payload: unknown }>
  let cleanups: Array<() => void>

  beforeEach(() => {
    seen = []
    cleanups = [
      EffectBus.on('chat:host-chunk', payload => seen.push({ effect: 'chunk', payload })),
      EffectBus.on('chat:host-done', payload => seen.push({ effect: 'done', payload })),
    ]
  })

  const stopListening = (): void => { for (const off of cleanups) off() }

  it('stores the turn without anyone awaiting the run', async () => {
    const store = makeStore()
    const host = scriptedHost(['one ', 'two ', 'three'])

    // NOT AWAITED — this is the window asking and then ceasing to exist.
    void startHostRun('chat:durable-1', 'a question', host, store)
    await vi.waitFor(() => expect(store.turns.length).toBe(1))

    expect(store.turns[0]).toEqual({
      convoId: 'chat:durable-1', role: 'assistant', text: 'one two three',
    })
    expect(isHostRunLive('chat:durable-1')).toBe(false)
    stopListening()
  })

  it('announces the ending on the bus, so a rebuilt window still hears it', async () => {
    const store = makeStore()
    await startHostRun('chat:durable-2', 'q', scriptedHost(['kept']), store)

    // Filtered by conversation, not merely counted: EffectBus replays its last
    // value to a late subscriber, so a fresh listener hears the PREVIOUS test's
    // ending too — which is exactly the property a rebuilt window relies on.
    const done = seen
      .filter(s => s.effect === 'done')
      .filter(s => (s.payload as { convoId?: string })?.convoId === 'chat:durable-2')
    expect(done.length).toBe(1)
    expect(done[0].payload).toMatchObject({
      convoId: 'chat:durable-2', text: 'kept', outcome: 'answered',
    })
    stopListening()
  })

  it('keeps and stores the partial when the participant stops it', async () => {
    const store = makeStore()
    const host = scriptedHost(['half ', 'an ', 'answer'], { hang: true })
    const run = startHostRun('chat:durable-3', 'q', host, store)

    host.release()
    await vi.waitFor(() => expect(liveHostRun('chat:durable-3')?.text).toBe('half '))

    expect(stopHostRun('chat:durable-3')).toBe(true)
    host.release()

    expect(await run).toBe('aborted')
    // STOPPING IS NOT DISCARDING.
    expect(store.turns[0]?.text).toBe('half ')
    stopListening()
  })

  it('checkpoints the partial while it streams and clears it once the turn lands', async () => {
    const store = makeStore()
    const host = scriptedHost(['first ', 'second'], { hang: true })
    const run = startHostRun('chat:durable-4', 'q', host, store)

    host.release()
    await vi.waitFor(() => expect(store.checkpoints.get('chat:durable-4')).toBe('first '))
    expect(liveHostConvos().has('chat:durable-4')).toBe(true)

    host.release()
    await run
    // The turn is the truth; the checkpoint only existed to protect it.
    expect(store.turns[0]?.text).toBe('first second')
    expect(store.checkpoints.has('chat:durable-4')).toBe(false)
    stopListening()
  })

  it('KEEPS the checkpoint when the threads pool refuses the turn', async () => {
    const store = makeStore({ refuse: true })
    await startHostRun('chat:durable-5', 'q', scriptedHost(['unstorable']), store)

    expect(store.turns.length).toBe(0)
    // The words are still somewhere, so the next boot can file them.
    expect(store.checkpoints.get('chat:durable-5')).toBe('unstorable')
    stopListening()
  })

  it('hands a re-attaching window the text so far, and joins rather than doubles', async () => {
    const store = makeStore()
    const host = scriptedHost(['re', 'attach'], { hang: true })
    const first = startHostRun('chat:durable-6', 'q', host, store)

    host.release()
    await vi.waitFor(() => expect(liveHostRun('chat:durable-6')?.text).toBe('re'))

    // A second window arriving on the same conversation gets the SAME run.
    const second = startHostRun('chat:durable-6', 'q', host, store)
    expect(second).toBe(first)

    host.release()
    await first
    expect(store.turns.length).toBe(1)
    expect(store.turns[0]?.text).toBe('reattach')
    stopListening()
  })
})
