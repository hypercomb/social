// diamondcoreprocessor.com/sharing/behavior-enablement.ts
//
// The READ side of the behavior-ENABLEMENT lens (essentials) — the third
// lens beside hidden (feature-hidden.ts) and verified (feature-availability.ts).
//
// One switch, one meaning — and the model is OPT-IN: everything is off
// until it is lit in the pool. A NEW INSTALL STARTS DARK — the shell writes
// this list EMPTY at cold install (`seedDarkOnFreshInstall`, shell-side),
// which is what makes the census seed below a no-op there: nothing is lit
// until the participant lights it in the roster. `hc:behavior-global-on` is the truth once it
// exists: a kind it doesn't name is DORMANT everywhere — not rendered, not
// offered, not shared into a swarm — even though its decorations stay on
// their tiles untouched. The list is seeded ONCE on boot from the census
// minus the legacy off-list (`seedGlobalOnKinds`), so a hive that predates
// the opt-in model keeps exactly the lights it had; until the seed lands,
// the legacy `hc:behavior-global-off` polarity still answers. Nothing is
// migrated or rewritten in any lineage; this is pure read-time precedence:
//
//   local wake (ON, per tile/branch)  >  global OFF  >  per-tile hidden  >  ON
//
// Re-lighting a behavior globally wakes it wherever it lives; wake
// exceptions and hidden records are never touched by the global flip.
//
// Participant-local, localStorage only — never in any lineage (same principle
// as hide / clipboard / public-tiles). The WRITER (the roster switches + the
// per-tile "wake here" action) lives shell-side in
// `hypercomb-shared/ui/features-viewer/behavior-enablement.ts`; the two never
// import each other — they agree ONLY on the keys, the record shapes, and the
// `behavior:enablement-changed` EffectBus event, exactly as the hidden and
// verified lenses split their reader/writer pairs.
//
// A FIFTH dormancy source is BINDING — the authorial one. Some behaviours
// have exactly ONE meaning in a hive: the post-it that IS the /revolucion/
// meetup page means nothing on any other tile. Binding a kind to a tile's
// LOCATION SIGNATURE says so: the behaviour is awake at that signature (its
// subtree, and the layer the bound tile SITS ON — the tile renders there, so
// that layer's Beehaviors list names the behaviour rather than hiding it) and
// dormant everywhere else, so the panel stops offering it on tiles it can
// never belong to, and the row it does show is marked as belonging to that
// tile.
//
// The signature is `sha256(lineageKey(segments))` — HistoryService.sign, the
// LOCATION sig, not a content sig. That distinction is the whole reason this
// works: a content sig changes on every edit, so a binding made against one
// would break the first time the page is touched. A location sig is stable
// for as long as the tile is called what it is called, which is exactly the
// lifetime an author means by "this behaviour belongs to that tile".
//
// The sig is the record's IDENTITY (what the panel shows, what an export
// carries). The canonical path rides alongside it as the per-frame match key
// — dormancy is asked per tile per frame and must answer synchronously, while
// signing is async. The two can never disagree: the sig IS a pure hash of the
// canonical key the path is built from, so matching the path matches the sig.
//
// A FOURTH dormancy source is essentials-owned: `hc:withheld-at-roots`
// records, at adopt time, which decoration kinds the PUBLISHER withheld from
// the swarm (their own global-off list, broadcast on wire kind 30208). A
// withheld kind under an adopted root renders inert with the same dormancy
// answer — the tile arrived as the signed snapshot, the behavior just doesn't
// light up. It is overridable by a local wake like any other dormancy: waking
// it is the adopter's conscious choice, and the verification gate still
// applies on top.

import { EffectBus, normalizeCell } from '@hypercomb/core'

