// Shell-owned fresh-install seed for the behavior roster.
//
// Only the installer knows that a hive is genuinely new. Keeping this tiny
// write here lets the production web shell establish that initial state
// without statically importing an Essentials module (which it loads from
// OPFS at runtime). The Essentials behavior-enablement lens deliberately
// agrees with these storage keys by contract.

const GLOBAL_ON_KEY = 'hc:behavior-global-on'
const SEEDED_COHORTS_KEY = 'hc:behavior-seeded'

/** Start a brand-new hive with every optional behavior dark. */
export function seedDarkOnFreshInstall(): boolean {
  try {
    if (localStorage.getItem(GLOBAL_ON_KEY) != null) return false
    localStorage.setItem(GLOBAL_ON_KEY, '[]')
    localStorage.setItem(SEEDED_COHORTS_KEY, JSON.stringify(['*']))
  } catch {
    return false
  }
  return true
}
