// ui/chat-window/host-stream.ts
//
// THE ANSWER OUTLIVES THE WINDOW THAT ASKED FOR IT.
//
// The shallow tier streams over HTTP: chunk after chunk, and only the last one
// makes it a turn. That loop used to run inside the chat window component, so
// its lifetime was the component's lifetime — and everything that ends a
// component ended the answer with it. Fold the panel away, let the shell swap
// the surface, navigate: `ngOnDestroy` aborted the fetch and the words already
// on screen were dropped without ever being stored. The person had asked, the
// host had answered, and nothing was kept.
//
// So the run lives HERE, at module scope, keyed by conversation:
//
//   * a component destroy is not a stop — only `stopHostRun` is
//   * the turn is STORED BY THE RUN, whether or not anyone is watching
//   * a component arriving mid-stream RE-ATTACHES: `liveHostRun` hands it the
//     text so far, and the same effects keep painting it
//   * the accumulating text is CHECKPOINTED to the threads pool, so even the
//     one interruption a module cannot survive — the page itself going away —
//     leaves the words on disk for the next boot to file (chat-thread.ts,
//     `recoverStreamCheckpoints`)
//
// What it does NOT do is decide anything: which tier answers, what the question
// says, what happens after — all of that stays in the window. This module owns
// exactly one thing, the part that must not be interruptible.

import { EffectBus } from '@hypercomb/core'

/** Three outcomes, because two cannot route the caller correctly:
 *
 *    'answered'  the host said something and it is stored
 *    'declined'  the host cannot answer — the caller may try another tier
 *    'aborted'   the PARTICIPANT stopped it — never re-queue a recalled ask
 */
export type HostOutcome = 'answered' | 'declined' | 'aborted'

export type HostAsk = (
  question: string,
  opts?: { contextSigs?: readonly string[]; signal?: AbortSignal },
) => AsyncGenerator<string, string, void>

/** The half of the threads module a run needs: somewhere to put the finished
 *  turn, and somewhere to checkpoint the unfinished one. Passed in rather than
 *  imported — shared UI may never import a module. */
export interface HostRunStore {
  appendTurn?: (convoId: string, role: string, text: string) => Promise<boolean>
  saveStreamCheckpoint?: (convoId: string, text: string) => Promise<boolean>
}

interface HostRun {
  readonly convoId: string
  readonly controller: AbortController
  /** Assigned the moment the loop below starts — one tick after the record is
   *  in the map, which is what lets a second caller join the first's run. */
  promise: Promise<HostOutcome>
  text: string
}

/** Every answer still arriving, keyed by conversation. One per conversation:
 *  the window will not let a second question out while the first is pending,
 *  and this is the other half of that promise. */
const runs = new Map<string, HostRun>()

/** How often the partial is written down while it streams. Frequent enough
 *  that a reload loses a sentence rather than a page, rare enough that a fast
 *  stream is not one pool write per chunk. */
const CHECKPOINT_MS = 1_200

/** What a turn that never finished says, filed at the next boot in place of
 *  the answer it was becoming. A TURN IS CHECKPOINTED FROM ITS FIRST MOMENT
 *  (2026-10-15): checkpointed only once words arrived, a page that went away
 *  during the reads — before the first word — left nothing to file, and the
 *  conversation said "waiting for reply…" for good (28 of them, two days). */
export const STOPPED_BEFORE_ANSWER = 'This turn stopped before an answer came back — the page reloaded or closed while it was running. Send it again, or say "Continue."'
/** Said under the words a turn had written when the page went away. */
export const STOPPED_PART_WAY = '\n\n(The answer stopped here — the page reloaded or closed while it was running. Say "Continue." to carry it on.)'

/** The text an in-flight answer has produced so far, or null when the
 *  conversation has nothing streaming. What a re-attaching window paints. */
export const liveHostRun = (convoId: string): { text: string } | null => {
  const run = runs.get(convoId)
  return run ? { text: run.text } : null
}

/** Is this conversation's answer still arriving? */
export const isHostRunLive = (convoId: string): boolean => runs.has(convoId)

/** Conversations whose answer is streaming right now — the guard a boot-time
 *  checkpoint recovery passes so it cannot file an answer still being said. */
export const liveHostConvos = (): Set<string> => new Set(runs.keys())

/** Call the answer back. The partial is KEPT: the host really did say those
 *  words, and throwing them away punishes the person for stopping a stream
 *  they had already read half of. */
