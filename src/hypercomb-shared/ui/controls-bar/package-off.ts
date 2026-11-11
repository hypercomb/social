// hypercomb-shared/ui/controls-bar/package-off.ts
//
// A LAUNCHER GOES WITH ITS PACKAGE (jwize, 2026-11-11: "I removed comfy
// refreshed and still it was showing"). The rail's launchers are shell chrome,
// so turning a package off in the hosts window unloaded its bees and left its
// button behind. A launcher that names a word is hidden while a package of
// that name is off.
//
// ONLY ON POSITIVE EVIDENCE: the hosts window's own off list (the install
// port's `offUnits`) names the package. A word with no package of its name,
// a shell with no install port, or anything that throws, hides nothing — a
// missing answer must never take a button away. A shell that runs its working
// tree ignores the off list (every package is compiled in), and so does this.

const DEV_SOURCE_CATALOG_KEY = '@hypercomb.social/DevSourceCatalog'
const INSTALL_KEY = '@hypercomb.social/Install'

type IocLike = { get?: (key: string) => unknown }

/** Is a package named for this word turned off here? */
export function packageIsOff(
  word: string,
  ioc: IocLike | undefined = (globalThis as { ioc?: IocLike }).ioc,
): boolean {
  try {
    if (ioc?.get?.(DEV_SOURCE_CATALOG_KEY)) return false
    const install = ioc?.get?.(INSTALL_KEY) as { offUnits?: () => Iterable<string> } | undefined
    const wanted = String(word ?? '').trim().toLowerCase()
    if (!wanted || !install?.offUnits) return false
    for (const path of install.offUnits()) {
      const unit = String(path).toLowerCase()
      if (unit === wanted || unit.endsWith(`/${wanted}`)) return true
    }
    return false
  } catch { return false }
}
