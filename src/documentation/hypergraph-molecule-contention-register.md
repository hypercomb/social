# Contention register — hypergraph molecule lineage

310 confirmed sites, 42 refuted. JSON: `contention-register.json` (`items[]` carry `order`/`step`; `refuted[]`; `steps[]`).
Severity split: 70 trap · 124 must-change · 95 should-change · 21 wording.
Ordering is topological over `dependsOn`; `order` is a global sequence, `step` the phase.

**One thing must be decided before ANY of this is written to disk** — see OPEN DECISIONS §f.1. It cannot be healed later (rule 6).

---

## (a) Execution order

### Step 1 — PRUNE SAFETY (orders 1–67, rules 5/6)
Precondition for everything else. Today the only thing standing between `/flatten` and a participant's pool is a spelling rule the doctrine retires; landing the flip first is a net loss of safety.

| # | site | change | rule |
|---|---|---|---|
| 1 | `hypercomb-core/src/core/directory-safety.ts` *(new)* | `classifyDirectoryEntry` / `hardDeleteVetoFor` / `SIGNATURE_NAME` / `MARKER_NAME`. Structural, registry-free — the registry is complete only for meanings THIS process derived (`pool-registry.ts:271`). | 5 |
| 2–5 | `history.service.ts:3754,3796,3822,3738` | `#quarantineNonLayerFiles`: drop the `isPoolAddress` early return; never push a `#SIG_RE` name onto `drop`; unparseable/bare-sig markers `continue`, not drop. | 5,6 |
| 6–7 | `history.service.ts:4273,4288` | `removeLineageBag`: structural refusal, then **delete the recursive remove** — replace with a forward tombstone marker. | 5,6,9 |
| 8–10 | `history.service.ts:3952,3885,4279` | `archiveEntries` / `removeEntries` / `removeContentSigs` stop unlinking markers and atoms; supersede forward. | 6 |
| 11–13 | `history.service.ts:456,640,479` | `enumerateBags` / `#absorbRootBagArchives` classify per ENTRY; drop the registry skip. | 5,1 |
| 14 | `history.service.ts:4197` | `sigsReferencedOutside` is local-only and excludes by DIR ADDRESS — federate it, or return `{authoritative:false}` and make prune refuse. | 4 |
| 15–19 | `history.service.ts:752,4506,4543,789,4419` | marker-shape filters on `replay` / `#nextBagMarker` (mints 9-digit markers) / `list()`; delete dead `nextIndex`; `writeRecord` is the load-bearing counter-example. | — |
| 22–28 | `prune.service.ts:367,349,374,513,459,193,30` | purge becomes a forward commit + exclusion set; tombstones gain `moleculeSig`; scope the "checked against every other bag" promise to this replica. | 6,4,2 |
| 29–34 | `pruned-tiles.ts:172,120,130,156,229,23` | meta/seam guard, federated live set, `BranchNode.name`+`molecule`, empty-seed root addresses, header. | 4,2 |
| 35–40 | `flatten.queen.ts:50,60,52,35` · `collapse-history.queen.ts:76,30` | flatten becomes a forward commit (its counter currently REWINDS and union-resolution resurrects the chain); collapse-history is RETIRED. | 6 |
| 41–50 | `sweep.queen.ts:115,96` · `clipboard.worker.ts:1087` · `store.ts:257,2016,2059` · `ensure-install.ts:860,775,237` · `substrate.service.ts:2330` | every remaining unguarded `removeEntry({recursive})` / enumerate-and-delete. | 5,6 |
| 51–55 | `packed-collect.ts:130,143` · `folder-sync.service.ts:1305,1040,1445` | GC reachability must see sig-named member NAMES and read through loose blobs; the hard copy must scan both faces of a colliding dir before it SEALS. | — |
| 56–57 | `doctrine.spec.ts:562,34` | **add the prune-safety ratchet** (it does not exist); add `hypercomb-client` to `SCAN_DIRS`. | 5 |
| 58–67 | `pool-bag-collision.spec.ts:200,192,232,243,128` · `history.service.spec.ts:243,1682,367,313` · `concealment.spec.ts:60` | invert every spec that PINS destruction. | 5,6 |

### Step 2 — DUAL-READ + federation read primitives (orders 68–134, rules 1/2/4/9)
Nothing writes in this step.

