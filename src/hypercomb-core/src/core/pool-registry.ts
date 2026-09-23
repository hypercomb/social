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
  // 'clipboard', 'computation', 'manifests', 'optimization', 'overrides',
  // 'threads' and 'translations' moved to `system:` spellings on 2026-09-23
  // (SCOPED_POOL_MEANINGS). They stay here as DRAIN SOURCES: still reserved
  // as tile names, still seeded so a root walk knows the directory is a
  // pool. Remove one only when its bare directory is gone from every replica.
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
  // THE SYSTEM POOLS, colon-spelled (jwize, 2026-09-23; the runtime Store's
  // *_MEANING constants). Each replaces a bare word below that was also the
  // lineage bag of a same-named tile. The bare spellings STAY in
  // BARE_WORD_POOL_MEANINGS — reserved and seeded — until every replica has
  // drained them (runtime store.ts `#absorbBarePools`); only then may the
  // word be given back. `bees` and `dependencies` are not here: their
  // addresses are the install layout every host and the native client share.
  'system:clipboard',
  'system:computation',
  'system:manifests',
  'system:optimization',
  'system:overrides',
  'system:threads',
  'system:translations',
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
  // Authored, signed marks on exact bytes from ANYONE — a person, another
  // participant, or an agent that read the content — never the participant's
  // own tag taxonomy (documentation/pheromones.md's 2026-09-13 reframe: a
  // pheromone is an interest-signal, not a classifier). One bucket per
  // (target signature, depositor pubkey) underneath the target, so
  // independent depositors never collide; unioned at read time. Written and
  // read by PheromoneDeposits (essentials/pheromones/pheromone-deposits.ts),
  // truth pool, never minted from the optimize phase.
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
  // The DECLARED VOCABULARY of pheromone kinds — a `family:names` pool
  // (documentation/pools-across-hosts.md) so "what kinds could I turn on"
  // is a directory listing, not an enumeration endpoint: it answers only
  // for the kinds THIS participant already holds, anchored on the closed
  // `pheromones` family word, never a network-wide crawl. One tiny record
  // per distinct kind, named by its own hash — idempotent, additive-only.
  // Written and read by PheromoneDeposits, truth pool (a cold client could
  // not rebuild "which kinds exist" from layers alone).
  'pheromones:names',
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
  // WHAT YOU ASKED TO SEE from the hosts you carry — the creations offered as
  // shaded peer tiles in your hive (essentials/sharing/static-peers.drone.ts).
  // One current JSON document per participant, replaced whole; never sent.
  // The swarm model for static content: an offer is not an adoption.
  'community:offers',
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
  // PAGES ATTACHED TO A GROUP — one sub-bucket per group molecule, each file
  // nominating a page that gathers from it (essentials/references/gather/
  // gather-link.service.ts). A nomination only counts while the page still
  // wears its `gathers` mark; detaching removes the mark, never the file.
  'gathers:pages',
  // THE FORWARD-ONLY MARKER CEILING per lineage — one bucket named by the
  // location sig, holding the highest marker name that lineage has ever
  // retired (essentials/history/history.service.ts). It exists because
  // archiving markers out of a bag would otherwise REWIND the sequence, and
  // union resolution across replicas would then resurrect the archived chain.
  // Holds markers, never members; nothing is ever deleted from it.
  'history:high-water',
  // WHAT A PARTICIPANT SAYS ABOUT A REVISION — a ★ mark, a restore-point
  // label, a prune receipt — one current document per marker LAYER SIG
  // (essentials/history/marker-meta.ts). The marker file itself is never
  // rewritten; before this pool the fields were written into the marker, and
  // those markers stay readable. Per-participant, replaced in place: DOCUMENT.
  'history:marker-meta',
  // THE LAST HEAD CLAIM THIS DEVICE SIGNED, per facet — the `minted` half of
  // `planHeadClaim`'s anti-rollback rule (core/head-claim.ts). One current
  // document per (facet, pubkey) sub-bucket; per-device, never replicated —
  // it exists precisely so a host that is merely behind cannot hand this
  // device a counter lower than the one it signed. DOCUMENT.
  'facet:minted',
  // FOUR NAVIGATION-AND-CHROME RECORDS THAT LIVED IN localStorage — the saved
  // locations, the pinned entrances, the recent portals with the marked home,
  // and the icon overrides (hypercomb-shared/core/participant-document.ts).
  // Each is the participant's own, small, and read synchronously by a paint
  // path; each is now ONE current JSON document per participant, never
  // replicated. DOCUMENT. `portals:recent` holds two sub-bucket documents,
  // the list and the home mark, so the list falling over cannot take the
  // mark with it. The localStorage keys stay READ-FALLBACK only.
  'entrances:pinned',
  'icons:overrides',
  'locations:saved',
  'portals:recent',
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
  // Each conversation's organized WORKFLOW, as the machine-local model
  // arranged it for the chat window's route sidebar (assistant/chat-route.ts,
  // documentation/chat-route.md). DERIVED CACHE: one recycled slot per
  // conversation (putPoolDoc sub-keyed by the convoId), version-stamped,
  // never load-bearing — wipe-safe.
  'chat:route-flows',
  // User-requested observations assimilated from selected chat text into the
  // workflow sidebar (assistant/chat-route.ts). Unlike route-flows these are
  // durable source state: the selected range cannot be reconstructed later.
  'chat:workflow-comments',
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
  // AN AGENT-OR-PARTICIPANT-CHOSEN SET OF TILES, kept as a slice layer
  // (assistant/context-slices.ts) so its members compose into one
  // projection. TRUTH POOL — a chosen set is an act, never derived, so
  // this is never minted from the optimize phase (optimize-phase.md
  // litmus: no cold client could rebuild "these are the members" from
  // layers alone). One member per slice, NAMED BY THE SLICE'S LAYER SIG,
  // holding `{ kind: 'context-slice', name, layerSig }` — the member is
  // what keeps the slice's root layer file reachable: a root sig file no
  // marker and no pool member names is litter to the collector.
  'context:slices',
  // The feedback inbox's summary log — one append-only record per bridge
  // start, saying who was waiting on whom at that moment (see
  // assistant/feedback-summaries.ts). TRUTH POOL, never minted from the
  // optimize phase: a past inbox state is not derivable from layers, so a
  // cold client could never rebuild it (optimize-phase.md litmus). Colon-
  // scoped so it can never collide with a tile slugged 'feedback'.
  'feedback:summaries',
  // THE BREAK REPAIR LOOP (essentials/assistant/breaks.ts,
  // documentation/break-repair-loop.md). `breaks:queue` is the page's raw
  // record of what broke — append-only, content-addressed, drained by the
  // fold. `breaks:log` is one issue document per break fingerprint, carrying
  // what the reviewing agent made of it and what the participant chose.
  // TRUTH POOLS, never minted from the optimize phase: a break is an event,
  // not a derivation of layers (optimize-phase.md litmus).
  'breaks:log',
  'breaks:queue',
  // WHAT THE HIVE WAS ASKED FOR AND COULD NOT DO (essentials/assistant/
  // machine-misses.ts, read with `misses`). One record per sentence a model
  // proposed that the census refused. An event, not a derivation of layers,
  // so never the optimize phase's to mint.
  'machine:misses',
  // WHAT HAPPENED AFTER JEV DECIDED (essentials/assistant/jev-outcomes.ts):
  // ran, skipped, failed, answered, deferred or refused, one record per
  // decided round, so the gates are tuned on outcomes. Events, never truth.
  'jev:outcomes',
  // WHAT THE PARTICIPANT PUT AWAY — the concealment records behind "hide
  // first, delete second" (essentials/concealment/concealment.ts). A pool
  // and not the optimize phase's business by the litmus in optimize-phase.md:
  // hiding is a hand, not a derivation. Losing it does not lose the tiles,
  // it UNHIDES them all at once, which is the loudest possible failure.
  'hidden:items',
  // SIGNATURES THAT HAVE NOT ARRIVED YET (core/eggs.ts) — one file per
  // missing signature, named by it, listing the hosts that already said no, so
  // they are never asked again until a new host joins. Truth about the
  // network, not a derivation of layers; wipe-safe (losing it costs one round
  // of 404s). Colon-scoped: the bare-word list is frozen, and it is NOT the
  // brood, which holds untrusted behaviours.
  'eggs:dormant',
  // THE BROOD (core/brood.ts) — automatons that arrived from somebody else
  // and are NOT trusted yet: held, inspectable, never imported. One record
  // per bee signature carrying where it came from, what readers made of it,
  // and the participant's ruling. TRUTH, never derived and never minted from
  // the optimize phase: losing it would silently un-hold code. Colon-scoped
  // because the bare-word list is frozen and no tile may name it.
  'brood:unverified',
  // The participant's admission policy (core/brood-rules.ts): what happens to
  // their own code, a followed community's, and a stranger's, and how many
  // followed keys must have accepted before their agreement stands in for a
  // hand. One record, named by the pool's own address.
  'brood:rules',
  // TOKEN-COMPACT TILE PROJECTIONS for the hive's `hive` tool
  // (assistant/llm-context.ts) — one record per SOURCE LAYER SIGNATURE,
  // a compact line-oriented rendering of what a tile SAYS in place of the
  // raw sig arrays `/read` returns. DERIVED CACHE, minted in the optimize
  // phase (optimize-phase.md): a pure derivation of the layer's own bytes
  // plus the resources its non-child slots reference, never load-bearing,
  // wipe-safe — `inflate()` substitutes it under a lens and re-derives on
  // a miss. Colon-scoped because the bare-word list is frozen and no tile
  // may name it.
  'llm:context',
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
  // PARTICIPANT-CREATED NAMED TILE-BACKGROUND SETS — any number of them,
  // unlike substrate:references (exactly one). One doc per set, keyed by the
  // set's own id ({ sigs: [...] }), same doc-pool shape as backgrounds:saved.
  // The sets themselves are ordinary `custom`-type entries in the
  // substrate:sources registry; this pool holds only each set's member list.
  'substrate:custom-sets',
  // GENERATED-BUT-UNDECIDED CANDIDATES for a custom set — one doc per set
  // (subKey=setId), { sigs: [...] }. Separate pool from substrate:custom-sets
  // on purpose: a candidate and a member answer different questions ("could
  // go in?" vs "is in"), same reason substrate:sources and
  // substrate:references are two pools rather than one.
  'substrate:custom-gen',
  // THE SUBSTRATE REGISTRY — which background sources this participant has and
  // which is active: one current document (essentials/substrate). It replaces a
  // member literally named `registry` inside substrate:sources, kept as a
  // read-fallback. Per-participant, replaced whole: DOCUMENT.
  'substrate:registry',
  'substrate:sources',
  // THE STATIC ANATOMY'S LINEAGE BAG — the protocol + doctrine text every
  // model outside the machine is sent first (documentation/anatomy-context-
  // need.md §2). 8-digit `{ layerSig, at }` markers, the history service's
  // own shape; the highest names the anatomy this hive is running. A system
  // pool no tile may name, hence the colon. Written by essentials/assistant/
  // anatomy/anatomy.service.ts, advanced only when the sig changes.
  'system:anatomy',
  // THE DOCTRINE AS A HIVE ARTIFACT (documentation/anatomy-context-need.md
  // §2a). 8-digit `{ layerSig, at, by }` markers, each naming a doctrine
  // record (a resource listing section resources by sig); the highest is the
  // doctrine this hive runs. The seed is the build's; every other marker is
  // the participant's. Written by essentials/assistant/anatomy/doctrine.ts.
  'system:doctrine',
  // TILE SUMMARIES a model wrote, keyed sign(layerSig + anatomySig + modelId)
  // (documentation/anatomy-context-need.md §5). A derived cache — wipe-safe,
  // never load-bearing — but NOT optimize-phase: a model's text is not a
  // pure derivation, so it is minted only on an explicit `/summary` miss by
  // essentials/assistant/compaction.ts. Colon meaning: no tile may name it.
  'system:compaction',
  // TRANSFER PACKS (atomic-modules-plan.md): one member per package, named by
  // the package's root signature and holding the signature of a pack — one
  // content-addressed file carrying that package's bytes, so a cold install
  // is one request instead of hundreds. A derived cache: anyone may mint one,
  // every member is verified against its own name on arrival, and a reader
  // with no pack installs the same package from loose files.
  'transfer:packs',
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
  // THE SIGNED VOCABULARY CLAIM (documentation/vocabulary-claim.md). Three
  // spellings, reserved together because sign() of a typo mints a different
  // address forever and a later correction is a data migration:
  //   vocabulary:hive      the SURFACE — line 3 of the claim preimage, and the
  //                        reserved hive-index root key. It is a door the
  //                        reader RENDERS, not a directory anything writes.
  //   vocabulary:published the participant's own ledger of what they have
  //                        published and the highest seq they signed — TRUTH,
  //                        the anti-rollback record planVocabularyClaim
  //                        takes as `minted`. Never derived from layers, so
  //                        never minted from the optimize phase.
  //   vocabulary:seen      a reader's proven high-water per publisher. Holds
  //                        {at, seq} and NEVER a body sig: a 64-hex string in
  //                        a pool member's bytes is credited by
  //                        sigsReferencedOutside, and pinning a STRANGER's
  //                        atoms in my own store is not a cache, it is litter.
  // Colon-scoped for the usual reason and one extra: publishing into a
  // BARE-WORD pool on a relay would make every sibling entry at that address
  // publicly enumerable by anyone who can derive the word.
  // A PARTICIPANT REGISTRY'S MASTER RECORD — the name, tag, bouquet and
  // interest maps, one current JSON document each, written by
  // hypercomb-shared/core/registry-document.ts. DOCUMENT pools: replaced
  // whole on every edit, per-participant, never sent. They replace a
  // pointer member named `names-master` (and three siblings) in the
  // bare-word `registry` pool, which stays a READ-FALLBACK only.
  'registry:bouquets',
  'registry:interests',
  'registry:names',
  'registry:tags',
  'vocabulary:hive',
  'vocabulary:published',
  'vocabulary:seen',
  'websites:menu',
  // A Solomon resident's freeform AI chat: one recycled document per
  // resident id {turns, memory?} (essentials/games/solomon/resident-chat.ts).
  // Per-player game state, never shared or listed — colon-scoped so no tile
  // can name it.
  //
  // ONE COLON, NOT TWO. Spelled 'games:solomon:talk' until 2026-09-20, which
  // validatePoolSpelling rejects on its own stated rule: a pool never contains
  // another pool, and everything below the first level is a bucket rather than
  // a new meaning. The rule predates the spelling, and the spelling arrived in
  // a commit about something else, so the spelling was the accident. The old
  // address is retired below and still read.
  'games:solomon-talk',
])

