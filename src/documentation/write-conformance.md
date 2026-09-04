# Write conformance — the health metric for the root primitive

**Census of every write in the platform, classified against the two operations
the architecture has.** Doctrine: `the-algorithm-is-the-application.md` (the
higher order), `address-syntax.md`, `hypergraph-molecule-lineage.md`,
`optimize-phase.md`.

> Anything can combine with anything else to become a molecule, or you can add
> detail inside a molecule to make any atom a new molecule. It's only when we
> deviate from that when things get complicated.

So every write is one of three things: **wrap-up** (composition, outward),
**break-apart** (refinement, inward — inserting design, intention, meaning), or
**deviation** (neither — by definition, whatever else it claims). The write is
the only point of failure; everything else reads a structure that is already
correct or already wrong.

## How this was produced, honestly

Six parallel sweeps read the tree by area and classified 174 write sites. The
second phase — whole-file adjudication of every site against the current
source — died on a usage limit the first time and **ran to completion on
2026-09-04 (six readers, one per area; verdicts in
`write-conformance.adjudication.json`, every site once)**:

| verdict | sites |
|---|---|
| confirmed | 121 |
| fixed since the census, fix present and sound | 34 |
| refuted (reclassified) | 11 |
| fix incomplete | 5 |
| cannot locate (deleted deliberately) | 3 |

Corrected classes: deviation 57 · wrap-up 64 · break-apart 29 ·
legacy-conforming 14 · unclear 10. The deviation count did not move: eleven
refutations were bookkeeping (sites with no write at all had been counted as
conforming; notes and the substrate override are legacy-conforming, not
deviations), offset by the readers' own finds. **What the readers found that
the census had not:**

- `layer-committer.drone.ts` `#importTree` — a third scalar-dropping site the
  check-5 fix missed (paste / adopt at a fresh location lost a scalar child
  pointer). *Fixed 2026-09-04 with this adjudication.*
- `active-genome.service.ts` — the check-6 half was closed by the reader fix,
  the check-7 half was not: the service ran its own idle scheduler beside the
  optimize phase. *Fixed 2026-09-04: it arms intent and exposes `optimize()`.*
- `substrate.service.ts` `#saveRegistry` — writes a member literally named
  `registry` into `substrate:sources`: the same shape as the four pointer
  copies. **Open.**
- `packed-interchange.ts` `transfer` — copies bytes under a 64-hex name lifted
  from the source listing without hashing them (check 1). No importer today.
  **Open.**
- `publish-branch.ts` step 1 — `enablePublicHost()` unconditionally, even over
  a prior explicit opt-out (check 10). **Owner question:** is a publish the
  gesture that grants the standing public host?
- `packed-collect.ts` — the collector the census actually cited for the
  four-hat bug still credits every pool member's name and bytes with no
  pool-kind gate; under the packed store the reader fix does not reach it.
  **Open** (the OPFS reader is fixed).
- `collapse-history.queen.ts` exists — an earlier note here said it did not.
  *Retired 2026-09-04 together with `/flatten` (born `/compact`): archiving the
  middle of a history is the one act that publishes less than the participant
  had.* `archiveEntries` stays, callerless, while its hardening spec lands.
- `tutorial-provenance.ts` — the fix keys by the location's signature, which
  is the path-hashed address the molecule model retires; an improvement, not
  the parent-layer-sig key proposed. Recorded, not reopened.
- Residual nits, recorded not counted: `LayerMachine.apply` drops a scalar
  before learning the list op was a no-op; `#opportunisticMigrateMarker`
  still rewrites marker files from a read path; `replicate.js`'s directory
  refusal fails the whole job rather than one atom; `layer-graph-resolver`
  and `publishEvent` are dead code the doc said to delete and nobody has.

