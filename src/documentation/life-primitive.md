# The life primitive: metadata for every artifact

**Status: canonical architecture — pinned 2026-08-27 (Jaime).**

## Architectural test

> If a new feature cannot itself be represented as a meta-wrapped layer
> capable of further references and growth, it is introducing an unnecessary
> terminal special case.

This is the recursive-closure test for features that need growth. The artifact
formats themselves do not change: layers remain layer JSON, resources remain
bytes, dependencies remain module bytes, and bees remain behavior bytes. What
becomes universal is the small metadata incidence around every artifact
reference.

## One typed envelope

```text
MetaEnvelope {
  meta: 1
  exactly one of:
    layer: <existing layer JSON signature>
    resource: <raw resource bytes signature>
    dependency: <raw dependency bytes signature>
    bee: <raw behavior bytes signature>
  relation?: <how its parent holds it>
  root?: <fixed canonical grammar name>
  ...authorship / recipients / gates / provenance / local overrides
}
```

The payload key is the type. There is no parallel `target` enum, and resolvers
never inspect referenced bytes to guess their kind. Exactly one payload key is
legal in each envelope.

Existing layer contracts stay intact:

```text
ExistingLayerArtifact {
  ...the installed canonical layer shape is unchanged
  children?: [<layer MetaEnvelope signature>, ...]
  bees?: [<bee MetaEnvelope signature>, ...]
  dependencies?: [<dependency MetaEnvelope signature>, ...]
  ...existing scalar/array artifact slots hold MetaEnvelope signatures
}
```

Existing collection slots remain collections. The change is atomic: every
artifact signature inside them becomes a meta signature. This preserves
current readers, history, and optimizations while giving each occurrence its
own label, image, border, marks, provenance, recipients, or gate.

Installed scalar child-list slots remain scalar: their signature names the
external JSON list resource, so that incidence is `meta(resource)`. An inline
child array contains child incidences directly, so each entry is
`meta(layer)`. The metadata migration must not erase that distinction.

## Growth and atoms

A layer incidence can continue recursively:

```text
meta(layer) -> layer -> meta(layer) -> layer -> ...
```

Raw artifacts terminate through declared atomic envelopes:

```text
meta(resource | dependency | bee) -> raw bytes
```

When an image, dependency, or behavior needs notes, children, or further
relationships, represent that feature with an ordinary layer that references
the atomic artifact through meta. A simple attachment does not need a
synthetic replacement layer merely to make its bytes look recursive.

Every commit remains a finite immutable snapshot. Direct content-signature
cycles cannot normally be minted because a record can only name signatures
known before its own bytes are hashed. Resolvers still keep an active-signature
set and depth budget for malformed imports and symbolic cycles.

## Identity, expression, and incidence

- The typed payload signature identifies immutable artifact bytes.
- The meta signature identifies how that artifact occurs here: relation,
  author, recipients, canonical root, gates, provenance, and overrides.
- A fixed root name such as `people` identifies the one grammar pool.
- A lineage appearance points to that root while keeping contextual display
  label, image, border, properties, and visibility in its own incidence.

Two references can therefore share `/people` without sharing appearance. A
change to `/somewhere/people` cannot stomp `/business/people`.

## Passive metadata healing

Legacy shapes remain readable forever:

```text
raw child sig
  -> virtual { meta: 1, layer: rawSig, relation: "children" }

notes: [a, b]
  -> notes: [meta(resource: a), meta(resource: b)]
```

The projection is deterministic. Reading does not append history. A resolver
may materialize synthesized immutable meta records additively in the flat pool,
but correctness cannot depend on that cache write. The next ordinary edit uses
metadata references in the existing artifact format. Old signatures and
history stay intact.

`HistoryService` is the production write-canonical boundary: immediately
before any newly committed or materialized layer is signed, it promotes bare
artifact references through this deterministic projection. Thus normal reads
stay passive while every new layer revision uses the standard.

## HTTP resolution and local caching

Both signature hops use the existing immutable transport:

```text
memory / OPFS
  -> HTTP GET /<meta sig> on miss
  -> verify SHA-256 and cache meta
  -> read its one typed payload sig
  -> HTTP GET /<artifact sig> on miss
  -> verify SHA-256 and cache in the artifact's local pool
```

HTTP is the durable resolution path. Swarm may provide request-driven layer
and resource bytes for live availability, while dependencies and bees remain
HTTP-only. Once resolved, subsequent reads are local.

## Optimization is present or absent

Optimizations are derived by convention, not advertised from meta:

```text
meta { layer: L }
  children -> sign("manifests") / L

meta { resource: R }
  visual -> sign("visual-optimization") / R
```

Every request probes the relevant optimization. Present and valid means use
it; absent means resolve from artifacts, derive it, and cache it. A changed
input signature automatically selects a different member, so unchanged layers
do no optimization work and only the changed layer/ancestor path rebuilds.

The children manifest contains resolved child layers, properties, and visuals.
It loads only when children are requested, stays out of Swarm, and is never
load-bearing. Meta remains light because the layer signature already derives
the manifest address; no cache pointer is stored in meta.

If an accelerator becomes authored, shared, historical, or required for
correctness, it is state rather than optimization and receives ordinary
metadata like every other artifact. See [optimize-phase.md](optimize-phase.md).

## Protocol ownership

`hypercomb-core/src/core/life-primitive.ts` owns:

- deterministic typed meta minting and validation;
- the exactly-one payload-key grammar;
- passive wrapping of existing artifact references;
- recursive closure/cycle inspection;
- local-first, HTTP-on-miss, hash-verified, write-through resolution.

Feature code retains its installed artifact format and supplies incidence
through this one envelope. It must not invent a competing metadata grammar.
