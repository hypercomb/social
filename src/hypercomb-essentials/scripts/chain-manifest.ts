// hypercomb-essentials/scripts/chain-manifest.ts
//
// Version chaining for the content manifest — the ONE implementation.
//
// build-module.ts deliberately emits a single-package manifest with a stable
// genesis `label` and `previous: null` (so identical rebuilds keep the file
// byte-identical). The VERSION — `generation` (monotonic counter), `previous`
// (the rootLayerSig this supersedes), `at` (deploy time) — is minted here, by
// whoever holds the remote/target manifest at ship time. These are SIDECAR
// discovery fields: they never affect a package's rootLayerSig, so naming or
// numbering a package never redefines it.
//
// This used to live only inside deploy-azure.ps1's merge phase, which meant
// revisions existed ONLY on the Azure path — the jwize/relay/DCP targets got
// a wholesale-replaced single-package manifest and DCP's revision list never
// had a chain to show. Now copy-to-dcp.ts chains every target through this
// module; deploy-azure.ps1 keeps its own equivalent merge for the Azure
// remote (its numbering is per-remote by construction).
//
// Semantics (ported from deploy-azure.ps1 Phase 1, two deliberate upgrades):
//   • fresh remote (no manifest / no packages) → mint v1 instead of shipping
//     an unminted genesis entry (the PS path left those for
//     correct-manifest-versions.ps1 to repair).
//   • identical re-deploy of an entry the remote holds UNMINTED → mint it in
//     place, so the head of the chain always carries a version.
// History entries beyond the head are never rewritten — retro-repair of a
// legacy chain stays correct-manifest-versions.ps1's job.

/** One `packages` entry. Sig arrays / bags / beeDeps ride through untouched. */
export interface PackageEntry {
  label?: string
  at?: string
  previous?: string | null
  generation?: number
  [key: string]: unknown
}

export interface ContentManifest {
  packages: Record<string, PackageEntry>
}

export interface ChainResult {
  manifest: ContentManifest
  /** The head entry's generation after chaining (0 = none could be minted). */
  generation: number
  /** True when this call minted a NEW generation (false = unchanged re-deploy). */
  minted: boolean
  /** The head entry's label, for logging. */
  label: string
}

export const generationOf = (entry: PackageEntry | null | undefined): number =>
  typeof entry?.generation === 'number' && Number.isFinite(entry.generation)
    ? entry.generation
    : 0

/** Highest `generation` across a manifest's packages (0 when none carry one). */
export const maxGeneration = (manifest: ContentManifest | null | undefined): number => {
  let max = 0
  for (const entry of Object.values(manifest?.packages ?? {})) {
    const g = generationOf(entry)
    if (g > max) max = g
  }
  return max
}

/** Ranking used to pick the AUTHORITY manifest among several targets: the
 *  deepest chain wins (highest generation, then most entries). Ties fall to
 *  caller order. Entry count can never realistically reach the multiplier, so
 *  generation always dominates. */
export const chainScore = (manifest: ContentManifest | null | undefined): number =>
  maxGeneration(manifest) * 1_000_000 + Object.keys(manifest?.packages ?? {}).length

/** deploy-azure.ps1's timestamp shape: local time, second precision. */
export const deployStamp = (now: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
    + `T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
}

/** The remote entry the new package supersedes: highest `generation`, ties and
 *  legacy no-generation entries fall back to highest `at` (ISO sorts). */
const predecessorOf = (remote: ContentManifest): string | null => {
  let bestSig: string | null = null
  let bestGen = -1
  let bestAt = ''
  for (const [sig, entry] of Object.entries(remote.packages)) {
    const g = generationOf(entry)
    const at = typeof entry?.at === 'string' ? entry.at : ''
    if (g > bestGen || (g === bestGen && at > bestAt)) {
      bestSig = sig
      bestGen = g
      bestAt = at
    }
  }
  return bestSig
}

/**
 * Chain the freshly built single-package manifest against the manifest a
 * target already holds. Returns the merged manifest with the current package
 * as the FIRST key (the runtime loader reads the first entry as current) and
 * every remote entry preserved after it, in remote order.
 */
export const chainManifest = (
  local: ContentManifest,
  remote: ContentManifest | null | undefined,
  now: Date,
): ChainResult => {
  const localSig = Object.keys(local.packages ?? {})[0]
  if (!localSig) return { manifest: local, generation: 0, minted: false, label: '' }
  // Local sig arrays always win — same rootLayerSig means same content, and a
  // fresh build's arrays are the ones proven against disk.
  const head: PackageEntry = { ...local.packages[localSig] }

  const remoteEntries = Object.entries(remote?.packages ?? {})
  const remoteHas = remoteEntries.length > 0
  const remoteForNew = remote?.packages?.[localSig]

  let minted = false
  if (remoteForNew) {
    // Identical content re-deploy: keep the version it already had — never
    // re-chain a package that hasn't changed.
    for (const name of ['label', 'at', 'previous', 'generation'] as const) {
      if (remoteForNew[name] !== undefined) (head as Record<string, unknown>)[name] = remoteForNew[name]
    }
    if (!generationOf(head)) {
      // The remote held it unminted (pre-chaining deploy) — mint in place.
      head.generation = maxGeneration(remote) || remoteEntries.length
      if (typeof head.at !== 'string' || !head.at) head.at = deployStamp(now)
      if (head.previous === undefined) head.previous = null
      minted = true
    }
  } else {
    // New content: mint the next version against the chain the remote holds.
    // When legacy entries carry no generation, count them so numbering
    // continues from the true chain length instead of restarting at 1.
    let maxGen = maxGeneration(remote)
    if (maxGen === 0 && remoteHas) maxGen = remoteEntries.length
    head.label = typeof head.label === 'string' && head.label ? head.label : 'genesis'
    head.at = deployStamp(now)
    head.previous = remoteHas ? predecessorOf(remote as ContentManifest) : null
    head.generation = maxGen + 1
    minted = true
  }

  const packages: Record<string, PackageEntry> = { [localSig]: head }
  for (const [sig, entry] of remoteEntries) {
    if (sig !== localSig) packages[sig] = entry
  }
  return {
    manifest: { packages },
    generation: generationOf(head),
    minted,
    label: typeof head.label === 'string' ? head.label : '',
  }
}
