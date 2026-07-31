# Superimposition

*A creation has one address and many implementations. Lay them on top of each
other and read the difference.*

---

## The observation this rests on

A lineage bag's address is `sha256(lineageKey(segments))`. The address is a
function of the coordinates and nothing else — not of who wrote it, not of what
language it is in, not of which platform runs it.

So two trees at the same coordinates **are the same tree**. Not similar: the
same bag, the same history, the same undo stack. Superimposition is therefore
not a feature to be built. It is what the addressing already does, and the only
question is whether we work with it or against it.

Working against it looks like `web/signatures` and `windows/signatures` — two
addresses, two histories, and a manual search every time one changes to find
where it lands in the other.

---

## The five laws

### 1. Coordinates name the creation, never the implementation

The address is what the thing *is*, in the vocabulary of the people who use it:
`signatures`, `markers`, `store`. Never where a file happens to sit in some
repository. No project's folder layout is the skeleton — every project hangs off
the shared vocabulary as one implementation among several.

A coordinate derived from a directory tree imports that tree's accidents
forever, and mints a different address the day the tree is reorganized.

### 2. Implementations are marks, not branches

`web` and `windows` are pheromones on the cell, not ancestors above it. The same
holds for every variant axis: a site's versions, a game's ports, a document's
languages. The discriminator is always a mark, because the address is already
spoken for.

Two implementations of one idea are two marks on one cell. If you find yourself
creating a parent to hold them apart, the parent is the mistake.

### 3. A layer is a view, not a place

Filter by a mark and you have a layer. Stack the filters and you have the
superimposition. Nothing is copied, nothing is kept in sync, and there is no
canonical layer that the others must mirror — because there was only ever one
tree, seen through different marks.

This is why the model costs nothing to maintain. A view cannot drift from what
it is a view of.

### 4. Deviation is content, and absence must say why

The interesting cells are where the layers *disagree* — an implementation
present in one and missing in another. That is the whole payoff, so it must be
readable, and two absences mean opposite things:

- **`does-not-port`** — the architecture removed the need. The web head index
  exists because enumerating 8,006 marker files took seconds; the native store
  answers the same question with a range query, so there is nothing to cache.
  Permanent, correct, and worth explaining.
- **`pending`** — not built yet. Temporary. A to-do.

Unmarked absence collapses the two into one shrug, and buries the most valuable
signal in the tree under a backlog. A cell carrying `does-not-port` with a note
saying *why* is often worth more than the implementations either side of it.

### 5. An update lands on the cell, not on a search

Because both implementations share coordinates, changing one puts you on the
exact cell the other occupies. Reconciliation stops being "where does this live
over there" and becomes a question the tree has already answered — and the
sweep across every layer is a walk, not a hunt.

---

## Applies to every creation

Nothing here is about platforms. It is about any creation that exists more than
once:

| creation | layers |
|---|---|
| a protocol feature | `web`, `windows` |
| a website | its versions |
| a game | its ports |
| a behaviour | shell, drone, native |
| a document | its languages |

Same laws each time — one address, marks for the variants, views for the
layers, explained absence where they diverge. Build every creation this way and
the whole hive becomes readable in layers, not just the parts someone
remembered to align.

---

## The test

> Line up two implementations of the same thing. They should overlap almost
> perfectly. Every place they do not is either a genuine architectural
> difference, or a gap — and the tree should tell you which without being asked.

If the overlap is poor, the coordinates were taken from a file tree instead of
from the creation. If a deviation cannot be explained, it is a gap, and it
should be marked as one.

---

## See also

- `mirror-paradigm.md` — why a creation is only half built until it exists in
  the hive
- `known-location-pools.md` — the closed root vocabulary this addressing assumes
- `documentation/protocol/conformance.md` — the contract the `web`/`windows`
  layers both answer to
