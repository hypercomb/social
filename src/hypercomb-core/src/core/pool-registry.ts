// core/pool-registry.ts
//
// THE POOL ADDRESS REGISTRY — which root directories are pools of meaning
// rather than lineage sigbags.
//
// WHY THIS EXISTS. Pools and lineage sigbags share ONE flat OPFS root
// namespace, and the root is an UNTAGGED UNION of the two:
//
//   pool address = sign(meaning)                = sha256(meaning)
//   bag address  = sign(lineageKey(segments))   = sha256(<slug>) for a
//                                                 single-segment location
//
// `lineageKey` preserves letters and digits, so for a BARE-WORD meaning the
// two preimages are byte-identical and the addresses ARE the same directory.
// Nothing on disk distinguishes them. Any code that walks the root and
// assumes "sig-named dir = lineage bag" will treat a pool as a bag, and any
// code that prunes a bag will destroy the pool's members.
//
// WHY A DENYLIST CANNOT WORK ALONE. A fixed list of meanings goes stale the
// moment any module mints a new pool — and modules are the whole point of
// the architecture. So this registry is BOTH:
//
//   1. SEEDED with the complete census of meanings live in the tree today
//      (so it is correct on the very first call, before any pool is opened),
//      and
//   2. SELF-EXTENDING — every `poolSignature(meaning)` derivation anywhere
//      registers its meaning here, so a pool minted by a module that this
//      file has never heard of still identifies itself the first time it is
//      addressed.
//
// COLLISION RULE FOR NEW MEANINGS: give the meaning a COLON (`websites:menu`,
// `usage:dwell`). `lineageKey` folds every non-letter/number to `-`, so a
// location can never produce a colon and a colon-carrying meaning is
// collision-proof by construction. The doctrine ratchet in `doctrine.spec.ts`
// freezes the bare-word set below — it may only shrink, never grow.

import { SignatureService } from './signature.service.js'

/**
 * BARE-WORD pool meanings — the ones that DO collide with a same-named
 * root tile. Frozen: this set may only shrink (as meanings are migrated to
 * colon-carrying spellings with a drain plan), never grow.
 *
 * Renaming one is not a code change but a DATA MIGRATION — sign() of a new
 * spelling mints a different address forever, so an unplanned rename strands
 * every existing member.
 */
export const BARE_WORD_POOL_MEANINGS: readonly string[] = Object.freeze([
  'authored',
  'bees',
  'clipboard',
  'computation',
  'dependencies',
  'host-push',
  'host-receipts',
  'manifests',
  'optimization',
  'overrides',
  'patches',
  'push',
  'receipts',
  'registry',
  'roots',
  'structure',
  // 'substrate' RETIRED — migrated to the colon-scoped `places:*` spellings
  // below. The old address stays a READ-FALLBACK drain source in
  // substrate.service.ts (see LEGACY_SUBSTRATE_POOL there); nothing writes
  // it. Do not re-add: this list may only shrink.
  'temporary',
  'threads',
  'translations',
  'viewport',
  'visual-optimization',
])

/** Collision-proof meanings — a colon can never appear in a lineage key.
 *
 *  An entry here RESERVES a spelling; it does not assert that the pool has
 *  members or even exists on disk. `pheromones:deposits` is reserved ahead of
 *  its build (see `documentation/pheromones.md`) precisely because the spelling
 *  is the expensive half: `sign()` of a typo mints a different address forever,
 *  so a later correction is a data migration, not an edit. */
