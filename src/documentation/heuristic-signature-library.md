# Heuristic signature library

> **Status: first local repository slice built (2026-08-26); hive and swarm
> distribution remain design.** `scripts/heuristic-audit.cjs` mines seven
> deterministic repository heuristics, persists findings only,
> skips current `(algorithmSig, operand signatures)` computations, supports aggregate lookup,
> and can watch continuously. This mechanism extends the existing signature
> system; it does not introduce a second identity scheme or make heuristic
> output authoritative.

An AI request often spends most of its time rediscovering inexpensive facts:
which package manager a repository uses, whether a file contains credentials,
what language a blob is, which symbols it exports, whether a document is an
invoice, or which earlier conversations concern the current task. Those facts
can be mined before a request exists.

Hypercomb calls each such reusable test a **heuristic**. A background miner
runs signed heuristic programs against signature-addressed content and stores
their signed results. At request time, the agent usually performs a lookup
instead of repeating the computation.

## Inclusion doctrine: every saved step counts

The library seeks **every reusable heuristic optimization, however small**.
If a finding can save an LLM a file read, search, parse, tool call, token,
branch decision, validation step, or repeated inference, it belongs. Tiny
savings compound across files, requests, machines, and swarm participants;
rejecting a fact because it looks individually trivial defeats collapsed
compute.

Usefulness is not a popularity contest and there is no minimum time-saving
threshold. The admission gates are instead:

- the finding is well-defined and retrievable;
- its algorithm and inputs have stable signature identities;
- consumers can understand its result contract;
- incorrect findings are bounded by validation, evidence, or trust policy;
- mining and storage cost can be controlled by scheduling and applicability.

The catalog may therefore contain narrow facts such as line-ending style,
presence of a shebang, whether a file has a default export, or which test
framework import appears. Each remains an independent heuristic so consumers
request only the facts that save work for their current task.

The useful shorthand is **Napster for computation results**. Napster made a
large distributed collection discoverable so a participant could fetch bytes
someone else already held. This mechanism makes a large distributed body of
finished computation discoverable so a participant can fetch a result someone
else already mined. The shared object is not a filename but a verifiable
relationship between exact algorithm bytes, exact input bytes, and exact
result bytes.

The core identity is an automatically memoized computation:

```text
heuristic key = H(canonical({
  protocol: "hypercomb-heuristic/v1",
  algorithmSig,
  operands: [operandSig1, operandSig2, ...]
}))

algorithmSig + operand signatures -> answerSig
```

The agent supplies the operation—the signed question—and zero or more signed
operands. `+` means canonical signature composition, not ambiguous string
concatenation. Operand order is preserved because it can matter to the
operation. If the same operation receives the same operands anywhere in the
swarm, the key is identical. The exact answer bytes live as an ordinary
resource under `answerSig = SHA-256(answerBytes)`; the heuristic key maps to
that answer signature.

Lookup is read-through automatic optimization:

```text
agent supplies algorithmSig + operands
  -> compose heuristicKey
  -> hit: return the saved result immediately
  -> miss: compute once
       finding: sign and store result, then return it
       no finding or failure: return without leaving an artifact
```

The next identical computation becomes a hit. No caller has to decide whether
to use the cache; supplying the operation and operands is always the question,
and lookup is always the first step.

## The unit of work

A heuristic consists of three immutable resources:

- **algorithm** — executable bytes or a declarative matcher, addressed by
  `algorithmSig`;
- **operands** — zero or more exact input artifacts, each addressed by its signature;
- **answer** — the exact answer bytes, addressed by `answerSig`.

A structured answer may be canonical JSON:

```json
{
  "language": "typescript"
}
```

The presence of the envelope means the heuristic found the fact it exists to
find; `value` carries the useful detail. A false, unsupported, or failed attempt produces no
result resource and no key mapping. If absence is useful knowledge, it is a
different positive heuristic—for example, `repo/no-tests`—with its own
algorithm signature and evidence contract. The envelope may also carry
optional evidence offsets, confidence, execution limits, and producer
attestations, but those fields are part of the answer bytes and therefore
produce a different `answerSig`.

## Background mining

Each machine maintains a queue of content signatures. Sources can include:

- repository working-tree files and committed Git objects;
- Claude Code, Codex, and other local agent history that the participant has
  permitted Hypercomb to read;