- **68–71 enabling:** `lineage-key.ts:74` keep `lineageKey` byte-identical + add `moleculeKey` (with the `|| raw.trim()` fallback — **70** is a trap); rewrite the header's "identity IS its ancestry".
- **72–76 keystone:** `history.service.ts:681` split `sign()` into `moleculeSig` + `pathBagSig`/`signBoth`; `#segmentsBySig` (**73**) must be re-keyed in the SAME change; `#parentCarriedChild`, `sealSubtree`/`healSubtreeBags` retarget per call site; `#promoteBag`'s "a later GC can remove verified copies" deleted.
- **77–85 core roster:** `level-roster.ts:38,44` widen `RosterHistory`/`RosterStore` (no way to express `sign(name)` or list a pool today); `:157,129,128` traps; `:149` mint AND resolution order; `:112` split membership from order; `:189,118,13`.
- **86–92 renderer:** `show-cell.drone.ts:471` (branch-ness ⇒ enterability), `:8035` order store, `:9029/9020` appearance index, `:8615`, `:4328`, `:5553`, `:1958` dead `key`.
- **93–95** `lineage.ts:135` `currentSig` molecule-first + **`compatSig()`** (nothing else can hand the committer two pointers), `:161`, `:186/410`.
- **96–102** `tile-properties.ts:524,339` · `substrate.service.ts:620,1749,1647/2142,744,660`.
- **103–112** bindings + decorations: `behavior-enablement.ts:92,443,337,298` · `behavior.queen.ts:118,111` · `decoration-kind-index.ts:41,345,313,121`.
- **113–121** `head-index.ts:83` (both pointers must be registered or the index re-derives forever) · `usage-tracker.ts:128` · `viewport-store.ts:97,293` · `aggregation-layer.ts:81,147` · `mixed-group-bag.ts:245,369,150`.
- **122–126** `hive-visit.drone.ts:146,366` (**contested** — see §f.3), `:265` the WRITE half the sweeps missed, `:168` trap, `:272`.
- **127–134 federation reads:** `publications-view.drone.ts:168,150` · `store.ts:213` add `readPoolMembers` · `published-pools.ts:186` (**wrong URL shape today: no trailing slash ⇒ immutable-cached file, or a silent JSON.parse throw against a conforming host**), `:178,213,92` · `pool-registry.ts:297`.

### Step 3 — FORWARD-COMMIT WRITE PATH (orders 135–204, rules 3/6/9)
One atom, two pointers, one serialised committer step.

- **135–139** `history.service.ts:960` `commitLayer` + `:1105` `#ensureEmptyMarker` take the sig PAIR; `layer-committer.drone.ts` gains a bag-sig `commitMeta`; `doctrine.spec.ts:436` **add the dual-pointer ratchet**, `:413` rewrite KNOWN LIMITS.
- **140–143** order becomes a meta atom: `order-projection.ts:88,48` (its read side is DEAD and its cache mixes names with sigs) · `tile-properties.ts:8,877`.
- **144–152** `substrate.service.ts:577,1142` · `aggregation-layer.ts:230,277` · `mixed-group-bag.ts:415` · `layer-placement.ts:297,144,415,123`.
- **153–167 published index:** `publish-branch.ts:260` dual-key roots (**blocked on `blossom-worker/worker.js:362`**), `:293` collision trap, `:366` `confirmPublished` takes a key SET, `:411` symmetric unpublish, `:312` bundle nameKey, `:291,191,148,224` · `publish-heads.ts:56,127,178,142,208,125`.
- **168–175** `hive-pointer.ts:214` **`setHiveRoots` (one PUT, N keys)**, `:235` unchanged-guard trap, `:229` freshness floor, `:121` freshest-wins, `:101,157,27` · `hive-link.ts:79,116`.
- **176–179** `publish-status.drone.ts:404,510,481,434` — four traps that turn a published hive into an unpublished-looking one.
- **180–190 hosts:** `blossom-worker/worker.js:1050,715,205` · `relay.js:888,696,657` · `replicate.js:114,182,82` · `shim/host/serve.mjs:66` (no directory branch at all) · `check-host.mjs:122` (never probes a sig subpath).
- **191–197** `host-pool.ts:11` · `host-packages.ts:189` · `acquire.ts:187,210` · `store.ts:2180`.
- **198–204 conformance/specs:** `history.service.spec.ts:40` · `publish-branch.spec.ts:129` · `tile-properties.inheritance.spec.ts:34` · `aggregation-layer.spec.ts:79` · `generate-vectors.ts:113` · `protocol/src/lineage.rs:3` · `protocol/tests/conformance.rs:194`.

