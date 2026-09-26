# Deployment stages are molecules — CONVENTIONS (2026-09-25)

**Status:** doctrine direction from the owner; conventions defined by the
agent at the owner's invitation, then reviewed against the code and the
molecule doctrine by a 90-agent panel (37 findings folded in). Section 6
holds the items only the owner decides. Built: the first ruling (63cb9b515)
and §4 steps 1–3 (`stage-succession.ts`, `publish-branch.ts`,
`swarm.drone.ts`); steps 4–6 remain.

**The rulings (jwize, 2026-09-25):**
- "You shouldn't be allowed to share if you're not a host. People can still
  watch a swarm and bring stuff in, they just can't host their content. That
  gives everybody the personal responsibility of making sure the content is
  available when they join a swarm if they want to share."
- "Joining a swarm is just publishing a branch… If there are updates you can
  send them at that time. Then the lock button becomes the publish/join
  swarm button."
- "Hypergraph layers can be part of the lifecycle… a hypergraph molecule can
  become first stage of deployment and then another stage or another stage
  or however you wanna organize it."

**Built already (63cb9b515):** the host is the truth — the drain asks a host
before it sends (`host-sync.service.ts`), and the availability gate stands on
both swarm announce surfaces with no escape hatch (`swarm.drone.ts`).

## 1. The idea in one paragraph

A **stage is a word**, and a word is a molecule: its address is `sign(word)`
([hypergraph-molecule-lineage.md](hypergraph-molecule-lineage.md)). An
author's stage list is their **succession** in that molecule — the one head
their bucket `sign(stage)/<pubkey>/` holds — and a creation is **at** the
stage when an envelope over it is a member of that list. Advancing a creation
mints the author's next succession with the member added; leaving mints the
next one without it. Every prior list is one `prev` back and no byte is ever
deleted. A stranger reads the list from the publisher's SIGNED record, pinned
to the key they asked for, and that record is served by a host or it is not —
which is what *sharing requires hosting* means: your stage lists exist where
your host serves them. Watching is reading the records of the hosts you
reach; that needs no host of your own.

## 2. The stages

Three stages, each bound in code to one existing act. `hosted` is NOT a
stage: it is the requirement every stage checks (receipts for the closure on
the hosts the list is served from, `isClosureAvailable`), read from the host
at the gesture, never asserted by a claim.

| stage (word) | role in code | what entering requires | the gesture and its word |
|---|---|---|---|
| `shared` | OFFERED — announced to the participants of a zone, who can adopt it | the closure hosted; an index door answered — `join` IS the branch publish, so a joined branch is also `published` (and `live` where it wears host marks); a zone to stand in | `join` / `leave` — the lock button |
| `published` | INDEXED — a link a stranger can open: the publisher's signed index names this head, and the link bundle is receipted | the closure hosted; an index door answered; the wipe guard satisfied | `publish` / unpublish — the Publish panel row |
| `live` | OPENED — a domain's signed door opens on this head: the visitor site | `published`; a host mark on the branch; the door signed | the Publish panel's per-domain switch (`setBranchDoors`) |

The stages form a DAG, not a line: `published` needs `hosted`, not `shared`
(the publish panel publishes without joining), while `join` enters `shared`
AND `published` in one act. A creation is usually at several stages at once
and each list keeps it. A location is at a stage when the head its index
names is a member of that list; "there are updates" is that index head
differing from the location's local head, and the next gesture sends them.

Modules keep their own two acts (`trial` → `promoted`,
[module-sandbox.md](module-sandbox.md)); they are candidates for the same
shape once a second lifecycle actually exists, and are NOT rewritten by this
pass.

## 3. The rules

**R1 — The words are protocol until a second lifecycle exists.** Each stage's
requirement is code (receipts, the index round trip, the door signature), so
the three words are bound to their three roles in code and are not a data
vocabulary yet. A community that wants other words needs a mapping from words
to roles; that mapping is the lifecycle molecule, deferred to the day a second
lifecycle is real.

**R2 — Membership is an envelope in the author's stage succession.** The
bucket `sign(stage)/<pubkey>/` holds ONE head claim
(`hypercomb-core/src/core/head-claim.ts`: six-line preimage — tag, molecule,
key, head, prev, seq; the claim declares no location) naming the author's
succession atom `{succession:1, signer, prev, members:[envelopeSig…]}` — the
shape `facet-succession.ts` already writes. Each member is a life-primitive
envelope over one creation, `{meta:1, layer:<head>, relation:<stage>, root:<stage>,
slot:<order>}` — `root` is the grammar the envelope is an incidence of
(life-primitive rule 5), and that is the stage word; the creation's own word is
carried by the head it points at.
The stage pool is declared kind `succession` (`declarePoolKind`) where its
address is derived. A repeated advance to a head the newest list already
names mints nothing (`changed:false`). `seq` never goes backward: the mint
ledger the facet writer keeps (`facet:minted`) is kept for stages too.

