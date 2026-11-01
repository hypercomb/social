// assistant/external-call.drone.ts
//
// LINES FROM OUTSIDE, MARKED AND GATED. An agent, a script or another machine
// may ask the hive to say lines (the say door, scripts/hive-say.cjs, sends
// them here as `EXTERNAL_CALL`). Nothing runs on arrival: the request waits in
// a queue, and the one at its head is shown on the command line in its fourth
// stance, `$`, with who sent it (`EXTERNAL_ASK`). The participant answers it
// there (`EXTERNAL_ANSWER`): Enter runs it, Escape declines it.
//
// EITHER WAY IT IS WRITTEN DOWN, in a new conversation on the layer the
// participant stands in: first the request, as who asked and the lines; then,
// on Enter, each line's verdict as it is said, and the conversation opens so
// the run is watched where it happens. A decline is written there too, and
// nothing opens.
//
// WHEN IT RUNS, EVERY LINE GOES THROUGH THE MACHINE DOOR (`REMOTE_SUBMIT`),
// never the participant's own: each word is judged against the participant's
// grants as any machine's is. Pressing Enter lets the batch be said, not say
// more than a machine may. A line the grants do not allow is refused, and the
// refusal is the verdict the caller hears.
//
// The chat stays a conversation: it records and shows the run, it is not the
// gate. See documentation/hive-say.md.

import {
  Drone, EffectBus, EXTERNAL_ANSWER, EXTERNAL_ASK, EXTERNAL_CALL, REMOTE_SUBMIT,
  formatRemoteSubmitOutcome, canonicalVerbOf, I18N_IOC_KEY, type I18nProvider,
  type ExternalAnswer, type ExternalAsk, type ExternalCallOutcome, type ExternalCallRequest,
  type ExternalLineResult, type RemoteSubmitOutcome, type RemoteSubmitRequest,
} from '@hypercomb/core'
import { deliverTurn, newTileConvoId } from './chat-thread.js'

// At most this many waiting at once, and this many lines in one call: a
// caller that floods is told no rather than filling the queue.
const MAX_WAITING = 20
const MAX_LINES = 200
const MAX_LINE = 4000
// A line the command line never settles is unknown, not a hang.
const LINE_DEADLINE_MS = 60_000

type Pending = {
  readonly id: string
  readonly from: string
  readonly lines: readonly string[]
  readonly complete?: (outcome: ExternalCallOutcome) => void
}

const slug = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'agent'

const here = (): string[] => {
  const lineage = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
    ?.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
  return (lineage?.explorerSegments?.() ?? []).map(String).filter(Boolean)
}

/** Say one line through the machine door and wait for its verdict. */
const sayLine = (text: string): Promise<RemoteSubmitOutcome> => new Promise(resolve => {
  let settled = false
  let heard = false
  const settle = (outcome: RemoteSubmitOutcome): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve(outcome)
  }
  const timer = setTimeout(
    () => settle({ kind: 'unknown', reason: 'the command line did not answer in time' }),
    LINE_DEADLINE_MS,
  )
  const request: RemoteSubmitRequest = { text, accept: () => { heard = true }, complete: settle }
  EffectBus.emitTransient(REMOTE_SUBMIT, request)
  if (!heard) settle({ kind: 'unknown', reason: 'no command line is open to say it' })
})

// A line the remote door answers `unknown` was handed to a pipeline that does
// not wait for it, and `go` walks the hive after it answers. Before the next
// line, let the hive arrive: the next line must run where the last one left
// it, or a planting's children all land in the layer it started from.
const GO_DEADLINE_MS = 5_000
const SETTLE_MS = 900

const verbOf = (text: string): string =>
  canonicalVerbOf(text) || (text.trim().split(/\s+/)[0] ?? '').toLowerCase()

/** Resolves when `go` says where it went (it reports every outcome in the
 *  activity log), or at the deadline. Subscribed before the line is said. */
const goReported = (): { done: Promise<void>; stop: () => void } => {
  let live = false
  let stop = (): void => { /* replaced below */ }
  const done = new Promise<void>(resolve => {
    const timer = setTimeout(() => finish(), GO_DEADLINE_MS)
    // The bus replays its last value to a new listener: that is an old line.
    const off = EffectBus.on<{ message?: string }>('activity:log', entry => {
      if (live && String(entry?.message ?? '').startsWith('Go:')) finish()
    })
    live = true
    function finish(): void { clearTimeout(timer); off(); resolve() }
    stop = finish
  })
  return { done, stop }
}

/** The processor's next settled pass, or a short wait if none comes. */
const settled = (): Promise<void> => new Promise(resolve => {
  const finish = (): void => { clearTimeout(timer); window.removeEventListener('synchronize', finish); resolve() }
  const timer = setTimeout(finish, SETTLE_MS)
  window.addEventListener('synchronize', finish)
})