- exported ChatGPT conversations and files;
- hive resources already present in the local content store;
- newly downloaded swarm resources;
- any participant-selected directory or import source.

When new bytes arrive, the machine signs them once, then considers each
applicable heuristic in its installed heuristic list. Before execution it
looks up the composed key. A hit ends the work immediately. A miss schedules
the sandboxed algorithm, stores its answer resource, and publishes the
computation-to-answer mapping according to the participant's sharing policy.

```text
new bytes
  -> contentSig
  -> select applicable algorithmSig values
  -> compose each heuristic key
  -> cache hit: resolve answerSig
  -> cache miss: run
       finding: sign result and store mapping
       no finding: leave nothing behind
```

Scanning is incremental. File paths, timestamps, branch names, and chat IDs
are discovery hints only; none are cache identity. Unchanged bytes keep the
same `contentSig` even after a rename. Changed bytes receive a new signature
and naturally miss old entries. Updating a heuristic changes `algorithmSig`,
so every result from the earlier algorithm remains valid for that version but
cannot be mistaken for a result from the new one. No mutable invalidation
table is required.

## Hive representation

A hive may hold a **heuristics** node whose children are lists such as code,
documents, history, safety, project shape, and domain-specific knowledge.
Each heuristic tile points to its algorithm signature, applicability contract,
result schema, and trust policy. The tile is human navigation; signatures are
the execution contract.

Hive resources enter the same queue as filesystem resources. This makes the
mechanism useful even when there is no conventional repository: notes,
documents, images, layer payloads, assistant outputs, and imported artifacts
can all accumulate lookup data before an AI request touches them.

The heuristic list itself is signature-addressed. A machine can subscribe to
a list signature, compare it with its last scanned list, and enqueue only the
new `(algorithmSig, operand signatures)` computations. Lists may be local, hive-owned, or
assembled from several swarm publishers.

## Swarm library

Heuristic results are portable because neither their keys nor their payloads
depend on a path or machine identity. A swarm can therefore publish:

1. signed heuristic lists;
2. algorithm resources;
3. key-to-result indexes;
4. result resources and optional evidence;
5. producer attestations and reputation signals.

### The result library is executable documentation

Swarm heuristic mining does more than save computation. Every successful
mapping documents a precise fact:

```text
this signed algorithm/question
+ these ordered immutable operands
= these exact signed answer bytes
```

Unlike prose written after the fact, the record is reproducible. Another peer
can resolve the algorithm, operands, and answer, recompute when permitted, and
compare signatures. Collections of these small facts become a machine-readable
description of branches, behaviors, histories, repositories, documents, and
the swarm itself.

This makes the heuristic pools a form of collective memory. One scout can
document a branch once; every participant can reuse the answer. As branches
change, new signatures create new facts without erasing the older ones, so the
same library documents both current state and historical evolution. History
diff computations connect those immutable observations into explanations of
what changed.

Documentation remains distributed and plural. Different algorithms may ask
different questions about the same operand, and different publishers may
attest to or dispute an answer. The swarm shares immutable evidence and
computations rather than granting one catalog authority over meaning.

In the Napster analogy, heuristic lists and key-to-result indexes are the
search catalog; peers and cache hosts hold the result bytes; signature checks
replace trust in filenames. Discovery may be centralized for speed while
storage, mirroring, execution, and verification remain distributed.

A well-known host may provide a centralized, high-availability library for
fast bootstrap, but it is a cache and distribution point rather than the
source of truth. Any peer can mirror the same signature-addressed bytes, and
clients verify downloaded bytes against their signatures. This preserves the
throughput benefit of a central catalog without making its operator capable
of silently changing an algorithm or result.

When one participant has already mined a public file with an accepted
heuristic, everybody else can download the small result immediately. The
network effect is **shared collapsed compute**: popular content and popular
heuristics approach zero repeated work across the swarm.

Private inputs are different. A peer must not announce a private
`contentSig`, lookup key, result, evidence, or access pattern unless policy
explicitly permits it. Hashes of guessable private content can leak facts.
Private results remain local by default; sharing is opt-in at the source and
heuristic-list levels.

### Publication is ordinary Hypercomb storage

Heuristic mining does not pollute the content root with thousands of payload
files. It publishes into a dedicated colon-scoped heap pool:

