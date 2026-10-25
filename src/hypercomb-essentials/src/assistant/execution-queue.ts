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
// IN THE PARTICIPANT'S OWN DOMAIN A CHANGE RUNS (jwize, 2026-10-02: "you are
// actively in your own domain when you are running it"). Everything here is
// client-side; history takes any of it back, and nothing reaches another
// hive unless a host replicates it and a reader follows. So every kind runs
// on arrival by default — the participant may tick kinds off to watch them.
//
// THREE HOLDS NO POLICY LIFTS, and they are one rule: what leaves the
// machine, or whose words are not the participant's, waits for a hand.
//
//   needsGrant  a READ from a provider the participant has not let read the
//               hive (llm-hive-access.ts). It offers "Always" — that same
//               grant, given from where the question arose. Reads leave the
//               machine; only the grant answers a privacy question.
//   leaves      a CHANGE that leaves the machine — a behaviour declaring
//               `scope: 'network'` (a signed publish, a peer, a host), or one
//               that never said. Approval downstream protects the reader,
//               never the participant's key.
//   foreign     a CHANGE asked for in a conversation that read someone else's words —
//               a tile from a peer's branch, or one carried out of it. The model acts
//               with the participant's authority; the words it acts on were
//               not theirs to give.
//
// A trusted conversation (the chat window's) lifts none of the three either.
//
// Requests live for the session — the conversation's turns are the record.
// The policy is the participant's permission groups (permit-groups.ts): one
// document in a pool. The mode and kinds this window shows are the `everyone`
// group's; a conversation, provider or model put in a group of its own is
// judged by that group instead, and never by more than every group it is in.

import { llmProviderRegistry } from './llm-provider-registry.js'
import { llmHiveAccess } from './llm-hive-access.js'
import { EVERYONE, PermitGroupsStore, permitGroups, type PermitFacts } from './permit-groups.js'

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
  /** A change that leaves the machine. Never runs by policy. */
  readonly leaves?: boolean
  /** A change asked for after the turn read someone else's words. Never
   *  runs by policy. */
  readonly foreign?: boolean
  readonly at: number
  readonly state: ExecutionState
  /** Ran on arrival because of the policy, not a press. */
  readonly auto: boolean
  /** Ran on arrival because the participant allowed these exact reads before. */
  readonly remembered?: boolean
  /** The permission groups that judged it, ` ∩ `-joined; `everyone` when no
   *  group names its conversation, provider or model. */
  readonly group?: string
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
  /** A change carrying a line that leaves the machine (core MachineScope). */
  readonly leaves?: boolean
  /** A change asked for in a turn that read someone else's words. */
  readonly foreign?: boolean
  /** For a read: what each line RESOLVED to (`read /projects/roadmap`,
   *  `read <sig>`), never the bare relative grammar — "read here" on another
   *  page is a different read. What an allowed read is remembered by. */
  readonly keys?: readonly string[]
  /** Stopping the conversation skips whatever of it is still waiting. */
  readonly signal?: AbortSignal
}

/** Settled rows kept for the window; waiting rows are never dropped. */
const KEEP_SETTLED = 40
const OUTCOME_MAX = 240
/** Reads a participant allowed, per provider — device-local and sticky. */
const allowedKey = (providerId: string): string => `hc:execution:allowed:${providerId}`
/** Newest kept; an old allowance that falls off simply asks again. */
const ALLOWED_MAX = 500

const factsOf = (entry: ExecutionRequest | ExecutionAsk): PermitFacts =>
  ({ convoId: entry.convoId, providerId: entry.providerId, model: entry.model })

export class ExecutionQueueStore extends EventTarget {
  readonly #permit: PermitGroupsStore
  #requests: readonly ExecutionRequest[] = []
  readonly #waiters = new Map<string, (decision: ExecutionDecision) => void>()
  /** What each waiting read resolved to, so a press can remember it. */
  readonly #keysById = new Map<string, readonly string[]>()
  #seq = 0