**R3 — One signed write, two pointers, never two facts.** A stranger never
lists a directory. The publisher's signed record — the hive index
`/hive/<pubkey>` (kind 30564) today; the attested head map when
`publish-branch.ts` moves onto it per the lineage doc's migration table —
carries, in the SAME signed PUT, a pointer per stage: the root key
`stage:<word>` whose value is the sig of the author's SIGNED HEAD CLAIM for
that stage — the same bytes as the bucket file, kept as a root resource so
one GET reaches it on any host — beside the per-branch `roots` and `doors`
legacy readers keep using. A reader GETs the claim, verifies it against
`sign(word)` and the key it asked for (`acceptHeadClaim`), follows it to the
succession and checks the succession's `signer` (`headClaimAuthors`). The
local replica holds the same claim under `sign(stage)/<pubkey>/`. One act
writes both pointers; the claim is minted BEFORE the index PUT so the PUT
can name it, and a refused claim leaves the previous pointer in place (the
index and the bucket then agree on the older list). The window that
remains: a PUT that fails after the claim was minted leaves the local bucket
one list ahead until the next write carries it. `published-pools.ts` (one shared file per origin, colon meanings
only) is NOT the carrier: a shared per-origin file is last-writer-wins across
tenants and holds no bucket key to verify against.

**R4 — Advance is a forward commit; leaving is an unlink, never a forget.**
Entering appends a member; leaving mints the next succession without it
(precedent: `withdrawVocabulary` declares nothing;
[life-primitive.md](life-primitive.md) notes). The prior list is one `prev`
back and the creation's bytes stay readable by signature. Nothing is deleted
by any stage transition; `unpublishBranch` keeps its existing meaning (the
index key is withdrawn, the bytes remain).

**R5 — A claim is the author's signed word; a reader verifies it, and
re-checks availability against the host.** Every stage claim a reader keeps
passes `acceptHeadClaim` for the address the reader asked for, and the
succession's `signer` is checked by `headClaimAuthors`; a hash check alone
would accept a misplaced claim (the remote-write hole). A host attests
nothing. Whether the closure is served is asked of the host at read time
(HEAD, `probeServed`), never inferred from a claim. Requirements are checked
at the gesture: the gesture waits (the upload, the index round trip) or
refuses with one sentence naming what is missing; a stage is entered whole
or not at all.

**R6 — Stage is derived from the records that hold it, never written on the
creation.** No mark, decoration or field on the creation says its stage; any
write there would move its head and make every stage list stale. "Which
stage is this at" is read from the author's stage successions and the index.
If a listing cache is wanted it is keyed by the sigs of those successions —
the inputs that change — and lives in a derived-cache pool, never
load-bearing ([optimize-phase.md](optimize-phase.md)); the control never
gates on it.

**R7 — One control, two directions, no new words.** The lock button is
`join` (advance the public branches you stand among to `shared`, which is
the branch publish of §4) and, once in the swarm, `leave`. `publish`,
unpublish and the per-domain door switches stay in the Publish panel, one
row per creation, where they already are. No behaviour word is added:
`open`, `close` and `withdraw` are sub-words of existing behaviours and the
command line runs every behaviour word on a line. The panel shows each
row's stages (R6).

**R8 — The meeting point is the creation's location among the members of
`shared`.** A swarm for a creation meets where that creation's location
appears in `shared` lists unioned across the hosts the reader asks, for the
keys it follows or meets there (each list is read through that key's signed
index — there is no listing to walk);
liveness (who is here now) rides the relay as today — a meeting point, never
a store. Two different things are both called "zone" elsewhere; here: a
**domain** is where a branch publishes (`host:<domain>` marks, doors); a
**zone** is room + secret — tenancy: whose hosts you ask and which relay
room you stand in. The relay slot's composition (`composeSigForSegments`)
is unchanged by this document. Claims are global; a zone scopes readers, not
claims.

**R9 — Data never heals: today's records stay read sources.** `.public`
markers and `hc:public-branches` remain the participant's local intent and
the announce filter's input; receipts remain the `hosted` evidence; the
index `roots` and `doors` remain what every shipped reader resolves. The
stage pointers are ADDED to the same signed write (R3). Readers that learn
the pointers prefer them for listing and keep resolving heads and doors as
they do today; nothing is removed.

