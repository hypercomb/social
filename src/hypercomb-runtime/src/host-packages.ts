// hypercomb-runtime/src/host-packages.ts
//
// WHAT A DOMAIN PUBLISHES. One question, asked the same way by everything that
// asks it.
//
// This lived in the shim, which was the right first home — the shim is the
// cold-boot shell, and asking a domain what it offers is the first thing it
// ever does. But the app needs the same answer for the same reason, and the
// app cannot import the shim. Two copies of "read a host's manifest" would
// have drifted on the first change to the manifest shape, and the two readers
// would then disagree about what a host publishes, which is the one thing they
// must never do.
//
// So it lives here, in runtime: the layer that owns io. Essentials cannot
// import it — a module imports core and nothing else, by doctrine — so this
// registers itself under the key CORE declares (`HOST_IOC_KEY`, host.types.ts)
// and a drone reaches it through IoC. Core holds the contract and stays free
// of io; runtime holds the fetch. Same split as I18nProvider.
//
// THE MANIFEST IS THE DOMAIN'S OWN VOICE — the one legitimate mutable pointer
// in the chain, because that is what a domain IS. Everything it names is
// content-addressed and verified on admission, so a hostile or hijacked host
// can offer you a different tree but never wrong bytes. Binding "current" to a
// publisher identity is the signed sentinel's job, not this file's.
//
// It reads nothing but public URLs and writes nothing anywhere.

import { HOST_IOC_KEY, registerPoolMeaning, type HostProvider } from '@hypercomb/core'
import { HOST_PACKAGES_MEANING, headIndex, markerIndices, parseMember, parsePoolListing, poolEntryName } from './host-pool.js'

const SIG_RE = /^[a-f0-9]{64}$/

/** The one document left, and only while hosts drain onto the pool. It is a
 *  MUTABLE pointer, so it is fetched `no-store`; a sig-addressed URL is the
 *  only thing on this wire that may be cached. */
const MANIFEST_FILE = 'manifest.json'

const isLoopback = (zone: string): boolean =>
  /^(localhost|127(?:\.\d+){3})(:\d{1,5})?$/i.test(zone)

/**
 * Every URL base worth asking, in order.
 *
 * Loopback hosts speak http; everything else https. A published site serves
 * the heap FLAT at its root, while a shell origin serves it under `/content`
 * — both are tried, and the manifest probe settles which. `content.<zone>` is
 * the relay/write face that a wildcard zone gets for free, so it is asked too.
 */
export const hostBases = (zone: string): string[] => {
  const scheme = isLoopback(zone) ? 'http' : 'https'
  return [`${scheme}://${zone}`, `${scheme}://content.${zone}`]
    .flatMap(base => [`${base}/content`, base])
}

export type HostPackage = {
  zone: string
  /** The base the manifest actually answered on — atoms hang off this one. */
  base: string
  packageSig: string
  label: string
  at: string
  generation: number | null
  layers: string[]
  bees: string[]
  dependencies: string[]
  beesBag?: string
  dependenciesBag?: string
  /** Display-only sizes. The projection states them (a picker cannot count an
   *  inventory it deliberately does not carry); the manifest fallback fills
   *  them in from the arrays it still ships. Neither can decide what installs
   *  — admission derives its own sets from the sealed root. */
  layerCount?: number
  beeCount?: number
}

type ManifestEntry = {
  bees?: string[]
  dependencies?: string[]
  layers?: string[]
  beesBag?: string
  dependenciesBag?: string
  label?: string
  at?: string
  generation?: number
}

/**
 * What one domain publishes, newest first.
 *
 * Returns an empty list for a domain that publishes nothing, that cannot be
 * reached, or that is not a host at all — the three are deliberately one
 * outcome here. A caller showing a list has the same thing to render in each
 * case, and the distinctions that matter (is it a host? is CORS set? does the
 * pin resolve?) belong to the host check, not to a picker.
 */
/** One entry, as it came off the wire. `at` is the transport's own
 *  `Last-Modified` — when this host received the package — not a date anybody
 *  published. Every static host answers with it; a host that does not simply
 *  yields rows without a date. */
type Fetched = { text: string; at: string }

const poolReader = (base: string, pool: string) =>
  async (index: number): Promise<Fetched | null> => {
    try {
      // DEFAULT CACHE MODE, deliberately: a pool entry is append-only, so
      // entry N is the same bytes forever and the HTTP cache is free
      // bandwidth. A 404 for an index nobody has shipped yet is not cached,
      // which is what keeps the head probe honest.
      const res = await fetch(`${base}/${pool}/${poolEntryName(index)}`)
      if (!res.ok) return null
      const text = await res.text()
      if (text.includes('<')) return null   // an SPA fallback is not an entry
      const modified = res.headers.get('last-modified')
      const at = modified ? new Date(modified).toISOString() : ''
      return { text, at: at === 'Invalid Date' ? '' : at }
    } catch { return null }
  }

const rowFrom = (zone: string, base: string, fetched: Fetched | null): HostPackage | null => {
  const member = parseMember(fetched?.text ?? null)
  if (!member) return null
  return {
    zone,
    base,
    packageSig: member.packageSig,
    label: member.label || member.packageSig.slice(0, 12),
    at: fetched?.at ?? '',
    generation: null,
    layers: [],
    bees: [],
    dependencies: [],
  }
}

type FoundPool = {
  base: string
  read: ReturnType<typeof poolReader>
  head: number
  /** Every index the host actually holds, when it could tell us in one
   *  request. Null from the probe path, which can find the head and nothing
   *  else. */
  indices: number[] | null
}

