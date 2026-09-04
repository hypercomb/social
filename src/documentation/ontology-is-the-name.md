# The ontology is the name — layouts declare belonging, marks record it, pools index it

> There is no ontology service and there never will be one. A concept is a
> name. A layout is names arranged. Belonging is a mark the member wears.
> The pool at `sign(name)` is a derived index of those marks. Rendering is a
> projection that reads the layout and never defines it.

Doctrine, 2026-09-04. This document exists so that no future session proposes
a separate "ontology layer", a relation table, a class hierarchy, or a schema
registry. Every one of those already exists under a Hypercomb name, and this
page says which.

## Related

- [hypergraph-molecule-lineage.md](hypergraph-molecule-lineage.md) — the name
  IS the grammar; a molecule is `sign(name)` plus the atoms gathered under it.
  This page is that doctrine read as an ontology.
- [template-addressing.md](template-addressing.md) — the name IS the
  placeholder; `template:part` is the fill mark.
- [layout-templates.md](layout-templates.md) — holes are an interface, arity is
  data, six primitives, at most three holes, rows only.
- [website-artifact-paradigm.md](website-artifact-paradigm.md) — never a
  parent; relations are marks the members wear.
- [tag-pools.md](tag-pools.md) — the mark is the forward truth, the pool is the
  inverse index.
- [vocabulary-claim.md](vocabulary-claim.md) — how a host publishes its names
  with honest absence.
- [optimize-phase.md](optimize-phase.md) — the only place a derived pool may be
  minted.

## 1. The four words

| word | what it is | where it lives |
|---|---|---|
| **name** | a concept; the top primitive | the molecule address `sign(name)` |
| **layout** | names arranged; a schema of holes | one artifact; order in its META atom |
| **fill** | a member placed at a name | a mark the member wears |
| **projection** | a renderer reading a layout | code; never in any artifact |

Everything the system calls a relation is one of these. There is no fifth.

## 2. The name is the top primitive

A concept is nothing but a name. It has no definition record, no class atom,
no registration. `sign('hero')` exists the moment anyone says *hero*, on every
host, without coordination, because SHA-256 is the coordination.

What a name *means* is not declared. It is **derived from use**: the union,
across every host, of what has been placed at that name. The pool at
`sign('hero')` on one host is one replica of that union. This is why a
Hypercomb ontology cannot be authored the way OWL or SKOS ontologies are
authored. It is not a snapshot somebody signs off on. It is a forward-only
chain of use, versioned by history, and no version is ever deleted.

A tile with no relations is still an ontology of one. That is the atomic-unit
paradigm said in ontology vocabulary.

## 3. The layout declares belonging

Nothing belongs on its own. A thing belongs because some layout has a hole
with its name. So:

- **A hole is a name.** Every hole is a molecule address. Naming a hole mints
  a concept.
- **"Child of" was never a primitive.** Children under a tile are the holes of
  whatever layout that tile wears, in the order the layout's META atom gives.
  The ordered child relation and the unordered tag relation are the same
  mechanism with a different read policy, exactly as tag-pools.md says.
- **Documenting layouts as you go IS building the ontology.** Each new layout
  mints names. Each fill adds a member. There is no separate step where the
  ontology gets written down, because the layouts are the writing.

A layout must stay **framework-free**. Six primitives, at most three holes,
rows only, no name states a side. The moment a layout knows about HTML it has
stopped being an ontology and become a page. Renderer vocabulary in a layout
artifact is a defect.

### What a hole may say about itself

A hole's constraints are marks on the **hole atom**, never fields of the
layout:

| mark | meaning |
|---|---|
| `accepts` | which kinds a filler may be; a renderer that cannot satisfy it leaves the hole empty rather than failing |
| `required` | the layout is incomplete without a fill here |

Do not add a third until a renderer needs it and cannot express it as one of
these two.

## 4. The fill is a mark: marks are causes, pools are consequences

Belonging is written **once**, as a mark the member wears. The kind names the
relation; the payload names the target (a sig or a name).

| relation | mark kind | payload |
|---|---|---|
| fills a hole | `template:part` | the hole name |
| is narrower than | `skos:broader` | the broader concept sig |
| is laterally related | `skos:related` | the concept sig |
| is the same as, elsewhere | `skos:exactMatch` / `skos:closeMatch` | an external identifier (QID, LCSH URI) |
| came from a scheme | `skos:inScheme` | the scheme name |

That table is the whole relation vocabulary. `skos:narrower` is never stored;
it is the inverse of `broader` and is derived. Do not mint a mark kind per
layout, per hole, or per renderer.

The mark rides the merkle tree, so adopt, sync, undo, publish and replication
carry it with no extra code. A cold client rebuilds every relation from marks
alone. That is the litmus test from the optimize-phase doctrine, and it is why
marks are where truth lives.