export const SCOPED_POOL_MEANINGS: readonly string[] = Object.freeze([
  // The participant's saved screen backdrops, sorted into the world they
  // suit — one content-addressed doc { light: [sigs], dark: [sigs] } written
  // by CanvasBackgroundService (presentation/background). The sigs point at
  // ordinary content-root resources; the pool is what makes the collection
  // queryable across the network, while WHICH picture is showing (and how
  // washed) stays a localStorage pref — that is the distinction. TRUTH POOL,
  // never minted from the optimize phase: a sorting is the participant's
  // hand, not derivable from layers (optimize-phase.md litmus). Colon-scoped
  // so it can never collide with a tile slugged 'backgrounds'.
  'backgrounds:saved',
  // WHAT IS BEHIND THE HIVE right now — one record naming the picture's
  // signature plus how it is washed, zoomed and offset
  // (essentials/presentation/background/canvas-background.service.ts).
  // localStorage still holds the same record for the instant first paint;
  // this pool is the durable half, and the reason it exists is REACHABILITY:
  // a backdrop no marker and no pool member names is litter to every
  // collector in this system. TRUTH POOL — a choice, never derived, so never
  // minted from the optimize phase. Colon-scoped like its sibling.
  'backgrounds:screen',
  // WHAT MADE A PICTURE — one record per IMAGE SIGNATURE, the member named by
  // that sig (the sig-keyed pattern: the pool listing IS the index, lookup is
  // O(1) by the bytes you are holding). Prompt, seed, workflow and model for
  // anything ComfyUI generated into this hive
  // (essentials/comfy/comfy.service.ts), which is what makes `/comfy reroll`
  // possible from a tile alone. TRUTH POOL — an act, not a derivation; no
  // cold client could rebuild "I asked for this" from layers, so it is never
  // minted from the optimize phase. The ComfyUI ADDRESS is deliberately NOT
  // in it: a machine address is device-local (hc:comfy:endpoint), and a
  // record that travels must not name a host the reader does not have.
  'comfy:generations',
  // COMFYUI WORKFLOWS THIS HIVE HOLDS — sig-named `comfy-workflow@1` specs
  // (the API-format node graph plus its inferred seams), swept at boot by
  // essentials/comfy/comfy-workflows.ts and probed for on every domain the
  // participant learns (sharing/published-pools.ts claims this meaning), so a
  // host can offer workflows exactly the way it can offer provider specs.
  // Content, and small by construction: a workflow is a recipe, never a
  // model — no checkpoint, LoRA or output ever enters the hive through it.
  'comfy:workflows',
  // THE LAYOUTS THIS PARTICIPANT MADE — one sig-named member per saved
  // arrangement, each `{ kind:'layout-creation@1', name, pieceSig }` naming
  // the root layout piece it was designed as
  // (essentials/presentation/tiles/layout-creations.ts). The built-in layouts
  // are the PIECES you build out of; a creation is the shape you built, kept
  // whole — nesting, measurements and all — so it can be dropped somewhere
  // else as one asset. TRUTH POOL, never minted from the optimize phase: a
  // design is a hand, not a derivation. It is also what makes the arrangement
  // REACHABLE — a piece tree no mark and no pool member names is litter to
  // every collector here, and unplugging the one container that used it would
  // strand the design.
  'layouts:creations',
  // THE NAMES THIS PARTICIPANT GAVE THE BEHAVIOURS — one content-addressed
  // doc mapping canonical command → the participant's own names for it
  // (essentials/commands/aliases/participant-aliases.ts). Code never declares
  // an alias (the doctrine ratchet in doctrine.spec.ts keeps them out of
  // source); this pool is where the participant's do live, and the runtime
  // seam (QueenBee.aliases + the slash census fold) is what they ride. It is
  // a pool and not localStorage for the same reason spoken habits are: a
  // name that did not follow you to your other machine was not your name for
  // it. TRUTH POOL — a christening is an act, not a derivation; no cold
  // client could rebuild it from layers (optimize-phase.md litmus), so it is
  // never minted from the optimize phase. Colon-scoped so it can never
  // collide with a tile slugged 'commands'.
  'commands:aliases',
  // How this participant actually TALKS to the command line — one record
  // holding the lead-in→behaviour phrasings learned from utterances that RAN,
  // plus per-behaviour run counts (essentials/commands/utterance/
  // spoken-habits.ts). It moves with the participant rather than with the
  // browser, which is the whole reason it is a pool and not localStorage:
  // habits that did not follow you to your other machine were not habits.
  //
  // TRUTH POOL, never minted from the optimize phase. "I said it this way and
  // ran it" is the record of an act, not a derivation of sig-addressed inputs
  // — no cold client could rebuild it from layers (optimize-phase.md litmus).
  // localStorage still holds a mirror of it, but only as a boot cache: the
  // completions are read synchronously and cannot wait on an OPFS round trip.
  'habits:spoken',
  'pheromones:deposits',
  // Sig-keyed author marks — one record per TARGET signature, member named
  // by that sig (the substrate:references pattern: the pool listing IS the
  // index, lookup is O(1) by anchor). "These exact bytes carry these marks"
  // — the participant-local carrier of the uniform decoration model
  // (documentation/uniform-decoration.md); community deposits with decay
  // stay in `pheromones:deposits` above. Written by PheromoneMarks
  // (essentials/pheromones/pheromone-marks.ts), truth pool, never minted
  // from the optimize phase.
  'pheromones:content',
  // 'places:references' / 'places:sources' — SHORT-LIVED, never shipped. The
  // substrate surface was briefly renamed Places before that name went to the
  // collections index instead. Both are drain sources in substrate.service.ts
  // (a dev build did write a registry record to `places:sources`) and neither
  // may be reserved here again.
  //
  // The substrate surface, re-spelled off its bare word. `:sources` holds the
  // registry record + per-location override records. `:references` holds one
  // file per copied reference, NAMED BY THE IMAGE SIGNATURE — the pool listing
  // IS the collection, so copying a reference in is the whole write and the
  // same image copied twice lands on one filename.
  // The packed store's own directory — it holds `hive.pack`, the INTERNAL
  // representation (conformance.md §7: internal form is not the protocol).
  // Reserved here so every root walker knows the address is a pool and never
  // mistakes it for a lineage bag, in packed mode or out of it.
  'store:packed',
  // What this participant has PUBLISHED, and what they last saw of it —
  // written by sharing/publish-heads.ts. One bare `{sealedSig}` member per
  // successful hive-index advance (segments, lineageKey, host, pubkey, the
  // index `created_at` we signed), plus `{sealedSig}.{hostHash}.seen`
  // observation sidecars that deliberately fail the record regex.
  //
  // TRUTH POOL, never minted from the optimize phase: "I advanced the index
  // to head X at time T" is the record of a remote act, not a derivation of
  // sig-addressed inputs, so a cold client could never rebuild it from layers
  // (optimize-phase.md litmus). It is also what makes the index safe to
  // rewrite — see the wipe guard in publish-branch.ts.
  'publish:heads',
  // The community's HOSTS — one member per host artifact, the living
  // primitive behind `host:<zone>` marks (essentials/sharing/community-hosts.ts,
  // and read back by ADDRESS alone from runtime/host-zones.ts so the runtime
  // never imports essentials). This pool is why a reader can find bytes at
  // all: replication has no fixed origin, so the set of machines willing to
  // serve is itself content. TRUTH POOL — "I know this host" is an act.
  'community:hosts',
  // WHAT FORMAT THIS HIVE IS WRITTEN IN — one declaration naming the format
  // its newest writes use, the lowest reader version that sees all of it, and
  // when that last moved (see essentials/sharing/hive-format.ts and the pure
  // comparison in core/format-version.ts). A true one-current-document pool:
  // one member, replaced forward, never a set.
  //
  // ITS SPELLING AND ITS SHAPE ARE FROZEN FOREVER. This is the one artefact
  // whose entire job is being readable by clients that will never be updated
  // again — so it lives at a colon-scoped root address, holds plain JSON in
  // the OLD format, and must never be relocated or re-shaped by a later
  // format change. If it moved, it would become unreadable by exactly the
  // clients it exists to warn.
  'format:hive',
  // CANONICAL VARIANTS of a reference, keyed by sign(name) sub-bucket
  // (essentials/commands/canonical-reference.service.ts). Colon-scoped as of
  // the prune-safety pass: it previously derived its address from a RAW TILE
  // NAME, which put foreign 64-hex records inside what the molecule model
  // says is that tile's own molecule. The old address stays a READ-ONLY
  // fallback; nothing is deleted there. Data never heals.
  'canonical:variants',
  // THE FORWARD-ONLY MARKER CEILING per lineage — one bucket named by the
  // location sig, holding the highest marker name that lineage has ever
  // retired (essentials/history/history.service.ts). It exists because
  // archiving markers out of a bag would otherwise REWIND the sequence, and
  // union resolution across replicas would then resurrect the archived chain.
  // Holds markers, never members; nothing is ever deleted from it.
  'history:high-water',
  // What a HOST is offering — the package pointers a shim publishes for
  // clients to replicate from (runtime/host-pool.ts, consumed by
  // web/setup/ensure-install.ts). The address is DERIVED by every client for
  // itself rather than named in a manifest, which is exactly why it must be
  // seeded: `ensure-install` reaches it on the BOOT path, and any root walk
  // that ran first would have met the directory with the registry still cold.
  'host:packages',
  // The changes repository — one append-only record per act that touched a
  // group of tiles (see assistant/changes.ts). Colon-scoped so it can never
  // collide with a tile slugged 'changes'.
  'changes:log',
  // Unsent chat drafts, one per tile — what was typed into a tile's
  // conversation and NOT sent (see assistant/chat-thread.ts). TRUTH POOL:
  // a half-written thought is not derivable from anything, so a cold client
  // could never rebuild it (optimize-phase.md litmus) and it must never be
  // minted from the optimize phase. Seeded here for the reason every pool is:
  // a root walker meeting the directory in a session that has not yet
  // addressed the pool would otherwise take it for a lineage bag.
  'chat:drafts',
  // A tile's conversation, and the one-line gloss of it that the rail shows
  // (assistant/chat-thread.ts, assistant/chat-blurb.ts). The blurb is
  // DERIVED from the thread, the streams are the in-flight halves of turns
  // that have not landed yet; both sit beside `chat:drafts` and `threads`
  // and all four are addressed on the same paths, so seeding three of them
  // and not these two left exactly the gap this registry exists to close.
  'chat:blurbs',
  'chat:streams',
  // The context basket — signatures gathered while browsing, handed to an ask
  // as its closure root list (see assistant/context-basket.ts). Colon-scoped
  // so neither can collide with a tile slugged 'context' or 'changes'.
  'context:basket',
  'context:draft',
  // Named handfuls of tiles asked about together (assistant/context-groups.ts).
  // A group is IDENTITY over a set of signatures — two groups may hold the
  // same tiles and stay two groups — and it is participant-local working
  // state, so it is a pool and never a layer.
  'context:groups',
  // The feedback inbox's summary log — one append-only record per bridge
  // start, saying who was waiting on whom at that moment (see
  // assistant/feedback-summaries.ts). TRUTH POOL, never minted from the
  // optimize phase: a past inbox state is not derivable from layers, so a
  // cold client could never rebuild it (optimize-phase.md litmus). Colon-
  // scoped so it can never collide with a tile slugged 'feedback'.
  'feedback:summaries',
  // WHAT THE PARTICIPANT PUT AWAY — the concealment records behind "hide
  // first, delete second" (essentials/concealment/concealment.ts). A pool
  // and not the optimize phase's business by the litmus in optimize-phase.md:
  // hiding is a hand, not a derivation. Losing it does not lose the tiles,
  // it UNHIDES them all at once, which is the loudest possible failure.
  'hidden:items',
  // The provider specs this hive knows how to talk to
  // (assistant/providers/provider-discovery.ts), probed for on every domain
  // the participant learns (sharing/published-pools.ts). Specs only — a
  // credential never enters a content-addressed write (doctrine.spec.ts
  // keeps them in LlmKeyStore), so this pool is safe to replicate.
  'llm:providers',
  // Which roots a phone opens into (preferences/mobile-pheromones.ts). It
  // travels with the participant rather than the browser for the same reason
  // `habits:spoken` does: a choice that did not follow you to your other
  // machine was not your choice.
  'mobile:roots',
  // The note-mark PALETTE — one content-addressed document holding the icons
  // a note may wear (shared/core/note-marks.store.ts). Its first write is the
  // seed, which lands while `getPool()` is still in flight; a root walk in
  // that window is precisely the race the seeding here removes.
  'notes:marks',
  // Prune receipts — what a prune took, written before the pass is stamped
  // (history/prune.service.ts). TRUTH POOL: the record of a DELETION is the
  // one thing that cannot be re-derived afterwards, so a walker mistaking
  // this directory for a bag would erase the evidence of the erasure.
  'receipts:prune',
  // DERIVED CACHES — recomputable, wipe-safe, GC-able, and minted in the
  // optimize phase (optimize-phase.md). They are seeded for the same reason
  // the truth pools are: "safe to wipe DELIBERATELY, by the code that owns
  // it" is not "safe for a bag-pruner to hard-delete on a name collision",
  // and a cache silently emptied by a root walk reads as a performance
  // mystery rather than as damage.
  //   computed:genome    — the active genome, keyed by the head it derives
  //                        from (history/active-genome.service.ts)
  //   insights:catalog   — the tree-insight catalog, one document
  //                        (presentation/tiles/tree-insight.ts)
  //   search:index       — sig-keyed search records, so a search is a read
  //                        and never a walk (search/hive-search.ts)
  //   thumbnails:hex     — hex thumbnails keyed by SOURCE IMAGE SIGNATURE
  //                        (presentation/tiles/thumbnails.ts)
  //   molecule:index     — the DECLARED VOCABULARY, keyed by the layer sig it
  //                        derives from: which molecule addresses a subtree's
  //                        names fold to (molecule/molecule-index.ts). It must
  //                        be COLON-SCOPED twice over — the bare-word list may
  //                        only shrink, and the index's whole subject IS
  //                        bare-word molecule addresses, so a bare `molecule`
  //                        would land the index on top of a bag it indexes.
  'computed:genome',
  'insights:catalog',
  'molecule:index',
  'search:index',
  'thumbnails:hex',
  // RESERVED AHEAD OF ITS BUILD, like `pheromones:deposits` above: the hive
  // entry point from documentation/known-location-pools.md, name → sealed
  // head, proved buildable today by history/hives-names-shape.spec.ts. The
  // spelling is the expensive half — `sign('hives')` would BE the bag of a
  // root tile called `hives`, which is the collision this whole file exists
  // to prevent — so the colon-scoped spelling is claimed now, not later.
  'hives:names',
  'substrate:references',
  'substrate:sources',
  'tutorial:artifacts',
  'usage:dwell',
  // Default tile art, keyed by the tile's NAME and holding a SIGNATURE (not
  // bytes) that points at an ordinary content-root resource. This is how a
  // behaviour supplies its own picture without any code knowing about it:
  // rendering reads the pool, so new art is a resource plus one member, never
  // an edit. TRUTH POOL — a cold client cannot derive an author's chosen
  // picture from layers, so it is state and never minted from the optimize
  // phase. Colon-scoped so it can never collide with a tile slugged 'visual'.
  'visual:tile-art',
  'websites:menu',
])

