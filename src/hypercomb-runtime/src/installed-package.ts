// hypercomb-runtime/src/installed-package.ts
//
// THE BUILD THIS SHELL IS RUNNING — one stamp, one reader.
//
// Two paths make a package live: `acquire()` (a host's package, replicated and
// verified — the shim always, the web shell on a cold boot) and the web
// shell's bundled install (`upgradeFromBundled`, `/upgrade`, `?upgrade=1`).
// They used to leave DIFFERENT stamps, so "which build am I on" had two
// answers and a surface asking it could only guess. Both now write THIS key
// at the moment of activation, and everything that wants the answer reads it
// here. The value is the package signature — a build IS a signature; the
// generation number a host shows next to it is a label the manifest carries.

const SIG_RE = /^[a-f0-9]{64}$/

/** localStorage key holding the signature of the live package. Written only
 *  after the complete-or-absent gate — a package that did not fully resolve
 *  never becomes the answer here. */
export const INSTALLED_KEY = 'hc:shim:installed-package'

/** The stamp the web shell's bundled install left BEFORE both paths shared
 *  one. Read as a fallback only, never written: an install that predates the
 *  shared key is still a real install, and it must still be able to say which
 *  build it is. The first activation after this change writes INSTALLED_KEY
 *  and the fallback stops mattering. */
const LEGACY_BUNDLED_KEY = 'sentinel.sync-signature'

/** The live package's signature, or null when no install has ever
 *  activated on this shell (the dev shell imports modules directly and never
 *  stamps one). */
export const installedPackageSig = (): string | null => {
  try {
    for (const key of [INSTALLED_KEY, LEGACY_BUNDLED_KEY]) {
      const sig = localStorage.getItem(key)
      if (sig && SIG_RE.test(sig)) return sig
    }
    return null
  } catch { return null }
}

/** Stamp the live package. Every activation path calls this and nothing
 *  else writes the key. */
export const stampInstalledPackage = (packageSig: string): void => {
  if (!SIG_RE.test(packageSig)) return
  try { localStorage.setItem(INSTALLED_KEY, packageSig) } catch { /* storage unavailable */ }
}