- Fixes are recorded inline as **FIXED (commit)** and left in place so the
  list stays a census, not a to-do. 2026-09-04: the one catastrophic item,
  the four-hat byte-scan bug, three of the four pointer copies, and the four
  publish-without-gesture sites, the life-primitive coherence item, the
  legacy-history shadow test, the layer writer's hash refusal, both host-side
  write guards, the insight catalog's kind, check 5 on the canonical write
  surface, the translation service, the swarm arrival forge, the install
  purge, the three primitive items in the history service, and two of the
  three derived-cache items (the third waits on show-cell, held by another
  session), the committer's create-reset branch, the tile-art and tutorial
  addresses, the orphaned participant base, and the fourth registry pointer —
  33 of 57 closed (one not
  reproduced; the five localStorage stores are an owner decision; the eager
  pool opens are deferred to the colon migration). Nothing at wide radius
  remains.

## The headline

| | sites | share |
|---|---|---|
| **wrap-up** | 70 | 40% |
| **break-apart** | 32 | 18% |
| **legacy-conforming** — correct for what it is, not the shape new writes take | 12 | 7% |
| **deviation** | 57 | 33% |
| unclear (no write at all; refuted on read) | 3 | 2% |
| **total** | **174** | |

**114 of 174 write sites conform to the root primitive — 66%.** The remaining
third is the work, and it is not evenly dangerous:

| blast radius of the 57 deviations | count |
|---|---|
| catastrophic — can destroy or invert live data | 1 |
| wide — a class of data, or the follow/publish graph | 24 |
| local — one feature's own records | 28 |
| none — dead code, a stale comment, an unread write | 4 |

