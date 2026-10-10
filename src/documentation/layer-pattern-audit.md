# Layer-pattern audit (2026-10-01)

jwize, 2026-10-01: *"Hypercomb is a tapestry of layers which are extensible on
every point. When we deviate we lose our flexibility. We need to correct every
point of failure to this paradigm."* And: *"You should never be saving
something that doesn't have this pattern, unless it isn't intended to live
long."*

## The standard

State is a LIST ITEM: a slot array on a layer (or a member set with history
behind it). A change is a NEW layer whose array gains an item, or has a new
item in place of another. History keeps every earlier layer, so anything can
be hidden and restored. Removing is an unlink (`hide-first-delete-second.md`);
forgetting bytes lives only behind prune.

Allowed WITHOUT the pattern, because short-lived by intent: scratch / tmp,
install and sync stamps replaced on the next install, work queues cleared when
they land, drain sources being absorbed, derived caches keyed by source
signature (recomputable, never load-bearing).

Everything else that persists and lacks the pattern is a deviation.

## Method

Three read-only passes over `removeEntry(`, `createWritable(` and
`localStorage.setItem(` in core, runtime, essentials, shared and web (101
removal sites in 30 files; 63 files with `createWritable`, 107 with
`localStorage.setItem`). Each cited line was checked against the source by
the manager that ran the audit (marked below); the judgement "wrong form" is
a design call and is for jwize to confirm.

## A. The systemic primitives (fix once, many records follow)

| # | Site | What happens | Verified |
|---|---|---|---|
| A1 | `hypercomb-runtime/src/store.ts:324-362` `putPoolDoc` | Writes the new document into the pool, then `removeEntry` on every other member: "the pool holds exactly one". Previous version is gone. | read |
| A1 | `hypercomb-core/src/core/pool-kinds.ts:~173-205` | Declares ~28 pools of kind `document` ("one current record, replaced in place"): `journal:entries`, `arkanoid:levels`, `solomon:levels`, `sequences:palette`, `patterns:palette`, `locations:saved`, `entrances:pinned`, `icons:overrides`, `portals:recent`, `registry:*`, `translations`, `overrides`, `history:marker-meta`, `viewport`, `insights:catalog`, `backgrounds:screen` ... | read |
| A2 | `store.ts:1478-1495` `removeOptimization` | `removeEntry` on a pool member. Door for `optimization-remove`, the feature un-hide (`feature-hidden.ts:134`), chat window, agent registry, organize. The pool holds ONLY state kinds (ask, organize-plan, hidden, feedback, qa, qa-answer, notes-digest ...), never a derived cache. `hidden` is a long-lived participant choice; `feature-hidden.ts:23-27` calls its home an "INTERIM SUBSTRATE". | read |
| A2 | Set pools, member unlink: `substrate.service.ts:749` (references), `host-zones.ts:146` and `community-hosts.ts:191` (hosts), `participant-features.ts:101`, `code-trust.ts:110`, `tile-public.ts:148`, `pheromone-marks.ts:184` ("This pool is TRUTH"), `concealment.ts:194` (reveal and state change unlink the earlier record), `move/layout.queen.ts:178` | Right shape (member named by its bytes), but withdrawal is `removeEntry` with no history. | read |
| A3 | localStorage-only authored, trust or durable state (about 22 files) | Overwritten whole, no history, lost with the browser profile. See section D. | sampled |

## B. Fixed-name records overwritten in place

