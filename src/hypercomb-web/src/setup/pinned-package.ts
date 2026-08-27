// The deployment pin is the only mutable package-discovery edge. It contains
// one signature; every expandable field lives in the signed descriptor named
// by that signature and is rejected unless the bytes hash exactly.

export const BOOTSTRAP_PIN_PATH = '/content/bootstrap-pin.json'

const SIGNATURE = /^[a-f0-9]{64}$/

export type PinnedPackage = {
  version: 1
  packageSig: string
  acquisition: string
  bees: string[]
  dependencies: string[]
  layers: string[]
  platforms?: Record<string, string>
  beeDeps?: Record<string, string[]>
  dependenciesBag?: string
  beesBag?: string
  renderCriticalKeys?: string[]
  label?: string
  at?: string
  previous?: string | null
}

export type PinnedPackageResult =
  | { status: 'verified'; package: PinnedPackage; descriptorSig: string }
  | { status: 'absent' }
  | { status: 'invalid'; reason: string }

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const isSignature = (value: unknown): value is string =>
  typeof value === 'string' && SIGNATURE.test(value)

const signatures = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || !value.every(isSignature)) return null
  return [...value]
}

const optionalSignature = (value: unknown): string | undefined | null => {
  if (value === undefined) return undefined
  return isSignature(value) ? value : null
}

const parsePlatforms = (value: unknown): Record<string, string> | undefined | null => {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  if (!entries.every(([name, sig]) => name.length > 0 && isSignature(sig))) return null
  return Object.fromEntries(entries) as Record<string, string>
}

const parseBeeDeps = (value: unknown): Record<string, string[]> | undefined | null => {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries: Array<[string, string[]]> = []
  for (const [beeSig, rawDeps] of Object.entries(value)) {
    const deps = signatures(rawDeps)
    if (!isSignature(beeSig) || !deps) return null
    entries.push([beeSig, deps])
  }
  return Object.fromEntries(entries)
}

const parseStringArray = (value: unknown): string[] | undefined | null => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return null
  return [...value]
}

export const parsePinnedPackage = (value: unknown): PinnedPackage | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (source['version'] !== 1 || !isSignature(source['packageSig']) || !isSignature(source['acquisition'])) return null

  const bees = signatures(source['bees'])
  const dependencies = signatures(source['dependencies'])
  const layers = signatures(source['layers'])
  const platforms = parsePlatforms(source['platforms'])
  const beeDeps = parseBeeDeps(source['beeDeps'])
  const dependenciesBag = optionalSignature(source['dependenciesBag'])
  const beesBag = optionalSignature(source['beesBag'])
  const renderCriticalKeys = parseStringArray(source['renderCriticalKeys'])

  if (!bees || !dependencies || !layers || platforms === null || beeDeps === null ||
      dependenciesBag === null || beesBag === null || renderCriticalKeys === null) return null

  const optionalText = (field: 'label' | 'at'): string | undefined | null => {
    const raw = source[field]
    if (raw === undefined) return undefined
    return typeof raw === 'string' ? raw : null
  }
  const label = optionalText('label')
  const at = optionalText('at')
  const previous = source['previous'] === undefined
    ? undefined
    : source['previous'] === null || isSignature(source['previous'])
      ? source['previous']
      : false
  if (label === null || at === null || previous === false) return null

  return {
    version: 1,
    packageSig: source['packageSig'],
    acquisition: source['acquisition'],
    bees,
    dependencies,
    layers,
    ...(platforms === undefined ? {} : { platforms }),
    ...(beeDeps === undefined ? {} : { beeDeps }),
    ...(dependenciesBag === undefined ? {} : { dependenciesBag }),
    ...(beesBag === undefined ? {} : { beesBag }),
    ...(renderCriticalKeys === undefined ? {} : { renderCriticalKeys }),
    ...(label === undefined ? {} : { label }),
    ...(at === undefined ? {} : { at }),
    ...(previous === undefined ? {} : { previous }),
  }
}

const sha256Hex = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Resolve the current package through the deployment's one-signature pin.
 * Only a genuine 404/410 means "old deployment" and permits the caller's
 * legacy-manifest compatibility path. A present but malformed pin, a missing
 * descriptor, wrong bytes, or invalid descriptor schema fails closed.
 */
export const fetchPinnedPackage = async (
  fetcher: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<PinnedPackageResult> => {
  let pinResponse: Response
  try {
    pinResponse = await fetcher(BOOTSTRAP_PIN_PATH, { cache: 'no-store' })
  } catch {
    return { status: 'invalid', reason: 'pin fetch failed' }
  }
  if (pinResponse.status === 404 || pinResponse.status === 410) return { status: 'absent' }
  if (!pinResponse.ok) return { status: 'invalid', reason: `pin returned ${pinResponse.status}` }

  let pin: unknown
  try { pin = await pinResponse.json() } catch { return { status: 'invalid', reason: 'pin is not JSON' } }
  const descriptorSig = (pin as { version?: unknown; bootstrap?: unknown } | null)?.bootstrap
  if ((pin as { version?: unknown } | null)?.version !== 1 || !isSignature(descriptorSig)) {
    return { status: 'invalid', reason: 'pin does not name one descriptor signature' }
  }

  for (const path of [`/${descriptorSig}`, `/content/${descriptorSig}`]) {
    let response: Response
    try { response = await fetcher(path, { cache: 'no-store' }) } catch { continue }
    if (!response.ok) continue
    const bytes = await response.arrayBuffer()
    if (await sha256Hex(bytes) !== descriptorSig) continue
    let decoded: unknown
    try { decoded = JSON.parse(new TextDecoder().decode(bytes)) } catch {
      return { status: 'invalid', reason: 'verified descriptor is not JSON' }
    }
    const packageDescriptor = parsePinnedPackage(decoded)
    if (!packageDescriptor) return { status: 'invalid', reason: 'verified descriptor schema is invalid' }
    return { status: 'verified', package: packageDescriptor, descriptorSig }
  }

  return { status: 'invalid', reason: 'no host path returned the pinned bytes' }
}