  /** With no groups given, the queue keeps a policy of its own that never
   *  reaches a pool — a spec's. The hive's queue is handed the hive's groups. */
  constructor(permit: PermitGroupsStore = new PermitGroupsStore({ whenStore: () => {} })) {
    super()
    this.#permit = permit
    // A group's policy changed, or the document arrived: show it, and run
    // what it now covers.
    permit.addEventListener('change', () => { this.#changed(); this.#releaseCovered() })
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

  /** The `everyone` group's mode: what runs for whatever no group names. */
  mode(): ExecutionMode { return this.#permit.group(EVERYONE)?.mode ?? 'manual' }

  setMode(mode: ExecutionMode): void {
    if (!EXECUTION_MODES.includes(mode) || mode === this.mode()) return
    this.#permit.setPolicy(EVERYONE, mode)
  }

  autoKinds(): readonly ExecutionKind[] {
    const auto = this.#permit.group(EVERYONE)?.auto ?? []
    return EXECUTION_KINDS.filter(kind => auto.includes(kind))
  }

  setAuto(kind: ExecutionKind, on: boolean): void {
    const auto = this.autoKinds()
    if (!EXECUTION_KINDS.includes(kind) || auto.includes(kind) === on) return
    this.#permit.setPolicy(EVERYONE, this.mode(), on ? [...auto, kind] : auto.filter(entry => entry !== kind))
  }

  /** Newest first. */
  requests(): readonly ExecutionRequest[] { return this.#requests }

  /** Would a request of this kind run the moment it arrives? `held` is a
   *  change that leaves the machine or follows someone else's words. `facts`
   *  pick the permission groups that judge it; none picks `everyone`. */
  runsByPolicy(kind: ExecutionKind, needsGrant: boolean, held = false, facts: PermitFacts = {}): boolean {
    if (needsGrant || held) return false
    return this.#permit.decide(kind, facts).run
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
    const leaves = ask.leaves === true
    const foreign = ask.foreign === true
    // While the groups are still being read nothing runs by itself — not even
    // a remembered read; the document's arrival releases what it covers.
    const verdict = this.#permit.decide(ask.kind, factsOf(ask))
    const byPolicy = !ask.needsGrant && !leaves && !foreign && verdict.run
    const auto = !ask.forceReview && !verdict.waiting && (remembered || byPolicy)
    const entry: ExecutionRequest = {
      id,
      convoId: String(ask.convoId ?? ''),
      providerId,
      model: String(ask.model ?? ''),
      kind: ask.kind,
      lines: [...ask.lines],
      needsGrant: ask.needsGrant,
      ...(leaves ? { leaves: true } : {}),
      ...(foreign ? { foreign: true } : {}),
      at: Date.now(),
      state: auto ? 'running' : 'waiting',
      auto,
      ...(ask.forceReview ? { forceReview: true } : {}),
      ...(remembered ? { remembered: true } : {}),
      group: verdict.groups.join(' ∩ '),
    }
    if (keys.length) this.#keysById.set(id, keys)
    this.#requests = this.#trim([entry, ...this.#requests])
    // THE WAITER BEFORE THE NEWS: a listener may decide the row the moment
    // it hears of it (a trusted conversation does), and a decision that
    // arrives before its waiter is lost — the row ran nowhere and the turn
    // waited forever.
    const decision = auto
      ? Promise.resolve<ExecutionDecision>('run')
      : new Promise<ExecutionDecision>(resolve => { this.#waiters.set(id, resolve) })
    this.#changed()
    if (auto) return { id, decision }
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

  /** A looser policy, or the groups arriving, releases what is now covered. */
  #releaseCovered(): void {
    if (this.#permit.reading) return
    for (const entry of this.#requests) {
      if (entry.state !== 'waiting' || entry.forceReview) continue
      const keys = this.#keysById.get(entry.id) ?? []
      const allowed = this.#allowedFor(entry.providerId)
      const remembered = entry.kind === 'read' && entry.needsGrant && keys.length > 0 && keys.every(key => allowed.has(key))
      if (remembered || this.runsByPolicy(entry.kind, entry.needsGrant, entry.leaves === true || entry.foreign === true, factsOf(entry))) {
        this.decide(entry.id, 'run')
      }
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

export const executionQueue = new ExecutionQueueStore(permitGroups)