/**
 * WHERE A ZONE'S POOL ANSWERS.
 *
 * Ask the DIRECTORY first — `GET /<pool>/` — which is one request and returns
 * every entry name, so it serves browsing and booting alike. `no-store`,
 * because the members are immutable but the membership is not.
 *
 * A host whose relay predates the directory branch falls through to probing
 * indices. That path is the drain window: eighteen requests where the listing
 * costs one, and it can only find the head — never enumerate. Which is
 * precisely why a browse list needed a manifest for as long as probing was
 * the only mechanism.
 */
const findPool = async (zone: string): Promise<FoundPool | null> => {
  const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)

  for (const base of hostBases(zone)) {
    const read = poolReader(base, pool)

    let listing: string[] | null = null
    try {
      const res = await fetch(`${base}/${pool}/`, { cache: 'no-store' })
      listing = res.ok ? parsePoolListing(await res.text()) : null
    } catch { listing = null }

    if (listing) {
      const indices = markerIndices(listing)
      if (indices.length) return { base, read, head: indices[indices.length - 1]!, indices }
      continue   // the host holds this pool and it is empty — not a miss to retry elsewhere
    }

    const head = await headIndex(async i => (await read(i)) !== null)
    if (head >= 0) return { base, read, head, indices: null }
  }
  return null
}

/**
 * THE HEAD PACKAGE A DOMAIN PUBLISHES — the whole of discovery.
 *
 * The address is DERIVED (`sign('host:packages')`), never named, so nothing
 * had to be published saying where to look. The max index is the head, and
 * that one signature expands into everything else at admission.
 */
export const headPackage = async (zone: string): Promise<HostPackage | null> => {
  const found = await findPool(zone)
  if (!found) return (await readManifestAnywhere(zone))[0] ?? null
  return rowFrom(zone, found.base, await found.read(found.head))
}

/** How many rows a picker asks for before someone scrolls. Each is one
 *  request, so this is the difference between opening a panel and fetching a
 *  host's entire history — 179 entries and counting on the oldest host. */
const BROWSE_PAGE = 25

/**
 * WHAT A DOMAIN PUBLISHES, newest first — walked from the head, downward.
 *
 * There is no list to read: the pool IS the list, and a picker takes the page
 * it can show rather than the whole history. `before` continues the walk for a
 * caller that scrolls (the index below which to keep going).
 *
 * The three things a row needs now come from three places that cannot
 * disagree with each other: the signature and its branch mark from the
 * member's own bytes, the date from the transport, and the counts from
 * nowhere — a count was only ever decoration, and admission derives the real
 * inventory anyway.
 */
export const listHostPackages = async (
  zone: string,
  options: { limit?: number; before?: number } = {},
): Promise<HostPackage[]> => {
  const found = await findPool(zone)
  if (!found) return readManifestAnywhere(zone)

  const limit = Math.max(1, options.limit ?? BROWSE_PAGE)
  const ceiling = options.before !== undefined ? options.before - 1 : found.head
  if (ceiling < 0) return []

  // The listing knows exactly which indices exist; the probe path can only
  // assume they run contiguously to the head, which append-only makes true.
  const available = found.indices ?? Array.from({ length: found.head + 1 }, (_, i) => i)
  const indices = available.filter(i => i <= ceiling).sort((a, b) => b - a).slice(0, limit)

  const rows = await Promise.all(indices.map(async i => rowFrom(zone, found.base, await found.read(i))))
  return rows.filter((row): row is HostPackage => row !== null)
}

/** The drain window: a host that has not shipped the pool yet is still read
 *  through its manifest. Not a second dialect — a source that is going away. */
const readManifestAnywhere = async (zone: string): Promise<HostPackage[]> => {
  for (const base of hostBases(zone)) {
    const declared = await readManifest(zone, base)
    if (declared.length) return declared
  }
  return []
}

/** `manifest.json` — the drain-window fallback for hosts that have not shipped
 *  since the projection landed. Its inventory arrays are read for nothing but
 *  the display counts and the divergence warning: admission derives. */
const readManifest = async (zone: string, base: string): Promise<HostPackage[]> => {
  let manifest: { packages?: Record<string, ManifestEntry> } | null = null
  try {
    const res = await fetch(`${base}/${MANIFEST_FILE}`, { cache: 'no-store' })
    if (!res.ok) return []
    manifest = await res.json() as { packages?: Record<string, ManifestEntry> }
  } catch { return [] }

  const packages = Object.entries(manifest?.packages ?? {})
    .filter(([sig]) => SIG_RE.test(sig))
    .map(([packageSig, entry]): HostPackage => ({
      zone,
      base,
      packageSig,
      label: String(entry.label ?? '').trim() || packageSig.slice(0, 12),
      at: String(entry.at ?? ''),
      generation: typeof entry.generation === 'number' ? entry.generation : null,
      layers: entry.layers ?? [],
      bees: entry.bees ?? [],
      dependencies: entry.dependencies ?? [],
      layerCount: entry.layers?.length,
      beeCount: entry.bees?.length,
      beesBag: entry.beesBag,
      dependenciesBag: entry.dependenciesBag,
    }))

  // `generation` is the counter the build stamps; `at` breaks ties for
  // manifests old enough to predate it.
  packages.sort((a, b) => (b.generation ?? 0) - (a.generation ?? 0) || b.at.localeCompare(a.at))
  return packages
}

// ── the port ────────────────────────────────────────────────────────────────
// Registered under the key CORE declares, so a module that imports core and
// nothing else (which is every module, by doctrine) can still ask a domain what
// it publishes. Core holds the contract and does no io; the io is here.
const provider: HostProvider = {
  listPackages: listHostPackages,
  bases: hostBases,
}

try {
  ;(globalThis as { ioc?: { register?: (k: string, v: unknown) => void } })
    .ioc?.register?.(HOST_IOC_KEY, provider)
} catch { /* no ioc in this environment — direct importers still work */ }

export { provider as hostProvider }
