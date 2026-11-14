# The atomic chain — atoms, groups and incidences, everywhere

> Never rewrite what can be referenced. Every piece of a creation — a style, a
> fragment of markup, a script, a layout, a string, a picture — is an atom that
> carries what it is. Groups aggregate atoms by signature. Incidences say where
> an atom is worn. The organization lives outside the content, so the same
> atoms can be housed, retrofitted and scaffolded into any number of meanings.

Status: **doctrine direction, decided 2026-11-13 (jwize).** Parts of it exist
(see *What already holds*); the rest is the path at the end. This document
carries the argument. The rule belongs in the codex Artifact tier
(`doctrine.codex`), next to A1–A9, which it extends.

## Why

A website on Hypercomb used to share code the way a page builder does: every
page carried its own copy of the look and the behaviour, and a shared change
meant editing every page — the Dreamweaver build, a template stamped into each
page and left to drift. That is bloat, and it breaks
[A6](doctrine.codex): *share resources, never copy*.

What a page should carry is its **compressed intention**: the few names and
signatures of the shared things it uses, plus what is particular to it. The
shared things live once, at their own signatures, with their own histories.

Websites are the first case, not the boundary. The same split applies to every
kind of content the hive holds.

## The split

Every rule of an artifact is split into three records, none of which depends on
another:

| Record | Carries | Never carries |
|---|---|---|
| **Atom** | what the thing is — its own bytes | where it is used, what it sits next to, its position |
| **Group** | which atoms belong together, in what order (order on the mark, A4) | the atoms' bytes |
| **Incidence** | this atom, worn here — the place, and the trait group for that place (A8) | the atom's bytes |

Applied to each kind:

| Kind | Atom | Group | Incidence |
|---|---|---|---|
| **Style** | a declaration block, no selector | a stylesheet | the selector, element or hole that wears it |
| **Markup** | a fragment with its holes | a page | a hole in a layout |
| **Script** | an ES module, one behaviour | an import set | the element or page that runs it |
| **Layout** | a pattern of holes and its variables | a nested design | the container that wears it |
| **Text and media** | a string, a picture | a catalog, a gallery | the place it is shown |

This is not a new rule. It is A1 (atomic and standalone), A3 (a relation is a
mark each member wears), A7 (placing adds an incidence) and A8 (appearance
belongs to the incidence) applied with no exception left for pages, sheets or
scripts. L3 already says the chain recurses — `meta → layer → meta → … →
resource` — and ends at a resource. The atomic chain is that recursion, used
for everything a creation is made of.

### Location never enters an atom

The one mechanic that decides whether an atom shares: **does its record carry
location?** A declaration block written without a selector is byte-identical on
every site that writes it, so every site gets the same signature and one record
serves them all. Put the selector, the page or the position inside it and each
use mints its own near-duplicate. (Measured once already: tag decorations with
`appliesTo` defaulting to the tile's segments minted 116 resources where 2
belonged; written with `appliesTo: []` they collapsed to one signature each.)

## The organization is pulled out of the content

Because no atom says where it belongs, every grouping lives in records the
atoms wear — and any number of organizations can sit over the same atoms
without touching their bytes. That gives three abilities:

- **House freely.** A molecule (N1: a name plus the atoms gathered under it)
  can gather any atom, and one atom sits in many molecules at once, each with
  its own position. Nothing moves, nothing is copied (A6, A7).
- **Retrofit.** A new meaning laid over old content is new group marks on
  existing atoms. There is no migration and no rewrite of old pages (H2: data
  never heals). Old pages keep working exactly as they were; the new meaning
  reads the same atoms through its own family. Meaning comes from use (N3), so
  organizing is how a new meaning comes into being.
- **Scaffold.** A group can exist before its atoms: a layout of named holes, a
  sheet with slots for atoms nobody has written, a site with pages still to
  come. An empty placeholder is a valid, finished state (A1). The scaffold can
  be shared and designed against, and filled later — by its author, by
  someone else, or by the AI through break-apart and expand.

Across hosts this is the network effect: anyone can organize your atoms into
their own meanings, holding only your signatures. The content stays put; the
organizations multiply.

A view renders **the family it owns** (A5) — `site:`, `style:`, `gallery:` —
and ignores the rest, because many organizations will cover the same atoms.

## References: a name and a signature

Every reference from a group or an incidence to an atom holds both halves:

```json
{ "name": "style:chrome", "sig": "<the version in use>" }
```