### Step 4 — MESH CHANNEL (orders 205–226, rule 7) — FLAG, DO NOT DECIDE
- **205** `swarm.drone.ts:1387` — extract ONE `#channelKey(segments)`; the four derivations (`1387`, `1704`, `2562`, `3018`) are contractually byte-identical and cannot move alone. Keep `(room, secret)` and the NUL separators under either option.
- **206–209** `:1704` subscribe anchor · `:2562` publish + `d` tag · `:3018` retraction (**dead behind `MAX_PUBLISH_DEPTH = 0` — decide reachability first**) · `:2807` per-channel memo (**dual-publish is silently swallowed without it**).
- **210** `relay.js:240` — NIP-33 eviction ignores the `x` tag, so a dual-publishing client **evicts its own presence** and late joiners on the other channel never see it.
- **211–219** `:412` `isSystemDirName` · `:3561/3614` drill puts a ROUTE on the wire · `:3420` presence-to-parent · `:3459` privacy prefix · `:1987` the real rule-4 gap · `:1554` peerIndex · `:1547/2607/4544` · `:6` header · `show-cell.drone.ts:1714`.
- **220–226** the mirrors: `controls-bar.component.ts:1158` and `mesh-modal.component.ts:139` are **two hand-rolled copies that are ALREADY divergent** (rawLineageKey vs lineageKey — the human-verifiable word pair is wrong today for any name with a space); `:508/2194`, `:78/211`, `lineage-key.ts:7`, `history.service.ts:666`, `decoration-kind-index.ts:561`.

### Step 5 — POOL-REGISTRY / RATCHET FLIP (orders 227–271, rule 5)
- **227–233** `pool-registry.ts:48` → `RESERVED_SYSTEM_MEANINGS` (may GROW, never lose an entry that has been on disk); `:31` header; `:285` `isPoolAddress` demoted to a label; `:271` **`registerPoolMeaning` must NOT be the molecule derivation**; `:83` add the missing name-refusal half; `:65` re-add `substrate`; `:170` un-forbid the `places:*` labels.
- **234–235** `doctrine.spec.ts:564` invert the polarity in ONE edit (612 filter, 594 register, 618 drift, 620 message, 589 precondition, 20 import, 568 address model); `:13` distinguish a DRIFT allowlist from a REGISTER.
- **236–237** `published-pools.ts:76` delete the colon throw (a SECOND prohibition, thrown at module scope) and replace with a reserved-name guard; invert its spec.
- **238–254** the meaning declarations: `store.ts:61,207,246` · `chat-thread.ts:31` · `viewport-store.ts:38` · `websites-pool.ts:19` (+ the `markSeeded` federation trap) · `community-hosts.ts:54` · `active-genome.service.ts:15` · `concealment.ts:55` · `prune.service.ts:62` · `host-pool.ts:39` · `chat-blurb.ts:56` · `usage-tracker.ts:28` · `enrollment.ts:116` · `group-signature.ts:26` · `hive-link.ts:42` · `locales.ts:35`.
- **255–271** `layout-template.spec.ts:787` (a bare hole meaning is silently DROPPED today) · `generate-vectors.ts:140` · `conformance.rs:150` · `tree-logger.ts:61` · `opfs-explorer.component.ts:320,370` (line 562 hides every molecule at root) · `hives-names-shape.spec.ts:149,137` · the remaining spec rationales.

### Step 6 — DOCS (orders 272–310)
`known-location-pools.md` (rewrite, not annotate — CLAUDE.md still points at it as "the full paradigm") · `protocol/conformance.md:152` (highest-leverage single edit: it is normative for other implementations) · `CLAUDE.md:293,296,244,313,415` · `protocol-spec.md:110` · `history-sigbag-as-root.md:277` · `revision-mode.md:216` · `glossary.md:88` · `mesh-domain-resolver-audit.md:188` · `entrances-and-sets.md:67` · `superimposition.md:10` · `behavior-binding.md:27` · `pheromones.md:437` · `publish-differential.md:133` · `visuals-across-lineages.md:170` · `tag-pools.md:52` · `aggregation-layer-model.md:73` · `algebraic-elimination-gc.md:20` · `hive-snapshots.md:88` · `sign-meaning-pool-migration-plan.md:66` · `protocol/client-design.md:66` · `dna.md:98` · `bee-story/*` · `swarm-resource-streaming.md:51` · `signed-site-bindings.md:33` · `layout-templates.md:153` · `website-artifact-paradigm.md:125` · `group-signatures.md:25` · `clipboard-sig-native.md:78` · six-doc colon-rationale sweep (order 300) · `everything-is-a-beehavior.md:414` · `resource-promotion.md:133` · `pools-across-hosts.md:158` · in-code creeds `title.queen.ts:5` + `decoration-kind-index.ts:505` · `cell-suggestion.provider.ts:20` · `substrate.service.ts:86` · relay/worker index wording · `hypergraph-molecule-lineage.md` (record the open decisions).