export const stopHostRun = (convoId: string): boolean => {
  const run = runs.get(convoId)
  if (!run) return false
  run.controller.abort()
  return true
}

/**
 * Stream one answer from the host, storing it whatever happens to the caller.
 *
 * Announces itself on two effects, both keyed by `convoId` so a window showing
 * another thread can ignore them:
 *
 *   `chat:host-chunk`  { convoId, text }              the partial, so far
 *   `chat:host-done`   { convoId, text, outcome }     stored, or declined
 *
 * The returned promise is a convenience for the caller that started it — it
 * resolves with the outcome so `send()` can fall through to the durable bridge
 * queue on 'declined'. Nothing depends on anyone awaiting it.
 */
export const startHostRun = (
  convoId: string,
  question: string,
  host: { ask?: HostAsk },
  store: HostRunStore,
  options: { contextSigs?: readonly string[] } = {},
): Promise<HostOutcome> => {
  const existing = runs.get(convoId)
  if (existing) return existing.promise
  if (!host?.ask) return Promise.resolve<HostOutcome>('declined')

  const controller = new AbortController()
  const run: HostRun = { convoId, controller, text: '', promise: Promise.resolve<HostOutcome>('declined') }
  runs.set(convoId, run)

  const promise = (async (): Promise<HostOutcome> => {
    let checkpointedAt = 0
    let aborted = false
    // Checkpoints are written one after another, and none once the run has
    // settled: a late write landing after the final clear would file the
    // answer a second time at the next boot.
    let settled = false
    let writing = Promise.resolve()

    const write = (): Promise<void> => {
      writing = writing.then(async () => {
        if (settled) return
        const text = run.text.trim() ? run.text + STOPPED_PART_WAY : STOPPED_BEFORE_ANSWER
        try { await store.saveStreamCheckpoint?.(convoId, text) } catch { /* the turn is still the truth */ }
      })
      return writing
    }
    // The first words are written at once; after them, once a beat.
    const checkpoint = (): Promise<void> => {
      if (!store.saveStreamCheckpoint) return writing
      const now = Date.now()
      if (now - checkpointedAt < CHECKPOINT_MS) return writing
      checkpointedAt = now
      return write()
    }
    /** The run is over: no checkpoint after this one. Empty text forgets. */
    const settle = async (text: string): Promise<void> => {
      settled = true
      await writing
      try { await store.saveStreamCheckpoint?.(convoId, text) } catch { /* next boot */ }
    }
    if (store.saveStreamCheckpoint) void write()

    try {
      const ask = host.ask as HostAsk
      const opts = {
        signal: controller.signal,
        ...(options.contextSigs?.length ? { contextSigs: options.contextSigs } : {}),
      }
      for await (const chunk of ask(question, opts)) {
        run.text += chunk
        EffectBus.emit('chat:host-chunk', { convoId, text: run.text })
        void checkpoint()
      }
    } catch {
      // No signer, no AI on that host, no network — or the participant pressed
      // Stop, which arrives here as the fetch's own abort.
      aborted = controller.signal.aborted
      if (!aborted && !run.text) {
        // Declined, not stopped: another tier takes the question, so the
        // first-moment checkpoint must not file "stopped" over it.
        await settle('')
        runs.delete(convoId)
        EffectBus.emit('chat:host-done', { convoId, text: '', outcome: 'declined' })
        return 'declined'
      }
    }

    const full = run.text
    const outcome: HostOutcome = aborted ? 'aborted' : full.trim() ? 'answered' : 'declined'

    // STORED BEFORE ANNOUNCED, and stored even when nobody is listening. This
    // is the whole point of the module: the turn does not depend on a window
    // being alive to write it.
    let stored = false
    if (full.trim()) {
      try { stored = !!(await store.appendTurn?.(convoId, 'assistant', full)) }
      catch { /* the checkpoint is what is left to try */ }
    }

    // The checkpoint is cleared LAST and ONLY for a turn that really landed.
    // An answer the threads pool refused stays on disk as a checkpoint, so the
    // next boot files it rather than the words being lost twice over.
    // A run that said nothing — declined, or stopped by the participant —
    // forgets its first-moment checkpoint too.
    await settle(stored || !full.trim() ? '' : full)
    runs.delete(convoId)
    EffectBus.emit('chat:host-done', { convoId, text: full, outcome })
    return outcome
  })()

  run.promise = promise
  return promise
}