- **The signature is the version in use.** It never moves on its own. A page
  can stay on an older version for as long as it needs (H3).
- **The name is the history.** `sign('style:chrome')` is a lineage bag (H1);
  each marker is a whole version, the highest is now. Names carry a colon
  family (P4): `style:<name>`, `layout:<name>`, `script:<name>`,
  `markup:<name>` — clear of tile words and of the reserved bare words, and
  the same address on every host.

A reference with only a signature cannot find its newer version without
searching every history. With the name beside it, discovery is one lookup.

### Upgrading is a forward commit

To see whether a reference is current: open the name's bag, read the highest
marker, compare with the held signature. Equal is current; otherwise the
markers between are the changes not taken.

An upgrade moves the reference to the newer signature in a new marker of the
referring artifact. The old version of the page stays in its history, and
undoing the upgrade is moving back to that marker (H2). Nothing is overwritten,
so trying an upgrade is safe.

**The AI's part is judgment.** Every marker is a whole version, so it can
compare the pinned version with the current one, see what changed (a renamed
variable, a removed hole, a new trait) and check whether the referring
artifact relies on it — then propose the upgrade, apply it and show before and
after, or say why it held back (C4: it proposes, the participant runs). Without
the AI the same comparison is a plain "newer version available" notice (T4:
never push updates).

**Whose newer version.** A name is federated (P1): several authors may each
keep a `style:chrome`. Discovery follows the author or host the pin came from,
never whichever head is newest across the network — otherwise a stranger's
edit looks like an upgrade. A reference may carry the author's key for this;
the name alone is not enough.

## Bases and extensions

A layout, a stylesheet or a page may **extend a base**: it names the base by
reference (name + signature) and declares only what it changes.

```json
{ "kind": "layout-piece", "base": { "name": "layout:shell", "sig": "…" },
  "vars": { "space": "2rem" }, "holes": { "body": "…" }, "marks": ["quiet"] }
```

Merge rules, the same for every kind:

| Part | Rule |
|---|---|
| **vars** | merge key by key; the extension wins |
| **holes** | replace by key |
| **marks** | union |
| **traits** | not merged — worn at the incidence (A8) |

For a stylesheet the rule is the cascade itself: the base group's atoms first,
the extension's after.

**A base is not a parent.** A2 forbids parent artifacts. The dependency points
one way: the extension names its base; the base never knows its extensions. A
base is a pattern of holes and defaults that holds no content — an interface,
the one dependency A2 sanctions. Say **base**, never parent.

**An extension is not a whole state on its own** (H1 asks every marker to be
one). The extension keeps its base's reference, and the merged result is a
derived record (D1) minted in the optimize phase:

- base pinned **by signature** → keyed by the extension's signature;
- base followed **by name** → keyed by the pair (extension signature, the base
  signature the name resolved to), so a change to the base never serves a
  stale merge.

## Atomic style

Style is the first kind to make fully atomic, because the dedup pays at once:

- **Atom:** a declaration block, no selector — `{ padding: 1rem; border-radius:
  .5rem }`.
- **Incidence:** the selector, element or hole that wears it. Restyling is
  changing what a place wears, never editing a sheet.
- **Group:** a stylesheet, order on the mark (the cascade is order; A4).
- **Scope:** an assembled sheet is scoped to the page's frame exactly as an
  inline `<style>` is today (`scopeCellPageCss`). A sheet reached by
  `resource:<sig>` is local and readable, so it is scoped too — not hoisted to
  `<head>` as a fetched external sheet is.

## One walker, two readings

Every kind is assembled the same way, by one walk: **group → incidences →
atoms → bytes.**

- **Compile.** The walk expanded fully and flattened by the optimize phase into
  one output, keyed by the root signature (D1, D2): complete or absent, never
  truth, wipe-safe, rebuilt by a cold client from the atoms alone (D3). The
  same root always expands to the same bytes, so the output can be verified
  against its key. How far it goes — compacted CSS, a bundled module, one day
  wasm or native code — changes only the last step of the walk, never the
  graph. No one chooses optimization settings; the deploy optimizes itself.
- **Explain.** The same walk reading names instead of bytes. Every node is a
  word (N1), every relation a named group, every incidence "this, worn here, in
  this order". A path reads as a sentence: *the pitch site's third page wears
  the card style in its body hole.*

Holding both in one graph means:

- **The explanation cannot drift from the code** — it is generated by walking
  the nodes the compiler walks.