---

## (b) TRAPS — 70 sites that silently pull an implementer back to the old doctrine

**Step 1 (destructive / pins destruction)**
- `history.service.ts:3754` — `isPoolAddress` is a DENYLIST; an unregistered molecule opens the guard and the loop hard-deletes its members.
- `history.service.ts:3796` — the `drop.push` fallthrough already destroys live delta records `writeRecord` puts in the bag.
- `history.service.ts:4273` — same denylist, one syscall from `removeEntry(recursive)`.
- `history.service.ts:4288` — the actual destructive call; no predicate above it can be made safe.
- `history.service.ts:456` — the pool skip hides a molecule from `sigsReferencedOutside`, so prune deletes bytes that are live.
- `history.service.ts:4197` — a LOCAL answer (built from a truncated enumeration) gates a hard delete.
- `history.service.ts:752` — `parseInt('0abc…',10)` = 0: a 64-hex atom is JSON.parsed as a HistoryOp.
- `history.service.ts:4506` — unfiltered `parseInt` MINTS a 9-digit marker that `#MARKER_RE` then rejects: the new head is invisible.
- `prune.service.ts:367` — deleting the step makes purge a silent no-op; keeping it destroys a pointer dir.
- `prune.service.ts:374` — the exclusion is a DIR ADDRESS; under `sign(name)` that address is the shared molecule.
- `prune.service.ts:513` — receipts keyed by the path sig: after the re-key every purged tile resurrects as prunable.
- `pruned-tiles.ts:120` — a seam meta's `children` are OLD HEADS, so every real tile is reported deleted.
- `flatten.queen.ts:50` — the only caller of the only hard-delete path in history.
- `flatten.queen.ts:52` — archived markers are restored from legacy sources on the NEXT boot, and the `__history__` drain stalls forever.
- `sweep.queen.ts:115` — recursive removal with no shape guard.
- `clipboard.worker.ts:1087` — wipes `sign('clipboard')` wholesale on ordinary paths (pasting the last item).
- `store.ts:257` — `putPoolDoc` removes every OTHER 64-hex file; called without a subKey on the bare-word `overrides` pool.
- `ensure-install.ts:860` — `purgeDir` over two bare-word pool addresses, no shape guard.
- `substrate.service.ts:2330` — `removeEntry` on a root sig-named dir, called with the bare word `substrate`.
- `packed-collect.ts:130` — sig-named member NAMES are never scanned, so their root twins are swept.
- `folder-sync.service.ts:1305` — the pool/bag `continue` makes the hard copy seal a closure it never walked.
- `doctrine.spec.ts:562` — the prune-safety ratchet the flip depends on does not exist.
- `pool-bag-collision.spec.ts:200` — asserts a 64-hex member IS deleted, at an address that IS a molecule.
- `pool-bag-collision.spec.ts:232` — demands the MAX marker (the head) be dropped.
- `pool-bag-collision.spec.ts:243` — pins "delete the atom squatting at a molecule address".
- `history.service.spec.ts:243` — `normalize` deletes markers from inside `listLayers`: **reading history destroys it**, and an old client erases shapes it does not recognise.