export const GLOBAL_ON_KEY = 'hc:behavior-global-on'
export const GLOBAL_OFF_KEY = 'hc:behavior-global-off'
export const WAKE_KEY = 'hc:behavior-wake'
export const WITHHELD_ROOTS_KEY = 'hc:withheld-at-roots'
export const BOUND_KEY = 'hc:behavior-bound'

/** Fired (by the shell writer AND the essentials adopt recorder) after any
 *  enablement write, so caches refresh and surfaces repaint at once. */
export const ENABLEMENT_CHANGED = 'behavior:enablement-changed'

/** Canonical absolute path — every segment normalized, same rule as
 *  tile-actions' tilePath so wake roots and withheld roots prefix-match
 *  descendants however the location arrived (raw nav vs descent). */
export function behaviorPath(segments: readonly string[]): string {
  const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean).map(s => normalizeCell(s) || s)
  return '/' + segs.join('/')
}

function readStringArray(key: string): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

/** One place a behaviour belongs to. `sig` is the identity — the tile's
 *  LOCATION signature, `sha256(lineageKey(segments))`, stable across every
 *  edit of that tile. `path` is the same location in canonical path form,
 *  carried so the per-frame dormancy read stays synchronous. `name` is the
 *  last-known label, for display only — never matched on. */
export interface BehaviorBinding {
  readonly sig: string
  readonly path: string
  readonly name?: string
}

