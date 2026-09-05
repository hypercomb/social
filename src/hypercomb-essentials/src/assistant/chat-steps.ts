// assistant/chat-steps.ts
//
// WHAT THE AGENT DID — the half of the loop that was being thrown away.
//
// `chat-thread.ts` settled the rule for replies: WRITE THE RECORD, THEN
// ANNOUNCE IT. Never the announcement as delivery. The STEPS between the
// replies never got the same treatment, and `agent-progress` says so in its
// own comment — "writes no layer, no note and no record — it moves a UI
// needle and nothing else". That is delivery-by-event, the exact pattern
// chat-thread exists to kill, still alive for the half of the loop that does
// the work.
//
// The cost is not cosmetic. A responder killed mid-run cannot know which of
// its steps landed, so picking the work back up means redoing it or guessing.
// A reload empties the trail. The orchestrator's `silent` and `rogue`
// findings are inferences about memory that no longer exists. The hive can
// say what an agent last CLAIMED it was doing, and never what it DID.
//
// ── This is not a parallel log ──────────────────────────────────────────
//
// Trails are a VIEW over history, never a second record free to disagree
// with it. A step obeys that rule because of a distinction the system had
// not yet needed to draw: history records EFFECTS; this records ATTEMPTS.
//
// A step says "at T, in run R, as step N, I invoked verb V, and it worked or
// it did not". It never says what CHANGED — the layer, the marker and the
// note remain the only place that lives — and it reaches them by POINTER
// (`sigs`, harvested from what the op returned), never by copying them. So
// there is nothing here for history to contradict: the two describe
// different things. An attempt that FAILED leaves no trace in history at
// all, and that absence is precisely what a resuming responder has to read.
//
// ── Where the bytes go ──────────────────────────────────────────────────
//
// A DIRECTORY inside the conversation's own bucket — named by the hash of a
// constant, exactly as the archive and goal markers are — holding one file
// per step named by the hash of its own bytes. A directory rather than more
// files beside the turns, for two reasons that are both about not disturbing
// what already works:
//
//   • EVERY EXISTING READER SKIPS IT. `readBucketRaw` walks a bucket under
//     `if (handle.kind !== 'file') continue`, so a build that predates this
//     file cannot see the ledger, let alone mistake a step for a turn. Data
//     never heals: older versions keep working, untouched, and a hive that
//     downgrades loses the trail rather than the thread.
//   • THE CONVERSATION LIST STAYS CHEAP. That walk reads files until it
//     finds one parseable turn. A busy run's steps sitting beside the turns
//     would put hundreds of files in front of that probe, per thread,
//     forever.
//
// The one reader that DOES have to know is `deleteConversation`, whose whole
// method is to prove every entry is this conversation's own before removing
// anything. It refuses outright on a subdirectory it cannot account for, so
// it is taught the ledger by name and proves its contents the same way it
// proves a turn. Nothing else in the system needs to change.
//
// ── Append-only, settled on read ────────────────────────────────────────
//
// A step file is named by the hash of its own bytes, so writing the
// identical step twice writes ONE file — replaying a step is free, which is
// what makes a resumed run safe to be approximate about where it stopped. A
// RETRY is not identical (its outcome, or its clock, differs) and so lands
// as a second record: the ledger shows the attempt that failed AND the one
// that worked, which is more honest than overwriting, and `settle()` reduces
// by `seq` when a caller wants only the outcome that stands.
//
// Order inside a run is `seq`, assigned by the writer. Never the clock —
// `at` is a label here, not an authority, and the bridge stamps it from the
// browser so a responder's machine clock cannot skew a run at all.

import { EffectBus } from '@hypercomb/core'
import { STEP_LEDGER_NAME, conversationBucket } from './chat-thread.js'

export type StepOutcome = 'ok' | 'failed'

/** One recorded attempt, as it sits on disk. */
export interface ChatStep {
  readonly kind: 'chat-step'
  readonly convoId: string
  /** The agent loop this step belongs to. Chosen by the responder; opaque. */
  readonly runId: string
  /** Position in the run. THE ordering authority — see the header. */
  readonly seq: number
  /** The bridge op invoked. */
  readonly verb: string
  readonly at: number
  readonly outcome: StepOutcome
  /** The request, as a root content resource — never inline. Absent when
   *  the store could not mint resources. */
  readonly contentSig?: string
  /** Signatures the op NAMED in its answer: pointers INTO history, never
   *  copies of it — the edge that makes the trail a view rather than a log.
   *  A REMOVING op names what it removed, so a step for one carries a
   *  signature that no longer resolves. That is honest rather than broken:
   *  the pointer records what the attempt was about, and a reader must treat
   *  every entry as a citation to check, never as a promise of presence. */
  readonly sigs?: readonly string[]
  /** Failure text, as a resource. Absent when the step worked. */
  readonly errorSig?: string
}

/** What a caller hands `appendStep`. The resources are minted here so that
 *  every writer stores the payload the same way. */
