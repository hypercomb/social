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
// So it lives here, in runtime: the layer both the shim and shared can reach.
// Essentials cannot (it imports core and nothing else, by doctrine), which is
// why the app-side caller is the hosts PANEL rather than a drone.
//
// THE MANIFEST IS THE DOMAIN'S OWN VOICE — the one legitimate mutable pointer
// in the chain, because that is what a domain IS. Everything it names is
// content-addressed and verified on admission, so a hostile or hijacked host
// can offer you a different tree but never wrong bytes. Binding "current" to a
// publisher identity is the signed sentinel's job, not this file's.
//
// It reads nothing but public URLs and writes nothing anywhere.

const SIG_RE = /^[a-f0-9]{64}$/

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
  beeDeps: Record<string, string[]>
  beesBag?: string
  dependenciesBag?: string
}

type ManifestEntry = {
  bees?: string[]
  dependencies?: string[]
  layers?: string[]
  beeDeps?: Record<string, string[]>
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
    let manifest: { packages?: Record<string, ManifestEntry> } | null = null
    try {
      const res = await fetch(`${base}/manifest.json`, { cache: 'no-store' })
      if (!res.ok) continue
      manifest = await res.json() as { packages?: Record<string, ManifestEntry> }
    } catch { continue }

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
        beeDeps: entry.beeDeps ?? {},
        beesBag: entry.beesBag,
        dependenciesBag: entry.dependenciesBag,
      }))

    if (packages.length) {
      // `generation` is the counter the build stamps; `at` breaks ties for
      // manifests old enough to predate it.
      packages.sort((a, b) => (b.generation ?? 0) - (a.generation ?? 0) || b.at.localeCompare(a.at))
      return packages
    }
  }
  return []
}
