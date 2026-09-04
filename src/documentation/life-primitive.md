# The Life Primitive

**The one reference mechanism, and where the molecule model meets it.** Code:
`hypercomb-core/src/core/life-primitive.ts`. Cited by `edge-registry.ts`,
`layout-piece.ts`, `enrollment.ts`, `division-assembly.ts` and the slide,
lightbox and tile-property surfaces. This document existed only as those
citations until 2026-09-04; the write-conformance census found the
foundational rule of the codebase was code-only with a dangling reference.

## The primitive

Every artifact reference is the signature of a **meta envelope**. The envelope
declares exactly one typed payload hop:

```
{ meta: 1, layer: <sig> }        a structured layer — a LifeLayer
{ meta: 1, resource: <sig> }     raw bytes: a picture, a note body, a JSON doc
{ meta: 1, dependency: <sig> }   a module dependency
{ meta: 1, bee: <sig> }          a behaviour bundle
```

plus, optionally, how the container holds it (`relation`), which grammar it
is a root or reference incidence of (`root`), and who and when (`agent`,
`recipients`, `at`). Exactly one payload key is present; that key says how
the signature resolves. Nothing is inferred from bytes — `isMetaEnvelope` is
self-declared only, and shape-sniffing referenced bytes is forbidden.

A **LifeLayer** is the existing growable artifact: `{ name, children?, …slots }`.
Its named slots hold meta signatures; `children` is the one ordered collection.
Layer, resource, dependency and bee payload formats do not change. Metadata
is the typed incidence wrapped *around* them, never a field added *inside* them.

```
meta → layer → meta → layer → … → meta → resource
```

The alternation is recursive closure: any referenced feature can become the
root of another tree, and no feature needs a terminal schema of its own.
Images and other atomic bytes still terminate a hop.

## Where the molecule model meets it

`hypergraph-molecule-lineage.md` names three atom shapes:

```
vertex      {name, properties?, decorations?, …}          — no children slot
envelope    {meta:1, layer:<vertexSig>, root:<canon name>, relation?, slot?}
succession  {succession:1, prev, members:[envelopeSig…], at}
```

**The envelope in that table IS `MetaEnvelope`.** The molecule model is the
Life Primitive's naming layer: the incidence between a molecule and a member
is one typed hop, the member is a vertex (a LifeLayer with no children), and
the succession is an ordered list of incidences. Two recursions, one
mechanism, stated from opposite ends — inward (a molecule is broken apart into
incidences) and outward (any incidence can be the root of another tree).
The write-conformance census asked directly whether the two were redundant.
They are not; they meet at exactly this point.

The fields the two documents share:

| field | meaning | who writes it |
|---|---|---|
| `layer` / `resource` / `dependency` / `bee` | the one typed hop | every envelope |
| `relation` | how the container holds this incidence (`children`, `notes`, `background`, …); the same word a legacy slot used, so the privacy gate in host-sync reads a relation exactly as it reads a slot | `Store.putArtifactMeta` / `ensureArtifactMeta`, `artifact-content.ts` |
| `root` | the canonical grammar name when this incidence is a root or reference incidence — the molecule's word, `canon(name)` | **the succession/envelope writers of the molecule transition** — see below |
| `slot` | order, riding the incidence rather than the member, so one tile can hold a different position in each appearance | the same writers |
| `agent`, `recipients`, `at` | provenance | the agent trail (`agent-trails-layer-meta`) |

### `root` is reserved, not drifted

`root` has been in `MetaEnvelope` and in `mintMetaEnvelope` since the primitive
landed, and as of 2026-09-04 **no live writer mints it**. The two live minters
(`Store.putArtifactMeta` and `artifact-content.ts`) write `relation` only. The
census classed this as "documented and never written". It is not a defect in
either writer: `root` belongs to the molecule incidence — the envelope a
succession names — and those writers are the transition steps that have not
landed yet (`hypergraph-molecule-lineage.md`, execution order). The prototype
under `documentation/molecule-lineage-prototype/` mints it. Until the live
writers exist, `root` is a reserved field with one defined meaning, and
nothing should write it for any other purpose.

