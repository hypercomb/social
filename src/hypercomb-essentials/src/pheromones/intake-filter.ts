// pheromones/intake-filter.ts
//
// THE INTAKE GATE — what survives arriving from somebody else.
//
// Selection decides WHO you take from (the `community:hosts` pool, mesh
// consent, the swarm participant filter). This decides WHAT you keep of what
// they offered, and it asks one question: which marks is the participant
// watching for, and which do they never want. The sets live in the
// InterestRegistry; this is only the seam that applies them at intake.
//
// ── two shapes, because `marksOf` is a union of two very different reads ──
//
//   location / label   tagsForSegments · tagsForLabel — SYNCHRONOUS, O(1),
//                      an in-memory index built to be read per visible cell
//   signature          sigMarksOf — ASYNC, one OPFS read per signature
//
// So there are two gates here and they are not interchangeable:
//
//   `allowsHere`  — sync. For a render or a mid-gesture decision, where an
//                   await would put an OPFS read on every peer tile of every
//                   frame. Location carrier only.
//   `allows`      — async. For a COMMIT, where the full union is affordable
//                   and the answer is authoritative.
//
// A sync moment may only ask the location carrier; the async commit asks the
// union. That is not a limitation to route around — it is `hide first, delete
// second` again: the cheap gate suppresses, the authoritative gate refuses at
// admission. A mark that only the signature carries will not stop a tile being
// drawn, but it will stop it being taken.
//
// ── it changes nothing until somebody expresses an interest ───────────────
//
// With no KEEP interest and no DROP interest the registry allows everything,
// so installing this gate is byte-for-byte the behaviour that shipped before
// it. That is deliberate and matches the polarity of the only intake filter
// that already exists (`SwarmFilterService`: empty selection = everyone shows).
//
// Full doctrine: documentation/intake-filter.md.

import { tagsForLabel, tagsForSegments } from '../commands/decoration-kind-index.js'
import { marksOf } from './pheromone-marks.js'

const get = <T,>(key: string): T | undefined => (window as any).ioc?.get?.(key) as T | undefined

/** The loose-IoC seam to shared's registry. Essentials must never IMPORT from
 *  shared (the dependency direction is one-way), so the gate asks for the
 *  registry by key and degrades to "allow" when it is not there — a shell
 *  without the registry is not a shell that should be dropping content. */
type RegistryLike = {
  allows(marks: readonly string[]): boolean
  ensureLoaded?(): Promise<void>
  /** Did the load actually land? Distinguishes "read an empty registry" from
   *  "never got to read", which is what tells `warm` whether to retry. */
  isLoaded?(): boolean
}

const registry = (): RegistryLike | undefined =>
  get<RegistryLike>('@hypercomb.social/InterestRegistry')

/**
 * THE REGISTRY'S ONE-SHOT LOAD, kicked on first use.
 *
 * NOTHING ELSE IN THE TREE LOADS IT. The registry holds its KEEP/DROP sets in
 * memory and fills them in `ensureLoaded()`; with no caller those sets stay
 * empty for the life of the session, `allows()` answers `true` to everything,
 * and the filter ships INERT — present, tested, and never once refusing
 * anything. That is a worse failure than a wrong verdict, because nothing
 * reports it.
 *
 * The kick lives here rather than in a boot step because intake is the only
 * thing that needs the sets: the first arrival pays for the load, and a
 * participant who never receives anything never pays at all.
 *
 * PER REGISTRY INSTANCE, not per module. A module-level flag would leak across
 * a re-registered registry (shell re-init, and every test after the first),
 * leaving the second one permanently cold.
 */
const warmed = new WeakMap<RegistryLike, Promise<void>>()
const warm = (reg: RegistryLike): Promise<void> => {
  const started = warmed.get(reg)
  if (started) return started
  // Swallows: a filter that cannot load must not break intake, and the empty
  // sets it falls back to already allow everything.
  const attempt = Promise.resolve(reg.ensureLoaded?.()).then(() => { /* loaded */ }, () => { /* cold */ })
  warmed.set(reg, attempt)
  // A FAILED ATTEMPT IS NOT A LOAD, so it must not be remembered as one.
  //
  // The registry deliberately keeps its own retry open: `#load` returns early
  // without setting `#loaded` when the Store is not in IoC yet, so a later
  // `ensureLoaded()` tries again. Caching the ATTEMPT here closed that door —
  // the first intake that happened to beat Store registration latched a
  // resolved promise into this map and the registry was never asked again,
  // leaving the filter inert for the rest of the session. Dropping the entry
  // on failure hands the retry back to the registry, which is the only thing
  // that knows whether it actually loaded.
  void attempt.then(() => {
    if (reg.isLoaded?.() === false) warmed.delete(reg)
  })
  return attempt
}

/** What the gate is deciding about. Exactly `marksOf`'s target, so a caller
 *  that already builds one passes it straight through. */
export type IntakeTarget = {
  segments?: readonly string[]
  label?: string
  sig?: string
}

/**
 * SYNCHRONOUS verdict from the location carrier alone.
 *
 * For render paths and mid-gesture decisions. Reads the in-memory tag index
 * and the registry's already-resolved sets — no promise, no OPFS.
 *
 * `true` when there is no registry, which is the safe direction: a filter that
 * has not loaded must not blank the screen.
 */
export const allowsHere = (target: IntakeTarget): boolean => {
  const reg = registry()
  if (!reg) return true
  // KICKED, NEVER AWAITED — this path is synchronous by contract. Until the
  // load lands the sets are empty and everything is allowed, which is the only
  // safe direction for a render: a filter still loading must not blank a
  // screen. The commit gate below is the one that waits.
  void warm(reg)
  const marks = target.segments?.length
    ? tagsForSegments(target.segments)
    : target.label
      ? tagsForLabel(target.label)
      : []
  return reg.allows(marks)
}

/**
 * ASYNCHRONOUS verdict from the full union — location marks ∪ signature marks.
 *
 * For commit paths: admitting a published-pool member, taking a peer's branch.
 * One OPFS read per signature, which is why this must not be called per frame.
 */
export const allows = async (target: IntakeTarget): Promise<boolean> => {
  const reg = registry()
  if (!reg) return true
  // AWAITED. A commit is the authoritative gate, so it must not race the load —
  // otherwise the first arrival of every session slips past a filter the
  // participant did set, and it would do so silently.
  await warm(reg)
  return reg.allows(await marksOf(target))
}

// The gate, reachable from OUTSIDE essentials — the same loose-IoC seam
// PheromoneMarks uses, so a shell surface can show WHY something was refused
// without importing a module.
window.ioc.register('@diamondcoreprocessor.com/IntakeFilter', { allows, allowsHere })