/** Every meaning known at build time. */
const SEED_MEANINGS: readonly string[] = Object.freeze([
  ...BARE_WORD_POOL_MEANINGS,
  ...SCOPED_POOL_MEANINGS,
])

/** meaning → sign(meaning), populated lazily and never evicted. */
const addressByMeaning = new Map<string, string>()
/** The inverse — the set consulted by `isPoolAddress`. */
const meaningByAddress = new Map<string, string>()

let seeded: Promise<void> | null = null

const derive = async (meaning: string): Promise<string> => {
  const known = addressByMeaning.get(meaning)
  if (known) return known
  const sig = await SignatureService.sign(
    new TextEncoder().encode(meaning).buffer as ArrayBuffer,
  )
  addressByMeaning.set(meaning, sig)
  meaningByAddress.set(sig, meaning)
  return sig
}

/**
 * Record `meaning` as a pool address. Called from every `poolSignature`
 * derivation — the registration IS the side effect of addressing a pool, so
 * no module has to remember to opt in.
 */
export const registerPoolMeaning = async (meaning: string): Promise<string> =>
  await derive(meaning)

/** Resolve the seed census once. */
const ensureSeeded = async (): Promise<void> =>
  seeded ??= (async () => { for (const m of SEED_MEANINGS) await derive(m) })()

