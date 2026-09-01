# Template addressing

How a template written against *files* becomes a creation that lives in the
hive, addressed the way everything else is.

A presentation, an explainer, a deck — anything authored as one page plus a set
of parts — arrives from its authoring tool as a folder: an HTML entry point and
some siblings it names by relative path. The hive has no relative paths. It has
tiles, and it has signatures.

Template addressing is the seam between the two: **the template's placeholders
are names, and a tile's children supply them.**

## The insight

A template already contains its placeholders. From the replication explainer,
unmodified:

```html
<x-import component-from-global-scope="ReplicationVideo"
  from="./animations-v3.jsx ./tweaks-panel.jsx ./replication-scene.jsx">
```

Those relative paths are names. Nothing has to be invented — `./scene` stops
meaning "the file beside me" and starts meaning "the child called scene". Same
template, different resolver.

That is the whole idea. The rules below exist because the two naming worlds do
not overlap as cleanly as they first appear.

## The contract

| | carries | job |
|---|---|---|
| **the name** | `scene`, `panel`, `support` | WHICH slot this part fills |
| **the mark** | `template:part` | THAT this child is a part at all |
| **`order` on the mark** | a number | which one wins if two claim a slot |
| **the template** | a signature | what to render the parts into |

The two are separate on purpose. Marks classify; they do not resolve. The mark
says a child is a part, the name says which part, and the reader does the
resolving — the same division that keeps every other mark in the system honest.

---

## Rule 1 — a placeholder is a SLUG, never a filename

`lineageKey` replaces every run of non-(letter|digit) with a single `-`
(`history/lineage-key.ts`). So a filename does not survive the trip:

```
animations-v3.jsx   →   animations-v3-jsx
styles.css          →   styles-css
styles/css          →   styles-css      ← a different thing, the same slug
```

Dots and slashes fold to the same character, so extensions and paths collide
**silently**. A template authored against `styles.css` and a tile named
`styles-css` resolve identically, and so does anything else that folds the same
way.

Author placeholders as flat slugs — `scene`, `panel`, `support`, `styles`. The
template is yours to write, so this costs nothing and removes the entire class
of mismatch.

**Corollary — a nested path is not a name.**
`_ds/industry-dcc8d4c7-a281-47b0-9faf-78e165288584/styles.css` cannot be a tile
name; it is a subtree with a UUID in the middle. A design system is ONE shared
artifact, not a directory of files. It already ships as a bundle plus a
stylesheet, and making it one artifact is precisely what lets ten presentations
reference it instead of carrying ten copies.

## Rule 2 — the mark carries a colon, always

`template:part` and never `part`. A colon can never appear in a lineage key
(the folding in Rule 1 guarantees it), so a colon-carrying meaning cannot
collide with any tile or page slug — the same reason every pool meaning needs
one (`core/pool-registry.ts`, and `known-location-pools.md` for the full
paradigm). A bare-word role marker would collide with the first creation
someone names "part".

## Rule 3 — resolution happens at PUBLISH, never in the visitor

**This is the load-bearing rule.** Names are an authoring convenience; the
published artifact carries signatures.

Publishing walks the parts, resolves every placeholder to the content signature
behind it, and seals the result. What reaches a reader has no names left in it.

Three things break at once if a visitor's page resolves names at render time:

1. the visitor needs the hive's whole name-resolution machinery to read a page
   that should be static bytes;
2. the seal cannot cover parts it cannot enumerate, so a published site is no
   longer a closed set — and "complete-or-absent" stops meaning anything;
3. renaming a tile silently breaks a site that was already published and
   verified, at a distance, with no error at the point of the change.

This is the same shape as every other mutable pointer that is allowed to exist:
`/pin` may be repointed, and everything it names is content-addressed. A
template placeholder is a pointer of exactly that kind, and it is resolved
before anything leaves the hive.

## Rule 4 — a missing part refuses the publish

Loudly, at the moment of publishing, naming the slot that had no supplier.

Never render a hole. `replication.hypercomb.com` served a black screen for a
day because the engine loaded, asked for something absent, and had nowhere to
say so; the reader saw nothing and the publisher was told nothing. A publish
that cannot resolve its own parts has not produced a creation, and should say
so while the person who can fix it is still standing there.

## Rule 5 — parts resolve inside the branch's closure

A part is a child of the tile, or an explicitly enrolled shared artifact.

A template that can name any tile anywhere gets action at a distance, and the
branch stops being self-contained — which breaks publishing directly, because
publishing seals a subtree. A role resolving to a tile outside that subtree
produces a published site with a hole in it, and by Rule 3 nobody finds out
until a visitor does.

Sharing is still the goal, not the exception (`SHARE RESOURCES, NEVER COPY` —
N uses are N references). A shared design system is enrolled so the seal
follows the reference; what is forbidden is an unenrolled name that happens to
resolve locally and cannot resolve anywhere else.

## Rule 6 — the template is an artifact

Addressed by signature like everything else, and referenced by the decoration
that says how a tile renders. One `presentation` template, N presentations.

A template pinned by signature also means a presentation cannot change under
its author because someone edited the template — a new template is a new
signature, and adopting it is a decision.

---

## What it looks like

```
/hypercomb/architecture/replication-by-signature     ← the creation
   ├── scene        template:part   order 0          ← replication-scene
   ├── panel        template:part   order 0          ← tweaks-panel
   ├── support      template:part   order 0
   └── styles       template:part   order 0          ← the shared design system
```

The tile wears the template reference; each child wears `template:part` and is
named for its slot. Swapping a scene is replacing one child. Publishing
resolves the four names to four signatures and seals them with the page.

## What this replaces

Relative paths in a folder, which cannot do any of it: two presentations cannot
share a design system without duplicating it, swapping a scene means editing
HTML, and the template is not reusable at all — it is a one-off that happens to
have been written twice.

## Related

- `known-location-pools.md` — why a colon is the collision-proof scope
- `website-artifact-paradigm.md` — an artifact stands alone; relations are
  marks the members wear
- `install-by-replication.md` — complete-or-absent, and why a hole is never
  published
