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
import { HOST_PACKAGES_MEANING, headPackageSig, poolEntryName } from './host-pool.js'

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
/**
 * THE HEAD PACKAGE A DOMAIN PUBLISHES — the whole of discovery.
 *
 * The address is DERIVED (`sign('host:packages')`), never named, so nothing
 * had to be published saying where to look. The max index in that pool is the
 * head, and that one signature expands into everything else at admission.
 *
 * Falls back to the manifest's newest entry for a host that has not shipped
 * the pool yet — the drain window, not a second dialect.
 */
export const headPackage = async (zone: string): Promise<HostPackage | null> => {
  const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)

  for (const base of hostBases(zone)) {
    // DEFAULT CACHE MODE, deliberately: a pool entry is append-only, so entry
    // N is the same bytes forever and the HTTP cache is free bandwidth. A 404
    // for an index nobody has shipped yet is not cached, which is what keeps
    // the head probe honest.
    const read = async (index: number): Promise<string | null> => {
      try {
        const res = await fetch(`${base}/${pool}/${poolEntryName(index)}`)
        if (!res.ok) return null
        const text = await res.text()
        return text.includes('<') ? null : text   // an SPA fallback is not an entry
      } catch { return null }
    }
    const packageSig = await headPackageSig(read)
    if (packageSig) {
      return {
        zone,
        base,
        packageSig,
        label: packageSig.slice(0, 12),
        at: '',
        generation: null,
        layers: [],
        bees: [],
        dependencies: [],
      }
    }
  }

  return (await listHostPackages(zone))[0] ?? null
}

/**
 * Everything a domain publishes, newest first — the BROWSE surface, still read
 * from the manifest.
 *
 * The pool answers "which package", which is what installing needs. It cannot
 * yet answer "and what is each one called", because a name is a mark and the
 * static-host form of marks is not built (documentation/host-packages-pool.md,
 * steps 2-3). Until it is, a picker reads the manifest and a cold boot does
 * not.
 */
export const listHostPackages = async (zone: string): Promise<HostPackage[]> => {
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