- `sign('heuristics:heap')/<artifactSig>` stores algorithm, list, answer,
  vector, evidence, attestation, and export-manifest bytes under their exact
  signatures;
- `sign('heuristics:results')` is a pool of meaning whose members map
  `<computationSig> → <answerSig>`;
- `sign('heuristics:lists')` is a pool of meaning whose members point to
  signed heuristic-list resources, including the currently recommended
  algorithm signatures;
- if attestations need independent discovery, they may ride
  `sign('heuristics:attestations')`; the attestation remains an ordinary
  signed resource and the pool stores only its signature pointer.

All pool addresses are derived from their colon-scoped meanings through
`Store.poolSignature`; no signature is hardcoded. Relationship pools hold
signature pointers rather than duplicating answer bytes. The heap is itself a
pool of content-addressed blocks, so the hive root contains only the small,
known pool directories—not every mined payload.

The results pool is an index, not the source of truth. A client recomposes the
`computationSig` from the algorithm and ordered operands, resolves its pointer,
downloads the answer from `sign('heuristics:heap')/<answerSig>`, and verifies
the answer bytes against that signature.
A corrupt or conflicting pool entry is discarded without invalidating the
answer artifact itself.

“Latest” never means overwriting an old computation. A heuristic-list
artifact selects the recommended `algorithmSig`; changing the implementation
produces a new list and new keys. Earlier results remain permanently valid for
their exact algorithm and input, while clients following the newer list skip
them. This makes upgrading policy mutable by signed pointer and keeps computed
facts immutable.

An operator can publish the pools and their transitive resource closure with
the normal host pipeline. Another host can mirror the same pool entries and
`/<sig>` resources, so a centralized catalog is only a fast rendezvous point,
not a unique database or authority.

## Request-time use

Before an agent reads or computes over a resource, its context assembler asks
the heuristic index for relevant results. Results can answer questions such
as:

- likely file type, language, encoding, and generated-file status;
- imports, exports, tests, entry points, and dependency relationships;
- document classes, dates, named entities, and searchable topics;
- presence of secrets, personal data, licenses, or unsafe constructs;
- conversation subjects, decisions, unresolved questions, and related files;
- chunk boundaries, summaries, embeddings, or other model-ready projections.

The request may use a result only if it accepts the exact `algorithmSig`,
understands the result schema, and trusts an attestation or reproduces the
computation locally. A heuristic is a fast hint, not proof of semantic truth.
Security decisions must fail closed or use a deterministic verifier whose
result the consumer is willing to trust.

## Signature expression language

The computation primitive supports a small declarative meta-language that an
agent can emit whenever it touches a resource. The language does not contain
answer bytes or executable source. It composes signed algorithms, signed
operands, and bounded algebra operations into a canonical program artifact:

```text
programSig = sign(canonical(signature expression))
answerSig  = compute(programSig, operandSigs)
```

The first vocabulary should stay deliberately small:

```text
call(algorithmSig, operands...)       lookup or compute one fact
apply(listSig, operand)               call every applicable algorithm in a list
select(predicateSig, answers...)      keep matching answer signatures
project(fieldSig, answers...)         derive one signed dimension
union(answerSets...)                  deduplicate signatures
diff(olderAnswerSig, newerAnswerSig)  describe change
until(count, newestFirst...)          stop when enough answers exist
```

Every expression is canonical and signed. Every intermediate successful
answer remains an ordinary resource and graph vertex; the program never hides
several facts inside an opaque session cache. Bounds such as `count`, maximum
history depth, and accepted heuristic-list signature are operands or signed
program content, so two materially different requests cannot collide.

### Visit-time enrichment

When an agent opens a repository file or hive branch, it supplies the current
content or branch signature to the applicable signed heuristic list:

```text
visit(fileSig, optional pathSig)
  -> apply(repositoryHeuristicListSig, fileSig)
  -> return every saved answer immediately
  -> compute only missing answers
  -> attach successful answer signatures to the computation graph
```

The visit therefore leaves behind useful knowledge that the agent already had
to derive. A later agent visiting identical bytes receives it immediately. A
changed file or branch has a new signature and grows a new part of the graph;
the older facts remain valid for the older state. Path-dependent questions
include `pathSig`, while content-only questions omit it and deduplicate across
renames and repositories.

