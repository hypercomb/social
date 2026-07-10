# Sig-Native Cut / Copy / Paste

*Status: BUILT 2026-07-09. Replaces the flatten/importTree clipboard pipeline.*

## The principle

A layer's signature **is** the collection. Under the merkle model a subtree
root sig carries every descendant by construction, so moving a tile between
pages never requires touching the subtree:

- **Copy / cut capture ONE sig at intent** — `sealSubtree` folds the
  subtree's LIVE per-page heads into a merkle-correct root (pool-written, no
  markers; the same primitive sharing uses — cut/copy is sharing with
  yourself). Fallback: the parent's stored child sig.
- **Cut = one commit** on the source parent: `children removeSig(sig)`.
  Nothing is deleted — the child's bytes, markers and bag survive; the new
  head merely stops listing it. Undo restores it forever.
- **Paste = one commit** on the destination parent: `children append(sig)`.
  The subtree is NOT re-committed: its bytes are pool-addressed and
  position-independent.

Both ride `LayerCommitter.commitChildrenDeltas(segments, {removes, appends})`
— the `deltas` commit kind: N surgical sig-space edits against one slot in one
marker. Unlike the old name-SET commits it never re-lists children, so:

- a **cold sibling cannot be wiped** (the entire strict-read/refusal class —
  "cut skipped — cold sibling", "paste deferred" — is structurally gone);
- **no name→sig re-resolution** runs, so the husk auto-mint hazard never
  enters the commit;
- cost is O(delta), not O(children × bag reads). The post-commit reconcile is
  targeted too: names are resolved only for the changed sigs.

## Lazy resolution: the parent chain is the fallback

The subtree's lineage bags at the DESTINATION paths are not seeded at paste.
Instead `HistoryService` resolves cold paths through the parent's children —
at the two choke points every reader funnels through:

- `sign()` records a **sig → segments reverse map** (location sigs are
  one-way hashes; this is how a sig recovers its parent).
- `currentLayerAt` — on authoritative absence, or a **husk-only bag** (a
  single auto-minted bare `{name}` marker — never truth; a bare head with
  real history IS truth: the user emptied the tile), it resolves
  `#parentCarriedChild`: parent head (recursively — a whole pasted subtree
  resolves this way) → child by name, manifest-first.
- `latestMarkerSigFor` — same fallback BEFORE minting the empty marker.
  The husk mint remains only for genuinely-new names (the create path
  takes the minted empty sig as a new child's first layer).

A successful fallback seeds a **virtual head** (`#seededHeadByLineage`,
session-only, never persisted, never written to the real head map — it must
die with a paste being undone elsewhere). Reads never write. On the first
WRITE at a seeded path, `commitLayer` materializes the seed as a real marker
first, so the bag's timeline reads *empty → pasted state → first edit* and
undo of that edit lands on the pasted state.

This closes the whole husk class in one seat: navigation into pasted/adopted
children, branch dots + click-through (`freshenBranches`), tile-properties
reads, committer hydration on first edit (previously orphaned the subtree),
and `sealSubtree` over bagless branches — with **zero changes** to show-cell,
lineage, or the shared shell.

## Derived collections (prune / index override)

Two paste features derive a NEW collection from the captured one — both are
pure pool re-mints via `HistoryService.materializeLayer` (canonicalize → sign
→ pool write, no markers):

- **Nested-discard exclusions** re-mint the spine down to each excluded
  branch (`#pruneCollection`).
- **Hover-number paste targets** re-mint only the top node with the `index`
  override folded into its props.

## What stays

- `hc:tile-props-index` seeding at destination keys — now a pure sig-walk
  over the (warm) pasted collection; no commits.
- Name-collision refusal at the destination (names are path identity),
  resolved manifest-first and tolerantly — a cold miss can no longer wipe.
- `flattenLayerTree` / `importTree` — still the right primitives for genuine
  multi-node MINTS (miro import, path creation, collections create) and for
  adopt/website-archive until they migrate to sig-append (they can — see the
  audit).
- Clipboard meta/restore/validate — `validate` is sig-first now: bytes
  present ⇒ pasteable ⇒ valid.

## Migration candidates (not yet done)

- `move.drone.ts` drop-into / promote → removeSig + append + `sig-swap` of
  the gaining parent's changed sig (2 commits + 1 swap).
- `swarm-adopt` / `website-archive` fold → append(branch root sig) once the
  byte closure is local.
- `image-paste.worker` → mint the child layer, then `commitChildrenDeltas`
  append (kills its strict-read dance).