**The inversion is forbidden.** Any design where the pool is the source and the
marks are inferred from it makes membership vanish on a wipe and makes a layer
depend on a derived record. If a pool derivation ever needs to read a layout
to know who belongs, a mark is missing, and the fix is the mark.

## 5. The pool is the index, and the index is the search address

The pool at `sign(name)` answers the inverse question: *who belongs here?* It
is minted in the optimize phase, from marks only, keyed by source signature,
complete-or-absent, wipe-safe, never load-bearing. Pools are unordered by
definition; order never enters one. Order stays in the layout's META atom.

Marks and pools make different things available, and that is the point:

- a **mark** is findable from the member: *what does this belong to?*
- a **pool** is findable from the name: *who belongs to this?*

The name is the only cross-host search address, so **federation runs on
pools**. But a host never serves its derived pool. It publishes the signed
vocabulary claim, which is the pool with honest absence, so that *nobody said
anything* and *that host has not recomputed yet* can never be confused.

## 6. Rendering is a projection

HTML is the first renderer that reads the six primitives. It is not the
definition of a layout. The same layout may be read by Pixi, by print, by a
voice walk, by a study deck, by a native shell. The mobile rails already work
this way: the rail matrix is a projection, never a commit. A new renderer adds
code and adds **nothing** to any layout artifact.

"This hole needs an HTML artifact" is therefore a mark on the hole (`accepts`),
never a property of the layout, and a renderer that cannot honour it skips the
hole.

## 7. Importing historical ontologies

Nothing new at the primitive level. An existing vocabulary lands as:

1. one atom per concept, sig-named; its preferred label is its name, so it
   has a molecule address for free;
2. alternate labels as participant aliases;
3. relations as the five SKOS marks above;
4. `skos:exactMatch` back to the source identifier, which is the cross-host
   anchor;
5. the scheme as a pool with a colon meaning, e.g. `ontology:lcsh`.

The importer is a deterministic converter, so every host that imports the
same vocabulary mints the same signatures and the network dedupes it. An
ontology is a package you **apply**, never add, and hide-first doctrine
governs the concepts you do not want in view.

Use SKOS as the interchange form. Nearly every thesaurus of the last century
has been republished in it, so one importer covers dozens of vocabularies.

| licence | vocabularies |
|---|---|
| CC0 / public domain | Wikidata, LCSH and LC Name Authorities, MeSH, ISO 639/3166/4217, the periodic table, NCBI and GBIF taxonomies |
| attribution | Getty AAT/TGN/ULAN, UNESCO Thesaurus, AGROVOC, Schema.org, WordNet, Iconclass, CIDOC-CRM |
| avoid | Dewey (proprietary); UDC beyond its open summary |

Classical trees (Aristotle's categories, Porphyry, Linnaeus, Roget) are content
rather than schema. They import as hives via break-apart, each concept a tile
wearing `skos:broader`, and they double as tutorial courses.

## 8. The open decision: address normalization

`sign(name)` is an exact string. *Cigars* from LCSH, *cigar* from a tile and
*Cigar* from Wikidata are three molecules today. The rule this page proposes:

- **case-fold at the address.** `sign('cigar')` and `sign('Cigar')` are one
  molecule; the display spelling is an alias.
- **nothing else at the address.** Singular/plural, diacritics and language
  are bridged with `skos:exactMatch` marks, not by the hash.

Until this lands the importer must not case-fold silently; it must mark. A
change to the address rule is a forward commit under the molecule-lineage
dual-pointer rule, never a rewrite.

## 9. Owed

| item | where |
|---|---|
| `accepts` / `required` marks on the hole atom | the layout designer writes them; the HTML projection reads them |
| the five SKOS mark kinds accepted by the decoration path | `pheromones/` |
| a `skos:narrower` read that derives from `broader` marks | the pool derivation in the optimize phase |
| SKOS JSON-LD importer as a drone | prove on the UNESCO Thesaurus, then LCSH |
| the case-fold address rule | molecule lineage, forward commit, dual pointer |
| a ratchet: no renderer vocabulary in a layout artifact | `doctrine.spec.ts` |

## 10. Traps

- **Do not build an ontology service, a relation table, or a class registry.**
  Each is one of the four words wearing a disguise.
- **Do not put HTML, CSS, or any framework word in a layout.** That is a page.
- **Do not store `narrower`.** Derive it.
- **Do not let a pool be read on any load path.** If a screen is blank without
  the pool, a mark is missing.
- **Do not case-fold in the importer before the address rule lands.** Mark
  instead, or the same concept splits across hosts that imported on different
  days.
