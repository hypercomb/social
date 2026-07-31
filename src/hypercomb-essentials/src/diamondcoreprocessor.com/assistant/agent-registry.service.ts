// diamondcoreprocessor.com/assistant/agent-registry.service.ts
//
// AGENT REGISTRY — what is working in this hive right now.
//
// An AGENT is one unit of work in flight: a queued `/opus` ask waiting for a
// bridged Claude Code, a routine that announced itself, an install/sync pass.
// Each one is drawn as a bee flying over the tiles it is working on (see
// presentation/avatars/agent-bee.drone.ts) and can be opened to read what it
// is doing and hand it more context (assistant/agent-panel.view.ts).
//
// ── Where agents come from ─────────────────────────────────────────────
//
// The registry does NOT invent a parallel store. Asks already persist as
// `kind:'ask'` records in the optimization pool (llm.queen.ts), so THOSE are
// the agents — which is why a queued ask survives a reload and its bee is
// still there when you come back. On top of that:
//
//   • `ask:queued`   → an agent appears (status pending)
//   • `ask:answered` → its answer landed; it finishes and flies off
//   • `agent:start` / `agent:progress` / `agent:end` → the GENERIC lane, for
//     any behaviour that wants a bee. A bridged responder reports through it
//     via the `agent-progress` bridge op, which is what makes the panel show
//     live activity instead of just "pending".
//   • `install:sync` → the long-op lane already emitted by install/resync.
//
// ── Adding context ─────────────────────────────────────────────────────
//
// `addContext` mints another `kind:'ask'` record carrying `mode:'context'`
// and the original ask's signature. The responder folds pending context
// records into the ask it is answering (scripts/bridge/watch-asks.cjs). The
// original record is never rewritten — content is immutable, so a follow-up
// is a new record pointing at the first.

import { EffectBus } from '@hypercomb/core'
import { kindFor, type AgentKind } from '../presentation/avatars/agent-waggle.js'
import { identifyModel } from '../presentation/avatars/agent-model.js'

export type AgentStatus = 'pending' | 'working' | 'done' | 'failed'
export type { AgentKind }

export interface AgentActivity {
  readonly at: number
  readonly text: string
}

export interface Agent {
  /** Stable identity. For an ask this IS the ask record's signature. */
  id: string
  /** Which behaviour is running — decides the avatar's colours. */
  behavior: string
  /** What SORT of worker this is — decides the waggle and the mark it wears.
   *  Derived from the behaviour unless the caller declares it. */
  kind: AgentKind
  /** Model hint, when the work is an ask. */
  model?: string
  /** Whose model — `anthropic`, `openai`, `google`, …, or `unknown`. Set for
   *  `kind:'model'` agents only; it is what the bee's colour family is saying. */
  vendor?: string
  /** How heavy the model is within its vendor's line-up. */
  tier?: string
  /** What was asked for. */
  request: string
  /** Tile labels the work applies to — where the bee flies. */
  targets: string[]
  /** Lineage of the page the work was raised from. */
  segments: string[]
  /** Hive-wide asks have no single tile to sit on. */
  scope?: 'hive'
  status: AgentStatus
  /** Newest last. The panel reads this as the activity log. */
  activity: AgentActivity[]
  /** Context the participant added after the fact. */
  context: string[]
  /** Progress, when the work reports it. */
  current?: number
  total?: number
  startedAt: number
  updatedAt: number
}

type StoreLike = {
  listOptimizations?: () => Promise<string[]>
  getOptimization?: (sig: string) => Promise<Blob | null>
  putOptimization?: (blob: Blob) => Promise<string>
}

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** How long a finished agent stays on screen before its bee leaves. Long
 *  enough to notice the landing, short enough not to litter the hive. */
const LINGER_MS = 6000

/** Cap on the seed scan. The pool also holds feedback/qa records; reading all
 *  of them at boot is not worth it, and a hive never has hundreds of asks. */
const SEED_SCAN_LIMIT = 400

const ACTIVITY_LIMIT = 40

export class AgentRegistry extends EventTarget {
  readonly #agents = new Map<string, Agent>()
  readonly #expiry = new Map<string, ReturnType<typeof setTimeout>>()
  #seeded = false