**Step 2 (read paths)**
- `lineage-key.ts:71` — `sign(canon(emoji-only name))` hashes the EMPTY string = the root address.
- `history.service.ts:1777` — first-seen-wins reverse map becomes non-injective; `#parentCarriedChild` walks a stranger's parent.
- `level-roster.ts:157` — `childSigsInline` returns `[]` for a sig-pointer children slot: every rail/notes/suggestion goes blank, no error.
- `level-roster.ts:129` — first-sig-wins renders the pre-seam head forever.
- `level-roster.ts:128` — an 8-hex pseudo-name would mint pool addresses out of hash fragments.
- `show-cell.drone.ts:8035` — retargeting the cache key alone collapses every same-named tile onto slot 0.
- `show-cell.drone.ts:9029` — flipping the appearance index early merges pictures nobody asked to merge.
- `tile-properties.ts:339` — rules 1/5 do NOT resurrect plaintext-named dirs.
- `behavior-enablement.ts:443` — sig-keyed dedupe vs path-keyed match ⇒ a binding that can never be released from the UI.
- `behavior.queen.ts:111` — asserts a mechanism the code does not implement; invites a migration for an inert field.
- `decoration-kind-index.ts:313` — a NAME LITERAL (`'sets'`) confers root-default write authority; federated replicas inherit it.
- `mixed-group-bag.ts:369` — collision-suffixed DISPLAY labels would become molecule names (`Bubble (2)`).
- `hive-visit.drone.ts:168` — the authoritative `name` only exists AFTER the head lookup; a "fix" here mints a key the publisher never wrote.

**Step 3 (write path / hosts)**
- `doctrine.spec.ts:413` — the regex stops at the first `)`, so passing the meta in a variable escapes the ratchet.
- `order-projection.ts:48` — the read side is dead and the guard makes `reorder` a no-op: new work would never run.
- `substrate.service.ts:577` — depth ≥ 2 overrides land under a name no new-model reader looks up; silent.
- `layer-placement.ts:144` — four readers see only `children`, so a `cells`-shaped parent reads "empty, SAFE TO WRITE" and the branch is wiped.
- `publish-branch.ts:293` — naive molecule keying overwrites the other branch's head (last publish wins).
- `publish-heads.ts:142` — the record filename IS the sealed sig, so a same-name join erases the other branch's publish act.
- `hive-link.ts:116` — the only boundary between a user-named segment and a reserved system meaning, once name keys are published.
- `publish-status.drone.ts:510/481/434` — a published hive renders as unpublished / ghost rows / marks read at a fabricated path.
- `blossom-worker/worker.js:1050` — the second path segment is discarded, so a marker read resolves to the blob (and `/…/` returns the SPA shell to a pool probe).
- `relay.js:696` — the ONLY code serving pool members and markers is labelled "legacy typed path" and will be deleted with the `__x__` cleanup.
- `replicate.js:182` — one well-formed atom whose bytes are `people` renames the whole `sign('people')` directory to a dotfile; the failure is swallowed.
- `acquire.ts:187` — a new-model package yields a frontier of ZERO and installs "ok" with an empty tree.
- `tile-properties.inheritance.spec.ts:34` — stays GREEN while every route-scoped write starts storing `{}`.

**Step 4 (mesh)**
- `swarm.drone.ts:1387` — four byte-identical copies; a partial move is a silent split-brain with no error anywhere.
- `swarm.drone.ts:2807` — the single-key publish memo swallows the second dual-publish emit.
- `relay.js:240` — NIP-33 eviction ignores `x`: a dual-publisher deletes its own presence beacon.
- `swarm.drone.ts:412` — `SIG_DIR_RE` excludes every molecule from the publish walk; publishes an EMPTY children list.
- `controls-bar.component.ts:1158` / `mesh-modal.component.ts:139` — hidden hand-rolled copies no `lineageKey(` grep finds, already wrong for punctuated names; the emptiness guard breaks the moment a 64-hex sig replaces the string.

**Step 5 (registry / ratchets)**
- `pool-registry.ts:285` — a FALSE answer is treated as licence to hard-delete, and false is what it always answers for a molecule.
- `pool-registry.ts:271` — **deriving registers**: routing molecules through `poolSignature` makes every tile name a "pool meaning" (silent, no ratchet catches it).
- `pool-registry.ts:65` — `substrate` was removed from the list while its directories still exist ⇒ they are now deletable.
- `pool-registry.ts:170` — forbids ever re-labelling two addresses that already hold members.
- `doctrine.spec.ts:564` — the ratchet, its message and its rationale all teach the retired rule to the one person best placed to act on it.
- `published-pools.ts:76` + `.spec.ts:65` — a second bare-word prohibition, thrown at module load, pinned by a spec.
- `websites-pool.ts:19/65` — plus a CONSTANT-payload seeded sentinel that, once the pool federates, permanently suppresses first-boot discovery for everyone.
- `hives-names-shape.spec.ts:149` — registers USER HIVE NAMES as pool meanings (via `putPoolDoc` → `poolSignature`).
- `layout-template.spec.ts:433/362` — **no change**: recorded so a grep sweep does not "fix" doctrine-aligned code.