This turns ordinary agent activity into continuous graph enrichment. Throughput
improves not only because individual computations are memoized, but because
the graph becomes progressively better documented in the exact dimensions
agents repeatedly need.

### Give me everything already known

Lookup by computation signature answers one known question quickly. A visit
needs the reverse direction too: “for this operand, give me every answer the
swarm already has.” Hypercomb materializes an immutable answer vector:

```text
sign('heuristics:vectors')/<operandSig> -> vectorSig

vectorSig -> {
  operandSig,
  facts: [{ position, algorithmSig, computationSig, answerSig }, ...]
}
```

The agent resolves one pool pointer and receives every known fact dimension
for the file or branch at once. It can then request only missing algorithms.
Multi-operand computations appear in each operand's vector with their operand
position, so direction and ordering remain recoverable.

The vector is immutable; discovering another fact creates a new `vectorSig`
and advances the operand's pool pointer. Individual computation and answer
artifacts do not change. This is a materialized reverse index for throughput,
not a new source of truth. Private operand vectors remain local unless sharing
policy explicitly permits publishing their relationships.

The language is a declarative scheduler over `compute(...)`, not a second
runtime. It never changes computation identity, batches are never semantic,
and arbitrary downloaded code is not granted execution merely because a
program references its signature.

## Execution and trust rules

- Verify every algorithm and result resource against its advertised
  signature before use.
- Run executable heuristics in a sandbox with declared capabilities, bounded
  CPU, memory, and output size, and no ambient network access.
- Prefer declarative byte matchers and deterministic parsers over arbitrary
  code when they can express the test.
- Make applicability explicit. A heuristic that expects UTF-8 TypeScript must
  not run blindly against every image or archive.
- Store only successful findings. False, unsupported, and failed attempts
  leave no artifact. A desired negative fact is expressed as its own positive
  heuristic with explicit evidence.
- Keep provenance separate from the deterministic answer. Two peers may
  attest to the same `answerSig` without changing its bytes.
- Never let a downloaded result grant capabilities or execute code merely
  because its signature is known.

## Initial implementation boundary

The smallest useful implementation is deliberately narrow:

1. a canonical key and result-envelope codec;
2. a local key-to-result signature index;
3. a low-priority watcher for repository and hive resource arrivals;
4. an installed, signature-addressed heuristic list;
5. a sandboxed worker that runs misses and records findings only;
6. a request-time lookup API;
7. an opt-in swarm publisher and a verifying downloader.

This is not a new database of mutable facts. It is a library of immutable
observations, each pinned to the exact algorithm bytes and exact content bytes
that produced it. That constraint is what makes precomputation safe to reuse,
cheap to distribute, and powerful enough to raise AI throughput across every
machine and hive that participates.

### First repository miner

From the `src` workspace root:

```text
npm run heuristics:audit
npm run heuristics:watch
node scripts/heuristic-audit.cjs list
node scripts/heuristic-audit.cjs summary
node scripts/heuristic-audit.cjs history --limit=20
node scripts/heuristic-audit.cjs query --heuristic=repo/symbol-inventory
node scripts/heuristic-audit.cjs export --out=<xcopy-folder>
```

The local index lives at `.hypercomb/heuristics/index.json`; answer bytes live
under `.hypercomb/heuristics/resources/<answerSig>`. Both are derived,
machine-local cache data and are ignored by Git. The first heuristic list
covers file role, language/format, generated-file detection, symbol inventory,
dependency edges, test signals, and entrypoint signals.

The miner also maintains a lean, rolling history at
`.hypercomb/heuristics/history.jsonl`. A meaningful audit, watcher checkpoint,
or changed export records aggregate work counters, discoveries by heuristic,
and signatures for the active optimization strategy and resulting index. The
entries form a signature chain and retain the newest 256 records. They contain
no filenames, prompts, answer bytes, or duplicated content; no-op audits and
skipped exports add nothing. The `history` command resolves the strategy
signature into a human-readable view of each orthogonal target, its expected
saving, useful compositions, and candidate mathematical scouts.