/**
 * Is `signature` the address of a pool of meaning? True for every seeded
 * meaning and for every pool addressed at runtime.
 *
 * A `true` answer means the directory is NOT (only) a lineage bag — callers
 * that prune, enumerate, or rewrite bags must leave it alone.
 */
export const isPoolAddress = async (signature: string): Promise<boolean> => {
  await ensureSeeded()
  return meaningByAddress.has(signature)
}

/** The meaning behind a pool address, for diagnostics. */
export const poolMeaningOf = async (signature: string): Promise<string | undefined> => {
  await ensureSeeded()
  return meaningByAddress.get(signature)
}

/** Every known pool address. Snapshot — callers must not mutate. */
export const poolAddresses = async (): Promise<ReadonlySet<string>> => {
  await ensureSeeded()
  return new Set(meaningByAddress.keys())
}

/**
 * The RESERVED SYSTEM SCOPES — the words that may legally appear before a
 * colon, DERIVED from `SCOPED_POOL_MEANINGS` rather than listed again.
 *
 * `documentation/address-syntax.md` rule 3: after a colon there is a reserved
 * system word or a 64-hex signature, never a user word. That rule needs to know
 * which words are reserved, and a second hand-kept list of them would drift
 * from this one exactly the way four copies of the pool census once drifted.
 * Reserving a new scoped meaning above extends this set for free.
 *
 * Synchronous and cheap: it reads the frozen build-time array, not the runtime
 * registry. A scope minted at runtime by a module is not a SYSTEM reservation —
 * it is that module's own spelling, and it is judged by the same rule.
 */
export const reservedColonScopes = (): ReadonlySet<string> => {
  const scopes = new Set<string>()
  for (const meaning of SCOPED_POOL_MEANINGS) {
    const colon = meaning.indexOf(':')
    if (colon > 0) scopes.add(meaning.slice(0, colon))
  }
  return scopes
}

/** sign(meaning) → meaning for every known pool, for labelling a root
 *  listing. Snapshot — callers must not mutate. */
export const poolMeanings = async (): Promise<ReadonlyMap<string, string>> => {
  await ensureSeeded()
  return new Map(meaningByAddress)
}