function readBindingMap(): Record<string, BehaviorBinding[]> {
  try {
    const obj = JSON.parse(localStorage.getItem(BOUND_KEY) ?? '{}')
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
    const out: Record<string, BehaviorBinding[]> = {}
    for (const [kind, list] of Object.entries(obj as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      const bindings = list
        .filter((b): b is BehaviorBinding =>
          !!b && typeof b === 'object'
          && typeof (b as BehaviorBinding).sig === 'string'
          && typeof (b as BehaviorBinding).path === 'string')
        .map(b => ({ sig: b.sig, path: b.path, ...(b.name ? { name: b.name } : {}) }))
      if (bindings.length > 0) out[kind] = bindings
    }
    return out
  } catch { return {} }
}

function readPathMap(key: string): Record<string, string[]> {
  try {
    const obj = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
    const out: Record<string, string[]> = {}
    for (const [p, kinds] of Object.entries(obj as Record<string, unknown>)) {
      if (Array.isArray(kinds)) out[p] = kinds.filter((k): k is string => typeof k === 'string')
    }
    return out
  } catch { return {} }
}

// Live caches — visibleWhen runs per tile per frame, so reads must be sync
// and cheap. Invalidated on the change event (both sides emit it after every
// write) and on cross-tab `storage`.
let onCache: ReadonlySet<string> | null | undefined // undefined = unread; null = not yet seeded
let offCache: Set<string> | null = null
let wakeCache: Record<string, string[]> | null = null
let withheldCache: Record<string, string[]> | null = null
let boundCache: Record<string, BehaviorBinding[]> | null = null
let wired = false

function dropCaches(): void {
  onCache = undefined; offCache = null; wakeCache = null; withheldCache = null; boundCache = null
}

function wire(): void {
  if (wired) return
  wired = true
  EffectBus.on(ENABLEMENT_CHANGED, dropCaches)
  try {
    window.addEventListener('storage', (e) => {
      if (e.key === GLOBAL_ON_KEY || e.key === GLOBAL_OFF_KEY || e.key === WAKE_KEY
        || e.key === WITHHELD_ROOTS_KEY || e.key === BOUND_KEY) dropCaches()
    })
  } catch { /* non-window context */ }
}

/** The opt-in ON set — the kinds whose global light is lit. `null` until the
 *  seed has landed (legacy hives answer from the off-list meanwhile). */
export function readGlobalOnKinds(): ReadonlySet<string> | null {
  wire()
  if (onCache !== undefined) return onCache
  let raw: string | null = null
  try { raw = localStorage.getItem(GLOBAL_ON_KEY) } catch { /* non-window context */ }
  onCache = raw == null ? null : new Set(readStringArray(GLOBAL_ON_KEY))
  return onCache
}

/** Materialize the opt-in on-list ONCE: everything the census knows minus
 *  the legacy off-list, so nothing that renders today goes dark. From then
 *  on the on-list is the truth and a kind it doesn't name — a new module's
 *  behavior, a foreign decoration — arrives OFF until lit in the pool.
 *  No-op (false) once the list exists. */
export function seedGlobalOnKinds(census: readonly string[]): boolean {
  if (readGlobalOnKinds()) return false
  const off = new Set(readStringArray(GLOBAL_OFF_KEY))
  const list = [...new Set(census.map(k => String(k ?? '').trim()).filter(Boolean))]
    .filter(k => !off.has(k))
  try { localStorage.setItem(GLOBAL_ON_KEY, JSON.stringify(list)) } catch { return false }
  dropCaches()
  EffectBus.emit(ENABLEMENT_CHANGED, { seeded: list.length })
  return true
}

/** Cohorts whose lights have already been decided — so no cohort seed can
 *  ever run twice and undo a deliberate switch-off. The single entry `'*'`
 *  means THIS HIVE STARTED DARK: every cohort, past and future, counts as
 *  decided, because a hive that opened with nothing lit must never have a
 *  light appear behind the participant. */
export const SEEDED_COHORTS_KEY = 'hc:behavior-seeded'

const DARK_START = '*'

/** Light a COHORT of kinds once, on a hive that already has an on-list.
 *
 *  The census seed above answers "this hive predates the roster". This one
 *  answers the case after it: behaviour that ALREADY WORKED, hive-wide, and
 *  is only now being put behind a switch. Games are the first — they ran
 *  from `/roper` and the launcher long before the roster knew the word, so
 *  arriving OFF like a new module's kind would read as four games silently
 *  breaking, which is the one failure mode the roster keeps re-teaching.
 *
 *  Three no-ops, and they are the whole design:
 *   • no on-list yet — the census seed is about to cover these kinds anyway;
 *     record the cohort and leave.
 *   • cohort already recorded — the participant has had their say.
 *   • `'*'` recorded — a fresh install that opened dark stays dark.
 *
 *  Returns true only when it actually lit something. */
export function seedCohortOn(cohort: string, kinds: readonly string[]): boolean {
  wire()
  const name = String(cohort ?? '').trim()
  if (!name) return false
  const done = new Set(readStringArray(SEEDED_COHORTS_KEY))
  if (done.has(DARK_START) || done.has(name)) return false

  const record = (): void => {
    try { localStorage.setItem(SEEDED_COHORTS_KEY, JSON.stringify([...done, name])) }
    catch { /* private-browsing */ }
  }

  const on = readGlobalOnKinds()
  if (!on) { record(); return false }

  const fresh = [...new Set(kinds.map(k => String(k ?? '').trim()).filter(Boolean))]
    .filter(k => !on.has(k))
  record()
  if (fresh.length === 0) return false

  try { localStorage.setItem(GLOBAL_ON_KEY, JSON.stringify([...on, ...fresh])) }
  catch { return false }
  // The off-list mirror must lose them too, or the swarm would go on
  // broadcasting as withheld what is now lit (one switch, one meaning).
  const off = readStringArray(GLOBAL_OFF_KEY).filter(k => !fresh.includes(k))
  try { localStorage.setItem(GLOBAL_OFF_KEY, JSON.stringify(off)) } catch { /* private-browsing */ }
  dropCaches()
  EffectBus.emit(ENABLEMENT_CHANGED, { cohort: name, seeded: fresh.length })
  return true
}

/** The legacy/mirror off set — kinds explicitly turned off. Still the truth
 *  until the on-list is seeded; afterwards kept only because the swarm's
 *  withheld wire (kind 30208) needs an enumerable list. */
export function readGlobalOffKinds(): ReadonlySet<string> {
  wire()
  return offCache ??= new Set(readStringArray(GLOBAL_OFF_KEY))
}

export function isKindGloballyOff(kind: string): boolean {
  const on = readGlobalOnKinds()
  if (on) return !on.has(kind)
  return readGlobalOffKinds().has(kind)
}

/** True when a wake exception at `segments` (or any ancestor — a wake covers
 *  its subtree, so waking a site root wakes the whole scope) re-enables the
 *  kind despite a global/publisher off. */
export function isWokenAt(kind: string, segments: readonly string[]): boolean {
  wire()
  const wake = wakeCache ??= readPathMap(WAKE_KEY)
  const p = behaviorPath(segments)
  for (const [root, kinds] of Object.entries(wake)) {
    if (!kinds.includes(kind)) continue
    if (p === root || p.startsWith(root === '/' ? '/' : root + '/')) return true
  }
  return false
}

/** True when the publisher of an adopted root withheld this kind from the
 *  swarm — recorded at fold time from their 30208 broadcast. */
export function isWithheldByPublisherAt(kind: string, segments: readonly string[]): boolean {
  wire()
  const withheld = withheldCache ??= readPathMap(WITHHELD_ROOTS_KEY)
  const p = behaviorPath(segments)
  for (const [root, kinds] of Object.entries(withheld)) {
    if (!kinds.includes(kind)) continue
    if (p === root || p.startsWith(root === '/' ? '/' : root + '/')) return true
  }
  return false
}

/** Every place a kind is bound to, empty when it is bound nowhere (the
 *  default — a behaviour with no bindings is hive-wide, as before). */
export function bindingsFor(kind: string): readonly BehaviorBinding[] {
  wire()
  return (boundCache ??= readBindingMap())[kind] ?? []
}

/** True when this kind is bound to at least one tile — i.e. it has become a
 *  behaviour that belongs somewhere in particular. */
export function isBoundKind(kind: string): boolean {
  return bindingsFor(kind).length > 0
}

/** The layer a bound tile SITS ON — its parent path (`/a/b` → `/a`,
 *  `/x` → `/`, the hive root). */
function layerOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}

