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
// ── THE ADDRESS OF AN OFFERING IS ITS SIGNATURE, NEVER ITS PATH ───────────
//
// This gate reads exactly ONE mark carrier: `sigMarksOf` — the marks the
// participant put on exact BYTES, in the `pheromones:content` pool.
//
// It used to read the location carrier too (`tagsForSegments`), and that was
// a false-evidence bug rather than a missing feature. A location is where a
// stranger's offering would LAND; it is not a description of it. Two things
// follow, and both were live:
//
//   A peer publishing a tile named `notes` into a page where the participant
//   already holds a `notes` tile was judged BY THE PARTICIPANT'S OWN TILE'S
//   MARKS. Mark yours `private` with `private` in your DROP set and the
//   stranger's unrelated tile vanished from the swarm; mark yours `cigars`
//   with a KEEP set and theirs was admitted having satisfied nothing.
//
//   Co-located same-name is not exotic — it is the ordinary case the tile
//   source's own `kind:name` dedup exists to resolve, and a REFERENCE tile is
//   named after its target by construction.
//
// A signature cannot collide that way: it names the bytes themselves, so a
// mark keyed by one is about the thing being offered no matter whose hive it
// came from or where it would sit. That is the only carrier admissible at
// intake, and dropping the other one is why `IntakeTarget` is now a signature
// and nothing else.
//
// ── two gates over one carrier ────────────────────────────────────────────
//
//   `allowsHere`  — sync. Reads `sigMarksKnown`, the in-memory record cache,
//                   and never awaits. For a render or a mid-gesture decision,
//                   where an OPFS read on every peer tile of every frame is
//                   not affordable. An unread signature answers "allow" and
//                   the read is kicked, so the next pass has an answer.
//   `allows`      — async. Awaits the record read. For a COMMIT, where the
//                   round trip is affordable and the answer is authoritative.
//
// That is `hide first, delete second`: the cheap gate suppresses what it
// already knows about, the authoritative gate refuses at admission.
//
// ── it changes nothing until somebody expresses an interest ───────────────
//
// With no KEEP interest and no DROP interest the registry filters nothing, so
// installing this gate is byte-for-byte the behaviour that shipped before it.
// That is deliberate and matches the polarity of the only intake filter that
// already exists (`SwarmFilterService`: empty selection = everyone shows).
//
// AND IT IS INERT ON DISK TOO, which is a separate claim and was the one that
// was false. A gate that answers "allow" but has already minted
// `sign('registry:interests')` and `sign('pheromones:content')` on the way to
// saying so has changed the hive of a participant who never used the feature —
// in a root that walkers, the collector and `/flatten` all enumerate. So:
// every read here opens its pool WITHOUT creating it, and a registry that
// filters nothing is short-circuited before any mark read happens at all.
//
// Full doctrine: documentation/intake-filter.md.

import { sigMarksKnown, sigMarksOf } from './pheromone-marks.js'

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
  /** Does this registry refuse ANYTHING? False on a participant who has named
   *  no interest, and then no mark read is worth performing — see `judge`. */
  filters?(): boolean
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

/**
 * IS THIS REGISTRY WORTH ASKING?
 *
 * A registry with no KEEP interest and no DROP interest cannot refuse
 * anything, so every mark read taken on its behalf is a read whose answer
 * cannot change the verdict — and, before `openPool` existed, a read that
 * minted a pool directory to prove it. Short-circuit.
 *
 * A registry that does not report (`filters` absent — an older build, or a
 * foreign implementation behind the same IoC key) is asked, which is the
 * conservative direction: paying for a read beats skipping a refusal.
 */
const filtering = (reg: RegistryLike): boolean => reg.filters?.() !== false

/** What the gate is deciding about. A SIGNATURE and nothing else — see the
 *  header: a path is where an offering would land, never a description of it,
 *  and only a content address survives crossing a hive boundary. */
export type IntakeTarget = {
  sig?: string
}

const SIG_RE = /^[0-9a-f]{64}$/i

/** Signatures whose record read has been kicked by the sync gate, so a miss
 *  costs one OPFS read ever rather than one per frame. Entries are never
 *  removed: the record cache behind `sigMarksKnown` is itself permanent and
 *  invalidated only by this participant's own writes. */
const kicked = new Set<string>()

/**
 * SYNCHRONOUS verdict from the marks already in hand.
 *
 * For render paths and mid-gesture decisions. Reads the in-memory record
 * cache and the registry's already-resolved sets — no promise, no OPFS.
 *
 * `true` when there is no registry, when the participant filters nothing, and
 * when this signature has never been read — all the same safe direction: a
 * filter that has not loaded, or has not yet seen the bytes, must not blank a
 * screen. The commit gate below is the one that waits.
 */
export const allowsHere = (target: IntakeTarget): boolean => {
  const reg = registry()
  if (!reg) return true
  // KICKED, NEVER AWAITED — this path is synchronous by contract.
  void warm(reg)
  if (!filtering(reg)) return true
  const sig = String(target.sig ?? '').toLowerCase()
  if (!SIG_RE.test(sig)) return reg.allows([])
  const known = sigMarksKnown(sig)
  if (known) return reg.allows(known)
  // NEVER READ. Allow, and kick the read so the NEXT pass can refuse. Peer
  // content re-renders on every relay arrival and every `synchronize`, so a
  // marked signature is suppressed within a frame or two of first sight —
  // which is what `hide first` can honestly promise when the evidence lives
  // on disk. The authoritative refusal is `allows`, at the commit.
  if (!kicked.has(sig)) { kicked.add(sig); void sigMarksOf(sig) }
  return true
}

/**
 * ASYNCHRONOUS verdict from the record read — authoritative.
 *
 * For commit paths: admitting a published-pool member, taking a peer's branch.
 * One OPFS read per signature (cached thereafter), which is why this must not
 * be called per frame.
 */
export const allows = async (target: IntakeTarget): Promise<boolean> => {
  const reg = registry()
  if (!reg) return true
  // AWAITED. A commit is the authoritative gate, so it must not race the load —
  // otherwise the first arrival of every session slips past a filter the
  // participant did set, and it would do so silently.
  await warm(reg)
  if (!filtering(reg)) return true
  const sig = String(target.sig ?? '').toLowerCase()
  return reg.allows(SIG_RE.test(sig) ? await sigMarksOf(sig) : [])
}

// The gate, reachable from OUTSIDE essentials — the same loose-IoC seam
// PheromoneMarks uses, so a shell surface can show WHY something was refused
// without importing a module.
window.ioc.register('@diamondcoreprocessor.com/IntakeFilter', { allows, allowsHere })