Per area (the sweeps' own tallies): derived caches **15/22**; publishing and
mesh **49/55**; feature writes **74/83** (89%); shell and hosts **29/42**; the
commit path and the store are the remaining sites.

## The deviation list, by blast radius

`file:line symbol` — which check failed — the smallest fix. Checks are numbered
1–10 as in the conformance rules at the end.

### Catastrophic

**FIXED 2026-09-04 — deleted, with all three callers. Seal failure now surfaces
as it already did (`lastSealFailure` / `'seal-failed'`).**

**`history.service.ts:2837` `healSubtreeBags → commitLayer`** — neither
operation. It takes a node that already carries *more* detail (a legitimately
newer descendant edit) and republishes an ancestor's frozen, less-detailed hint
over it. Its own docblock at :2805–2811 admits the case. *Fix:* delete the three
automatic call sites (`snapshot.queen.ts:113`, `publish-branch.ts:226`,
`builds-slot.ts:183`) and let the seal failure surface as it already does
(`lastSealFailure` / `'seal-failed'`).

### Wide

**FIXED 2026-09-04 — a wipe-safe member is now skipped whole (`if
(!creditsNames) continue`), name and bytes; ratcheted in
`molecule-index.prune-pin.spec.ts`. The four sites below are unchanged and
conform as writes; what was wrong was the reader crediting them.**

**One bug wearing four hats — check 6.** `HistoryService.referencesOutside`
(`:4425`) correctly refuses to credit a wipe-safe pool's member *names*, but
still scans their *bytes*. So a derived record that names layer signatures pins
those layers against prune, and a cache that changes what the collector keeps is
not wipe-safe whatever it claims. *One-line fix:* gate the byte scan on the same
`creditsNames` flag that already gates the name. Sites:
- `hive-search.service.ts:263` `writeRecord` — the sharpest instance
- `active-genome.service.ts:377` `#writeDoc` — one member whose bytes enumerate
  *every* signature in the hive, so the reachability answer becomes "everything
  is shared". Also fails 7 (self-scheduled, not the optimize phase).
- `store.ts:2245` `writeChildrenManifest` — `packed-collect.ts:132–146` credits
  both the member's name (a parent sig) and every sig in its bytes
- `store.ts:1308` `#putOptimizedVisual` — the original image can never be
  collected once its thumbnail exists

**FIXED 2026-09-04 (all four — `interest-registry.ts` adopted the same writer when it landed) — `hypercomb-shared/core/registry-document.ts`
is the one writer. The pointer is gone: the master record IS the document,
written by `putPoolDoc` into its own colon-scoped DOCUMENT pool
(`registry:names` / `registry:tags` / `registry:bouquets` / `registry:interests`,
reserved in core and seeded as `document`). Reads walk back through the old
`registry/<key>` pointer and the root `0000` props; writes never do; nothing
is deleted. No `#writePointer` remains anywhere in the tree.**

**Four copies of one wrong pointer — check 1.** `name-registry.ts:150`,
`tag-registry.ts:181`, `interest-registry.ts:312`, `bouquet-registry.ts:211`
each `#writePointer` a member named by a caller-chosen human string — not
sha256, not a derivation. Consequences: GC blindness (`packed-collect` cannot
credit the target), a permanent foreign entry in a molecule-colliding address,
mutable-in-place so two readers can disagree. That the identical six lines exist
four times is itself the evidence. *Fix:* one `writeRegistryPointer(meaning,
subKey, sig)` emitting a sig-named JSON member under a colon meaning
(`registry:names` …); delete the four copies.

**FIXED 2026-09-04, all four.** The passive replication queue does no work without the host-sync opt-in (`allowed`, consulted at dispatch; intent stays durable). A learned domain is PROBED and its verified members HELD in `offeredPools`; `placeOffers` is the only path to `handler.accept` and nothing automatic calls it. The `/offers` window (`sharing/offers.view.ts`) is where the participant places or sets aside; a one-caller ratchet holds it as the only press. `ensureSwarmTarget` no longer flips the public CDN on: it answers ready / opted-out / needs-host, emits `host-sync:needs-target`, and the join shows a toast naming the yes (`/use-live-relay`, or the hosts panel). The bridge's `hive-root-set` is an ALLOW-list now — `install:<channel>` and nothing else (`bridgeMaySetRootKey`). Ratcheted in `sharing/publish-gesture.spec.ts`.

**Publishing without a gesture — check 10.**
- `passive-replication-queue.ts:90` — auto-starts at module load, fires on
  *every* commit, gated only by a localStorage flag. *Fix:* gate on the same
  predicate host-sync uses and restrict to `.public`-marked inventory.
- `published-pools.ts:238` `probePublishedPool → handler.accept` — fires on
  `domain:learned`, which `#learnHost` emits on a visit. A host declaring what it
  holds becomes a host *placing* it. *Fix:* `accept` writes a PENDING record and
  a gesture promotes it.
- `host-sync.service.ts:322` `ensureSwarmTarget` — the gesture was "share these
  tiles with these people in this zone"; the act performed is "upload bytes to a
  named third party". *Fix:* return a needs-a-host signal; the swarm-join surface
  takes the yes.
- `hive-link.ts:135` `BRIDGE_FORBIDDEN_ROOT_KEYS` — by omission:
  `HIVE_FORMAT_ROOT_KEY` is settable over the bridge with no gesture, for the
  same reason `vocabulary:hive` was. *Fix:* add it — better, invert to an
  allow-list of `install:*`.

**Check 5 on the canonical write surface.** *FIXED 2026-09-04 — the machine carries scalar slots verbatim (a list op on one replaces it, explicitly); the committer's `update` passes non-array values through as `scalars` instead of discarding them. Tests in `layer-machine.spec.ts`.*
`layer-machine.ts:121` `fromLayer`
drops any scalar slot (`if (Array.isArray(v) && v.length > 0)`), and
`layer-committer.drone.ts:634` `update` does the same one layer up — a scalar
slot silently vanishes and `output()` can never write it back. `level-roster.ts`
states scalar slots exist. *Fix:* carry non-array slots through verbatim.

**Deletion — check 2.** *gcLegacyHistory FIXED 2026-09-04: the shadow test
compares bytes, so a diverged legacy marker keeps the folder. The
`collapse-history.queen.ts:76` site: an earlier note here wrongly said the
file did not exist. It did, unchanged; the adjudication caught it. The
behaviour is RETIRED 2026-09-04 with /flatten.*
- `history.service.ts:559` `gcLegacyHistory` — the shadow test is by *name*
  only and `#copyBagInto` never overwrites, so on a same-name divergence the
  legacy copy is never copied and then destroyed. *Fix:* compare content, or
  require the legacy marker to resolve to a layer sig present at the root.
- `collapse-history.queen.ts:76` — `enumerateBags` deliberately no longer skips
  pool addresses, so this loop removes markers from directories it has proved
  nothing about. *Fix:* restrict to bags this participant has a head for.

**The primitive itself — check 1.** *FIXED 2026-09-04 — the layer writer refuses a hash mismatch like its siblings; the host-fetch write-through was its most exposed caller.*
`store.ts:1910` `writeLayerBytes` — its two
siblings twelve lines away (`writeBeeBytes`, `writeDependencyBytes`) hash the
bytes and refuse on mismatch; the layer writer does not. *Fix:* the three lines
the siblings already have.

**Hosts — checks 2, 3, 8.** *Both FIXED 2026-09-04: the relay's PUT refuses any path with more than one segment; the replicator refuses to write an atom over a directory (test added).*
- `relay.js:909` `tryWriteContent` — the sig check pins the bytes and nothing
  about the *place*; `mkdirSync(dirname(resolved), {recursive:true})` lets an
  authorised writer choose a directory. *Fix:* reject any PUT path with more
  than one segment.
- `replicate.js:182` — `existsSync(finalPath)` is true for a *directory*, and
  the content root demonstrably holds sig-named directories (the pool-listing
  branch serves them); `renameSync` then `rmSync` a pool. The `/flatten` hazard
  on the host side. *Fix:* refuse to write an atom over a directory.

**Drift from the Life Primitive.**
- `life-primitive.ts:41` `MetaEnvelope.root` — documented as "stable canonical
  grammar name", **never set by any writer**. The molecule model's incidence
  needs it. *Fix:* `Store.ensureArtifactMeta` sets `root` to the folded
  canonical name when the incidence names a reference to a named artifact.
- `host-sync.service.ts:89` (also `active-genome.ts:95`,
  `website-archive.queen.ts:55`) — a local copy of `CHILD_SLOTS`, which core
  owns and `healLegacyLayer` imports. *Fix:* import it.
- *FIXED 2026-09-04 — one call through `writeTilePropertiesAt`; reads through `readTilePropertiesAt`; ratchet `translation.write-surface.spec.ts`.* `translation.service.ts:415` — writes translated props into a device-local
  index and never touches the layer; checks 1 and 3. *Fix:* one call through
  `writeTilePropertiesAt`.
- *FIXED 2026-09-04 — seeded `document`.* `tree-insight.ts:96` with `pool-kinds.ts:129` — `insights:catalog` is
  declared `index` (wipe-safe) but is a per-participant current document; a
  collector may wipe a hand-authored record. *Fix:* one seed line → `document`.

### Local

- *2026-09-04 — `ManifestOptimizerDrone.enqueue(parentSig, childSigs)` is the door; the two show-cell writes are left for the session that holds that file dirty: replace each `store.writeChildrenManifest(...)` with `optimizer.enqueue(parentLayerSig, childSigs)` and delete the render-path build.* `show-cell.drone.ts:666`
  `resolveChildNames` and `:708` `upgradeThinPack` write children manifests
  from a paint, making a second and third writer of a record
  `manifest-optimizer.drone.ts` owns. *Fix:* push the parent sig into the
  optimizer's `#pending` set; delete the writes.
- *FIXED 2026-09-04 — `writeRecord` refuses a truncated record: not to disk, not to the memo.* `hive-search.service.ts:213` — a record keyed by a content sig that is not a
  pure function of it (it depends on where the walk arrived). *Fix:* return
  `null` for a truncated record; guard the write.
- *FIXED 2026-09-04 — `history/marker-meta.ts`: one current record per marker layer sig in the `history:marker-meta` document pool; the marker file is never rewritten; readers union legacy in-marker fields (record wins).* `history.service.ts:4338` `setMarkerMeta`, `:4653` `stampMarkerSig` — in-place
  mutation of a marker under a non-content name; break-apart in *intent*,
  implemented as an overwrite. *Fix:* a sig-addressed record in a colon pool
  keyed by the marker's layer sig.
- *FIXED 2026-09-04 — deleted with the whole delta-record path (`writeRecord`, `listRecordSigs`, `resolveDeltaRecord`, `hydratedStateAt`, `delta-record.ts`, `delta-reducer.ts`); nothing called it.* `history.service.ts:4746`/`:4757` `writeRecord` — a content atom inside a bag
  (one-folder-shape violation) and a second, incompatible marker shape that
  `purgeNonLayerFiles` classifies as pre-merkle and drops. *Fix:* delete;
  nothing reads it.
- *FIXED 2026-09-04 — both reset sites (the name-add branch and the import path's "fresh" hydrate) link the head; `cell:fresh` and its listener are gone; ratchet `history/create-links-head.spec.ts`.* `layer-committer.drone.ts:1199` the create-reset branch — the one place the
  commit path deliberately publishes a *less*-detailed head over a live one.
  *Fix:* link the existing head (as `revive: true` already does).
- *2026-09-04 — deleted: `HiveParticipant` had no subclass and no importer but the generated barrel; the notes drone never adopted it.* `hive-participant.ts:439` — `idOf(item)` (content) becomes a path segment;
  checks 3 and 4. *Fix:* derive the location from `sign(bodySig)`.
- *FIXED 2026-09-04 — the member is `moleculeAddress(name)`; the lowercased name is a read-fallback.* `tile-art.ts:107` — the pool key is `name.trim().toLowerCase()`, not an
  address. *Fix:* `moleculeAddress(name)`.
- `notes.drone.ts:1008` `#writeNoteLayer` — **the Life Primitive and the
  molecule model have drifted apart here.** Every *layer's* artifact references
  are healed into meta envelopes; a note's children are put raw. *Fix:* map
  each child through `store.ensureArtifactMeta('resource', childSig, {relation:
  'note'})`, the one-line call `tile-properties.ts:820` already makes.
- *FIXED 2026-09-04 — hashed before any write, written only on a match, and with emit:false so a peer's bytes never become this participant's publish; ratchet `swarm-resource-arrival.spec.ts`.* `swarm.drone.ts:3225` — a resource event's bytes are stored before the sig is
  checked. *Fix:* hash first, write on match.
- *FIXED 2026-09-04 — the sub-bucket is the location's own signature from `history.sign`; the path key is a read-fallback; no signer means no write.* `tutorial-provenance.ts:82` — a NEW sub-bucket address minted from a path;
  check 4. *Fix:* key by the parent layer sig the record already resolves.
- *FIXED 2026-09-04 — `purgeInstallCacheDir` removes a file only if named like an install artifact and a directory only past `bagEvictionVeto`; tests in `install-purge.spec.ts`.* `ensure-install.ts:983` `purgeStaleOpfsArtifacts` — the one `purgeDir` in that
  file not routed through `hardDeleteVetoFor`. *Fix:* one line, same guard as
  its neighbours.
- *FIXED 2026-09-04 — deleted with `memoize.ts` and `expand.ts`; nothing imported any of the three.* `projection.ts:42` — a memo keyed by a *name* in localStorage; checks 6 and 7.
- *OWNER DECISION, 2026-09-04: each of these is a feature's state store moving into a pool — five designs, not five fixes. Left open on purpose.* **Participant state outside the graph — check 1.** `tile-properties.ts:284`
  (`hc:tile-props-index`), `saved-locations-store.ts:49`,
  `pinned-entrances.store.ts:178` (keyed by a *path*, check 4 too),
  `recent-portals.store.ts:191`, `icon-override.store.ts:75`. Each is a
  "fourth thing": recomputable or authored state that could be a colon-scoped
  pool with sha256-named members. A saved location *is* a molecule per the
  higher-order doc.
- *DEFERRED 2026-09-04 with reason: 54 readers hold these as non-optional handles; opening lazily is a wide seam change, and the colon migration that retires the bare words is the real fix.* `store.ts:456` `#doInit` — opens nine bare-word pools eagerly, minting nine
  empty molecules on every boot. *Fix:* open lazily; the colon migration is the
  real fix and is already scheduled.

### None (recorded so nobody re-audits them)

- `nostr-mesh.drone.ts:565` `publishEvent` — hands an attacker-supplied object
  back unsigned; nothing calls it. *Fix:* delete.
- `show-cell.drone.ts:8051` `#persistLayoutMode` — writes a key nobody reads.
  *Fix:* delete.
- `layer-graph-resolver.service.ts:83/92` — fetches by sig and caches *unverified*
  bytes under the sig it asked for; unreferenced. *Fix:* delete the file.
- `native-filesystem.ts:316` — a docstring contradicted by `store.ts:256`.
- `serve.mjs`, `host-pool.ts:106` — refuted; no write, correct.

## Legacy-conforming — NOT a defect list

12 sites write path-keyed bags or legacy marker shapes. They are correct for
what they are: **nothing migrates**, old data stays readable where it is, and
these are not the shape new writes take. They are listed in `census.json` and
are excluded from the deviation count on purpose.

## Life-primitive coherence

**RESOLVED 2026-09-04 — `documentation/life-primitive.md` now exists and is
the doctrine the code cites.** The four private `CHILD_SLOTS` copies import
core's roster (ratchet: `history/child-slots.ratchet.spec.ts`). `root` is
recorded as RESERVED for the molecule's envelope writers, which have not
landed — not a defect in either live minter. Notes are recorded as the one
known legacy writer, read-compatible and carried by every closure; their
forward path is the `notes:<sig>` facet, a deferred forward commit, not an
in-place fix. The paragraphs below are the census's original finding.

Asked directly: is the molecule model redundant with the Life Primitive? **No —
they meet at exactly one place and have drifted at three.**

The Life Primitive (`core/life-primitive.ts`) is the *reference* mechanism:
every artifact reference is a meta envelope declaring one typed payload hop,
alternating `meta → layer → meta → layer`, so any referenced feature can become
the root of another tree. The molecule model is its *naming* layer: the
incidence `{meta:1, layer:<vertexSig>, root, relation, slot}` **is**
`MetaEnvelope`. The two recursions are one recursion stated from opposite ends.

The drift: `root` is documented and never written (`life-primitive.ts:41`);
notes bypass the envelope entirely (`notes.drone.ts:1008`); and three files keep
a private copy of `CHILD_SLOTS`. And **`documentation/life-primitive.md` does not
exist** while `edge-registry.ts` cites it — the most foundational rule in the
codebase is code-only with a dangling reference.

## The ratchet

The full census cannot be recomputed mechanically, so it is frozen as a list
(`documentation/write-conformance.census.json`) and the *checkable* subset is
ratcheted. Two of the ten checks are already ratchets in `doctrine.spec.ts`
(recursive removal consults directory-safety; no `parseInt` over an entry
name). Add these — **allowlists that may only shrink, never grow:**

```ts
// doctrine.spec.ts — write conformance
it('children manifests have exactly one writer, and it lives in the optimize phase', () => {
  // check 7. show-cell.drone.ts:666 and :708 are the debt; remove them from
  // this list when they enqueue into the optimizer instead of writing.
  const writers = filesMatching(/\bwriteChildrenManifest\s*\(/, SOURCE_DIRS)
  expect(writers.sort()).toEqual([
    'hypercomb-essentials/src/history/manifest-optimizer.drone.ts',
    'hypercomb-essentials/src/presentation/tiles/show-cell.drone.ts',
  ])
})

it('participant state outside the graph may only shrink', () => {
  // check 1. Every localStorage.setItem in a non-spec source file is a
  // "fourth thing" until it becomes a pool. Frozen at the census count.
  const writers = filesMatching(/localStorage\.setItem\(/, SOURCE_DIRS)
  expect(writers.sort()).toEqual(FROZEN_LOCALSTORAGE_WRITERS) // 2026-09-03: the census list
})

it('a registry pointer is a signature, never a caller-chosen name', () => {
  // check 1. The four #writePointer copies; delete entries as they move to
  // putPoolDoc with a subKey under a colon meaning.
  const pointers = filesMatching(/#writePointer\b/, SOURCE_DIRS)
  expect(pointers.sort()).toEqual([
    'hypercomb-essentials/src/pheromones/bouquet-registry.ts',
    'hypercomb-essentials/src/pheromones/interest-registry.ts',
    'hypercomb-essentials/src/pheromones/name-registry.ts',
    'hypercomb-essentials/src/pheromones/tag-registry.ts',
  ])
})

it('a layer writer verifies the bytes it is handed', () => {
  // check 1 at the primitive. writeLayerBytes must do what its siblings do.
  const store = read('hypercomb-runtime/src/store.ts')
  const body = store.slice(store.indexOf('writeLayerBytes'), store.indexOf('writeBeeBytes'))
  expect(body).toMatch(/SignatureService\.sign\(/)
})
```

## The runtime probe (design only)

A dev-only wrapper on the store's write surface, asserting the checks at the
moment of the write — where the address is a real value rather than an
expression, which is what static analysis cannot see.

- Wrap `putResource`, `putPoolDoc`, `writeLayerBytes`, `commitLayer`,
  `removeEntry`, `setRoot` behind one `probe(op, address, bytes, meta)` when
  `localStorage['hc:write-probe'] === '1'`.
- Per write: hash the bytes and compare to any sig-shaped address (check 1);
  refuse to log a removal whose target directory fails `hardDeleteVeto` (2, 8);
  flag any address segment that appears verbatim in the payload (3); flag a
  multi-segment `lineageKey` preimage on a new address (4); flag a scalar in a
  plural slot or an array in a singular one (5); flag 64-hex strings in a record
  written into a derived-cache pool (6); flag any derived-pool write whose stack
  does not pass through `optimize()` (7); flag any host PUT with no gesture token
  on the call (10).
- **Never blocks a write.** Logs `[write-probe] <check> <op> <address> <stack>`
  and counts per check into `sign('probe:writes')` — a derived, wipe-safe
  record keyed by the session, so the probe follows the pattern it enforces.

## The ten conformance checks

1. The name is the content — `sha256(canonical bytes)` or a stated derivation.
2. Writes append, never remove — a removal is of a named set the caller proved
   is its own.
3. The bytes do not choose the address.
4. New addresses are derived, not path-hashed (existing bags are legacy, not
   defects).
5. Plural is an array; singular is a scalar.
6. A derived record holds no layer signatures.
7. Derived is minted only in the optimize phase.
8. A recursive removal consults `directory-safety`.
9. No directory entry name is parsed as a number.
10. Publishing is an act — nothing leaves the machine without a gesture.

## Coverage gaps

Reported by the sweeps themselves: no runtime verification (every claim is
static); `hypercomb-client` (Rust) and the conformance vectors unread;
`hypercomb-shim/dist` unscanned; the ~200 indirect `history.sign({
explorerSegments })` callers were sampled, not enumerated; and — the largest
gap — **the adjudication phase never ran**, so nothing above has had a second
reader.
