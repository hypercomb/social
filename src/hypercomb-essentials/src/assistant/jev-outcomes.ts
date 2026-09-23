// assistant/jev-outcomes.ts — WHAT HAPPENED AFTER JEV DECIDED.
//
// TypeSafe's guidance is that thresholds are tuned on your own outcomes, never
// guessed (documentation/jev-decisions.md, audit 2026-09-21). Every decision
// receipt is already kept; what was missing is what the participant did with
// it. The chat emits `jev:outcome` once per decided round — the step ran, the
// participant skipped it, it failed, the worker was told to answer, the
// choice was deferred to the participant, or the table was refused — and
// this keeps one immutable record per outcome in its own pool, named by the
// hash of its bytes (so the EffectBus replay can never double-count one).
//
// Pools hold events and membership, never truth: nothing here gates, and a
// cold hive without the pool loses only the tally. The tally is shown on the
// Jev row of the providers window.

import { EffectBus } from '@hypercomb/core'

export const JEV_OUTCOMES_POOL = 'jev:outcomes'
export const JEV_OUTCOMES_IOC_KEY = '@diamondcoreprocessor.com/JevOutcomes'

/** `passed`: the front door was not sure of one step and handed the turn to
 *  the worker. `aside`: the front door was sure the hive was not needed and
 *  Jev stepped out of the turn. */
export const JEV_OUTCOMES = ['ran', 'skipped', 'failed', 'answered', 'deferred', 'refused', 'passed', 'verified', 'unverified', 'aside'] as const
export type JevOutcomeKind = typeof JEV_OUTCOMES[number]
const PLANS = ['do', 'read', 'answer', 'ask', 'participant', 'revise', 'direct', 'verify', 'file', 'front'] as const
const REACHES = ['additive', 'editing', 'destructive'] as const
const WEIGHTS = ['fast', 'balanced', 'deep'] as const

export interface JevOutcome {
  readonly kind: 'jev-outcome'
  /** The decision receipt's signature, when the store kept one. */
  readonly decision?: string
  readonly plan: typeof PLANS[number]
  readonly outcome: JevOutcomeKind
  /** The change waited for the participant's review rather than Jev's gates. */
  readonly review?: true
  readonly reach?: typeof REACHES[number]
  /** The weight the front door read the request at, when it was sure. */
  readonly weight?: typeof WEIGHTS[number]
  readonly at: number
}

export type JevTally = Readonly<Record<JevOutcomeKind, number>> & { readonly decisions: number }

const SIG = /^[0-9a-f]{64}$/
const one = <T extends string>(set: readonly T[], value: unknown): T | undefined =>
  typeof value === 'string' && (set as readonly string[]).includes(value) ? value as T : undefined

/** A payload from the bus, made into a record — or nothing, if it is not one. */
export const outcomeRecord = (payload: unknown): JevOutcome | null => {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as Record<string, unknown>
  const plan = one(PLANS, value['plan'])
  const outcome = one(JEV_OUTCOMES, value['outcome'])
  const at = typeof value['at'] === 'number' && Number.isFinite(value['at']) ? value['at'] : 0
  if (!plan || !outcome || !at) return null
  const decision = typeof value['decision'] === 'string' && SIG.test(value['decision']) ? value['decision'] : undefined
  const reach = one(REACHES, value['reach'])
  const weight = one(WEIGHTS, value['weight'])
  return {
    kind: 'jev-outcome', plan, outcome, at,
    ...(decision ? { decision } : {}),
    ...(value['review'] === true ? { review: true as const } : {}),
    ...(reach ? { reach } : {}),
    ...(weight ? { weight } : {}),
  }
}

// ── how long a turn took, by the way it went ──────────────────────────────
//
// "Does Jev make turns faster" is a number, not a feeling
// (jev-creative-plan.md §2.3). The chat emits `jev:turn` once per finished
// turn, Jev on or off, and each lands in the same pool as its own record.
// Times include any wait in Execution; medians keep one long wait from
// deciding the answer.

/** direct: Jev ran one step, no worker · judged: Jev stayed and judged the
 *  worker's tables · aside: Jev was sure the hive was not needed · down: Jev
 *  was on but did not answer at the front door · gone: Jev failed mid-turn ·
 *  off: Jev was not on for this worker. */
export const JEV_TURN_PATHS = ['direct', 'judged', 'aside', 'down', 'gone', 'off'] as const
export type JevTurnPath = typeof JEV_TURN_PATHS[number]

export interface JevTurn {
  readonly kind: 'jev-turn'
  readonly path: JevTurnPath
  /** From the message leaving to the turn's last word. */
  readonly ms: number
  /** Until the first visible text: what streaming changes. */
  readonly firstMs?: number
  /** Worker calls in the turn (0 on the direct path). */
  readonly rounds: number
  /** The weight the worker was routed at. */
  readonly weight?: typeof WEIGHTS[number]
  readonly at: number
}

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined

export const turnRecord = (payload: unknown): JevTurn | null => {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as Record<string, unknown>
  const path = one(JEV_TURN_PATHS, value['path'])
  const ms = count(value['ms'])
  const rounds = count(value['rounds'])
  const at = typeof value['at'] === 'number' && Number.isFinite(value['at']) ? value['at'] : 0
  if (!path || ms === undefined || rounds === undefined || !at) return null
  const firstMs = count(value['firstMs'])
  const weight = one(WEIGHTS, value['weight'])
  return {
    kind: 'jev-turn', path, ms, rounds, at,
    ...(firstMs !== undefined && firstMs <= ms ? { firstMs } : {}),
    ...(weight ? { weight } : {}),
  }
}

/** The four ways a turn can go, as the Jev row compares them. */
export const TURN_GROUPS = {
  direct: ['direct'], judged: ['judged'], aside: ['aside'], without: ['off', 'down', 'gone'],
} as const satisfies Record<string, readonly JevTurnPath[]>
export type JevTurnGroup = keyof typeof TURN_GROUPS
export type JevSpeeds = Partial<Record<JevTurnGroup, { readonly turns: number; readonly ms: number; readonly firstMs?: number }>>

const median = (values: readonly number[]): number | undefined => {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/** Median time per group, only for groups that have turns. */
export const turnSpeeds = (turns: readonly JevTurn[]): JevSpeeds => {
  const speeds: JevSpeeds = {}
  for (const [group, paths] of Object.entries(TURN_GROUPS) as [JevTurnGroup, readonly JevTurnPath[]][]) {
    const inGroup = turns.filter(turn => paths.includes(turn.path))
    if (!inGroup.length) continue
    const firstMs = median(inGroup.flatMap(turn => turn.firstMs === undefined ? [] : [turn.firstMs]))
    speeds[group] = { turns: inGroup.length, ms: median(inGroup.map(turn => turn.ms))!, ...(firstMs === undefined ? {} : { firstMs }) }
  }
  return speeds
}

export const tallyOutcomes = (records: readonly JevOutcome[]): JevTally => {
  const tally = Object.fromEntries(JEV_OUTCOMES.map(kind => [kind, 0])) as Record<JevOutcomeKind, number>
  for (const record of records) tally[record.outcome]++
  return { ...tally, decisions: records.length }
}

// ── the pool ──────────────────────────────────────────────────────────────

type StoreLike = { getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null> }
const pool = async (): Promise<FileSystemDirectoryHandle | null> =>
  (await (window.ioc?.get?.('@hypercomb.social/Store') as StoreLike | undefined)?.getPool?.(JEV_OUTCOMES_POOL)) ?? null

const sha256Hex = async (text: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('')

class JevOutcomes {
  #records: JevOutcome[] = []
  #turns: JevTurn[] = []
  #seen = new Set<string>()
  #loaded: Promise<void> | null = null

  /** Read the pool once; later records join the tally as they are written. */
  load(): Promise<void> {
    this.#loaded ??= (async () => {
      const dir = await pool()
      if (!dir) { this.#loaded = null; return }
      for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind !== 'file' || !SIG.test(name) || this.#seen.has(name)) continue
        try {
          const parsed: unknown = JSON.parse(await (await (handle as FileSystemFileHandle).getFile()).text())
          const kind = (parsed as { kind?: unknown } | null)?.kind
          const record = kind === 'jev-turn' ? turnRecord(parsed) : outcomeRecord(parsed)
          if (record?.kind === 'jev-turn') { this.#seen.add(name); this.#turns.push(record) }
          else if (record) { this.#seen.add(name); this.#records.push(record) }
        } catch { /* an unreadable record is skipped, never fatal */ }
      }
    })()
    return this.#loaded
  }

  async record(payload: unknown): Promise<boolean> {
    const record = outcomeRecord(payload)
    if (!record) return false
    const name = await this.#write(record)
    if (name && !this.#seen.has(name)) { this.#seen.add(name); this.#records.push(record) }
    return !!name
  }

  async recordTurn(payload: unknown): Promise<boolean> {
    const record = turnRecord(payload)
    if (!record) return false
    const name = await this.#write(record)
    if (name && !this.#seen.has(name)) { this.#seen.add(name); this.#turns.push(record) }
    return !!name
  }

  /** One immutable record, named by the hash of its bytes. */
  async #write(record: JevOutcome | JevTurn): Promise<string | null> {
    const dir = await pool()
    if (!dir) return null
    const body = JSON.stringify(record)
    const name = await sha256Hex(body)
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(body) } finally { await writable.close() }
    return name
  }

  /** Median turn time per group, as far as it is known now. */
  speeds(): JevSpeeds {
    void this.load().catch(() => { this.#loaded = null })
    return turnSpeeds(this.#turns)
  }

  turns(): readonly JevTurn[] { return this.#turns }

  /** The tally as far as it is known now: synchronous, for a view to paint. */
  tally(): JevTally {
    void this.load().catch(() => { this.#loaded = null })
    return tallyOutcomes(this.#records)
  }

  records(): readonly JevOutcome[] { return this.#records }
}

export const jevOutcomes = new JevOutcomes()
EffectBus.on('jev:outcome', payload => { void jevOutcomes.record(payload).catch(() => { /* the chat never waits on this */ }) })
EffectBus.on('jev:turn', payload => { void jevOutcomes.recordTurn(payload).catch(() => { /* the chat never waits on this */ }) })