/** The binding covering `segments` — the bound tile itself or any ancestor
 *  (a binding covers its subtree exactly as a wake does), and the LAYER the
 *  bound tile sits on: the tile renders there, so that is where its row must
 *  show — asked last, so a binding you are standing inside always wins over
 *  one merely sitting beside you. `undefined` when the kind is unbound, or
 *  bound only elsewhere. */
export function bindingAt(kind: string, segments: readonly string[]): BehaviorBinding | undefined {
  const bindings = bindingsFor(kind)
  if (bindings.length === 0) return undefined
  const p = behaviorPath(segments)
  return bindings.find(b =>
    p === b.path || p.startsWith(b.path === '/' ? '/' : b.path + '/'))
    ?? bindings.find(b => b.path !== '/' && p === layerOf(b.path))
}

/** True when the kind belongs to some OTHER tile than this one — bound, but
 *  no binding reaches here. This is what makes a one-tile behaviour vanish
 *  from every tile it can never belong to. */
export function isBoundElsewhere(kind: string, segments: readonly string[]): boolean {
  return isBoundKind(kind) && !bindingAt(kind, segments)
}

/** Bound elsewhere AND not woken here — the answer a surface wants when it is
 *  deciding whether to OFFER a behaviour, rather than asking the full dormancy
 *  question. `isBehaviorDormant` short-circuits on the wake before it ever
 *  reaches the binding; a caller that tests bindings on their own must apply
 *  the same escape hatch itself, or a wake would light up an applied row while
 *  the offer beside it stayed withdrawn. */
export function isWithdrawnByBinding(kind: string, segments: readonly string[]): boolean {
  return isBoundElsewhere(kind, segments) && !isWokenAt(kind, segments)
}