---

## (c) The bare-word system pools — per-pool decision

Rule 5 gives two exits (colon meaning with a drain, or declared reserved). **Rule 9 forecloses the first for almost all of them**: an older client keeps writing to the bare address against the same OPFS, so a new spelling strands live data and rule 6 forbids a healing pass. Declaration site for ten of them is `hypercomb-runtime/src/store.ts:61-78,124,1256`.

| pool | decision | why |
|---|---|---|
| `bees` | **RESERVE** | `ensure-install.ts:669` derives pool address, OPFS write target, SW cache-seed URL and read set from this one meaning with NO old-address fallback; a rename strands every installed hive. |
| `dependencies` | **RESERVE** | import map; five independent derivations (`store.ts:62`, `acquire.ts:79`, `content-broker.drone.ts:1877`, `resolve-import-map.ts`, `shim/import-map.ts`) — an unsynchronised rename = blank shell. |
| `clipboard` | **RESERVE** | live collision already pinned: `history.service.spec.ts:2212` addresses a lineage bag at `sha256('clipboard')` (underscores fold). Pair with the `clipboard.worker.ts:1087` fix. |
| `threads` | **RESERVE** | `chat-thread.ts:27-30` already argues it; a respelling makes every existing bucket unreachable. Sub-buckets are 64-hex DIRS, so the prune guard must be shape-based. |
| `computation` | **RESERVE** | index-named receipts (`00000001`) — a third entry shape at the root; nothing gained by moving. |
| `manifests` | **RESERVE** | the children manifest IS the derived mirror older readers consult (rule 9) — the address must not move. |
| `optimization` | **RESERVE** | participant substrate truth; older clients write it. Also delete the hardcoded hex in the `store.ts:117` jsdoc. |

**Not in the doctrine's list of seven, equally ambiguous, same decision owed:**
`temporary` (`HistoryService.#TEMPORARY_MEANING`, the archive pool — an 8th) · `overrides` and `translations` (`store.ts:77-78` — the ONLY two `putPoolDoc` writes without a subKey, so they are also the two the sweep at `store.ts:257` destroys) · `viewport` (`viewport-store.ts:38`) · plus the frozen list's `authored, host-push, host-receipts, patches, push, receipts, registry, roots, structure, visual-optimization`. **`visual-optimization` is the ONE that can safely move** (`visual:optimization`, pure recomputable cache, no drain — a miss just re-optimizes). **`substrate` and `places:*` must be RE-ADDED as labels** (`pool-registry.ts:65,170`) — their directories still hold members.

Launcher group ids (`mixed-group-bag.ts:150`: `/games`, `/help`, `/websites`) are an open-ended NINTH class minted from a registry, and `websites:menu` already exists as the reserved twin of one of them — decide reserve-vs-`launch:<id>` before federation.

---

## (d) Refuted (42) — one line each

