// hypercomb-runtime/src/hive-author.ts
//
// AUTHORING A HIVE (documentation/hives.md, phase 4). A hive is cut from what a
// real session activated, checked against the package, and minted as a
// content-addressed document: canonical JSON, named by its own signature, so
// the entrance can verify the bytes it fetches (setup/hive-entrance.ts).
// Pure except `saveHive`, which writes the one resource through the store —
// durable state goes through the store, never beside it.

import { SignatureService } from '@hypercomb/core'
import { classOfKey, resolveArrival, type BeeClass } from './arrival-plan.js'
import { parseHive, type Hive } from './hive.js'

export type HiveDraft = {
  readonly name: string
  readonly package: string
  readonly core: string
  readonly arrival: readonly string[]
  readonly off: readonly string[]
  readonly tiers: Readonly<Record<string, 0 | 1 | 2>>
  readonly depth: 0 | 1 | 2
}

/** CUT A HIVE FROM OBSERVATION: the bees a session actually ran. The faces are
 *  the observed classes no other observed class reads — everything else is
 *  reached through them — so the hive names the entrances, not the whole set.
 *  A package with no such class (a cycle) names every observed class. */
export const cutHive = (input: {
  readonly observed: Iterable<string>
  readonly classes: ReadonlyMap<string, BeeClass>
  readonly packageBees: ReadonlySet<string>
  readonly name: string
  readonly package: string
  readonly core: string
  readonly depth?: 0 | 1 | 2
}): HiveDraft => {
  const seen = new Set(input.observed)
  const observed = [...input.classes.entries()].filter(([, cls]) => seen.has(cls.sig) && input.packageBees.has(cls.sig))
  const names = new Set(observed.map(([name]) => name))
  const read = new Set<string>()
  for (const [name, cls] of observed) {
    for (const need of cls.needs) {
      const target = classOfKey(need)
      if (target !== name && names.has(target)) read.add(target)
    }
  }
  const faces = [...names].filter(name => !read.has(name))
  return {
    name: input.name.trim(),
    package: input.package.toLowerCase(),
    core: input.core.toLowerCase(),
    arrival: (faces.length ? faces : [...names]).sort(),
    off: [],
    tiers: {},
    depth: input.depth ?? 1,
  }
}

export type HiveProblem =
  | { readonly severity: 'error'; readonly kind: 'not-a-hive' }
  | { readonly severity: 'error'; readonly kind: 'empty' }
  | { readonly severity: 'error'; readonly kind: 'missing-face'; readonly name: string }
  | { readonly severity: 'note'; readonly kind: 'unresolved-need'; readonly face: string; readonly need: string }

/** CHECK A HIVE AGAINST ITS PACKAGE before it is minted. Errors stop it: a face
 *  the package does not carry, or a hive that resolves to no bee. A need that
 *  names no class in the package is only a NOTE — it is often a shell service,
 *  and only the author can tell which. */
export const validateHive = (
  draft: HiveDraft | unknown,
  classes: ReadonlyMap<string, BeeClass>,
  packageBees: ReadonlySet<string>,
): HiveProblem[] => {
  const hive = parseHive(draft)
  if (!hive) return [{ severity: 'error', kind: 'not-a-hive' }]
  const problems: HiveProblem[] = []
  const { bees: reached, missing } = resolveArrival(hive.arrival, classes, packageBees)
  for (const name of missing) problems.push({ severity: 'error', kind: 'missing-face', name })
  if (!reached.size) problems.push({ severity: 'error', kind: 'empty' })

  // Needs of every bee the hive reaches, outside the package's classes.
  const noted = new Set<string>()
  for (const [name, cls] of classes) {
    if (!reached.has(cls.sig)) continue
    for (const need of cls.needs) {
      const target = classOfKey(need)
      const key = `${name}→${target}`
      if (classes.has(target) || noted.has(key)) continue
      noted.add(key)
      problems.push({ severity: 'note', kind: 'unresolved-need', face: name, need })
    }
  }
  return problems
}

/** Stable key order at every depth, so one hive is one signature. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [key, canonical(item)]))
  }
  return value
}

/** MINT: the canonical bytes of a hive and the signature that names them.
 *  Null when the draft is not a hive or has an error — nothing invalid is minted. */
export const mintHive = async (
  draft: HiveDraft,
  classes: ReadonlyMap<string, BeeClass>,
  packageBees: ReadonlySet<string>,
): Promise<{ sig: string; bytes: Uint8Array; problems: HiveProblem[] } | null> => {
  const problems = validateHive(draft, classes, packageBees)
  if (problems.some(problem => problem.severity === 'error')) return null
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(draft)))
  const sig = await SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  return { sig, bytes, problems }
}

type ResourceStore = { putResource(blob: Blob, options?: { emit?: boolean }): Promise<string> }

/** Keep a minted hive in the store — one resource, named by its signature.
 *  Throws if the store names it differently: the entrance verifies the hash, so
 *  a document stored under any other name would never load. */
export const saveHive = async (store: ResourceStore, minted: { sig: string; bytes: Uint8Array }): Promise<string> => {
  const stored = await store.putResource(new Blob([new Uint8Array(minted.bytes)], { type: 'application/json' }))
  if (stored !== minted.sig) throw new Error(`hive stored as ${stored}, expected ${minted.sig}`)
  return stored
}

export type { Hive }