Orthogonal results are intentionally composable. Role, representation,
provenance, public-surface, topology, validation, and execution facts can be
combined into higher-level answers such as safe-to-skip, best starting point,
change impact, and execution maps. Mathematical scouts may add signed set
algebra, graph closure and strongly connected components, Boolean decision
tables, ordered sequence differences, canonical normal forms, and finite
lookup tables. Even a very small computation is eligible when verified lookup
is cheaper than evaluation. Because answer bytes are stored under their hash,
reuse leaves the existing block in place rather than creating another logical
result. Small answers share immutable pack files without losing their atomic
signature identity.

The export command emits an XCopy-ready closure without root payloads.
Algorithm, heuristic-list, answer, vector, and manifest resources are named by
signature inside `sign('heuristics:heap')/`. Answer resources of 1 KiB or less
retain their individual `answerSig` identities but are physically coalesced
into immutable packs targeting 1 MiB. The signed catalog at
`sign('heuristics:packs')/current` is a headerless fixed-width binary table.
Each 72-byte record is `answerSig[32] | packSig[32] | offset[4] | length[4]`,
sorted by the raw answer signature for binary search. Signatures use their raw
32 digest bytes rather than 64-byte hexadecimal text; the pool meaning and
export protocol define the record shape once, rather than repeating metadata
inside every entry. A reader slices the located answer bytes and verifies their
original signature. This prevents mathematical tables and other tiny facts
from becoming large collections of tiny files.
`sign('heuristics:results')/<heuristicKey>` contains the corresponding
`answerSig` pointer, and `sign('heuristics:lists')/repository-default` contains
the list signature. `sign('heuristics:exports')/current` points at the signed
export manifest in the heap. Copying these pool directories to `jwize.com` or
any compatible host publishes the closure without a heuristic-specific server
runtime.

Regular export is differential. A private export-state receipt records the
signature of the semantic algorithm-and-results index. If it has not changed,
the exporter performs no heap or pool writes. When it changes, immutable heap
blocks are copied only if absent; computation mappings refuse conflicts;
mutable current-list, vector, and export pointers advance to new immutable
artifacts. An XCopy/robocopy pass therefore transfers only new blocks and small
changed pointers.

### Contentless heuristics and batched execution

A heuristic may require no content. Its key carries an empty operand list, so
it remains distinct from a heuristic deliberately run against the signature
of empty bytes. This supports facts derived from environment, repository, or
hive state while keeping the algorithm signature mandatory.

Batching is deliberately outside identity. A worker may run one
heuristic over many files, many heuristics over one file, or any bounded matrix
of algorithms and whole content resources. Every finding still lands independently
under its own canonical heuristic key and result signature, so changing batch
shape never changes, merges, divides, groups, or invalidates results. A batch
is transient scheduling only; it is never stored or signed as a semantic unit.

The scheduler is **content-first** to prevent duplication. For one file it
reads or transfers the bytes once, holds one immutable buffer, and runs every
applicable heuristic against that buffer. A distributed work envelope carries
`contentSig` once plus a list of `algorithmSig` values; it does not repeat the
content for every heuristic. The worker resolves `contentSig` once from its
local content cache or `GET /<contentSig>`, verifies it once, and shares the
buffer across the batch. Only independent answer resources are emitted.

Chunking is outside the first protocol. A heuristic receives one complete
content resource or no content resource. Large inputs may be rejected by an
applicability or size limit, but they are not silently divided. This avoids
duplicated overlap, boundary-dependent findings, and a second identity layer.

### Low-load scheduling cursor

No-answer executions produce no answer resource and no results-pool mapping.
A machine may still keep a private scan cursor saying that a source signature
was considered under a particular signed heuristic list. This is operational
scheduling metadata, not a negative fact and never a published artifact. It
lets an idle background service skip unchanged inputs without repeatedly
burning CPU. A changed source signature or changed heuristic-list signature
invalidates the cursor and schedules the work again.

## Relationship to existing primitives

- [signature-system.md](signature-system.md) supplies immutable identity and
  byte storage.
- [deterministic-computation.md](deterministic-computation.md) supplies the
  algorithm-plus-input authenticity model.
- [collapsed-compute.md](collapsed-compute.md) explains why a signature hit
  makes repeated computation optional.
- [signature-algebra.md](signature-algebra.md) supplies canonical composition
  and query operations over the resulting library.
- [swarm-resource-streaming.md](swarm-resource-streaming.md) supplies the
  transport for algorithms, inputs where permitted, and result resources.
- [llm-primitive.md](llm-primitive.md) is the primary request-time consumer.