- **Every compiled byte traces back** to its atom, its name and its group: a
  source map for free, and a plain-English answer to "why is this here?"
- **The AI works in both directions** — it reads the graph as English and
  writes back signatures and marks (C2). The participant reviews the English;
  the machine runs the bytes.
- **The render walk and the publish closure are the same walk.** What is shown
  is exactly what is shipped (today `rewritePageRefs` and `extractPageRefSigs`
  are kept in step by hand; one walker makes it structural).

The English reading is only as good as the names. A graph of abbreviations
compiles just as well and explains nothing: names are words, never shortened.

The doctrine codex is this pattern applied to the rules: one line per axiom,
base to leaf, each citing only earlier ones — English that the build compiles
into the anatomy the hive's AI is taught.

## Limits

1. **The floor is usefulness, not size.** An atom must stay valid alone (A1)
   and must be larger than its reference — a signature is 64 characters and
   `padding:1rem` is 12. The atom is the smallest unit **worth sharing**: a
   coherent block that is reused or versioned on its own. Below that,
   properties stay together inside one atom.
2. **Dependencies become interfaces.** A descendant selector depends on
   structure; a function can reach into shared state. Each must depend on a
   declared shape — a hole, a custom property, an exported function signature
   — never on a particular other atom (A2). This is where most of the design
   work is.
3. **Order belongs to the relation.** The cascade, script load order and page
   sequence live on the group mark, never on the atom (A4).
4. **Nothing third-party.** An atom is reached by signature from the hive or a
   followed host, never from a host we do not control (T7).

## What already holds

- `chrome.css` is put once and linked by every page as
  `resource:<sig>/chrome.css` (the website-build skill).
- Layout pieces nest by signature
  ([layout-piece.ts](../hypercomb-essentials/src/presentation/tiles/layout-piece.ts));
  a container wears its layout as a mark
  ([template-target.ts](../hypercomb-essentials/src/presentation/tiles/template-target.ts)),
  and layout variables already merge with the inner level winning
  ([layout-templates.md](layout-templates.md)).
- Parts are seated each in its own declarative shadow root
  ([division-render.ts](../hypercomb-essentials/src/presentation/tiles/division-render.ts)),
  and an absent part is never an error.
- Membership, order on the mark and family-scoped meanings
  ([enrollment.ts](../hypercomb-essentials/src/pheromones/enrollment.ts),
  [website-artifact-paradigm.md](website-artifact-paradigm.md)).
- Page refs rewrite to `/@resource/<sig>`
  ([decoration-closure.ts](../hypercomb-essentials/src/sharing/decoration-closure.ts)),
  and the resource worker types a response by what requested it, so a module
  script should import by signature (not yet proven live).

## The path

1. **Scope stylesheets reached by signature** instead of hoisting them
   ([cell-page-stylesheets.ts](../hypercomb-essentials/src/presentation/tiles/cell-page-stylesheets.ts),
   [cell-page-css-scope.ts](../hypercomb-essentials/src/presentation/tiles/cell-page-css-scope.ts)).
2. **References as name + signature**, with the discovery lookup and the
   upgrade as a forward commit.
3. **Bases and extensions** for layouts, then stylesheets, with the merged
   result as a derived record.
4. **Style atoms and groups**: declaration blocks without selectors, sheets as
   ordered groups, the assembled sheet minted in the optimize phase.
5. **Markup fragments seated into holes**, so a page is a layout plus
   incidences.
6. **Script atoms** as modules imported by signature.
7. **One walker** for render, publish closure and explanation; the per-kind
   ref extractors fold into it.

## Invariants

- An atom carries no location, no position and no reference to a particular
  other atom — only to interfaces.
- Every reference holds a name and a signature; the signature moves only by a
  forward commit.
- A base never knows its extensions; it is an interface, never a parent.
- Assembled output is a derived record keyed by signature, never truth and
  never referenced by a layer.
- One walk assembles, ships and explains.

## Related

- [website-artifact-paradigm.md](website-artifact-paradigm.md) — atoms related
  by decoration, breaking apart, the interface rule
- [layout-templates.md](layout-templates.md) — holes, pieces, inherited
  variables
- [embedded-sites.md](embedded-sites.md) — how a page mounts and scopes today
- [hypergraph-molecule-lineage.md](hypergraph-molecule-lineage.md) — the name
  as the address and its history
- [optimize-phase.md](optimize-phase.md) — where derived records are minted
- [signature-system.md](signature-system.md) — signatures as the composition
  mechanism
