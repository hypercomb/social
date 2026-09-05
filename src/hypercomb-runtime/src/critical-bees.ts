// Render-critical bee scheduling.
//
// A critical-bee list is a hint, never an authority: the enabled bee
// inventory still comes from the signed layer closure.  These helpers keep
// both the signed-root hint and the learned warm-start cache fail-closed so a
// stale or partial hint can only select the ordinary cold path.

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

const LOADABLE_CRITICAL_CLASSES = Object.freeze([
  'PixiHostWorker',
  'ShowCellDrone',
  'BackgroundDrone',
] as const)

const canonicalSignature = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const canonical = value.trim().toLowerCase().replace(/\.js$/i, '')
  return SIGNATURE_RE.test(canonical) ? canonical : null
}

/** Reduce a fully-qualified IoC key, a legacy short key, or an esbuild
 *  collision-renamed class to the stable class name used for learning. */
export const normalizeCriticalClassName = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  const tail = value.trim().split('/').pop() ?? ''
  return tail.replace(/^@+/, '').replace(/^_+/, '')
}

/** Validate an optional critical-bee hint against the authoritative enabled
 *  inventory. Any malformed, duplicate, or foreign entry rejects the whole
 *  hint; accepting a useful-looking subset would make a corrupt hint unsafe. */
export const validateCriticalBeeHints = (
  value: unknown,
  enabled: Iterable<string>,
): string[] | null => {
  if (!Array.isArray(value) || value.length !== LOADABLE_CRITICAL_CLASSES.length) return null

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

/** Derive a learned fast-path list from evaluated bees. Partial learning is
 *  rejected: all three loadable render classes must be identified. */
export const learnedCriticalBeeSigs = (
  entries: Iterable<CriticalBeeEntry>,
): string[] | null => {
  const byClass = new Map<string, string>()
  const wanted = new Set<string>(LOADABLE_CRITICAL_CLASSES)

  for (const [rawSignature, bee] of entries) {
    let rawKey: unknown = typeof bee === 'string' ? bee : undefined
    if (bee && typeof bee === 'object') {
      try { rawKey = (bee as { iocKey?: unknown }).iocKey } catch { /* use constructor below */ }
      if (typeof rawKey !== 'string') {
        rawKey = (bee as { constructor?: { name?: unknown } }).constructor?.name
      }
    }
    const className = normalizeCriticalClassName(rawKey)
    if (!wanted.has(className)) continue

    const signature = canonicalSignature(rawSignature)
    if (!signature) return null
    const prior = byClass.get(className)
    if (prior && prior !== signature) return null
    byClass.set(className, signature)
  }

  if (LOADABLE_CRITICAL_CLASSES.some(className => !byClass.has(className))) return null
  return LOADABLE_CRITICAL_CLASSES.map(className => byClass.get(className)!).sort()
}

type LearnedCriticalBeeRecord = {
  version: number
  packageSig: string
  sigs: unknown
}

/** Parse the warm-start cache only when it belongs to the active package and
 *  still names exactly the three expected, enabled loadable bees. Legacy
 *  unbound arrays intentionally miss and take the safe cold path once. */
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

  const signatures = validateCriticalBeeHints(parsed.sigs, enabled)
  return signatures?.length === LOADABLE_CRITICAL_CLASSES.length ? signatures : null
}

/** Serialize the learned list in a versioned, package-bound envelope. */
export const serializeLearnedCriticalBeeSigs = (
  packageSig: string,
  sigs: readonly string[],
): string => {
  const canonicalPackage = canonicalSignature(packageSig)
  const canonicalSigs = validateCriticalBeeHints(sigs, sigs)
  if (!canonicalPackage || canonicalSigs?.length !== LOADABLE_CRITICAL_CLASSES.length) {
    throw new TypeError('learned critical bees require one package signature and three unique bee signatures')
  }
  return JSON.stringify({
    version: LEARNED_CACHE_VERSION,
    packageSig: canonicalPackage,
    sigs: canonicalSigs,
  })
}