**R10 — Visitors resolve door → head through the signed index for the
pinned pubkey**, exactly as `hive-visit.boot.drone.ts` does now. `live` is a
listing for discovery ("what this publisher opened"), never the resolver: a
claim carries no domain, and a domain's many-author `sign('live')` names no
key.

**R11 — Stage words are ordinary words under the collision rule, and that
has a consequence to accept.** `sign('published')` is the molecule of every
tile named `published`; an author's tile of that name and their published
list are the SAME succession in the same bucket. Under this document that is
literal: your `published` molecule IS the place in your hive that lists what
you published. It is put to the owner in §6.2. Colon meanings stay reserved
for system pools; the pointer key `stage:<word>` in the index is a pointer's
name, not a molecule address.

## 4. What changes in the code, in order

1. **`publishBranch` mints the `published` list BEFORE the index PUT** —
   the pointer rides that write, so the claim must exist first. The member is
   an envelope over the head the index names, the branch's previous head is
   dropped, and the claim, the succession and the envelopes go wherever the
   sealed closure went (`answering`, via `markPublic` as resources) and are
   receipted beside the link bundle before `confirmed` (`stagesReceipted`).
   `stage:published` (and every stage the act names — `join` names
   `shared`) rides the same signed `putHiveManifest`. A refused signature
   returns `ok:true` with `stages.<word>: 'refused'`, never a failed
   publish. WITHDRAWAL rides the same writes: `unpublishBranch` mints the
   next `published`, `shared` and `live` lists without the withdrawn head in
   the PUT that drops the key; `setBranchDoors` enters `live` in the PUT that
   opens a door, and an empty door set is the unpublish above;
   `leaveBranches` (the swarm's leave) mints the next `shared` list without
   the roots you stood among. (`signHeadClaim`, `head-claim-signer.ts`;
   `advanceStage` / `withdrawStage`, `stage-succession.ts`.)
2. **`join` = the branch publish, per public branch root.** On the join
   gesture only — never from the heartbeat, a re-walk or `host:receipt` —
   the swarm drone runs, for each public-branch root the walk at the current
   location announces (never a single public tile, never a whole-branch
   `markPublic`), the `hosted` requirement (`markPublic` + the drain, which
   asks the host first) and mints the `shared` list; then it announces
   through the availability gate exactly as now. The announce filter keeps
   reading `.public` markers; the claim is written, not read, in this step.
   A branch not available within the publish deadline gets no member and
   the toast names it; join never flips the flag back. The boot replay of
   `mesh:public-changed` (web `app.ts:299`, dev `app.ts:286`) mints nothing:
   remember the previous flag, as `mesh-adapter.drone.ts` reads it.
   Participants who joined before this ships get lists on their next
   explicit join. At the root, the root itself has nothing to advance; its
   public branches do.
3. **`hosted` has one definition for both paths:** a confirmed receipt for
   every sig of the closure on at least one enabled target, read through
   `isClosureAvailable` — the same gate the publish panel and the announce
   walk already use. The index door is one of the nodes the bytes went to
   (`answering`), so what the pointer names is served where the pointer is.
4. **The control reads the stage of the branch you stand in** through an
   essentials service on IoC (`mesh-header` has only a boolean today), and
   keeps a single-press `leave`. The world-review step stays until the
   public subset is shown before the first join.
5. **The Publish panel reads the lists:** rows = creations with any stage
   membership; columns = the head each stage names vs the local head.
6. **Hosts derive nothing new.** A static host serves the index and the
   atoms; a relay keeps the kind-30565 claim per `(pubkey, molecule)` d-tag.
   No worker change is required for steps 1–5.

Each step is a forward commit with read-fallback and ships behind proof on
4250 (`scripts/drive-swarm-connectivity.cjs`, `scripts/drive-swarm-join-word.cjs`).

## 5. Known costs, stated plainly

- One more signed atom per advance (a succession plus one envelope), on
  every host that carries the closure. A repeated advance to the same head
  mints nothing.
- The relay keeps one head claim per `(pubkey, molecule)`: a participant's
  stage claim and a tile of the same name from the same key share it (R11).
- "Current stage" is a read across an author's successions plus the index; a
  cold listing of many creations wants the R6 cache, and cold paths must
  answer identically without it.
- The next list is planned from THIS replica's bucket and minted ledger
  (`facet:minted`), exactly as the notes facet is. A second device of the
  same key that has not replicated the bucket starts a list of its own, and
  readers keep the chain with the higher `seq` until the buckets meet. That
  is the molecule model's multi-device story, not a stage-specific one, and
  it is solved where buckets replicate, not here.
- A stage writer replaces the whole list. When a tile-succession writer for
  a molecule of the same word lands (numbered markers are still the live
  convention), the two share one bucket and one ledger (R11) and must
  preserve each other's members — or §6.2 chooses a system spelling first.

## 6. The items only the owner decides

1. **The words.** `shared`, `published`, `live` are proposed, bound to the
   three roles OFFERED, INDEXED, OPENED. They are protocol until a second
   lifecycle exists (R1).
2. **The collision, accepted or not.** Under R11 an author's tile named
   `published` IS their published list. Accept that (it is the molecule
   doctrine, literally), or give stage lists a system spelling
   (`stage:published`) — which stops a stage from being a molecule a
   participant can name.
3. **Zone required or optional.** A swarm needs room + secret today. Under
   R8 the zone is tenancy and could default to the community commons, so
   `join` on a hosted branch needs no selector. Say which.
4. **The swarm as a place (raised 2026-09-25).** Today `join` is a global
   mode (`hc:mesh-public`) and the root has no subject. The alternative:
   joining a branch re-roots the view there (as entering a site does), back
   past the entrance ends PRESENCE and nothing else, the offer stays on the
   host until it is withdrawn in the panel, and the root is never a swarm.
   Under that model the built `leaveBranches` (leave withdraws `shared`)
   comes out. Say which.

## 7. The template — the cadence of a place (decided 2026-09-25)

**The ruling (jwize):** "If somebody's hosting a swarm they should give you
a default template, and based on how much of that template you fulfil you
will see a percentage; you'll see them filled in with your content,
otherwise they'll be empty, and when you get there other people have those
tiles." Decided the same day: the template is a **declared subset** of the
host's branch, and an unfilled slot is an **empty outline**, never the
host's content.

**T1 — The template is a declared list of the host's own names.** A place is
a published branch; its children are molecules, and a name is a grammar
([template-addressing.md](template-addressing.md): the name is the
placeholder). The host declares which of those names are the cadence — a
succession in the branch's own molecule, kind `succession`, whose members
are envelopes over the branch's slot tiles, relation `template` — and the
list rides the host's signed index as `stage:template`, exactly like a
stage pointer (R3). Undeclared children are the host's content, not the
place's shape. Declaring is a panel act on the branch's row; nothing is
inferred from a branch as it stands.

**T2 — Joining superimposes, never copies.** Nothing from the template is
written into a joiner's hive. A joiner's branch whose children carry the
template's names lands ON the host's addresses — the superimposable-trees
law ([superimposition.md](superimposition.md)): same addresses, layers
stacked, differences visible. A slot the joiner has a tile for shows the
joiner's tile; a slot they do not is painted as the template's outline —
name and position, no body, no picture, no host content.

**T3 — Fulfilment is a read.** `filled / declared`, where `filled` counts
the template names the joiner's `shared` head has a member for. It is
derived from two successions (the host's template list and the joiner's
branch) and is keyed by their two sigs in a derived-cache pool; it is never
stored on a creation and never gates anything ([optimize-phase.md](optimize-phase.md)).

**T4 — Arriving shows every member's answer in the same slot.** At the place,
each `shared` member (R8: the heads listed by the keys you follow or meet
there) is a branch with the same names, so the `people` slot stacks the
host's people, yours, and every member's — one word, many authors, filtered
by whose keys the reader follows. This is what the rendezvous means: the
template is the meeting point's shape.

**T5 — Filling a slot is the visible way to contribute.** Creating a tile
with a template name inside a joined place enrols it there (create on a
holder = member in the group); fulfilment rises, and the next `join`
advance carries it in the joiner's `shared` head. A tile named outside the
template is the joiner's own, shown in their layer, counted nowhere.

**T6 — The template is versioned like everything else.** A host who changes
the cadence mints the next template succession; the pointer moves in the
same signed write. A joiner's fulfilment is always read against the
template the host's CURRENT index names, so an old percentage never
lingers, and the previous template is one `prev` back.

**What this adds to the build**, in order after §4 steps 4–6: (a) the
template list and its `stage:template` pointer (a `declare` act on the
publish panel's row, reusing `advanceStage` with the word `template`);
(b) the outline paint for an unfilled slot in the superimposed render;
(c) the fulfilment cache and its percentage on the row and at the place;
(d) enrolment of a template-named tile into the joiner's `shared` head at
the next advance.