export interface StepInput {
  readonly convoId: string
  readonly runId: string
  readonly seq: number
  readonly verb: string
  readonly at: number
  readonly outcome: StepOutcome
  /** Serialized to a resource. Build it with sorted keys if you want two
   *  identical requests to dedup to one resource. */
  readonly request?: unknown
  readonly sigs?: readonly string[]
  readonly error?: string
}

type StoreLike = {
  putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
  getResource?: (sig: string) => Promise<Blob | null>
}

/** A run's requests are the participant's PRIVATE working material — note
 *  bodies, command lines, the layer a step proposed. `content:wrote` is the
 *  publication trigger: HostSync PUTs on that signal once a public host is
 *  configured, with no filter on kind. Minting
 *  these resources loudly would enqueue every recorded request for a host the
 *  participant never chose to show them to. So the ledger writes SILENTLY,
 *  the same way the store's own cache-fill writes do. This is not an
 *  optimisation; removing it is a privacy regression. */
const SILENT = { emit: false } as const

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

const sha256 = async (bytes: ArrayBuffer): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', bytes))

/** The run's ledger directory inside the conversation's bucket. `create`
 *  false everywhere but the write path, so reading a conversation that never
 *  ran an agent mints nothing. */
const ledgerDir = async (
  convoId: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> => {
  const bucket = await conversationBucket(convoId, create)
  if (!bucket) return null
  try {
    return await bucket.getDirectoryHandle(await STEP_LEDGER_NAME(), { create })
  } catch { return null }
}

/**
 * Record one attempt, and return true only once the bytes are on disk.
 *
 * The return value matters for the same reason `appendTurn`'s does: a step
 * that could not be stored is a step a resume will not see, so a caller that
 * cares can say so rather than believing the ledger is complete.
 */
export const appendStep = async (step: StepInput): Promise<boolean> => {
  const convoId = String(step?.convoId ?? '').trim()
  const runId = String(step?.runId ?? '').trim()
  const verb = String(step?.verb ?? '').trim()
  const seq = Number(step?.seq)
  if (!convoId || !runId || !verb || !Number.isInteger(seq) || seq < 0) return false

  const ledger = await ledgerDir(convoId, true)
  if (!ledger) return false

  try {
    const store = get<StoreLike>('@hypercomb.social/Store')
    // The payload is a RESOURCE, the step is a MANIFEST — the same shape the
    // turn takes, for the same reasons: the bytes dedup across every step
    // that sent the same request, and the ledger walk reads small records.
    let contentSig: string | undefined
    if (store?.putResource && step.request !== undefined) {
      contentSig = await store.putResource(
        new Blob([JSON.stringify(step.request)], { type: 'application/json' }), SILENT)
    }
    let errorSig: string | undefined
    const error = String(step.error ?? '')
    if (store?.putResource && error) {
      errorSig = await store.putResource(new Blob([error], { type: 'text/plain' }), SILENT)
    }

    // Explicit key order: the file is named by the hash of these bytes, so
    // the shape has to be deterministic or an identical step would land
    // twice under two names.
    const record: ChatStep = {
      kind: 'chat-step',
      convoId,
      runId,
      seq,
      verb,
      at: Number(step.at) || 0,
      // A ledger whose whole purpose is to be BELIEVED about what landed must
      // never let an unrecognised outcome read as success. 'ok' is the value
      // that has to be asked for; everything else settles to 'failed'.
      outcome: step.outcome === 'ok' ? 'ok' : 'failed',
      ...(contentSig ? { contentSig } : {}),
      ...(step.sigs && step.sigs.length ? { sigs: [...step.sigs] } : {}),
      ...(errorSig ? { errorSig } : {}),
    }
    const bytes = new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer
    const name = await sha256(bytes)

    // REPLAYING A STEP MUST NOT DESTROY IT. `createWritable()` truncates an
    // existing file to zero and only refills it on close, so re-recording an
    // identical step opens a window in which a crash leaves an EMPTY record
    // where a complete one was — and an empty record is unparseable, which
    // (before this check) made the conversation permanently undeletable. The
    // record is content-addressed, so a same-named file of the same length is
    // already byte-for-byte this step: there is nothing to write.
    try {
      const existing = await ledger.getFileHandle(name, { create: false })
      if ((await existing.getFile()).size === bytes.byteLength) return true
    } catch { /* not recorded yet — fall through and write it */ }

    const handle = await ledger.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(new Blob([bytes as BlobPart])) } finally { await writable.close() }

    // Written, THEN announced — the record is the truth, this only makes it
    // feel instant. Nothing may depend on this arriving.
    EffectBus.emit('agent:step', { convoId, runId, seq, verb, outcome: record.outcome })
    return true
  } catch (err) {
    console.warn('[chat-steps] could not store the step:', err)
    return false
  }
}

/** Every recorded attempt for a conversation, ordered by run then `seq`.
 *  `runId` narrows it to one loop — what a resuming responder asks for. */
