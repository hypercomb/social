// core/optimization-heat.ts
//
// Use counts for derived optimization records. The count is not stored
// inside the derived bytes — those stay a pure function of the source
// signature. This ledger only decides recycling order.
//
// A count at or above OPTIMIZATION_KEEP_AT is out of recycling priority.
// A count below it is in. A pass may drop an in-priority record. The
// highest counts are not eligible. A record the ledger has never seen is
// enrolled at the keep line and is not dropped on that pass.

/** Derived index pools whose members are files named by the source signature.
 *  The heat ledger and the reap both refuse every other meaning. */
export const DERIVED_OPTIMIZATION_POOLS = Object.freeze([
  'system:manifests',
  'visual-optimization',
  'thumbnails:hex',
  'sprites:boot',
  'llm:context',
  'search:index',
  'molecule:index',
] as const)

/** Local ledger of those counts. One current document. Declared `index`
 *  so a reference walk does not treat the signatures named inside it as roots. */
export const OPTIMIZATION_HEAT_MEANING = 'optimization:heat'

/** At or above this, a record is out of recycling priority. */
export const OPTIMIZATION_KEEP_AT = 3

/** A use cannot raise a count past this. Twenty-four daily decays of protection. */
export const OPTIMIZATION_COUNT_MAX = 24

/** A mint starts a record on the keep line, so the thing just written is
 *  not eligible for recycling until a later unused decay. */
export const OPTIMIZATION_MINT_WEIGHT = OPTIMIZATION_KEEP_AT

/** One decay step. A record used at least once a day holds its count. */
export const OPTIMIZATION_DECAY_MS = 24 * 60 * 60 * 1000

/** How often a reap may list a pool. Uses accumulate between passes. */
export const OPTIMIZATION_REAP_MS = 60 * 1000

/** Members dropped from one pool on one pass. The rest stay in priority
 *  and go on the next pass that lists that pool. */
export const OPTIMIZATION_DELETE_BATCH = 48

const SIG = /^[0-9a-f]{64}$/
const POOLS = new Set<string>(DERIVED_OPTIMIZATION_POOLS)

export type OptimizationHeat = {
  readonly v: 1
  readonly at: number
  readonly counts: Readonly<Record<string, number>>
}

export type HeatUse = {
  readonly meaning: string
  readonly member: string
  readonly weight: number
}

export const optimizationHeatId = (meaning: string, member: string): string =>
  `${meaning}/${member.toLowerCase()}`

export const inRecyclingPriority = (count: number): boolean => count < OPTIMIZATION_KEEP_AT

export const emptyOptimizationHeat = (now: number): OptimizationHeat =>
  ({ v: 1, at: now, counts: {} })

const clampCount = (value: number): number =>
  Math.max(0, Math.min(OPTIMIZATION_COUNT_MAX, Math.floor(value)))

const validId = (key: string): boolean => {
  const slash = key.indexOf('/')
  if (slash <= 0) return false
  return POOLS.has(key.slice(0, slash)) && SIG.test(key.slice(slash + 1))
}

/** Null when the text is not a ledger. A caller treats null as "delete nothing". */
export const parseOptimizationHeat = (text: string): OptimizationHeat | null => {
  try {
    const raw = JSON.parse(text) as { v?: unknown; at?: unknown; counts?: unknown }
    if (raw?.v !== 1 || typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null
    if (!raw.counts || typeof raw.counts !== 'object' || Array.isArray(raw.counts)) return null
    const counts: Record<string, number> = {}
    for (const [key, value] of Object.entries(raw.counts as Record<string, unknown>)) {
      if (!validId(key) || typeof value !== 'number' || !Number.isFinite(value)) continue
      counts[key] = clampCount(value)
    }
    return { v: 1, at: raw.at, counts }
  } catch {
    return null
  }
}

export const serializeOptimizationHeat = (heat: OptimizationHeat): string => {
  const counts: Record<string, number> = {}
  for (const key of Object.keys(heat.counts).sort()) {
    if (validId(key)) counts[key] = clampCount(heat.counts[key] ?? 0)
  }
  return JSON.stringify({ v: 1, at: heat.at, counts })
}

export type HeatPass = {
  readonly heat: OptimizationHeat
  /** Exact member names to drop from `pool`, lowest count first. */
  readonly victims: readonly string[]
  readonly changed: boolean
}

/**
 * Apply one reap to a copy of the ledger.
 *
 * Decay, when due, lowers every count by one. A use then adds its weight
 * and, when the result is under the keep line, lifts it back onto the line
 * — that is the move out of recycling priority. Members of `pool` that the
 * ledger has never counted are enrolled on the keep line. Only a member
 * that was already counted, and is still under the line after this pass,
 * is a victim. A pool that is not a derived index yields no victims.
 */
export const runOptimizationHeat = (input: {
  readonly heat: OptimizationHeat
  readonly now: number
  readonly uses: readonly HeatUse[]
  readonly pool: string
  readonly members: readonly string[]
}): HeatPass => {
  const counts: Record<string, number> = { ...input.heat.counts }
  const before = new Set(Object.keys(counts))
  let at = input.heat.at
  let changed = false

  if (input.now - at >= OPTIMIZATION_DECAY_MS) {
    for (const key of Object.keys(counts)) counts[key] = Math.max(0, (counts[key] ?? 0) - 1)
    at = input.now
    changed = true
  }

  const touched = new Set<string>()
  for (const use of input.uses) {
    const member = use.member.toLowerCase()
    if (!POOLS.has(use.meaning) || !SIG.test(member)) continue
    const weight = clampCount(use.weight)
    if (weight <= 0) continue
    const id = optimizationHeatId(use.meaning, member)
    const lifted = Math.max(Math.min(OPTIMIZATION_COUNT_MAX, (counts[id] ?? 0) + weight), OPTIMIZATION_KEEP_AT)
    if (counts[id] !== lifted) changed = true
    counts[id] = lifted
    touched.add(id)
  }

  const listed = POOLS.has(input.pool)
  const memberNames = listed ? input.members.filter(name => SIG.test(name.toLowerCase())) : []
  if (listed) {
    for (const name of memberNames) {
      const id = optimizationHeatId(input.pool, name)
      if (counts[id] === undefined) {
        counts[id] = OPTIMIZATION_KEEP_AT
        changed = true
      }
    }
    const present = new Set(memberNames.map(name => name.toLowerCase()))
    for (const key of Object.keys(counts)) {
      if (!key.startsWith(`${input.pool}/`)) continue
      const member = key.slice(input.pool.length + 1)
      if (!present.has(member) && !touched.has(key)) {
        delete counts[key]
        changed = true
      }
    }
  }

  const ranked: { name: string; n: number }[] = []
  if (listed) {
    for (const name of memberNames) {
      const id = optimizationHeatId(input.pool, name)
      const n = counts[id] ?? 0
      if (before.has(id) && inRecyclingPriority(n)) ranked.push({ name, n })
    }
  }
  ranked.sort((a, b) => a.n - b.n || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const victims = ranked.slice(0, OPTIMIZATION_DELETE_BATCH).map(row => row.name)
  if (victims.length > 0) {
    changed = true
    for (const name of victims) delete counts[optimizationHeatId(input.pool, name)]
  }

  return { heat: { v: 1, at, counts }, victims, changed }
}
