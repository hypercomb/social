// preferences/mobile-pheromones.ts
//
// The mobile pheromone vocabulary — shared constants so the gate
// (show-cell), the vocabulary depositors (auto-deposit + /mobile sweep),
// the VisualBeeRegistry query, and the MobileModeService all agree on the
// exact strings. See documentation/mobile-experience-plan.md §4.
//
// Pure module: NO side effects, NO registration. Safe to import from any
// tier. There are exactly TWO tags in the `mobile:` namespace — do not mint
// more here without updating the plan.

/**
 * The one gate tag. A cell carrying this `kind:'tag'` decoration renders on
 * mobile; a cell without it (and without a marked descendant) is excluded
 * from the render walk BEFORE any resource fetch. Colon-namespaced per the
 * tag convention; `mobile:` is a capability axis, distinct from domain
 * vocabularies like `jwize.com:*`.
 */
export const MOBILE_FRIENDLY = 'mobile:friendly'

/**
 * The negation / anti-clobber tag. Deposited when a human removes
 * `MOBILE_FRIENDLY`; every automatic route (auto-deposit AND the sweep)
 * skips any cell carrying it, permanently. The gate treats a held cell as
 * not-friendly. Mirrors the `jwize.com:hold` meaning-loop precedent.
 */
export const MOBILE_HOLD = 'mobile:hold'

/** Behaviour capability pheromones. Content tiles are platform-neutral; these
 * marks divide executable/view behaviour between shells. Every visual-bee
 * registration declares at least one, and universal behaviour declares both. */
export const PLATFORM_MOBILE = 'platform:mobile'
export const PLATFORM_DESKTOP = 'platform:desktop'

/**
 * localStorage key for the manual mobile-mode override written by
 * `/mobile on|off`. Values: `'on'` | `'off'`. Absent = auto-detect.
 */
export const MOBILE_MODE_KEY = 'hc:mobile-mode'

/**
 * localStorage key for participant-local behavior-pheromone overrides,
 * keyed by the registration's stable `view` name (NOT module signature).
 * Shape: `{ [view]: { add?: string[]; remove?: string[] } }`. The effective
 * set is (declared ∪ add) − remove — see VisualBeeRegistry.withPheromone.
 */
export const BEHAVIOR_PHEROMONES_KEY = 'hc:behavior-pheromones'

/** IoC key for the MobileModeService singleton. */
export const MOBILE_MODE_IOC_KEY = '@diamondcoreprocessor.com/MobileMode'

/**
 * Pool-of-meaning for the participant-local registry of designated mobile
 * hive roots — the "mobile signature pool". Holds one content-addressed JSON
 * doc `{ roots: string[] }` of location signatures (`sign([<hive-name>])`),
 * so the mobile home can enumerate / prefer mobile hives without walking, and
 * a participant can curate which hives (including adopted ones they don't own)
 * appear on their mobile home WITHOUT editing the hive's own tags.
 *
 * The colon is load-bearing: pool meanings MUST carry one so the address can
 * never collide with a top-level hive named `mobile` (doctrine — see
 * documentation/known-location-pools.md). Deriving it via
 * `Store.poolSignature` registers it in the pool registry.
 *
 * Note the DIVISION OF LABOUR: the per-tile `mobile:friendly` tag is the
 * authoritative, travels-with-the-hive mechanism for "what shows in mobile"
 * (the gate reads it). This pool is a participant-local INDEX/curation layer
 * on top — never the source of truth, so it can never drift a hive's own
 * designation.
 */
export const MOBILE_ROOTS_POOL = 'mobile:roots'

/** EffectBus channel that carries `{ active: boolean }` on mode changes.
 *  Last-value-replayed, so late subscribers get the current state. */
export const MOBILE_MODE_EFFECT = 'mobile:mode'
