// Render-critical bee scheduling.
//
// A critical-bee list is a hint, never an authority: the enabled bee
// inventory still comes from the signed layer closure.  These helpers keep
// both the signed-root hint and the learned warm-start cache fail-closed so a
// stale or partial hint can only select the ordinary cold path.
//
// WHICH BEES ARE CRITICAL IS THE BEE'S OWN MARK, NOT A LIST HERE. A bee that
// must evaluate before the first frame declares `readonly lane = 'first-paint'`
// (the build reads the same declaration to sign the root's `criticalBees`).
// Classification belongs on the thing classified, so this module asks the bee
// and keeps no class-name list and asserts no count: a fourth first-paint bee
// is one `lane` field, not an edit here and a failing exact-count check.
//
// What stays a list is READINESS, below: IoC keys of services (Settings,
// AxialService, LayoutService) that namespace bundles register in their
// constructors. They are not bee artifacts, so there is no bee to wear a mark,
// and the set is boot ordering — what must exist before paint — which nothing
// else in the package states.

/** The lane a bee declares when it must evaluate before the first frame. */
export const FIRST_PAINT_LANE = 'first-paint'

const SIGNATURE_RE = /^[a-f0-9]{64}$/
const LEARNED_CACHE_VERSION = 1

/** Every key must be registered before first paint. The packed ShowCell module
 *  explicitly registers its canonical key; accepting its constructor's
 *  development-only underscore spelling would declare readiness while every
 *  consumer still asks for the canonical service. */
export const RENDER_CRITICAL_IOC_GROUPS = Object.freeze([
  Object.freeze(['@diamondcoreprocessor.com/PixiHostWorker']),
  Object.freeze(['@diamondcoreprocessor.com/Settings']),
  Object.freeze(['@diamondcoreprocessor.com/AxialService']),
  Object.freeze(['@diamondcoreprocessor.com/LayoutService']),
  Object.freeze(['@diamondcoreprocessor.com/ShowCellDrone']),
  Object.freeze(['@diamondcoreprocessor.com/BackgroundDrone']),
] as const)

const canonicalSignature = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const canonical = value.trim().toLowerCase().replace(/\.js$/i, '')
  return SIGNATURE_RE.test(canonical) ? canonical : null
}

/** Validate an optional critical-bee hint against the authoritative enabled
 *  inventory. Any malformed, duplicate, or foreign entry rejects the whole
 *  hint; accepting a useful-looking subset would make a corrupt hint unsafe.
 *  How many bees are critical is the signed root's statement, not this
 *  module's: any non-empty hint that is entirely enabled is accepted. */
export const validateCriticalBeeHints = (
  value: unknown,
  enabled: Iterable<string>,
): string[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null

  const enabledSet = new Set<string>()
  for (const signature of enabled) {
    const canonical = canonicalSignature(signature)
    if (canonical) enabledSet.add(canonical)
  }

  const accepted = new Set<string>()
  for (const candidate of value) {
    const signature = canonicalSignature(candidate)
    if (!signature || accepted.has(signature) || !enabledSet.has(signature)) return null
    accepted.add(signature)
  }

  return [...accepted].sort()
}

export type CriticalIoc = {
  has?: (key: string) => boolean
  get?: (key: string) => unknown
}

export type RenderCriticalStatus = {
  ready: boolean
  /** Missing requirement groups. A group is satisfied when any key in it is
   *  registered. Returning groups preserves the ShowCell alternative. */
  missing: ReadonlyArray<ReadonlyArray<string>>
}

/** Report whether all render-critical IoC requirements are present. */
export const renderCriticalStatus = (ioc: CriticalIoc | null | undefined): RenderCriticalStatus => {
  const holds = (key: string): boolean => {
    try {
      if (ioc?.has?.(key)) return true
      return ioc?.get?.(key) !== undefined
    } catch {
      return false
    }
  }

  const missing = RENDER_CRITICAL_IOC_GROUPS
    .filter(group => !group.some(holds))
    .map(group => [...group])

  return { ready: missing.length === 0, missing }
}

export type CriticalBeeEntry = readonly [signature: string, bee: unknown]

/** The lane a bee declares, read off the instance. */
const laneOf = (bee: unknown): unknown => {
  if (!bee || typeof bee !== 'object') return undefined
  try { return (bee as { lane?: unknown }).lane } catch { return undefined }
}

/** Derive a learned fast-path list from evaluated bees: every one that DECLARES
 *  the first-paint lane. Nothing is named here — the bee says what it is. An
 *  entry with a malformed signature rejects the list (fail closed); a list
 *  naming no first-paint bee is no list. */
export const learnedCriticalBeeSigs = (
  entries: Iterable<CriticalBeeEntry>,
): string[] | null => {
  const sigs = new Set<string>()
  for (const [rawSignature, bee] of entries) {
    if (laneOf(bee) !== FIRST_PAINT_LANE) continue
    const signature = canonicalSignature(rawSignature)
    if (!signature) return null
    sigs.add(signature)
  }
  return sigs.size ? [...sigs].sort() : null
}

type LearnedCriticalBeeRecord = {
  version: number
  packageSig: string
  sigs: unknown
}

/** Parse the warm-start cache only when it belongs to the active package and
 *  every bee it names is still enabled. Legacy unbound arrays intentionally
 *  miss and take the safe cold path once. */
export const parseLearnedCriticalBeeSigs = (
  raw: unknown,
  packageSig: string,
  enabled: Iterable<string>,
): string[] | null => {
  const expectedPackage = canonicalSignature(packageSig)
  if (!expectedPackage || typeof raw !== 'string' || raw.length === 0) return null

  let parsed: LearnedCriticalBeeRecord
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    parsed = value as LearnedCriticalBeeRecord
  } catch {
    return null
  }

  if (parsed.version !== LEARNED_CACHE_VERSION) return null
  if (canonicalSignature(parsed.packageSig) !== expectedPackage) return null

  return validateCriticalBeeHints(parsed.sigs, enabled)
}

/** Serialize the learned list in a versioned, package-bound envelope. */
export const serializeLearnedCriticalBeeSigs = (
  packageSig: string,
  sigs: readonly string[],
): string => {
  const canonicalPackage = canonicalSignature(packageSig)
  const canonicalSigs = validateCriticalBeeHints(sigs, sigs)
  if (!canonicalPackage || !canonicalSigs) {
    throw new TypeError('learned critical bees require one package signature and unique bee signatures')
  }
  return JSON.stringify({
    version: LEARNED_CACHE_VERSION,
    packageSig: canonicalPackage,
    sigs: canonicalSigs,
  })
}