/** THE dormancy answer every activation surface asks — icons, view toggles,
 *  panel rows, launchers. Dormant = (globally off OR publisher-withheld here
 *  OR bound to another tile) AND not locally woken. Per-tile hidden stays a
 *  separate, narrower lens (feature-hidden.ts) consulted after this one.
 *
 *  Wake still outranks binding: waking a bound behaviour somewhere else is a
 *  deliberate "I want it here anyway", and every dormancy source in this lens
 *  is overridable the same way — one escape hatch, not one per source. */
export function isBehaviorDormant(kind: string, segments: readonly string[]): boolean {
  if (!kind) return false
  if (isWokenAt(kind, segments)) return false
  return isKindGloballyOff(kind)
    || isWithheldByPublisherAt(kind, segments)
    || isBoundElsewhere(kind, segments)
}

/** What the swarm broadcasts as withheld (wire kind 30208): exactly the
 *  global-off list. One switch, one meaning — what's off for you is off for
 *  the swarm. */
export function withheldForShare(): string[] {
  return [...readGlobalOffKinds()]
}

/** Essentials-side writer for the adopt path ONLY: record the publisher's
 *  withheld kinds at the adopted root. Empty `kinds` clears the record. */
export function recordWithheldAtRoot(segments: readonly string[], kinds: readonly string[]): void {
  wire()
  const map = readPathMap(WITHHELD_ROOTS_KEY)
  const p = behaviorPath(segments)
  if (kinds.length > 0) map[p] = [...new Set(kinds)]
  else delete map[p]
  try { localStorage.setItem(WITHHELD_ROOTS_KEY, JSON.stringify(map)) } catch { /* private-browsing */ }
  withheldCache = null
  EffectBus.emit(ENABLEMENT_CHANGED, { root: p })
}

function writeBindingMap(map: Record<string, BehaviorBinding[]>): void {
  try { localStorage.setItem(BOUND_KEY, JSON.stringify(map)) } catch { /* private-browsing */ }
  boundCache = null
}

/** Bind a kind to a tile — the authorial write, essentials-side because the
 *  author performs it from the command line (`/behavior bind`), the same way
 *  the adopt path owns `recordWithheldAtRoot`. Re-binding the SAME location
 *  refreshes the display name; binding a second location adds it, so a
 *  behaviour may belong to a few tiles without belonging to all of them. */
export function bindBehaviorTo(kind: string, binding: BehaviorBinding): void {
  wire()
  const k = String(kind ?? '').trim()
  if (!k || !binding?.sig || !binding?.path) return
  const map = readBindingMap()
  const list = (map[k] ?? []).filter(b => b.sig !== binding.sig)
  map[k] = [...list, {
    sig: binding.sig,
    path: binding.path,
    ...(binding.name ? { name: binding.name } : {}),
  }]
  writeBindingMap(map)
  EffectBus.emit(ENABLEMENT_CHANGED, { kind: k, boundTo: binding.sig })
}

/** Release a binding. `sig` omitted releases EVERY binding for the kind — the
 *  behaviour goes back to belonging everywhere, which is the unbound default. */
export function unbindBehavior(kind: string, sig?: string): boolean {
  wire()
  const k = String(kind ?? '').trim()
  if (!k) return false
  const map = readBindingMap()
  const list = map[k] ?? []
  if (list.length === 0) return false
  const next = sig ? list.filter(b => b.sig !== sig) : []
  if (next.length === list.length) return false
  if (next.length > 0) map[k] = next
  else delete map[k]
  writeBindingMap(map)
  EffectBus.emit(ENABLEMENT_CHANGED, { kind: k, unbound: sig ?? 'all' })
  return true
}

/** Every bound kind, for the roster's "belongs to" column. */
export function allBindings(): Readonly<Record<string, readonly BehaviorBinding[]>> {
  wire()
  return boundCache ??= readBindingMap()
}
