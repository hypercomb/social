// assistant/execution-queue.ts
//
// THE EXECUTION WINDOW'S STATE (documentation/hive-read-fence.md §3). Every
// read or change a model asks for in a conversation lands here first, and
// runs only when the participant's policy or the participant's hand says so:
//
//   manual      everything waits for Run or Skip
//   auto        the kinds the participant ticked run on arrival; the rest wait
//   everything  all of it runs on arrival
//
// ONE EXCEPTION NO POLICY LIFTS: a READ from a provider the participant has
// not let read the hive (llm-hive-access.ts) always waits, and offers
// "Always" — which is that same grant, given from where the question arose.
// Reads leave the machine. The policy is about how much to watch; the grant
// is about what may leave; only the grant answers a privacy question.
//
// Requests live for the session — the conversation's turns are the record.
// The policy is device-local and sticky, like the grant it sits beside.

import { publishService } from './llm-provider-registry.js'
import { llmHiveAccess } from './llm-hive-access.js'

export const EXECUTION_QUEUE_IOC_KEY = '@hypercomb.social/ExecutionQueue'

/** A read, or a change by how far it reaches (core `MachineReach`). */
export type ExecutionKind = 'read' | 'additive' | 'editing' | 'destructive'
export const EXECUTION_KINDS: readonly ExecutionKind[] = Object.freeze(['read', 'additive', 'editing', 'destructive'])

export type ExecutionMode = 'manual' | 'auto' | 'everything'
export const EXECUTION_MODES: readonly ExecutionMode[] = Object.freeze(['manual', 'auto', 'everything'])

export type ExecutionState = 'waiting' | 'running' | 'ran' | 'skipped' | 'failed'
export type ExecutionDecision = 'run' | 'skip'

export type ExecutionRequest = {
  readonly id: string
  readonly convoId: string
  readonly providerId: string
  readonly model: string
  readonly kind: ExecutionKind
  /** Canonical grammar, exactly what will run. */
  readonly lines: readonly string[]
  /** A read from a provider not granted the hive. Never runs by policy. */
  readonly needsGrant: boolean
  readonly at: number
  readonly state: ExecutionState
  /** Ran on arrival because of the policy, not a press. */
  readonly auto: boolean
  readonly outcome?: string
}

export type ExecutionAsk = {
  readonly convoId: string
  readonly providerId: string
  readonly model: string
  readonly kind: ExecutionKind
  readonly lines: readonly string[]
  readonly needsGrant: boolean
  /** Stopping the conversation skips whatever of it is still waiting. */
  readonly signal?: AbortSignal
}

const MODE_KEY = 'hc:execution:mode'
const AUTO_KEY = 'hc:execution:auto'
/** Today's behaviour, kept: a granted provider reads freely, changes wait. */
const DEFAULT_MODE: ExecutionMode = 'auto'
const DEFAULT_AUTO: readonly ExecutionKind[] = ['read']
/** Settled rows kept for the window; waiting rows are never dropped. */
const KEEP_SETTLED = 40
const OUTCOME_MAX = 240

export class ExecutionQueueStore extends EventTarget {
  #mode: ExecutionMode = DEFAULT_MODE
  #auto = new Set<ExecutionKind>(DEFAULT_AUTO)
  #requests: readonly ExecutionRequest[] = []
  readonly #waiters = new Map<string, (decision: ExecutionDecision) => void>()
  #seq = 0

  constructor() {
    super()
    try {
      const mode = globalThis.localStorage?.getItem(MODE_KEY)
      if (EXECUTION_MODES.includes(mode as ExecutionMode)) this.#mode = mode as ExecutionMode
      const auto = globalThis.localStorage?.getItem(AUTO_KEY)
      if (typeof auto === 'string') {
        const kinds: unknown = JSON.parse(auto)
        if (Array.isArray(kinds)) {
          this.#auto = new Set(kinds.filter((kind): kind is ExecutionKind => EXECUTION_KINDS.includes(kind)))
        }
      }
    } catch { /* defaults */ }
  }

