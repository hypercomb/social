// hypercomb-shared/ui/features-viewer/feature-staging.ts
//
// Benign, hive-local staging for the "show features" panel. Turning a
// feature on in the panel does NOT activate anything — it only records the
// feature here. When the participant later opens the installer, portal-
// overlay reads this list and hands the staged branch signatures over so the
// matching nodes come PRE-TICKED. Nothing folds or runs until the installer
// is opened and accepted (Done) as usual.
//
// Participant-local decoration: localStorage only, never in any lineage —
// same principle as viewport / clipboard / domain visibility. Keyed by a
// stable feature key so re-staging the same feature is idempotent.

const STORAGE_KEY = 'hc:feature-staging'
const SIG_RE = /^[a-f0-9]{64}$/

export interface StagedFeature {
  /** Stable identity: the branch sig when known, else `${cell}::${kind}`. */
  key: string
  /** Installer-resolvable branch signature, when a peer offers this tile.
   *  Only sig-bearing entries are handed to the installer for pre-tick. */
  sig?: string
  cell: string
  kind: string
  view: string
  label: string
}

/** Compose the stable key for a feature on a tile. */
export function featureKey(opts: { sig?: string; cell: string; kind: string }): string {
  const sig = (opts.sig ?? '').trim().toLowerCase()
  if (SIG_RE.test(sig)) return sig
  return `${opts.cell}::${opts.kind}`
}

export function loadStaged(): StagedFeature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr
      .filter((e: unknown): e is StagedFeature =>
        !!e && typeof (e as StagedFeature).key === 'string'
        && typeof (e as StagedFeature).cell === 'string'
        && typeof (e as StagedFeature).kind === 'string')
      .map((e: StagedFeature) => ({
        key: e.key,
        cell: e.cell,
        kind: e.kind,
        view: typeof e.view === 'string' ? e.view : '',
        label: typeof e.label === 'string' ? e.label : '',
        ...(typeof e.sig === 'string' && SIG_RE.test(e.sig.toLowerCase()) ? { sig: e.sig.toLowerCase() } : {}),
      }))
  } catch {
    return []
  }
}

function save(entries: StagedFeature[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)) } catch { /* quota / no storage — staging degrades to in-session only */ }
}

export function isStaged(key: string): boolean {
  return loadStaged().some(e => e.key === key)
}

/** Flip a feature's staged state. Returns the new state (true = now staged). */
export function toggleStaged(feature: StagedFeature): boolean {
  const list = loadStaged()
  const idx = list.findIndex(e => e.key === feature.key)
  if (idx >= 0) {
    list.splice(idx, 1)
    save(list)
    return false
  }
  list.push(feature)
  save(list)
  return true
}

export function clearStaged(): void {
  save([])
}

/** Every staged branch signature — what portal-overlay hands the installer
 *  to pre-tick. Lower-cased, de-duped, only valid 64-hex sigs. */
export function stagedSigs(): string[] {
  const out = new Set<string>()
  for (const e of loadStaged()) {
    const sig = (e.sig ?? '').trim().toLowerCase()
    if (SIG_RE.test(sig)) out.add(sig)
  }
  return [...out]
}