| Site | Holds |
|---|---|
| `core/core/brood.ts:131`, `:330` | per-bee trust record (audits, vouches, flags, the participant's ruling); `:330` removes it whole |
| `core/core/brood-rules.ts:130` | the participant's trust policy, one fixed member merged and overwritten |
| `presentation/tiles/tile-art.ts:118` | the author's default picture for a tile name |
| `assistant/chat-thread.ts:1130, 1140, 1167, 1174, 1197` | conversation archived flag, harness choice, goal receipt (fixed-name markers set and unset) |
| `substrate/substrate.service.ts:630, 2567` | per-location background override, merge-overwritten |
| `assistant/breaks.ts:408` (from :518, :566) | break issues incl. the status a person chose, patched in place |
| `sharing/publish-heads.ts:148` | publish ledger record; republishing a head loses the earlier host |
| `molecule/vocabulary-ledger.ts:103` | anti-rollback floor per publisher, overwritten |
| `runtime/src/packed-store.worker.ts:235, 271` | fixed-name `current` pointer; an unreadable pointer reads as generation 0 and `#dropOtherGenerations` can delete the authoritative pack |
| `editor/viewport-store.ts:282, 302` | viewport per location (removal path has no live caller) |

## C. Destructive acts that should be a hide

| Site | Act |
|---|---|
| `shared/ui/command-line/command-line.component.ts:4693`, `cut-paste.behavior.ts:137` | `remove` / `rm` / `~name` recursively delete a name folder with no directory-safety veto; at the flat root it is usually a silent no-op; correct form is a layer commit with `children` minus the label (as `#createPaths` does) |
| `chat-thread.ts:1279` `deleteConversation` | the Delete button hard-removes the whole thread, turns and step ledger; archive already is the hide |
| `history.service.ts:4298` `archiveEntries` (from the history viewer `deleteRow`) | removes a marker after copying its bytes to `sign('temporary')`; the marker's place in the lineage is lost. Its comment at ~4225 is stale (says callerless). `:4196`, `:4104` have no production caller |
| `ensure-install.ts:1117` | purges sig files in legacy `__layers__/<domain>/`; no ordering guard against the Store relocation pass (`store.ts:2331-2335`) |
| `move/layout.queen.ts:178` | `/layout remove <name>` is permanent loss; saving is also broken (`:89-90` logs "not persisted") |

## D. localStorage holding durable state (group A, about 22 files)

Feature lights and the author's behaviour bindings
(`shared/.../behavior-enablement.ts:111`, `essentials/sharing/behavior-enablement.ts`),
features reviewed and allowed roots (`feature-verified.ts:48,108`), adopted
roots and tombstones (`adopted-roots.ts:46`), who I follow and who may follow me
(`swarm.drone.ts:4522` and friends), the machine admission ceiling
(`grant.queen.ts:117`), hosting settings (`host-sync.service.ts`,
`runtime-initializer.ts`), blocked tiles (`tile-actions.drone.ts:948`),
`hc:hidden-tiles:*` (`tile-public.ts` — since made session-only, so nothing persists), the picture-assignment
ledger (`substrate.service.ts:195,1935`), sync receipts (`swarm-adopt.drone.ts`),
the cigar catalog index (`cigar-catalog.service.ts:106`), tutor progress
(`games/tutor/scheduler.ts:203`), the sequence ring
(`sequence-cycle.drone.ts:561`, a second layout history outside the layers),
module audit roots (`module.queen.ts:276`), plus four keys not yet audited:
`hc:domain-claims`, `hc:attested-packages`, `hc:upgrade:allow`,
`hc:replication:intents:v1`.

## E. Dead writes (remove, nothing to migrate)

- `history/history-cursor.service.ts:763`: `#loadPersistedPosition` is defined and never called, so the keys pile up unread.
- `meeting/meeting.queen.ts:96-99`: `writeProps` has no caller.
- `shared/ui/file-explorer/opfs-explorer.component.ts:471`: writes an empty `<name>.install`; nothing reads it.

## F. Needs jwize

- **Device identity keys** (`hc:nostr:secret-key`, `hc:client-id`, 7 files): cannot sit in a replicated pool; a cleared profile loses the identity.
- **Per-device UI and AI preferences** (about 53 files): persist forever by design; by the rule as stated they deviate. `hc:chat-seen` and `hc:chat-models` also grow one entry per conversation.
- **Derived caches** with no collector (`store.ts:1444`, `:2447`, `eggs.ts:90`), the trust set `hypercomb.signature-store` (`acquire.ts:1136`, only grows), and `sign('temporary')` (fed by `archiveEntries` and `/sweep`, nothing cleans it).
- **The doctrine text itself**: `hide-first-delete-second.md` says a state change in `hidden:items` is "remove-then-write, never an edit". By the standard it should be a new item in place of the old, with history keeping both.

## Correction order

1. `putPoolDoc`: stop sweeping and give the document a head (form: see decisions). Covers A1, about 30 records.
2. One shared unlink for set pools (A2): a hide record instead of `removeEntry`; the optimization pool's `hidden` kind moves to its own pool.
3. Move group D onto the repaired document pools (the precedent exists: `hypercomb-shared/core/participant-document.ts` already moved navigation and chrome records out of localStorage).
4. Section B records become members with history on the same primitive.
5. Section C acts route through hide.
6. Section E removed.

Every step is a forward change: dual-read the old shape, write the new one,
delete nothing (data never heals).

## Verification status

Read by the manager that ran the audit: every site in A1, A2 and C, the
quoted lines in B for brood, brood-rules, tile-art, chat-thread, breaks,
packed-store, and in D for grant, adopted-roots, feature-verified,
behavior-enablement (shared), swarm.drone:4522, tutor scheduler, module.queen,
sequence-cycle; both dead-code claims. Reported by the audit agents and not
yet read: the remaining rows in B and D, and the group counts in F.

---

# The plan: pools are the truth, the layer is transport (2026-10-01)

jwize's points that shape it:

- *"The whole idea is a thread in time over multiple tiles, separated by their hierarchical organizations."* Every location and every pool has its own thread; a change on one never touches another.
- *"Restrict our update api to one call update(meta<layer|anything>)."* One door, so nothing can be saved in the wrong form.
- *"That allows any conventional extensions from any domains."* The door is the extension point and the gate.
- *"Maybe pools only is better."* The molecule doctrine (2026-09-02) already says the tile name is the grammar, a molecule is `sign(name)` plus its atoms, and `children` is a derived mirror.
- *"The meta is temporary transport information... that can still be there in swarm."* The layer stays, as a projection.

## The rules

1. **Truth lives in pools of meaning, each with history.** A document (one current value) is markers with a head: BUILT in step 1. A set (membership) is a succession of entries; hiding is an entry, never a `removeEntry`.
2. **The layer / meta is a TRANSPORT PROJECTION.** Derived from the pools, complete-or-absent, keyed by the source signature, never read as truth by new code (the existing "no `children` READ" ratchet, extended). It rides the swarm so older clients and single-signature sharing keep working. Regenerable from the pools alone.
3. **One door, `update(meta)`, contract in core.** The type and result live in `hypercomb-core`; the implementation is resolved by a stable IoC key. A caller names its domain and may write only the pools and slots it registered. Admission and trust are checked here, once.
4. **Forward only.** Dual-read (new shape first, old shape as fallback), write the new shape, delete nothing. Data never heals.
5. **Named exceptions, short-lived by intent:** scratch / tmp, install and sync stamps, work queues, drain sources, derived caches; plus device identity keys and per-device UI preferences (jwize, 2026-10-01).
6. **Only the GENOME leaves; history never does.** What replicates is the participant's own genome: the CURRENT state, with no history. Earlier versions and the numbered `000x` marker files are private: no external path (host, relay, shim, peer, probe) may be able to list or fetch them, and no external path may be able to list a participant's personal data. A history version leaves only when that version is itself the one being shared. Peers only ever read their own replicated genome (jwize, 2026-10-01). The enforcement point is one filter where bytes are chosen to be sent and where a host decides what it will list or serve (being verified: see "Replication check" below).

## Phases (each one: fix, then I read the code, re-run the specs, and run the full suite twice)

| # | Phase | Notes |
|---|---|---|
| 0 | Step 1 BUILT: `putPoolDoc` keeps every version, max marker is current. Wording TIDIED 2026-10-01: `pool-kinds.ts` (`deletion` is now `'keeps-versions'`, with its two specs), `directory-safety.ts` header and veto doc, `native-filesystem.ts`, `pool-registry.ts`, `address-syntax.md`, `molecule-index.md`, and the comments in `chat-blurb.ts`, `tree-insight.ts`, `registry-document.ts` | still open: adopt a legacy member as marker 0 on first write. The growth question is settled (decision 1 below): writes that are not a participant's save pass `keep: 'current'` |
| 1 | The door: `update(meta)` contract in core + one implementation over `putPoolDoc` and `LayerCommitter` (`commitSlotSet/Append/Remove/Swap`); `restore` is a new marker naming an earlier atom | the facade, domain-namespaced, with the admission gate |
| 2 | BUILT 2026-10-07: `doctrine.spec.ts` "raw storage writes may only shrink". Every `removeEntry(` / `createWritable(` / `localStorage.setItem(` site is frozen PER FILE in `doctrine.storage-writes.json` (that day: 100 sites in 32 files / 94 in 62 / 293 in 139 — the scan covers every package, legacy included): a file may never gain one, and a file that sheds one must have its count lowered | per site, not per file: the hot files (store, history, swarm) are where new sites land |
| 3 | Sets as successions with hide entries, one small pilot first (`participant-features` or `code-trust`), then `tile-public`, `pheromone-marks`, `substrate:references`, `concealment` (reveal = a new entry), the optimization pool's `hidden` kind (own pool), hosts LAST | hosts files carry another session's uncommitted edits: coordinate first |
| 4 | Durable localStorage state into pools through the door, security first: machine grant, verified features, follows and allowed subscribers, adopt tombstones; then feature lights and bindings, hosting settings; then catalog index, tutor progress, sequence ring, substrate ledger, sync receipts, module audit roots, block and hide lists | each reads the pool first and falls back to the old key once; the old key is left alone. RE-SCOPED 2026-10-07 (jwize: option b): the SECURITY GATES and everything else read SYNCHRONOUSLY at boot stay in localStorage until phase 1 (the door) can carry them — the machine grant, its verb roster, verified features and allowed roots, trusted domains, publisher follow, upgrade-allow, attested packages, adopted and carried roots, behaviour lights. Moving them to a pool alone opens a boot window: `DEFAULT_MACHINE_GRANT` is `editing/network`, so a narrowed grant would read wider until the pool loads, and the feature gate runs while modules load. Device-scoped settings (mobile mode) stay where they are on purpose. Hide lists: nothing to move — every tile hide is session-only by design (`session-hide.store.ts`); the entry in section D predates that |
| 5 | Fixed-name records into members or markers: brood records and rules, tile-art, chat archive / harness / goal, break issues, substrate override, publish-heads, vocabulary-ledger floor, viewport | the packed-store `current` pointer is storage-engine work with Rust parity: its own item, last |
| 6 | Destructive acts become hides: command-line `remove` / `~name` (commit `children` minus the label), chat Delete (archive, then the delete area), history `archiveEntries`, `/layout remove`, the `ensure-install` legacy purge ordering | |
| 7 | DONE 2026-10-07: dead writes removed — the history cursor's per-location localStorage position (its leftover `hc:history-cursor:*` keys are cleared on boot by `retired-statistics.ts`), `meeting.queen` `writeProps` with its `0000` props helpers, and the unmounted explorer's empty `-install` file with its button and string | nothing to migrate; the ratchet's counts lowered |
| 8 | The layer as projection: a DESIGN DOCUMENT first (which slots are mirrored, how a swarm peer verifies a mirror against the pool heads, atomic multi-item writes), then the code | the large architectural phase: no code before the decisions below |

## Decisions still jwize's

1. ~~Prune policy for document history.~~ DECIDED 2026-10-03 (jwize): *"saves never happen without human intent."* A write the participant deliberately caused keeps every version and nothing prunes it. A write the software makes on its own is not a save: `putPoolDoc(…, { keep: 'current' })` replaces the old atoms and lays no marker (same space proof). Fifteen writers pass it (chat blurbs, route flows, stream checkpoints, chat and context drafts, clipboard, active genome, hive format, substrate model sets, translation cache, Solomon resident chat and designer draft, tutorial provenance, facet minted). The usage tracker that wrote most of all is retired outright (no tracking).
2. Atomic multi-item writes: `update` takes a list, writes every atom, then advances the markers (crash-survivable, not atomic), or something stronger.
3. Which slots the transport projection mirrors, and what a peer must verify.
4. The pilot pool for phase 3, and when the hosts files are free.
5. `packed-interchange` and the Rust restore fix for sub-bucket markers: done together or not at all (Rust tests cannot run locally).

## Baseline for the checks (suite of 6176 tests, 2026-10-01 16:3x)

Failing BEFORE this work and not touched by it: `icons.spec.ts` (3: two baked icons no longer used), `mobile-touch-contract.spec.ts` (1: asserts `LANES_DEFAULT` in `layer-deck.drone.ts`, edited 13:22), `community-hosts-panel.spec.ts` (1: asserts `SEED_HOST = 'jwize.com'` in `hosts.drone.ts`, edited 13:18, now `'hypercomb.com'`). Timeouts only under full-suite load, passing alone: `bubble/tile-surface.spec.ts` round-trip (23.5 s alone, 60 s limit), `tile-surface.history.spec.ts`, `solomon/designer.spec.ts`, `upgrade-allow.spec.ts`.

## Replication check (2026-10-01): does kept history leave?

Rule 6: only the genome leaves. The genome is the walk from the current root head down through the child slots, newest marker only (`active-genome.ts:201`), plus every layer, resource, bee and dependency those heads reach. It excludes earlier markers and layers, every pool of meaning, and unreferenced root atoms.

**VERIFIED by reading the code (manager): one path leaks.** `hypercomb-client/crates/serve/src/lib.rs:302-343` answers `/<sig>/` with `hive.entries(sig)` and `/<sig>/<entry>` with `hive.entry(sig, name)` for ANY signature; `app/src/main.rs:1053-1078` (`AppHive`) reads the app's whole store with no filter by pool kind and none on marker names; `main.rs:1135` and `bin/hypercomb-serve.rs:76-85` bind every interface (`ANY`) unless `--local`. So with hosting on, anyone who can reach the port and compute a signature can list a pool (all document versions since step 1) and any bag's `000x` markers, and fetch them. The crate header says it serves `/<bagSig>/00000007` on purpose, so this is a design decision to reverse, not a slip. Current documents and tile markers were exposed before step 1; step 1 added the old document versions.

**REPORTED by the audit agent, not yet read by me:**
- All browser byte paths read only the flat root and cannot reach pool directories (host-sync drain and `publishAtoms`, publish-branch, content-broker responder, swarm, relay, blossom worker for participant data).
- `folder-sync` hard copy lists every file of every signature directory and requests, from hosts, the signatures named by every version (signatures, not bytes). A local backup copy of everything is by design.
- A succession's `prev` chain: only the head is marked for publish, but `prev` travels as a signature and older atoms sit at the root, so anything that serves by signature (the broker, `hypercomb-serve` `raw_get`, the self-domain backup) can return the whole chain.
- Hide and withdraw: swarm hide events send the NAMES of hidden tiles to relays (`swarm.drone.ts:3452-3472`, re-sent on heartbeat); a stage withdraw sends a claim whose `prev` names the list that still held the removed head (`publish-branch.ts:587-590`).
- The genome record carries `marker: head.filename` per location (reveals version counts) and is itself stored through `putPoolDoc`, so earlier genome records are now kept.
- A document pool written without a `subKey` and with a bare word gets no marker, so every version is kept with none current; `getPoolDoc` then returns the first member found, which can be an old version.

**Single enforcement point.** None exists today. The allow-list already exists: the current genome record. In the browser it can be enforced where bytes are chosen (`HostSyncService` drain reconcile and `publishAtoms`, and the broker responder), all of which read only the flat root. A host must carry the gate where it decides what to list or serve; the one that has none is `hypercomb-serve`'s `HiveSource`.

**Decisions:** (1) gate `HiveSource` so it serves only the genome's signatures and lists nothing (Rust; cargo tests cannot run here); (2) whether today's deliberate non-genome sends (stage lists, link bundle, vocabulary, catalogs, harness, plans, features snapshot, themes, module files, self-domain backup of every generation) are cut or kept; (3) whether swarm hide events may name hidden tiles.

**Host gate BUILT (2026-10-01), checked by the manager.** One shared floor file `hypercomb-relay/host-listing.floor.json` (`host:packages`, `host:offerings`, `community:hosts` = set; `community:offers` = document) is the only copy; `host-listing.js` imports it with identical exports (relay: 42/42 node:test; blossom worker bundled in memory by the agent, same frozen array) and the Rust host reads it with `include_str!`. In `hypercomb-client/crates/serve/src/lib.rs` `resolve()`: only a floor pool is listed; every other directory answers `404 pool not held`, byte-identical to an absent one; a floor `document` pool lists only its max marker and the atom it names; outside a floor pool only the head marker is served (older markers and every member answer 404, which also closes the `%2F` sub-bucket route). `check-host.mjs` check 11 tests any host the same way and warns VACUOUS when the host holds nothing. `cargo check --tests` and clippy are clean; the 9 new Rust tests are COMPILED, NOT EXECUTED (Application Control blocks test binaries here; CI is the runner). Relay `engines.node` raised to `>=20.10.0` (the JSON import needs it).

Still open: operator-declared `listed` pools are floor-only in Rust; the relay and worker do not apply the `document` policy (they hold no such pool today); a head marker still reveals its current atom's signature and, by probing numbers, the version count; the client CI only triggers on `src/hypercomb-client/**`, so a floor-file-only edit skips the Rust tests; staged shell files still win inside a non-floor directory (the published build, not the store). From the audit and not yet addressed: the broker responder and `HostSyncService` gates, the folder-sync hard copy's requests for old signatures, swarm hide events naming hidden tiles, a succession's `prev` chain, genome records kept by `putPoolDoc`.