  mode(): ExecutionMode { return this.#mode }

  setMode(mode: ExecutionMode): void {
    if (!EXECUTION_MODES.includes(mode) || mode === this.#mode) return
    this.#mode = mode
    try { globalThis.localStorage?.setItem(MODE_KEY, mode) } catch { /* session-only */ }
    this.#changed()
    this.#releaseCovered()
  }

  autoKinds(): readonly ExecutionKind[] { return EXECUTION_KINDS.filter(kind => this.#auto.has(kind)) }

  setAuto(kind: ExecutionKind, on: boolean): void {
    if (!EXECUTION_KINDS.includes(kind) || this.#auto.has(kind) === on) return
    if (on) this.#auto.add(kind)
    else this.#auto.delete(kind)
    try { globalThis.localStorage?.setItem(AUTO_KEY, JSON.stringify(this.autoKinds())) } catch { /* session-only */ }
    this.#changed()
    this.#releaseCovered()
  }

  /** Newest first. */
  requests(): readonly ExecutionRequest[] { return this.#requests }

  /** Would a request of this kind run the moment it arrives? */
  runsByPolicy(kind: ExecutionKind, needsGrant: boolean): boolean {
    if (needsGrant) return false
    if (this.#mode === 'everything') return true
    return this.#mode === 'auto' && this.#auto.has(kind)
  }

  /** Enter a request. `decision` settles at once when the policy covers it. */
  request(ask: ExecutionAsk): { readonly id: string; readonly decision: Promise<ExecutionDecision> } {
    const id = `x${Date.now().toString(36)}${(this.#seq++).toString(36)}`
    const auto = this.runsByPolicy(ask.kind, ask.needsGrant)
    const entry: ExecutionRequest = {
      id,
      convoId: String(ask.convoId ?? ''),
      providerId: String(ask.providerId ?? ''),
      model: String(ask.model ?? ''),
      kind: ask.kind,
      lines: [...ask.lines],
      needsGrant: ask.needsGrant,
      at: Date.now(),
      state: auto ? 'running' : 'waiting',
      auto,
    }
    this.#requests = this.#trim([entry, ...this.#requests])
    this.#changed()
    if (auto) return { id, decision: Promise.resolve('run') }
    const decision = new Promise<ExecutionDecision>(resolve => { this.#waiters.set(id, resolve) })
    const signal = ask.signal
    if (signal) {
      if (signal.aborted) this.decide(id, 'skip')
      else signal.addEventListener('abort', () => this.decide(id, 'skip'), { once: true })
    }
    return { id, decision }
  }

  /** The participant's hand. `always` is the hive grant for that provider. */
  decide(id: string, decision: 'run' | 'skip' | 'always'): void {
    const entry = this.#requests.find(request => request.id === id)
    const resolve = this.#waiters.get(id)
    if (!entry || !resolve || entry.state !== 'waiting') return
    this.#waiters.delete(id)
    this.#update(id, { state: decision === 'skip' ? 'skipped' : 'running' })
    resolve(decision === 'skip' ? 'skip' : 'run')
    if (decision === 'always' && entry.kind === 'read' && entry.providerId) {
      llmHiveAccess.setMayRead(entry.providerId, true)
      // The same question, already asked again by the same provider, is
      // answered by the same grant.
      for (const other of this.#requests) {
        if (other.state === 'waiting' && other.kind === 'read' && other.providerId === entry.providerId) {
          this.decide(other.id, 'run')
        }
      }
    }
  }

  /** How it went, once it has run (or been skipped by the caller). */
  settle(id: string, state: 'ran' | 'skipped' | 'failed', outcome?: string): void {
    const entry = this.#requests.find(request => request.id === id)
    if (!entry || entry.state === 'waiting') return
    const text = String(outcome ?? '').trim()
    this.#update(id, { state, ...(text ? { outcome: text.slice(0, OUTCOME_MAX) } : {}) })
  }

  /** A looser policy releases what it now covers. */
  #releaseCovered(): void {
    for (const entry of this.#requests) {
      if (entry.state === 'waiting' && this.runsByPolicy(entry.kind, entry.needsGrant)) this.decide(entry.id, 'run')
    }
  }

  #trim(list: readonly ExecutionRequest[]): readonly ExecutionRequest[] {
    let settled = 0
    return list.filter(entry => entry.state === 'waiting' || entry.state === 'running' || settled++ < KEEP_SETTLED)
  }

  #update(id: string, patch: Partial<ExecutionRequest>): void {
    this.#requests = this.#requests.map(entry => (entry.id === id ? { ...entry, ...patch } : entry))
    this.#changed()
  }

  #changed(): void {
    this.dispatchEvent(new CustomEvent('change'))
  }
}

export const executionQueue = new ExecutionQueueStore()

// Both lines: the first is what `prepare` looks for to load this module at
// all; the second survives the early `window.ioc` map being replaced.
window.ioc?.register(EXECUTION_QUEUE_IOC_KEY, executionQueue)
publishService(EXECUTION_QUEUE_IOC_KEY, executionQueue)