export const readSteps = async (
  convoId: string,
  runId?: string,
): Promise<ChatStep[]> => {
  const id = String(convoId ?? '').trim()
  if (!id) return []
  const ledger = await ledgerDir(id, false)
  if (!ledger) return []

  const want = String(runId ?? '').trim()
  const out: ChatStep[] = []
  const entries = (ledger as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()
  for await (const [, handle] of entries) {
    if (handle.kind !== 'file') continue
    try {
      const file = await (handle as FileSystemFileHandle).getFile()
      const step = JSON.parse(await file.text()) as ChatStep
      if (step?.kind !== 'chat-step') continue
      // A step names its own conversation, so the ledger describes itself
      // exactly as the bucket does — a stray record cannot pass as ours.
      if (step.convoId !== id) continue
      if (want && step.runId !== want) continue
      if (!Number.isInteger(step.seq)) continue
      out.push(step)
    } catch { /* one unreadable step must not hide the run */ }
  }
  return out.sort((a, b) =>
    a.runId === b.runId ? (a.seq - b.seq || a.at - b.at) : (a.runId < b.runId ? -1 : 1))
}

/**
 * The outcome that STANDS for each `seq`, retries collapsed.
 *
 * A retried step is two records on purpose (see the header), so a caller
 * asking "did step 7 land?" needs the later word, not the first. Later `at`
 * wins; on a tie `ok` wins, because the only way to hold both outcomes at
 * one instant is a retry the clock was too coarse to separate, and the
 * attempt that succeeded is the one that describes the world.
 */
export const settle = (steps: readonly ChatStep[]): ChatStep[] => {
  const best = new Map<string, ChatStep>()
  for (const step of steps) {
    const key = `${step.runId}\u0000${step.seq}`
    const held = best.get(key)
    if (!held
      || step.at > held.at
      || (step.at === held.at && held.outcome === 'failed' && step.outcome === 'ok')) {
      best.set(key, step)
    }
  }
  return [...best.values()].sort((a, b) =>
    a.runId === b.runId ? a.seq - b.seq : (a.runId < b.runId ? -1 : 1))
}

/**
 * THE RUN AN ASK IS ANSWERED BY — derived from the ask sig, and nothing else.
 *
 * Both halves come from ONE input on purpose. An earlier spelling took the
 * conversation from the target tile's path, which reads better and is wrong:
 * the responder learns that path from the command line (whichever target it
 * is answering right now) while a reader — the agent panel — can only infer
 * it from the ask record. Two inputs, free to disagree, and for a
 * multi-target ask they DO: the responder writes into target 3's bucket
 * while the panel reads target 1's and shows an empty ledger. Silently,
 * which is the failure mode this whole feature exists to remove.
 *
 * So the address is the ask. Every party that knows which ask this is —
 * the responder, the panel, a later audit — computes the same bucket
 * without consulting anything else. `agent:` sits outside
 * `isHumanConversation`, so these never appear in a chat list.
 *
 * The cost, stated: one directory per answered ask, which nothing sweeps
 * yet. It holds only the run's own steps, the conversation list skips it
 * without opening a file, and no read path enumerates it — but it does
 * accumulate, and a sweep is owed.
 */
export const runIdForAsk = async (askSig: string): Promise<string> =>
  'ask:' + (await sha256(new TextEncoder().encode(String(askSig ?? '')).buffer as ArrayBuffer)).slice(0, 32)

/** The conversation an ask's run records into. See {@link runIdForAsk}. */
export const runConvoForAsk = (askSig: string): string => 'agent:' + String(askSig ?? '')

/** Every recorded attempt for one ASK, oldest first. What the agent panel
 *  reads to show what a responder actually did, as opposed to what it last
 *  claimed it was doing. */
export const readAskSteps = async (askSig: string): Promise<ChatStep[]> => {
  const sig = String(askSig ?? '').trim()
  if (!sig) return []
  return readSteps(runConvoForAsk(sig), await runIdForAsk(sig))
}

/** Where a run got to: the seq a resuming writer should claim next. Reads
 *  the ledger, so it is correct across a reload — an in-memory counter is
 *  not, and a run that restarts its numbering overwrites its own history. */
export const nextSeq = async (convoId: string, runId: string): Promise<number> => {
  const steps = await readSteps(convoId, runId)
  let max = -1
  for (const step of steps) if (step.seq > max) max = step.seq
  return max + 1
}

/** The request a step recorded, materialized. Kept separate from `readSteps`
 *  so listing a run costs the manifests only — the payloads are fetched by
 *  the caller that actually wants to read them. */
export const stepRequest = async (step: ChatStep): Promise<unknown> => {
  if (!step?.contentSig) return undefined
  const store = get<StoreLike>('@hypercomb.social/Store')
  try {
    const blob = await store?.getResource?.(step.contentSig)
    if (!blob) return undefined
    return JSON.parse(await blob.text())
  } catch { return undefined }
}
