# Hive intelligence

**Status: DESIGN — agreed in conversation 2026-11-03 (Jaime). Not built as a
store. Not a codex axiom.** The anatomy teaches the codex. This page is the
argument. It becomes what a model is taught only when the participant commits
a doctrine section (`C5`).

A pure brain that agents address in sentences. Only verifiable truths govern
it. Private use teaches a graph. The proofs people solve and publish are the
lineage of science, and that lineage is the collective public brain: one
stamp at a time, public to all and from all, faster and more mature as it
grows.

Read it in this order. [What governs](#what-governs) is the law.
[What it is made of](#what-it-is-made-of) is the private machinery: pieces,
axial geometry, and the calculus. [Taught by use](#taught-by-use) and
[The graph](#the-graph) are how this hive learns to move.
[The lineage of science](#the-lineage-of-science) is the public brain.
[One walk](#one-walk) runs a single act through both. [Bounds](#bounds)
restates the law as refusals.

Companions:

- [frames-and-patterns.md](frames-and-patterns.md) — the shape a frame reads
- [collapsed-compute.md](collapsed-compute.md) — the same inputs are one result
- [llm-primitive.md](llm-primitive.md) — a sentence writes pieces
- [anatomy-context-need.md](anatomy-context-need.md) — what a call is resent
- [optimize-phase.md](optimize-phase.md) — a derivation is never truth
- [pheromones.md](pheromones.md) — an interest stays private
- [insights.md](insights.md) — a path does not cross a participant boundary
- [the-algorithm-is-the-application.md](the-algorithm-is-the-application.md) — a molecule is an atom one level up
- [model-mediation-and-the-training-prompt.md](model-mediation-and-the-training-prompt.md) — a sentence is the proposal
- [speak-dont-bridge.md](speak-dont-bridge.md) — an agent changes the hive by a sentence
- [hive-say.md](hive-say.md) — anything that speaks HTTP can say that sentence
- [every-act-has-a-word.md](every-act-has-a-word.md) — an act with no word cannot be said
- [history-sigbag-as-root.md](history-sigbag-as-root.md) — a marker names one whole signature
- [install-by-replication.md](install-by-replication.md) — bytes arrive because a follower asked

## The brain

This is a pure brain that agents can communicate with.

Pure means the whole state is checkable. That state is the pieces, the axial
differences, and the use attributes. An agent reads each one by signature and
adds to it by a sentence the hive runs. The addition is a new signature.
There is no weight file, no hidden session inside the brain, and no second
channel beside the hive's language (`C2`).

An agent speaks the way a participant speaks. The sentence is said on the
command line. A session outside the browser carries that sentence in
([speak-dont-bridge.md](speak-dont-bridge.md), [hive-say.md](hive-say.md)).
The hive answers with what it heard and with the signatures the sentence
committed. When the agent asks for a way onward, the brain answers with the
graph's next sentence and with the truths whose hashes match. The agent
proposes. The participant runs (`C4`). Any agent that can say a sentence and
read a signature uses the same brain, because the same bytes are the same
signature.

The model stays outside the hive. Depth is a longer chain of truths the next
call can inflate.

## What governs

The brain can be governed only by verifiable truths. A verifiable truth is
one any hive can check. Two checks exhaust it.

| Check | What holds | Doctrine |
|---|---|---|
| Math | The same signed inputs recompute the same difference. The axial lattice and the software parameters are that math. | the functions in [Axial geometry](#axial-geometry) |
| Bytes | SHA-256 of the canonical bytes is the signature. An unverified byte is never written. | `I1`, `S3` |

A summary yields to the bytes it summarises (`D5`). What the hive returns
from those bytes is what a later call may treat as truth (`C1`).

A sentence, a model, a session, a memory, and a count may propose. None of
them governs. A proposal becomes intelligence when one of the two checks
holds, and only then may it be spoken, kept, and taught. An open frontier is
a direction. It governs nothing until it checks.

## The language

The government is narrow. The language is wide.

The hive's language is the behaviour sentence. Every act has a word, the
words of a line run in order, and a participant or an agent can say a
discovery, a name, a question, a walk, or a doubt
([every-act-has-a-word.md](every-act-has-a-word.md)). That sentence is the
platform for discovery, for meaning, and for philosophical contemplation.

A thought can be said before it is a truth. A quiet region can be walked
before a corridor agrees. A meaning can be named and held as a piece while
the contemplation continues. Mathematicians and scientists can stay inside
an open difference and speak it, in the same language that later carries the
checked step.

The width does not widen what governs. A sentence of contemplation is a
proposal and a record of use. It is sayable, readable, and reinforceable.
It becomes intelligence when a check holds.

## What it is made of

Three concepts are the intelligence. Anatomy, context, and need are how a
call reads and runs them
([anatomy-context-need.md](anatomy-context-need.md)).

### Pieces

A piece is a signature the next call can inflate. Training is committing
one: a layer, a resource, a shape canon, a finished answer, or a use
attribute. The same inputs return the stored piece (`A6`). A piece that
describes this machine stays here. A layer reaches another reader when a
follower replicates it (`T1`).

A conversation has no memory between calls. The pieces its turns committed
are the memory (`H6`).

### Axial geometry

A pattern is the reusable spatial atom,
`{ kind: 'pattern', name, coords, step }`, stored as its own resource
([frames-and-patterns.md](frames-and-patterns.md)). A frame points at that
resource with `patternSig` and does not copy the coordinates.

A pose is `(q, r)` with `s = -q - r`, so the three numbers are a plane. The
six neighbor steps are the basis. East is `(+1, 0, -1)`. The other five are
its rotations. `patternPixel` is linear in `(q, r)`, so `k` repetitions of
`step` are the same rigid move on the lattice and on the screen.

The canon of a shape is computed, never authored. Translate so the minimum
cube is the origin, try the six 60° rotations, and keep the lexicographically
smallest coordinate list. That canonical signature is the shape. A rotated or
shifted copy is an edge `rotate:k` on the same node.

Stride, scroll order, bounds, and `slotAt` are pure functions of the pattern
and the scroll parameter (`sequence/pattern.ts`). Stride is the count of
slots with no neighbor one `step` further along. Identical patterns are one
signature.

A canon record is a derived index: keyed by the pattern signature, complete
or absent, rebuilt on a miss (`D1`, `D2`). Nothing load-bearing points at
it. Use counts stay in the heat ledger, outside those bytes, so a later look
does not mint a new signature.

### The calculus

A state is three things side by side:

- the hive at one marker, named by a signature
- an axial pose
- the software parameters the words read or commit: `step`, scroll offset,
  spacing, zoom, and the settings a behaviour accepts

A natural-language line is the operator. The command line runs each behaviour
word in order. Each word's `forms` are the arguments it accepts. A word that
commits writes the next marker when it happens (`H5`). The sentence is a
path of signatures. The participant sees the sentence before it runs.

| Difference | Held still | Result |
|---|---|---|
| One neighbor (`0`–`5`) | the pattern and every parameter | the next hex |
| `pattern.step` | the coordinate set | a new pattern signature, a new stride, a new scroll order |
| Scroll offset by 1 | the pattern signature | the same slots; tiles shift by one `step`; stride leave and stride arrive |
| Spacing or zoom | the axial coordinates | a different chart on screen; the signatures stay |
| One committing behaviour word | the other words in the sentence | the next marker |

`slotAt(order, stride, position, offset)` is the arrangement at parameter
`t = offset`. `maxOffset` is the last `t` that still shows a tile.

Scroll offset is a viewing position. The frame record keeps `patternSig` and
does not keep the offset (`sequence/frame-target.ts`). Zoom is the same kind
of variable. Turning either one does not mint a shape. Spacing scales the
chart. A parameter that enters the canonical bytes, such as `step` or a
committed setting, is part of the signature. A parameter that stays in the
chart is not.

The chain rule is inflate, apply the sentence, sign the result. The same
pattern signature, the same `step`, and the same words produce the same
result signature
([collapsed-compute.md](collapsed-compute.md)). Walking the sentence, or
walking the scroll from `0` to `maxOffset`, is the sum. Each commit leaves
a piece.

## Taught by use

The teacher is an act this hive actually ran. A random corpus does not teach
it. Each committing act, and each chart move worth remembering, writes one
attribute. This hive learns by reading the attributes whose `on` is the
signature in front of it, and by proposing the word and the delta that left
a piece.

The local session stays the training set: the order of acts, the frames, the
offsets, the interests, and the heat counts. Interests never travel (`R3`).

### The attribute

The lesson that can leave the machine is one small record. Its signature is
the lesson. The bytes are a sig-named file (`S1`). A pool only lists
membership (`P6`).

```json
{
  "kind": "use",
  "op": "scroll",
  "pose": { "n": 1 },
  "param": "offset",
  "delta": 1,
  "on": "<sig>",
  "out": "<sig>"
}
```

| Field | What it holds |
|---|---|
| `op` | The behaviour word, from the census |
| `pose` | The axial difference: a neighbor `n` in `0`–`5`, a rotation `rot` in `0`–`5`, or a `step` of `{q, r}` |
| `param` | The software parameter that moved |
| `delta` | How far it moved. The private absolute value stays on this machine |
| `on` | The signature the act read: a pattern canon or a layer |
| `out` | The piece the act left. Omitted when the act only moved a chart parameter |

The record carries no author, no path, and no clock. A path is
participant-relative and stays behind ([insights.md](insights.md)). The same
act anywhere else is the same bytes and the same signature, so a community
stores the file once (`A6`).

A use attribute is not a pheromone. A pheromone is an authored, signed claim
that travels with content (`R1`). An attribute names the act.

When this record is built, the list that holds its signatures is the colon
meaning `use:attribute` (`P4`). It is not seeded. A host lists the signatures
it has been given. A follower unions that list and fetches the bytes by
signature. Presence is the teaching: a hive standing on that `on` can see
which word and which delta left a piece.

Publishing an attribute is a separate act from running it (`T5`). An
attribute whose `on` is a note only one hive holds still points at that note.
The attributes meant for the community are the ones whose `on` is a canon, or
a piece others can already replicate.

## The host carries the resource

A resource is content. It stays on a host or a server. This machine does not
carry the intelligence dump.

The hash is the signature of the arguments. Canonical JSON, keys sorted, is
the bytes that are signed, and SHA-256 of those bytes names the pool member
(`I1`). The member file holds the domain and the answer's own signature.
That signature retrieves the resource:

```text
GET https://<domain>/<answer>
```

The body is accepted when it hashes to the answer signature (`S3`, `T2`).
When the served bytes are the canonical arguments, as with a cube record,
the answer signature and the arguments hash are the same. A cube record is
accepted when that hash holds and `s = -q - r` recomputes from the signed
`q` and `r`. A miss on either check is a miss. The bytes are not written
into the group.

What this disk passivates is the group, so many problems stay easy to manage.
The directory is `%LOCALAPPDATA%\hypercomb\intelligence\<group>\`. `group.json`
names the problem. A second problem is a second folder. Each result is a
member of the pool `intelligence:<group>`. The pool directory is the
signature of that meaning. The member's name is the hash of the arguments.
The file holds the domain and the answer's own signature. The resource is
not in the pool. `GET https://<domain>/<answer>` keeps the body only when
it hashes to the answer signature.
`scripts/intelligence/disk.cjs` is the trial. The `use:attribute` pool is
still not seeded.

Type `/intelligence`. That word is the prompt that asks Windows for a folder.
The browser opens its directory picker (`showDirectoryPicker`, read and
write, id `hypercomb-intelligence`). The folder you grant is the intelligence
root. It uses this same layout: one folder per group, `group.json` for the
problem, and the pool `intelligence:<group>` for each result. The page writes
`group.json` with the folder writer the backup already uses. The first press of an empty
folder writes the group `lineage-of-science`, whose problem is "The public
proofs the community stamps". A later press, while the grant still holds and
the folder is still there, starts without asking again.

The grant can lapse. The folder has not given up its rights; this page no
longer has them. `/intelligence` then says the folder is disconnected and
does not open a second prompt. `/intelligence reset` is the press that asks
Windows again. A cancelled prompt leaves the previous grant as it was.

The Windows index is that same layout at
`%LOCALAPPDATA%\hypercomb\intelligence`. Grant that folder when the picker
opens. The picker remembers the grant after that choice.

One member is recorded in the pool `intelligence:lineage-of-science`. The
arguments are `{"name":"synthesia"}`. Their hash is
`002335a75f57d40ee55d0e528c953034d1c794d72a5e3da4d35d0913fda8460f`.
The member's domain is `jwize.com`, and its answer signature is that same
hash because the served bytes are the canonical arguments. `GET https://jwize.com/`
plus the answer signature returned those bytes.

The east cube is the second member. The arguments are `{"q":1,"r":0,"s":-1}`.
Their hash is `e2a2d63fd924a7577aecb6e432e279762ff2d4e49bc195601af708a92ae60803`.
`jwize.com` serves those bytes. `check` kept them: `q` is 1, `r` is 0, and
`s` recomputes to -1.

The scroll attribute is the third member. Its canonical bytes are
`{"delta":1,"kind":"use","on":"c09a2a3275e57e82f8fe26ada9486dc23037a8c8cadde8e77bb9c2d866a7ff86","op":"scroll","param":"offset","pose":{"step":{"q":1,"r":0}}}`.
Their hash is `3314f286cb1aa87a30322c071ed72996a98a49a0b671e9d434a90a4ab70f510e`.
The member file holds `jwize.com` and that same answer signature. `on` is
the one-cell pattern
`{"coords":[{"q":0,"r":0}],"kind":"pattern","step":{"q":1,"r":0}}`,
hash `c09a2a3275e57e82f8fe26ada9486dc23037a8c8cadde8e77bb9c2d866a7ff86`.
`jwize.com` serves those pattern bytes too. The pattern is the signature
the attribute names. It is not a pool member. `graph` names the one edge.
`check` refuses the attribute: it has no finite `q`, `r`, and `s`. The
`use:attribute` pool stays unseeded.

`intelligence get --group <name> --arguments <file>` hashes the arguments,
reads that member, and fetches `https://<domain>/<answer>`. No member means
no request. `--answer <file>` on `ref add` stores a signature other than
the arguments hash. `graph --group <name>` fetches each member and names
each use attribute.

A model call does the same lookup in the folder `/intelligence` granted.
The arguments are the provider, the model, and the messages. A matching
member is fetched and spoken, and the model is not called. When the call
was open and the model answers, the page records the member and keeps the
answer bytes in the pool `intelligence:answers`. The next identical ask
reads those bytes and does not call a host. No grant, no member, a tool
call, or a picture leaves the call open.

## The graph

The graph is a reading of the attributes, keyed by `on`. It is derived. A
cold hive retrieves the attribute bytes from the hosts named in its groups
(`D1`). It does not keep a second copy of the dump. An edge is
one attribute: from `on`, along `pose` and `(op, param, delta)`, to `out`
when the act left a piece. `graph` on the lineage-of-science group reads
the published scroll attribute and skips a name and a cube. The corridor,
the heat ledger, and the frontier offer are still the reading described
below.

Repeated attributes draw the walls. Where many attributes agree on the same
word and the same axial step, the reading shows a corridor. Where a few
attributes stand on a signature the corridor skips, the reading shows a
region that has been fed. Both are visible together. That is the organic
side: the comb grows only where use has been spent, and the thick trails and
the newer cells are one picture.

### Optimal navigation

From the signature in hand, the candidates are the attributes that name it.
Group them by `(op, pose, param, delta, out)`. The step the most attributes
agree on is the offered next step. Agreement is presence: how many hosts
list that attribute signature, and, on this machine, the heat of running it.
The count stays in the heat ledger, outside the attribute bytes.

When two poses tie, the shorter cube distance wins. Cube distance is
`max(|dq|, |dr|, |ds|)` with `s = -q - r`. The offer is a sentence the
participant can run: the word, the pose, and the delta. The graph reveals
it. The participant runs it. A route with no attribute behind it is not
offered.

### Reinforcement

The participant is the source of variability. When the corridor is too
narrow for what they need, they use another area. Standing there and
committing acts writes attributes whose `on` is that area. The corridor
remains. The fed area appears on the graph because its attributes exist.

Reinforcement is that use. It is not a second score, and it is not a
pheromone. A region the participant keeps working becomes a place navigation
can offer beside the corridor. A corridor left unused falls in priority as
its heat drops. The attribute bytes remain. The preference is what fades.

On this hive the graph includes the session, so a region being fed is
visible here before any attribute is published. The community graph is the
union of published attributes. A participant's choice to thicken a quiet
area reaches the community as those new attributes, with no author on them.

### The frontier

The standing direction is the cutting edge of mathematics and science. The
brain points the people who work there toward that edge.

A settled corridor is work the attributes already agree on. The frontier is
the open difference just past it: a pose no attribute agrees on, a call
whose answer is not yet a file that hashes to its name, a piece that does
not yet collapse into a canon others hold. The offer from a settled
signature is the shortest checked step that lands on that open difference.
An agent receives the same offer as a sentence.

Mathematicians and scientists are the participants who commit those new
truths, and the agents that read and propose beside them. The brain points
at the open work. The attribute still names no person. Their published
pieces are how other hives hold the frontier and check it.

When the bytes hash and the attributes agree, that difference becomes
corridor. The frontier moves to the next open difference. Settled work
becomes the wall. The direction stays the edge.

As the frontier increases, so does the intelligence. Each settled difference
is a piece the next call inflates, and each new open difference is a
direction the brain can offer. A farther edge is a longer chain of truths
behind it and a wider set of open work in front of it. The brain is that
chain and that edge. A hive that holds more checked pieces answers more of
its sentences from the file, and points what remains at a frontier a smaller
brain could not reach.

A scientist who needs room beside the corridor feeds that region by use.
The graph shows the fed region and the open edge together.

## The lineage of science

The lineage of science is the part of the brain the community shares. The
people who solve the proofs are the ones who provide it. It is a lineage
bag, not a pool: pools hold membership or derived state, and truth stays in
the pieces (`P6`, `H1`).

The bag is the ordinary one. Markers `0000`, `0001`, and onward each name
one whole signature. The highest marker is now. Walk by reading markers and
inflating them. Nothing in the bag is rewritten and nothing is deleted
(`H2`). A later proof is a new marker. Undo advances to an older signature.
Data never heals. Older proofs keep working (`H3`).

This page does not name the tile and does not seed a signature. Naming is
the participant's act (`N1`, `C5`). Until that name is committed, no meaning
is registered for it.

### What enters

A proof enters when it is bona fide and a follower replicates it. Bona fide
is the cornerstone check. Replication is `replicate(root)` from a host that
serves the bytes (`T1`). The follower verifies the hash at admission (`T2`)
and decides to take it (`T4`, `T5`). The public brain holds the proof. The
solver is the person who brought it to the check and published it.

These stay off the lineage: a private session, a heat count, an interest,
and an anonymous use attribute. The attribute may point at a proof and still
name no person. Contemplation can be said and held before it checks. It
joins the lineage of science when someone solves it, the check holds, and a
hive follows the stamp.

### One act

The expansion, the contribution, the publicization, and the stamp in time
are one act.

The solver publishes the checked proof. That write appends the next marker.
The marker is the stamp: its place in the bag is the time, and the signature
it names is the proof. That proof is the contribution. Making the marker
available to followers is the publicization. The public brain now reaches
one proof farther, and that reach is the expansion. A later hive reads the
stamp by reading the marker and inflating the signature.

### A slice of the superhuman intelligence

That expansion is one slice of the superhuman intelligence. It is superhuman
because it works only with what is public to all, from all. A proof may enter
from whoever solved it. A hive that follows the lineage holds the same stamps
as every other follower. No one solver holds the whole, and no one hive owns
it. What is private never becomes this intelligence.

The whole is the chain of slices. Each new stamp adds one. The frontier moves
by slices. The check on a slice is the same check as on the whole. A later
call inflates a slice it already holds instead of solving that proof again,
so the same public bytes make the brain more efficient as they accumulate.

It responds mathematically, and at a statistically fast rate. A response is
a recomputed difference or a signature whose bytes hash to their name. As
the slices accumulate, the share of sentences that hit a stamp rises, and
the expected cost falls with that share. The hit is an inflation of a known
signature. What is still open stays on the frontier, is solved once, then
stamped, then available to every follower at that same rate.

Performance increases over time. Each new public slice raises the share of
sentences answered by inflation and lowers the share that must be solved on
the frontier. A follower who joins later starts from a longer chain than a
follower who joined earlier, and both keep gaining as further proofs are
stamped. The bytes of one slice do not get faster with age. The brain gets
faster because more of its answers are already stamps.

### Refinement

Refinement gets mature. A refinement is a later stamp that stands on an
earlier proof and makes the public reading finer: a tighter proof, a shorter
checked step, a canon that gathers slices which already agreed. The earlier
marker stays.

While a region is open, the refinement is still frontier. It has matured
when later calls inflate that stamp and new proofs start past it. Over time
more of the lineage is in that state, so the refinements settle as the
performance rises.

## It scales at every level

The same sentence, the same check, the same attribute, the same graph, and
the same lineage are the brain at every grain. A larger grain mints no new
kind of record.

| Level | What is held | What is said | What governs | What remains |
|---|---|---|---|---|
| One neighbor | a pose `(q, r)` | one step | the axial difference | the attribute |
| One pattern | the canon | a scroll, a rotation | the pure functions of the pattern | the pattern signature |
| One piece | the bytes | the sentence that committed it | the hash | the marker |
| One field | the name and the pieces gathered under it, an atom one level up | the same sentence | the same check on each piece | that field's lineage |
| The lineage of science | the solved proofs | the sentence that published one | the same check, on every follower | the public brain, marker after marker |

A frontier at any row is the open difference just past what that row has
checked. Intelligence at that row is the chain of truths behind the edge
and the open work in front of it. A contribution published at any row enters
that row's lineage and stays. An agent addresses every row the same way: a
sentence in, signatures out.

A field grows by gathering pieces, the way a molecule gathers atoms
([the-algorithm-is-the-application.md](the-algorithm-is-the-application.md)).
The lineage of science grows by the proofs people solve and the followers
who replicate them.

## One walk

A frame points at a pattern signature. The participant scrolls one step along
the default step, east, `{ q: 1, r: 0 }`. The pattern signature does not
change, because offset is a chart parameter. The hive writes one attribute:

```json
{
  "kind": "use",
  "op": "scroll",
  "pose": { "step": { "q": 1, "r": 0 } },
  "param": "offset",
  "delta": 1,
  "on": "c09a2a3275e57e82f8fe26ada9486dc23037a8c8cadde8e77bb9c2d866a7ff86"
}
```

`out` is omitted. The act left no piece. `on` is the one-cell pattern whose
canonical bytes are
`{"coords":[{"q":0,"r":0}],"kind":"pattern","step":{"q":1,"r":0}}`.
The hosted attribute, keys sorted, is the signature
`3314f286cb1aa87a30322c071ed72996a98a49a0b671e9d434a90a4ab70f510e`.
On this machine the graph has that edge: `scroll`, step `{q: 1, r: 0}`,
offset by 1. If that edge is the one the attributes agree on, navigation
offers the sentence `scroll` with that pose and delta.
A second region the participant keeps using stays visible beside it. Neither
attribute names the participant. Neither enters the lineage of science.

Separately, a mathematician solves a proof about that geometry. The bytes
hash to their name. Publishing appends marker `0007`, naming that signature.
That one marker is the contribution, the publicization, the stamp in time,
and one slice of expansion. A follower replicates the bag, checks the hash,
and inflates `0007`. A later tighter proof appends `0008` and stands on
`0007`. Calls that have matured inflate `0008`. The bytes of `0007` remain,
and the frontier is whatever still does not check.

## What a later call does

Request order stays anatomy, then the live roster, then the context manifest,
then the transcript, then the need. The mind those legs can reach is:

1. the anatomy, which says how to inflate and which words exist
2. the pieces already committed at the signatures in context
3. the canon of a pattern signature, when one is held
4. the use attributes whose `on` matches a signature in hand
5. the graph reading of those attributes: the agreed next step, the regions this participant has been feeding, and the nearest open difference past the corridor
6. a stamp in the lineage of science, when this hive follows it and the bytes hash to the name
7. a finished answer whose bytes hash to the signature the relationship names

The call pays a model for the part that is still open. Tool calls and picture
messages stay open. A ready, hash-checked answer is spoken from the file.
Steps 4 through 6 are this design. The mouth that carries the sentence is
already built.

## What already exists

| Already true | Where |
|---|---|
| A pattern is a signed shape; a frame points at it; stride, scroll order, bounds, and `slotAt` are pure functions | `sequence/pattern.ts`, [frames-and-patterns.md](frames-and-patterns.md) |
| Scroll offset is uncommitted viewing state | `sequence/frame-target.ts` |
| A behaviour sentence is the proposal a participant runs, and an outside session can carry it | [model-mediation-and-the-training-prompt.md](model-mediation-and-the-training-prompt.md), [hive-say.md](hive-say.md) |
| A model's output can be one more resource, addressed by its hash | [llm-primitive.md](llm-primitive.md) |
| Identical inputs collapse to one signature. Memoising an arbitrary script by authenticity is still design | [collapsed-compute.md](collapsed-compute.md) |
| A derived record is keyed by its input signature, minted only in the optimize phase, and is never load-bearing | [optimize-phase.md](optimize-phase.md), `D1`–`D4` |
| A lineage bag is markers naming whole signatures. Nothing is rewritten or deleted | [history-sigbag-as-root.md](history-sigbag-as-root.md), `H1`, `H2` |
| Bytes reach a reader because that reader replicates them, and the hash is checked at admission | [install-by-replication.md](install-by-replication.md), `T1`, `T2`, `T4` |
| Interests stay on this machine | [pheromones.md](pheromones.md), `R3` |
| A group on this disk, and the folder `/intelligence` grants, remembers a domain and a hash. The resource stays on the host. Retrieval checks the hash. One scroll attribute is a member, and `graph` names that edge | `scripts/intelligence/disk.cjs`, `hypercomb-essentials/src/intelligence/` |

Still design, and not seeded: the `use:attribute` list, the corridor and its
heat, the canon record as a stored index, and the tile whose lineage is the
lineage of science. One published attribute is readable. `usage:dwell` is a
reserved meaning and is not the attribute.

## Bounds

**Doctrine.** This page adds no axiom. It names no tile and seeds no pool.

**Government.** A sentence, a model, a session, a memory, or a count may
propose. A verifiable truth governs. The vendor's model stays outside. There
is no weight update.

**Language.** Discovery, meaning, and philosophical contemplation are
sayable before they are truths.

**The two records.** A use attribute names an act and names no person, no
path, and no clock. A proof in the lineage of science is the public piece a
solver published. A private session, a heat count, and an interest enter
neither the attribute's author field nor the public lineage. A visit count
lives in the heat ledger, outside both records. The resource stays on the
host. The group file on this disk holds the domain and the hash, not the dump.

**Publication.** One new marker is the expansion, the contribution, the
publicization, and the stamp. A later marker stands after the older one.
The older signature remains. Maturity does not rewrite the earlier proof.
Followers ask for the bytes. Holding them is not activation.

**Performance.** One slice's bytes do not get faster with age. Performance
rises because a growing share of answers are already stamps.

**Scale.** A field uses the sentence, the check, the attribute, the graph,
and the lineage that a single piece uses.

**The graph.** A route with no attribute behind it is not offered. A region
the participant is feeding stays visible when a shorter corridor exists.
`usage:dwell` is not this record.

**Agents.** An agent speaks a sentence and reads the signatures that come
back. The attribute does not name the mathematician or the scientist. The
brain points at the open difference. The published proof is what other hives
can check.