export class ExternalCallDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  public override description =
    'Holds lines sent from outside until you answer them on the command line, then says them through the machine door and writes the run into a conversation.'

  protected override listens: string[] = [EXTERNAL_CALL, EXTERNAL_ANSWER]
  protected override emits: string[] = [EXTERNAL_ASK, REMOTE_SUBMIT, 'chat:open', 'ask:chat-reply', 'toast:show', 'activity:log']

  #bound = false
  #queue: Pending[] = []
  #busy = false
  #count = 0

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => { this.#bind() }

  constructor() {
    super()
    this.#bind()
  }

  /** How many calls wait, the one shown included. */
  get waiting(): number { return this.#queue.length }

  #bind(): void {
    if (this.#bound) return
    this.#bound = true
    EffectBus.on<ExternalCallRequest>(EXTERNAL_CALL, request => { this.#arrive(request) })
    EffectBus.on<ExternalAnswer>(EXTERNAL_ANSWER, answer => { void this.#answer(answer) })
  }

  #arrive(request: ExternalCallRequest | undefined): void {
    const complete = typeof request?.complete === 'function' ? request.complete : undefined
    const refuse = (reason: string): void => { complete?.({ kind: 'refused', reason }) }
    if (!request || !Array.isArray(request.lines)) { refuse('a call needs lines'); return }
    const lines = request.lines.map(line => String(line ?? '').trim()).filter(Boolean)
    if (!lines.length) { refuse('no line to say'); return }
    if (lines.length > MAX_LINES) { refuse(`at most ${MAX_LINES} lines in one call`); return }
    if (lines.some(line => line.length > MAX_LINE)) { refuse(`a line may be at most ${MAX_LINE} characters`); return }
    if (this.#queue.length >= MAX_WAITING) { refuse('too many calls are already waiting'); return }
    const from = String(request.from ?? '').replace(/\s+/g, ' ').replace(/^[\s/]+/, '').trim().slice(0, 80) || 'an agent'
    this.#queue.push({ id: `x${Date.now().toString(36)}-${(++this.#count).toString(36)}`, from, lines, complete })
    try { request.accept?.() } catch { /* a caller's own failure is not ours */ }
    // Told, not only shown: a window may be covering the command line.
    const i18n = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<I18nProvider>(I18N_IOC_KEY)
    const message = i18n?.t('external-call.arrived', { from, count: lines.length })
      ?? `${from} asks to say ${lines.length} line${lines.length === 1 ? '' : 's'}. Answer on the command line: Enter runs, Esc declines.`
    EffectBus.emit('activity:log', { message, icon: '$' })
    EffectBus.emit('toast:show', { type: 'info', title: '$', message, duration: 10000 })
    if (!this.#busy) this.#show()
  }

  /** Put the call at the head of the queue in front of the participant, or
   *  clear the ask when nothing waits. */
  #show(): void {
    const head = this.#queue[0]
    const ask: ExternalAsk | null = head
      ? { id: head.id, from: head.from, lines: head.lines, waiting: this.#queue.length - 1 }
      : null
    // Replayed on purpose: a command line that mounts late still shows it.
    EffectBus.emit(EXTERNAL_ASK, ask)
  }

  async #answer(answer: ExternalAnswer | undefined): Promise<void> {
    const head = this.#queue[0]
    if (this.#busy || !head || answer?.id !== head.id) return
    if (answer.decision !== 'run' && answer.decision !== 'decline') return
    this.#busy = true
    this.#queue.shift()
    // The ask leaves the command line the moment it is answered: while the
    // run goes on, the participant's own line is theirs again.
    EffectBus.emit(EXTERNAL_ASK, null)
    let outcome: ExternalCallOutcome
    try {
      outcome = answer.decision === 'run' ? await this.#run(head) : await this.#decline(head)
    } catch (error) {
      outcome = { kind: 'refused', reason: String((error as Error)?.message ?? error) }
    }
    try { head.complete?.(outcome) } catch { /* a caller's own failure is not ours */ }
    this.#busy = false
    this.#show()
  }

  async #record(call: Pending): Promise<string> {
    const convoId = newTileConvoId(here(), `external-${slug(call.from)}-${Date.now().toString(36)}`)
    await deliverTurn(convoId, 'user', `from ${call.from}:\n${call.lines.join('\n')}`)
    return convoId
  }

  async #run(call: Pending): Promise<ExternalCallOutcome> {
    const convoId = await this.#record(call)
    EffectBus.emit('chat:open', { convoId })
    const results: ExternalLineResult[] = []
    for (const text of call.lines) {
      const walking = verbOf(text) === 'go' ? goReported() : null
      const outcome = await sayLine(text)
      if (walking) {
        if (outcome.kind === 'refused' || outcome.kind === 'ambiguous') walking.stop()
        await walking.done
        await settled()
      } else if (outcome.kind === 'unknown') {
        await settled()
      }
      const verdict = formatRemoteSubmitOutcome(outcome)
      results.push({ text, verdict })
      await deliverTurn(convoId, 'assistant', `${text}\n→ ${verdict}`)
    }
    // A line may have walked the hive elsewhere, and the chat follows the
    // layer: bring the run's own conversation back in front of the participant.
    EffectBus.emit('chat:open', { convoId })
    return { kind: 'ran', convoId, results }
  }

  async #decline(call: Pending): Promise<ExternalCallOutcome> {
    const convoId = await this.#record(call)
    await deliverTurn(convoId, 'assistant', 'Declined. Nothing ran.')
    return { kind: 'declined', convoId }
  }
}

const _externalCall = new ExternalCallDrone()
window.ioc.register('@diamondcoreprocessor.com/ExternalCallDrone', _externalCall)