`history.service.ts:845` manifest already keyed by content sig · `:805` `head()` is dead · `lineage-key.ts:90` `rawLineageKey` is the PRE-canonical key, not the path key · `swarm.drone.ts:399` governs one OPFS name test, not federation · `:412` "invert it" would publish sigbags as tiles · `doctrine.spec.ts:405` meta atoms are truth, not derived caches · `:239` hardcoded-hex ratchet is aligned · `show-cell.drone.ts:1958` not the single retarget point; compatSig has no reader here · `hive-visit.drone.ts:146,366` **contested** (kept confirmed) · `head-index.ts:5` accepts opaque 64-hex keys, derives nothing · `tile-properties.ts:293` `index[label]` is plaintext, not `sign(name)` · `lineage-key.spec.ts:55` path distinctness is REQUIRED by rule 9 · `publish-branch.spec.ts:126,144,152` all fixtures single-segment · `conformance.rs:84` pins addresses rule 9 makes permanent · `published-pools.ts:161` `(origin, meaning)` IS the federated shape · `relay.js:679` the directory branch already exists at 657 · `:597` `resolveFlatSig` is a storage-layout probe, not a membership oracle · `group-signature.ts:23` that clause is about the string after `group:` · `order-projection.ts:82` unreachable and address-agnostic · `cell-suggestion.provider.ts:106` derives no address · `blossom-worker/worker.js:205,364` roots keys are operator NAME strings, already bare labels · `publish-branch.ts:425` unpublish is a withdrawal, not a transition act; an absent key falls back to `rootSig` · `swarm.drone.ts:3018` dead behind `MAX_PUBLISH_DEPTH=0` · `host-packages.ts:136` `hostBases` is four URL layouts of ONE zone · `host-pool.ts:24` quotes a superseded header · `acquire.ts:531` `parent` is a pool, never the root · `sweep.queen.ts:43` the 4-hex rule guards the legacy root `0000` props file · `packed-collect.ts:121` address-agnostic, never removes a dir · `chat-thread.ts:760` removes exactly the bucket it minted · `packed-interchange.spec.ts:141` already asserts rule 5 · `hive-link.spec.ts:26` KEEP — it becomes more necessary · `layout-template.spec.ts:433,362` hole-local paths / doctrine-aligned · `show-cell.lineage-cache.spec.ts:62` head-layer-sig keying is content-addressed · `enrollment.spec.ts:63` a group meaning is never a pool address · `behavior-enablement.ts:42` no sig-keyed read exists · `behavior.queen.ts:11` the sig is inert · `pruned-tiles.ts:172` re-keying while keeping the delete licence IS the hazard · `prune.service.ts:367` deleting the step disables purge · `aggregation-layer.spec.ts:47` a disjoint test namespace · `hive-pointer.ts:144` replaceable-not-mergeable is what makes rule 9 safe.

---

## (e) Coverage gaps

1. **Whole classes reached only by whole-file reads, never by any sweep** — the rule-9 mechanism itself (`commitLayer:960`, `#ensureEmptyMarker:1105`), `#segmentsBySig:1777`, `writeRecord:4419`, the two unfiltered `parseInt` allocators, `putPoolDoc`'s sweep, `registerPoolMeaning`'s registration side effect, `evictOldBagDirs`, `clearDirectory`, `replicate.js`'s renameSync displacement. A grep-by-symbol sweep cannot find a defect whose symbol is absent.
2. **`doctrine.spec.ts` SCAN_DIRS omits `hypercomb-client`** (also `hypercomb-mobile`, `hypercomb-extensions`) — precisely where the old model is frozen hardest (`generate-vectors.ts` emits the normative `vectors.json`). By the file's own rule, "a package missing from this list is an exit".
3. **Two ratchets that do not exist**: prune safety (order 56) and dual-pointer atomicity (order 138). The atomicity ratchet that DOES exist (`:502`) walks `scripts/` only.
4. **No rule-4 primitive anywhere**: `Store.getPool` returns one local handle, `RosterStore` cannot list, `sigsReferencedOutside` is local, `published-pools` speaks the wrong wire shape, `enrolledCells`/`listReferences`/`#scanTagsAcrossPages`/`#recoverVisualsAt` are all local walks.
5. **No rule-3 writer anywhere**: nothing mints a meta atom; `OrderProjection.hydrate` (the only read side) is dead.
6. **Host tier cannot carry the model**: `serve.mjs` has no directory branch; `_redirects` swallows `/<sig>/`; the blossom worker discards the second path segment and cannot WRITE a marker; `relay.js` rejects marker basenames and 422s `/hive/<pubkey>`; `replicate.js` can neither fetch nor write sets or markers; `check-host.mjs` never probes a sig subpath.
7. **Specs blind by construction**: `publish-branch.spec.ts` is single-segment only; `history.service.spec.ts` has no dual-pointer and no two-head coverage; `aggregation-layer.spec.ts` has a single-pointer heads Map; `layout-template.spec.ts` exercises only colon meanings.
8. **Conformance vectors** carry no molecule, meta-atom, dual-pointer, mixed-directory, prune-safety or mesh vectors, and nothing freezes previously published addresses.

---

## (f) OPEN DECISIONS — owner's, and one that blocks everything