/** Every meaning known at build time. */
/**
 * SPELLINGS THAT WERE ONCE WRITTEN AND ARE NO LONGER WRITTEN.
 *
 * A pool's address is the hash of its meaning, so RESPELLING A MEANING MOVES
 * IT. The bytes already written under the old spelling do not move with it,
 * and data never heals: the old address stays a read-fallback in whatever
 * module owns the feature, and nothing ever writes it again.
 *
 * They stay SEEDED for one reason that matters more than tidiness: anything
 * that walks, prunes or enumerates the root asks this registry whether a
 * sig-named directory is a pool. Forget a retired address and its directory
 * looks like a lineage bag to the next prune. Seeding it here keeps that
 * answer right from boot rather than from whenever the owning module happens
 * to load.
 *
 * NOT part of SCOPED_POOL_MEANINGS: these are history, so the spelling rules
 * that govern live meanings do not apply to them, and they reserve no scope.
 * This list may grow when a meaning is retired; an entry may never be removed.
 */
export const RETIRED_POOL_MEANINGS: readonly string[] = Object.freeze([
  // → 'games:solomon-talk' (2026-09-20). Read-fallback in
  // essentials/games/solomon/resident-chat.ts; nothing writes it.
  'games:solomon:talk',
])

const SEED_MEANINGS: readonly string[] = Object.freeze([
  ...BARE_WORD_POOL_MEANINGS,
  ...SCOPED_POOL_MEANINGS,
  ...RETIRED_POOL_MEANINGS,
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
