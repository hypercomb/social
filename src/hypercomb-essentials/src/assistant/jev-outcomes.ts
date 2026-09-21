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

/** `passed`: the direct path was not sure and handed the turn to the worker. */
export const JEV_OUTCOMES = ['ran', 'skipped', 'failed', 'answered', 'deferred', 'refused', 'passed', 'verified', 'unverified'] as const
export type JevOutcomeKind = typeof JEV_OUTCOMES[number]
const PLANS = ['do', 'read', 'answer', 'ask', 'participant', 'revise', 'direct', 'verify'] as const
const REACHES = ['additive', 'editing', 'destructive'] as const

export interface JevOutcome {
  readonly kind: 'jev-outcome'
  /** The decision receipt's signature, when the store kept one. */
  readonly decision?: string
  readonly plan: typeof PLANS[number]
  readonly outcome: JevOutcomeKind
  /** The change waited for the participant's review rather than Jev's gates. */
  readonly review?: true
  readonly reach?: typeof REACHES[number]
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
  return {
    kind: 'jev-outcome', plan, outcome, at,
    ...(decision ? { decision } : {}),
    ...(value['review'] === true ? { review: true as const } : {}),
    ...(reach ? { reach } : {}),
  }
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
          const record = outcomeRecord(JSON.parse(await (await (handle as FileSystemFileHandle).getFile()).text()))
          if (record) { this.#seen.add(name); this.#records.push(record) }
        } catch { /* an unreadable record is skipped, never fatal */ }
      }
    })()
    return this.#loaded
  }

  async record(payload: unknown): Promise<boolean> {
    const record = outcomeRecord(payload)
    if (!record) return false
    const dir = await pool()
    if (!dir) return false
    const body = JSON.stringify(record)
    const name = await sha256Hex(body)
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(body) } finally { await writable.close() }
    if (!this.#seen.has(name)) { this.#seen.add(name); this.#records.push(record) }
    return true
  }

  /** The tally as far as it is known now: synchronous, for a view to paint. */
  tally(): JevTally {
    void this.load().catch(() => { this.#loaded = null })
    return tallyOutcomes(this.#records)
  }

  records(): readonly JevOutcome[] { return this.#records }
}

export const jevOutcomes = new JevOutcomes()
EffectBus.on('jev:outcome', payload => { void jevOutcomes.record(payload).catch(() => { /* the chat never waits on this */ }) })
window.ioc?.register(JEV_OUTCOMES_IOC_KEY, jevOutcomes)
