// hypercomb-runtime/src/hive.ts
//
// A HIVE decides which beehaviors are available (documentation/hives.md). It is
// a signed, named selection: the faces its arrival needs (IoC class names, which
// survive every rebuild), the package paths turned off, and a tier per face.
// This file is the pure half — parse a hive document, resolve it against a
// package's class index. It reads no store and loads nothing; the loader asks
// it which bees run now, which wait for idle, and which stay passive.

import { classOfKey, resolveArrival, type BeeClass } from './arrival-plan.js'

/** 0 = before first paint · 1 = after it, at idle · 2 = only when woken. */
export type HiveTier = 0 | 1 | 2

export type Hive = {
  readonly name: string
  /** The package root the hive was cut from. */
  readonly package: string
  /** The core surface the hive expects. */
  readonly core: string
  readonly arrival: readonly string[]
  readonly off: readonly string[]
  readonly tiers: Readonly<Record<string, HiveTier>>
  /** The highest tier loaded eagerly: 0 sparsest, 2 everything. */
  readonly depth: HiveTier
}

export const DEFAULT_HIVE_DEPTH: HiveTier = 1

const SIG = /^[a-f0-9]{64}$/

const tierOf = (value: unknown): HiveTier | null =>
  value === 0 || value === 1 || value === 2 ? value : null

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(v => String(v ?? '').trim()).filter(Boolean) : []

/** A hive document, or null when it is not one. A hive that names no face is
 *  no hive: the package loads as it always has. */
export const parseHive = (raw: unknown): Hive | null => {
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as Record<string, unknown>
  const arrival = strings(doc['arrival']).map(classOfKey)
  if (!arrival.length) return null
  const pkg = String(doc['package'] ?? '').toLowerCase()
  const core = String(doc['core'] ?? '').toLowerCase()
  if (!SIG.test(pkg) || !SIG.test(core)) return null

  const tiers: Record<string, HiveTier> = {}
  const given = doc['tiers']
  if (given && typeof given === 'object') {
    for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
      const tier = tierOf(value)
      if (tier !== null) tiers[classOfKey(key)] = tier
    }
  }
  return {
    name: String(doc['name'] ?? '').trim(),
    package: pkg,
    core,
    arrival,
    off: strings(doc['off']),
    tiers,
    depth: tierOf(doc['depth']) ?? DEFAULT_HIVE_DEPTH,
  }
}

/** The hive this visit entered through, if its shell found one: a hive
 *  document, read before the runtime exists (the same hand-off as the arrival
 *  plan, `__hcArrival`). Bounded — a slow or absent hive is no hive. */
export const selectedHive = async (ms = 4000): Promise<Hive | null> => {
  const pending = (globalThis as { __hcHive?: Promise<unknown> | unknown }).__hcHive
  if (pending === undefined || pending === null) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  const value = await Promise.race([
    Promise.resolve(pending).catch(() => null),
    new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms) }),
  ])
  clearTimeout(timer)
  return parseHive(value)
}

export type HiveResolution = {
  /** Loaded before first paint. */
  readonly now: Set<string>
  /** Loaded after it, in idle batches. */
  readonly idle: Set<string>
  /** Held, not compiled; woken on demand. */
  readonly passive: Set<string>
  /** Faces the hive names that the package does not carry. */
  readonly missing: string[]
}

/** What a hive makes of a package. `excluded` is the bees under the paths the
 *  hive turns off (the caller owns path knowledge); `critical` always runs now,
 *  because without them there is no hive to turn anything back on from.
 *
 *  A bee a face needs takes the earliest tier of any face that reaches it — a
 *  tier-0 bee never waits on a tier-1 dependency. A bee no face reaches is
 *  tier 2, so it loads eagerly only at depth 2. */
export const resolveHive = (
  hive: Hive,
  classes: ReadonlyMap<string, BeeClass>,
  packageBees: ReadonlySet<string>,
  excluded: ReadonlySet<string> = new Set(),
  critical: ReadonlySet<string> = new Set(),
): HiveResolution => {
  const tier = new Map<string, HiveTier>()
  const missing: string[] = []
  const lower = (sig: string, to: HiveTier): void => {
    const held = tier.get(sig)
    if (held === undefined || to < held) tier.set(sig, to)
  }

  for (const face of hive.arrival) {
    const reached = resolveArrival([face], classes, packageBees)
    missing.push(...reached.missing)
    const faceTier = hive.tiers[face] ?? 0
    for (const sig of reached.bees) lower(sig, faceTier)
  }
  for (const sig of critical) if (packageBees.has(sig)) lower(sig, 0)

  const now = new Set<string>()
  const idle = new Set<string>()
  const passive = new Set<string>()
  for (const sig of packageBees) {
    if (excluded.has(sig) && !critical.has(sig)) continue
    const t = tier.get(sig) ?? 2
    if (t === 0) now.add(sig)
    else if (t <= hive.depth) idle.add(sig)
    else passive.add(sig)
  }
  return { now, idle, passive, missing: [...new Set(missing)] }
}

/** PHASE 2 — the arrival a hive makes, in the loader's terms: the bees that
 *  load now (the rest stay passive and wake as any arrival's do). Idle loading
 *  is not built yet, so every tier above 0 waits passive here. Depth 2 is
 *  today's behaviour — everything loads — so it makes no arrival. */
export const hiveArrival = (
  hive: Hive,
  classes: ReadonlyMap<string, BeeClass>,
  packageBees: ReadonlySet<string>,
  critical: ReadonlySet<string> = new Set(),
): { bees: Set<string>; missing: string[] } | null => {
  if (hive.depth >= 2) return null
  const { now, missing } = resolveHive({ ...hive, depth: 0 }, classes, packageBees, new Set(), critical)
  return { bees: now, missing }
}
