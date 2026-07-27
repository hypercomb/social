// diamondcoreprocessor.com/assistant/orchestrator.drone.ts
//
// THE ORCHESTRATOR — the bee that watches the other bees.
//
// Work that runs in the background goes wrong quietly: an ask sits pending
// because nothing is bridged, a routine claims a tile and never reports again,
// two passes fight over the same tile, something fails at 3am and nobody sees
// the toast. The orchestrator's whole job is that none of it goes unnoticed.
//
// It sweeps the agent registry on a slow tick and raises FINDINGS:
//
//   waiting    queued a long time with nothing picking it up
//   silent     said it was working, then went quiet
//   overlap    two live agents working the same tile
//   failed     ended badly
//   rogue      still alive long past any reasonable run
//
// It has its own bee (kind `orchestrator`: the wide slow figure-8, wearing the
// eye) which is calm while everything is healthy and dances when it has
// something to say. Clicking it opens the same panel every other agent uses —
// its activity log IS the findings list.
//
// ── It reports, it never intervenes ────────────────────────────────────
//
// A stalled ask is still the participant's request; a slow routine may be
// slow for a good reason. Retiring or restarting someone else's work on a
// timer would destroy data to satisfy a heuristic, so the orchestrator does
// not do it. It makes the state visible and leaves the decision where it
// belongs.
//
// The other half of the job — stray log files, code that has drifted from the
// documentation, mirrors that were never built — lives outside the browser
// and runs over the bridge: `scripts/bridge/orchestrator-sweep.cjs` reports
// its findings back through the `agent-progress` op, onto this same bee.

import { Drone, EffectBus } from '@hypercomb/core'
import type { Agent, AgentRegistry } from './agent-registry.service.js'

export type FindingKind = 'waiting' | 'silent' | 'overlap' | 'failed' | 'rogue' | 'sweep'

export interface OrchestratorFinding {
  readonly kind: FindingKind
  /** Agent ids the finding concerns. */
  readonly agents: readonly string[]
  readonly text: string
  readonly at: number
}

/** The one agent id the orchestrator reports under. Bridge sweeps target it. */
export const ORCHESTRATOR_ID = 'orchestrator'

const SWEEP_MS = 15_000
/** Queued this long with nobody picking it up is worth saying out loud. */
const WAITING_MS = 5 * 60_000
/** Working, but nothing reported since. */
const SILENT_MS = 4 * 60_000
/** Alive far longer than any single pass should be. */
const ROGUE_MS = 45 * 60_000

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const minutes = (ms: number): string => `${Math.max(1, Math.round(ms / 60_000))}m`

