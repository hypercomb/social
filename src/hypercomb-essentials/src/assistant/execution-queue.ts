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

import { llmProviderRegistry } from './llm-provider-registry.js'
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
  /** A semantic decision needs the participant, even in automatic mode. */
  readonly forceReview?: boolean
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
  /** Ran on arrival because the participant allowed these exact reads before. */
  readonly remembered?: boolean
  readonly outcome?: string
}

export type ExecutionAsk = {
  readonly forceReview?: boolean
  readonly convoId: string
  readonly providerId: string
  readonly model: string
  readonly kind: ExecutionKind
  readonly lines: readonly string[]
  readonly needsGrant: boolean
  /** For a read: what each line RESOLVED to (`read /projects/roadmap`,
   *  `read <sig>`), never the bare relative grammar — "read here" on another
   *  page is a different read. What an allowed read is remembered by. */
  readonly keys?: readonly string[]
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
/** Reads a participant allowed, per provider — device-local and sticky. */
const allowedKey = (providerId: string): string => `hc:execution:allowed:${providerId}`
/** Newest kept; an old allowance that falls off simply asks again. */
const ALLOWED_MAX = 500

export class ExecutionQueueStore extends EventTarget {
  #mode: ExecutionMode = DEFAULT_MODE
  #auto = new Set<ExecutionKind>(DEFAULT_AUTO)
  #requests: readonly ExecutionRequest[] = []
  readonly #waiters = new Map<string, (decision: ExecutionDecision) => void>()
  /** What each waiting read resolved to, so a press can remember it. */
  readonly #keysById = new Map<string, readonly string[]>()
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
    // "UNLESS WE STOP ALLOWING IT." Taking a provider's hive grant away takes
    // every read it was allowed along with it.
    llmHiveAccess.addEventListener('change', event => {
      const detail = (event as CustomEvent<{ providerId?: string; allowed?: boolean }>).detail
      if (!detail?.providerId || detail.allowed !== false) return
      this.forgetAllowed(detail.providerId)
      // …and every model provider that read under that grant.
      for (const provider of llmProviderRegistry().all()) {
        if (provider.credentialsFrom?.toLowerCase() === detail.providerId) this.forgetAllowed(provider.id)
      }
    })
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
    const providerId = String(ask.providerId ?? '')
    const keys = (ask.keys ?? []).map(key => String(key).trim()).filter(Boolean)
    // LOOKED UP ONCE, LOOKED UP AGAIN (Jaime, 2026-09-13): a read the
    // participant already allowed for this provider runs on arrival — every
    // line of it must have been allowed, or the whole read waits.
    const allowed = this.#allowedFor(providerId)
    const remembered = ask.kind === 'read' && ask.needsGrant && keys.length > 0
      && keys.every(key => allowed.has(key))
    const auto = !ask.forceReview && (remembered || this.runsByPolicy(ask.kind, ask.needsGrant))
    const entry: ExecutionRequest = {
      id,
      convoId: String(ask.convoId ?? ''),
      providerId,
      model: String(ask.model ?? ''),
      kind: ask.kind,
      lines: [...ask.lines],
      needsGrant: ask.needsGrant,
      at: Date.now(),
      state: auto ? 'running' : 'waiting',
      auto,
      ...(ask.forceReview ? { forceReview: true } : {}),
      ...(remembered ? { remembered: true } : {}),
    }
    if (keys.length) this.#keysById.set(id, keys)
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
    // Allowed by hand: remember exactly what was allowed.
    if (decision !== 'skip' && entry.kind === 'read' && entry.needsGrant) {
      this.#rememberAllowed(entry.providerId, this.#keysById.get(id) ?? [])
    }
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

  /** The reads this provider was allowed, newest last. */
  allowed(providerId: string): readonly string[] {
    return [...this.#allowedFor(providerId)]
  }

  /** Stop allowing: every remembered read for this provider asks again. */
  forgetAllowed(providerId: string): void {
    const id = String(providerId ?? '').trim()
    if (!id) return
    try { globalThis.localStorage?.removeItem(allowedKey(id)) } catch { /* session-only */ }
    this.#changed()
  }

  #allowedFor(providerId: string): Set<string> {
    const id = String(providerId ?? '').trim()
    if (!id) return new Set()
    try {
      const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(allowedKey(id)) ?? '[]')
      return new Set(Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string') : [])
    } catch { return new Set() }
  }

  #rememberAllowed(providerId: string, keys: readonly string[]): void {
    const id = String(providerId ?? '').trim()
    if (!id || !keys.length) return
    const next = [...this.#allowedFor(id)].filter(key => !keys.includes(key))
    next.push(...keys)
    try { globalThis.localStorage?.setItem(allowedKey(id), JSON.stringify(next.slice(-ALLOWED_MAX))) } catch { /* session-only */ }
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
      if (entry.state === 'waiting' && !entry.forceReview && this.runsByPolicy(entry.kind, entry.needsGrant)) this.decide(entry.id, 'run')
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