  constructor() {
    super()

    // ── the ask lane ──
    EffectBus.on<{ sig: string; prompt: string; targets?: string[]; model?: string }>('ask:queued', p => {
      if (!p?.sig) return
      this.#upsert({
        id: p.sig,
        behavior: String(p.model || 'ask'),
        model: p.model,
        request: String(p.prompt ?? ''),
        targets: [...(p.targets ?? [])],
        segments: [],
        status: 'pending',
        activity: [{ at: Date.now(), text: 'queued for a bridged Claude Code' }],
      })
    })

    EffectBus.on<{ sig: string }>('ask:answered', p => {
      if (!p?.sig) return
      this.#finish(p.sig, 'done', 'answered — the note landed on the tile')
    })

    // ── the generic lane — any behaviour can raise a bee ──
    EffectBus.on<Partial<Agent> & { id?: string }>('agent:start', p => {
      if (!p?.id) return
      this.#upsert({
        id: String(p.id),
        behavior: String(p.behavior ?? 'agent'),
        // A behaviour may declare what sort of work this is; otherwise the
        // name decides. A plain script gets the script waggle, not a dance.
        ...(p.kind ? { kind: p.kind } : {}),
        model: p.model,
        request: String(p.request ?? ''),
        targets: [...(p.targets ?? [])],
        segments: [...(p.segments ?? [])],
        status: 'working',
        activity: [{ at: Date.now(), text: 'started' }],
      })
    })

    EffectBus.on<{ id?: string; sig?: string; activity?: string; latest?: boolean; status?: AgentStatus; current?: number; total?: number }>(
      'agent:progress',
      p => {
        const id = String(p?.id || p?.sig || '')
        const agent = this.#agents.get(id)
        if (!agent) return
        if (p?.status && p.status !== agent.status) agent.status = p.status
        else if (agent.status === 'pending') agent.status = 'working'
        if (typeof p?.current === 'number') agent.current = p.current
        if (typeof p?.total === 'number') agent.total = p.total
        if (p?.activity) {
          const text = String(p.activity)
          if (p.latest && agent.activity.at(-1)?.text.startsWith('Latest file:')) {
            agent.activity[agent.activity.length - 1] = { at: Date.now(), text }
          } else {
            this.#note(agent, text)
          }
        }
        agent.updatedAt = Date.now()
        this.#changed()
      },
    )

    EffectBus.on<{ id?: string; ok?: boolean; summary?: string }>('agent:end', p => {
      const id = String(p?.id ?? '')
      if (!id) return
      this.#finish(id, p?.ok === false ? 'failed' : 'done', p?.summary)
    })

    // ── the long-op lane — install / resync already emit this ──
    EffectBus.on<{ active?: boolean; source?: string; current?: number; total?: number }>('install:sync', p => {
      const id = `sync:${String(p?.source ?? 'sync')}`
      if (p?.active === true) {
        const existing = this.#agents.get(id)
        if (existing) {
          existing.current = p.current
          existing.total = p.total
          existing.updatedAt = Date.now()
          this.#changed()
          return
        }
        this.#upsert({
          id,
          behavior: 'sync',
          request: 'Installing and syncing content',
          targets: [],
          segments: [],
          status: 'working',
          current: p.current,
          total: p.total,
          activity: [{ at: Date.now(), text: 'syncing' }],
        })
      } else {
        this.#finish(id, 'done', 'sync complete')
      }
    })
  }

  /** Every agent, oldest first. */
  list(): Agent[] {
    return [...this.#agents.values()].sort((a, b) => a.startedAt - b.startedAt)
  }

  get(id: string): Agent | undefined {
    return this.#agents.get(id)
  }

  get count(): number {
    return this.#agents.size
  }

  /** Read the asks already sitting in the pool, so a reload doesn't lose the
   *  bees. Idempotent and idle-scheduled — the render layer calls it once the
   *  hive is up. */
  async seed(): Promise<void> {
    if (this.#seeded) return
    this.#seeded = true
    const store = ioc<StoreLike>('@hypercomb.social/Store')
    if (!store?.listOptimizations || !store?.getOptimization) return
    let sigs: string[] = []
    try { sigs = await store.listOptimizations() } catch { return }

    // Context records are read in the same pass so a reloaded agent still
    // shows the context that was added to it before the reload.
    const contextByAsk = new Map<string, string[]>()
    const pending: Array<{ sig: string; record: any }> = []

    for (const sig of sigs.slice(0, SEED_SCAN_LIMIT)) {
      let record: any
      try {
        const blob = await store.getOptimization(sig)
        if (!blob) continue
        record = JSON.parse(await blob.text())
      } catch { continue }
      if (record?.kind !== 'ask') continue
      const mode = record?.payload?.mode
      if (mode === 'chat') continue // the ask screen's own conversation, not an agent
      if (mode === 'context') {
        const of = String(record?.payload?.askSig ?? '')
        if (of) contextByAsk.set(of, [...(contextByAsk.get(of) ?? []), String(record?.payload?.prompt ?? '')])
        continue
      }
      pending.push({ sig, record })
    }

    for (const { sig, record } of pending) {
      if (this.#agents.has(sig)) continue
      const payload = record?.payload ?? {}
      const askedAt = Number(payload.askedAt) || Date.now()
      this.#upsert({
        id: sig,
        behavior: String(payload.model || 'ask'),
        model: typeof payload.model === 'string' ? payload.model : undefined,
        request: String(payload.prompt ?? ''),
        targets: Array.isArray(payload.targets) ? payload.targets.map(String) : [],
        segments: Array.isArray(payload.segments) ? payload.segments.map(String) : [],
        scope: payload.scope === 'hive' ? 'hive' : undefined,
        status: payload.status === 'working' ? 'working' : 'pending',
        activity: [{ at: askedAt, text: 'waiting for a bridged Claude Code' }],
        context: contextByAsk.get(sig) ?? [],
        startedAt: askedAt,
      })
    }
  }

  /** Hand an in-flight agent more to work with. Mints a `mode:'context'` ask
   *  record pointing at the original; returns false when the write is refused
   *  so the panel can keep the text. */
  async addContext(id: string, text: string): Promise<boolean> {
    const agent = this.#agents.get(id)
    const prompt = text.trim()
    if (!agent || !prompt) return false

    const store = ioc<StoreLike>('@hypercomb.social/Store')
    if (!store?.putOptimization) return false

    const record = {
      kind: 'ask',
      appliesTo: agent.targets.length ? agent.targets : agent.segments,
      payload: {
        mode: 'context',
        askSig: agent.id,
        prompt,
        model: agent.model,
        targets: agent.targets,
        segments: agent.segments,
        status: 'pending',
        askedAt: Date.now(),
      },
      mark: 'persistent',
    }
    try {
      await store.putOptimization(new Blob([JSON.stringify(record)], { type: 'application/json' }))
    } catch {
      return false
    }

    agent.context.push(prompt)
    this.#note(agent, 'you added context')
    agent.updatedAt = Date.now()
    this.#changed()
    return true
  }

  // ── internals ──────────────────────────────────────────────────────

  #upsert(seed: Partial<Agent> & { id: string; behavior: string }): void {
    const now = Date.now()
    const existing = this.#agents.get(seed.id)
    if (existing) {
      Object.assign(existing, seed, { updatedAt: now })
      this.#changed()
      return
    }
    this.#agents.set(seed.id, {
      model: undefined,
      request: '',
      targets: [],
      segments: [],
      status: 'pending',
      activity: [],
      context: [],
      startedAt: now,
      updatedAt: now,
      ...seed,
      ...this.#identity(seed),
    } as Agent)
    this.#changed()
  }

  /** Kind, and — for a model — whose it is. Derived once at spawn: the name
   *  cannot change under an agent, and every surface that wants to say
   *  "anthropic · opus" should read the same answer. */
  #identity(seed: Partial<Agent> & { behavior: string }): { kind: AgentKind; vendor?: string; tier?: string } {
    const kind = kindFor(seed)
    if (kind !== 'model') return { kind }
    const { vendor, tier } = identifyModel(seed.model || seed.behavior)
    return { kind, vendor, tier }
  }

  #finish(id: string, status: 'done' | 'failed', summary?: string): void {
    const agent = this.#agents.get(id)
    if (!agent) return
    agent.status = status
    agent.updatedAt = Date.now()
    if (summary) this.#note(agent, summary)
    this.#changed()
    clearTimeout(this.#expiry.get(id))
    this.#expiry.set(id, setTimeout(() => {
      this.#agents.delete(id)
      this.#expiry.delete(id)
      this.#changed()
    }, LINGER_MS))
  }

  #note(agent: Agent, text: string): void {
    agent.activity.push({ at: Date.now(), text })
    if (agent.activity.length > ACTIVITY_LIMIT) agent.activity.splice(0, agent.activity.length - ACTIVITY_LIMIT)
  }

  #changed(): void {
    this.dispatchEvent(new CustomEvent('change'))
  }
}

const _agents = new AgentRegistry()
window.ioc.register('@diamondcoreprocessor.com/AgentRegistry', _agents)