export class OrchestratorDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'

  public override description =
    'Watches every agent in the hive and reports work that has stalled, gone silent, overlapped, failed, or run away.'
  public override effects = ['network'] as const

  protected override listens = []
  protected override emits = ['agent:start', 'agent:progress', 'agent:end', 'orchestrator:findings']

  #timer: ReturnType<typeof setInterval> | null = null
  #started = false
  /** Findings currently standing, keyed so the same one is not re-announced
   *  every 15 seconds — an alert that repeats is an alert nobody reads. */
  readonly #open = new Map<string, OrchestratorFinding>()
  #raised = false

  protected override sense = (): boolean => true

  /** Start watching at WARMUP, not on the first pulse. A drone's heartbeat
   *  runs when the processor acts — i.e. when somebody is using the hive —
   *  and a watchdog that only wakes up while you are watching it is not a
   *  watchdog. (Verified: a hive left alone never started the sweep at all.)
   *  The heartbeat below stays as a safety net if warmup was missed. */
  public override async warmup(): Promise<void> {
    this.#begin()
  }

  protected override heartbeat = async (): Promise<void> => {
    this.#begin()
  }

  #begin = (): void => {
    if (this.#started) return
    this.#started = true
    this.#timer = setInterval(this.#sweep, SWEEP_MS)
    this.#sweep()
  }

  /** Everything currently wrong, newest first. */
  get findings(): OrchestratorFinding[] {
    return [...this.#open.values()].sort((a, b) => b.at - a.at)
  }

  /** Record a finding from the REPO-SIDE sweep (stray logs, mirrors that were
   *  never built, notes citing source files that no longer exist). Those come
   *  in over the bridge, which cannot see the registry — so they are kept
   *  under their own keys and carried through every hive-side sweep until the
   *  next run of the script clears them. */
  noteSweep(text: string): void {
    const clean = text.trim()
    if (!clean) return
    if (clean === 'clear') {
      for (const key of [...this.#open.keys()]) if (this.#open.get(key)?.kind === 'sweep') this.#open.delete(key)
      this.emitEffect('orchestrator:findings', { findings: this.findings })
      return
    }
    const key = `sweep:${clean}`
    if (this.#open.has(key)) return
    this.#raise(this.#registry()?.list().length ?? 0)
    this.#open.set(key, { kind: 'sweep', agents: [], text: clean, at: Date.now() })
    this.emitEffect('orchestrator:findings', { findings: this.findings })
  }

  #registry = (): AgentRegistry | undefined => ioc<AgentRegistry>('@diamondcoreprocessor.com/AgentRegistry')

  #sweep = (): void => {
    const registry = this.#registry()
    if (!registry) return
    const agents = registry.list().filter(a => a.id !== ORCHESTRATOR_ID)

    // Nothing running and nothing outstanding: stand down completely. An idle
    // hive should be an empty hive — a permanent watcher bee is decoration.
    if (agents.length === 0 && this.#open.size === 0) {
      if (this.#raised) {
        this.#raised = false
        this.emitEffect('agent:end', { id: ORCHESTRATOR_ID, ok: true, summary: 'nothing left to watch' })
      }
      return
    }

    this.#raise(agents.length)

    const now = Date.now()
    const found = new Map<string, OrchestratorFinding>()
    const add = (key: string, finding: OrchestratorFinding): void => { found.set(key, finding) }

    for (const agent of agents) {
      const idle = now - agent.updatedAt
      const age = now - agent.startedAt

      if (agent.status === 'failed') {
        add(`failed:${agent.id}`, {
          kind: 'failed', agents: [agent.id], at: now,
          text: `${agent.behavior} failed${agent.targets.length ? ` on ${agent.targets.join(', ')}` : ''}`,
        })
      } else if (agent.status === 'pending' && age > WAITING_MS) {
        add(`waiting:${agent.id}`, {
          kind: 'waiting', agents: [agent.id], at: now,
          text: `${agent.behavior} has been queued ${minutes(age)} with nothing picking it up`
            + (agent.kind === 'model' ? ' — is a Claude Code bridged?' : ''),
        })
      } else if (agent.status === 'working' && idle > SILENT_MS) {
        add(`silent:${agent.id}`, {
          kind: 'silent', agents: [agent.id], at: now,
          text: `${agent.behavior} has reported nothing for ${minutes(idle)}`,
        })
      }

      if (age > ROGUE_MS && agent.status !== 'done') {
        add(`rogue:${agent.id}`, {
          kind: 'rogue', agents: [agent.id], at: now,
          text: `${agent.behavior} has been running ${minutes(age)} — check whether it is still doing anything`,
        })
      }
    }

    // Two live agents on one tile: not always wrong (an ask and a sync can
    // legitimately overlap), but it is the shape of two passes clobbering each
    // other's writes, so it gets said once.
    const byTarget = new Map<string, Agent[]>()
    for (const agent of agents) {
      if (agent.status === 'done' || agent.status === 'failed') continue
      for (const target of agent.targets) {
        byTarget.set(target, [...(byTarget.get(target) ?? []), agent])
      }
    }
    for (const [target, sharing] of byTarget) {
      if (sharing.length < 2) continue
      add(`overlap:${target}`, {
        kind: 'overlap', agents: sharing.map(a => a.id), at: now,
        text: `${sharing.length} agents are working "${target}" at once (${sharing.map(a => a.behavior).join(', ')})`,
      })
    }

    // Sweep findings pushed in from the bridge live under their own keys and
    // are not re-derived here — carry them through untouched.
    for (const [key, finding] of this.#open) {
      if (finding.kind === 'sweep') found.set(key, finding)
    }

    for (const [key, finding] of found) {
      if (this.#open.has(key)) continue
      this.#open.set(key, finding)
      this.emitEffect('agent:progress', { id: ORCHESTRATOR_ID, activity: finding.text, status: 'working' })
    }
    // A finding that no longer holds simply clears — the work recovered.
    for (const key of [...this.#open.keys()]) {
      if (!found.has(key)) this.#open.delete(key)
    }

    if (this.#open.size === 0) {
      this.emitEffect('agent:progress', {
        id: ORCHESTRATOR_ID,
        activity: `watching ${agents.length} agent${agents.length === 1 ? '' : 's'} — all healthy`,
        status: 'pending',
      })
    }
    this.emitEffect('orchestrator:findings', { findings: this.findings })
  }

  /** Raise the orchestrator's own agent so it has a bee. Idempotent. */
  #raise = (watching: number): void => {
    if (this.#raised) return
    this.#raised = true
    this.emitEffect('agent:start', {
      id: ORCHESTRATOR_ID,
      behavior: 'orchestrator',
      kind: 'orchestrator',
      request: 'Watching every agent in the hive for work that stalls, overlaps, fails, or runs away.',
      targets: [],
      segments: [],
    })
    this.emitEffect('agent:progress', {
      id: ORCHESTRATOR_ID,
      activity: `watching ${watching} agent${watching === 1 ? '' : 's'}`,
      status: 'pending',
    })
  }

  protected override dispose = (): void => {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
  }
}

const _orchestrator = new OrchestratorDrone()
window.ioc.register('@diamondcoreprocessor.com/OrchestratorDrone', _orchestrator)

// A sweep run over the bridge reports through the same `agent-progress` op as
// any other responder. It marks its lines with SWEEP_PREFIX so they can be
// told apart from the drone's OWN progress emissions — without that, this
// listener would hear itself and every heartbeat would become a finding.
export const SWEEP_PREFIX = 'sweep: '

EffectBus.on<{ id?: string; activity?: string }>('agent:progress', payload => {
  if (payload?.id !== ORCHESTRATOR_ID) return
  const activity = String(payload.activity ?? '')
  if (!activity.startsWith(SWEEP_PREFIX)) return
  ioc<OrchestratorDrone>('@diamondcoreprocessor.com/OrchestratorDrone')
    ?.noteSweep(activity.slice(SWEEP_PREFIX.length))
})