**f.1 THE MOLECULE PREIMAGE (blocking, unhealable).** Is the address `sign(RAW name)` or `sign(canonicalizeLineageSegment(name))`? Computed both ways:
- raw: `sha256('My Cool Tile')` = `bc829b26…` ≠ `sha256(lineageKey(['My Cool Tile']))` = `f8da6dfd…` — so rule 2's "single-segment bags already coincide" is FALSE for every non-slug name, and `My Cool Tile` re-forks from `My-Cool-Tile` exactly as `lineage-key.ts` exists to prevent.
- canonical: canonicalization EATS THE COLON — `sha256('websites:menu')` = `17deba5b…` (the reserved pool address in CLAUDE.md) but `sha256(lineageKey(['websites:menu']))` = `3850d35c…`, so every colon system pool would be re-addressed and rule 5's reservation becomes unimplementable.
Pin it (with the empty-canon fallback for symbol/emoji names, order 70) **before any commit mints an address** — rule 6 forbids healing it. `conformance.rs:114` and `pool-registry.ts` currently disagree: the suite pins `canonicalize_segment` as the bag preimage while `PoolRegistry::address` signs the RAW meaning.

**f.2 Rule 7** — dual-publish window vs partition-by-version, plus the `relay.js:240` eviction consequence and which channel the secret-words crumb names.

**f.3 Contested sites** (one sweep confirmed, another refuted; kept as confirmed, marked `contested:true` in the JSON): `hive-visit.drone.ts:146`, `:366`, `blossom-worker/worker.js:205`. All three turn on whether the PUBLISHER upholds rule 9's path-key advance; the additive fallback is cheap and safe either way.

**f.4** Same-name convergence across routes must be **announced, never silent** (`publish-branch.ts:293`, `publish-heads.ts:208`, `clipboard.worker.ts:617`) — decide the merge semantics before the dual write ships.

**f.5** Whether hole/mark group referents (`sha256('group:'+meaning)`) converge on `sign(name)` (rule 4 hyperedge join) or stay a disjoint namespace — `meaning-target.ts`, `enrollment.ts:116`.

**f.6** Case sensitivity: `canonicalizeLineageSegment` preserves case, so `sign('People')` and `sign('people')` never join across hosts (`lineage-key.spec.ts:36/54`). Do not change the fold; record the decision.

---

## Addenda — decisions taken after this register was generated

These resolve items the register left open. The register body above is the
agents' raw output and is deliberately unedited.

**f.1 THE MOLECULE PREIMAGE — RESOLVED. The dilemma was false.** It assumes one
preimage function serves both namespaces. It does not, and the code already
reflects that (`PoolRegistry::address` signs the RAW meaning; the bag preimage
is canonicalized — not a disagreement, the design):

- molecule address = `sign(fold(canon(name)))`
- system-pool address = `sign(RAW meaning)`, untouched

The colon reservation holds **because** the two differ:
`canonicalizeLineageSegment` maps every non-letter/digit run to `-`, so its
output can never contain a colon, so no tile name in any script can reach a
colon-scoped address. Verified: `canon('websites:menu') === 'websites-menu'`
while `sign('websites:menu')` stays `17deba5b…`. Add
`moleculeKey(name) = fold(canon(name)) || String(name).trim()` — the raw
fallback is required, or a symbol-only name canonicalizes to `''` and collides
with the ROOT address. `lineageKey` stays byte-identical.

**f.6 CASE — DECIDED: FOLD IT.** The register says "do not change the fold";
that predates the owner's decision. Case folding IS the interop — a global
vocabulary in which `People` and `people` are different molecules is not a
shared vocabulary. Accepted cost: differently-capitalised tiles merge, as
same-named ones do. `lineage-key.spec.ts:36/54` must be updated, not preserved.

**Step 1 — PARTIALLY LANDED** (commit `8b7b24365`):

- order 1 — `hypercomb-core/src/core/directory-safety.ts` exists:
  `classifyDirectoryEntry`, `hardDeleteVeto` (returns the reason, so a refusal
  is never silent), `hardDeleteVetoFor` (reads a handle, fails CLOSED).
- orders 2–5 — `#quarantineNonLayerFiles` no longer pushes any `#SIG_RE` name
  onto `drop`; marker-shaped pollution is still cleaned.
- order 6 — `removeLineageBag` runs the structural veto after the registry check.
- Step 2's `prev` → `REFERENT_FIELDS` landed early in the same commit (it is a
  one-line protocol declaration and gates nothing).

Still open in step 1: order 7 (replace the recursive remove with a forward
tombstone), 8–10, 11–19 (the `parseInt` marker-shape filters — a live
corruption path: a 64-hex member whose name starts with digits is parsed as a
marker index and can mint a 9-digit name `#MARKER_RE` then rejects), 22–57, and
the spec inversions 58–67. Order 56 — **the prune-safety ratchet does not yet
exist** — is the one that keeps this from drifting back.