## Read-compatibility, and why nothing heals destructively

Data never heals. Layers written before the primitive hold raw signatures in
their slots — `children: [<layerSig>]`, `notes: [<noteSig>]`, a scalar
`background: <sig>`. They are read-compatible forever:

- `healLegacyLayer` wraps each raw signature in a deterministic envelope at
  read time (`children` → a `layer` hop; a scalar child slot → a `resource`
  hop naming the pointer-to-list; any other slot → the kind the caller's
  `payloadKindFor` declares, else `resource`). The synthesized records may be
  pool-materialised additively; the next ordinary edit writes the canonical
  form. No migration pass, ever.
- `ensureArtifactMeta` reuses an existing incidence when its kind and relation
  match, and otherwise wraps the **terminal artifact** — never another
  envelope. An incidence around an incidence is the one shape the primitive
  forbids.
- Walkers that compute reachability walk every signature-shaped value
  regardless of envelope (host-sync's slot walk, the packed collector, the
  prune reference walk). The precise edge walk (`edgeSigsOf`) is a protocol
  helper for clients that adopt the uniform node model; nothing in this tree
  depends on it yet, so a legacy slot is never stranded by a closure.

## Notes: the one live writer that bypasses the envelope

`notes/notes.drone.ts` writes a note as a bare resource
`{ children: [<noteSig>], note, shape?, mark?, tags? }` and the owning cell
holds `notes: [<noteSig>, …]` — raw signatures, no envelope, and a `children`
slot that is a **note** collection rather than a layer collection. This is
read-compatible by the rule above and travels in every closure by the walker
rule above, so it is not a data-loss risk. It is the one place a new write
still mints the pre-primitive shape.

The forward path is decided and deferred: notes become a facet of the tile's
molecule — `notes:<sig>` (the plural facet, `hypergraph-molecule-lineage.md`
"facets"), each note an atom, its incidence an envelope with
`relation: 'notes'` and `slot` for order. That is a forward commit, not a
rewrite: an untagged note must keep signing to the bytes it always did, or
every re-materialisation re-signs the whole tree. Until that step, the notes
drone is a **known legacy writer** and is listed as such in
`write-conformance.md`, not a site to "fix" in place.

## One roster, not four

`CHILD_SLOTS = ['cells', 'layers', 'children']` — the slots a layer holds its
descendant layers in, in resolution precedence — is declared once, in
`hypercomb-core/src/core/level-roster.ts`, and consumed from `@hypercomb/core`
everywhere. Four files kept a private copy (`active-genome.ts`,
`host-sync.service.ts`, `website-archive.queen.ts`, and shared's
`collections.source.ts`, whose comment believed core could not be imported
from shared — it can, and shared already does). A ratchet
(`history/child-slots.ratchet.spec.ts`) refuses the literal outside core.

## Rules

1. **One typed hop per envelope.** Exactly one of `layer`, `resource`,
   `dependency`, `bee`. `metaPayloadOf` refuses zero or two.
2. **Never wrap an envelope.** `ensureArtifactMeta` unwraps to the terminal
   artifact first.
3. **Self-declared only.** `meta: 1` plus a payload key is the whole test.
   Nothing sniffs bytes.
4. **Read-compatible forever.** Legacy shapes are healed at read time,
   additively. There is no migration pass.
5. **`root` means the grammar word and nothing else.** Reserved until the
   molecule's envelope writers land.
6. **The child roster lives in core.** Ask `CHILD_SLOTS`; never restate it.

Related: `hypergraph-molecule-lineage.md` (the naming layer),
`address-syntax.md` (the seven rules), `signature-system.md` (the expansion
doctrine), `write-conformance.md` (the census that found the drift).
