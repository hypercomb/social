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

import { HOST_IOC_KEY, type HostProvider } from '@hypercomb/core'

const SIG_RE = /^[a-f0-9]{64}$/

/** The projection a host publishes, preferred over the manifest it is rendered
 *  from (documentation/host-packages-pool.md). Both are MUTABLE pointers, so
 *  both are fetched `no-store` — a sig-addressed URL is the only thing on this
 *  wire that may be cached. */
const PACKAGES_FILE = 'packages.json'
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
export const listHostPackages = async (zone: string): Promise<HostPackage[]> => {
  for (const base of hostBases(zone)) {
    const projected = await readProjection(zone, base)
    if (projected.length) return projected
    const declared = await readManifest(zone, base)
    if (declared.length) return declared
  }
  return []
}

/** `packages.json` — the projection. Ordered by the host, newest first, and
 *  carrying no inventory at all: what installs is derived from the sealed
 *  root at admission, so there is nothing here for a host to get wrong. */
const readProjection = async (zone: string, base: string): Promise<HostPackage[]> => {
  type Entry = {
    sig?: unknown
    label?: unknown
    at?: unknown
    layerCount?: unknown
    beeCount?: unknown
    beesBag?: unknown
    dependenciesBag?: unknown
  }
  let doc: { packages?: Entry[] } | null = null
  try {
    const res = await fetch(`${base}/${PACKAGES_FILE}`, { cache: 'no-store' })
    if (!res.ok) return []
    doc = await res.json() as { packages?: Entry[] }
  } catch { return [] }

  const entries = Array.isArray(doc?.packages) ? doc.packages : []
  return entries
    .filter(entry => SIG_RE.test(String(entry?.sig ?? '')))
    .map((entry): HostPackage => {
      const packageSig = String(entry.sig)
      return {
        zone,
        base,
        packageSig,
        label: String(entry.label ?? '').trim() || packageSig.slice(0, 12),
        at: String(entry.at ?? ''),
        // The projection's ORDER is the answer; there is no counter to rank by
        // and nothing to re-sort. Ranking data was per-host bookkeeping that
        // only ever existed to be sorted on — the list arrives sorted instead.
        generation: null,
        layers: [],
        bees: [],
        dependencies: [],
        layerCount: typeof entry.layerCount === 'number' ? entry.layerCount : undefined,
        beeCount: typeof entry.beeCount === 'number' ? entry.beeCount : undefined,
        beesBag: typeof entry.beesBag === 'string' ? entry.beesBag : undefined,
        dependenciesBag: typeof entry.dependenciesBag === 'string' ? entry.dependenciesBag : undefined,
      }
    })
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
