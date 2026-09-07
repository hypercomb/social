# root-entries — the home page draws from a molecule

> **Status: BUILT 2026-09-06.** Core: `HOME_MOLECULE_NAME`, `homeMoleculeKey`,
> `homeMoleculeAddress` (`hypercomb-core/src/core/molecule-address.ts`).
> Essentials: `HistoryService.sign` signs the empty path with the home key;
> `commitLayer` mirrors every root marker into the legacy `sign('')` bag.

## The invariant, and the one thing it does not say

**Everything is on the root.** Every molecule and every bag lives at the OPFS
root; that is the nature of the hive. What it does NOT say is what the home
page shows. The home page shows one chosen pool of those things, and that
pool is a molecule like any other: a bare word, `root-entries`, whose bag
`sign('root-entries')` holds the home page's head layer and its history.

So "on the root" and "shown on the home page" are two different facts:

| fact | where it lives |
|---|---|
| a thing exists | its bag or record at the OPFS root — always |
| a thing is on the home page | it is a child in the head layer of `sign('root-entries')` |

A molecule outside that pool is not hidden. Hidden is a mark on a member you
chose not to see. A molecule nobody enrolled is simply in its own group,
reachable at its address, a member of nothing. That is the default for
anything minted by address (documentation/reference-designer.md, section 4).

## Why a molecule and not a new kind of thing

The root hive is generic: it is whatever you decide to program it to be. A
molecule already gives everything the home page needs — an ordered head layer,
markers, undo, the deploy head, the swarm channel — so the home page is the
molecule `root-entries` and nothing else was invented. Consequences that fall
out of that, all by design:

- **A top-level tile named `root-entries` IS the home.** `lineageKey(['root-entries'])`
  is the home key, so its bag is the home bag — exactly as `sign('websites')`
  is the `/websites` bag. The name is the address.
- **The name can be anything.** `HOME_MOLECULE_NAME` is the one place it is
  spelled. Choosing it per participant is a setting, not built.
- **Publish and visit keys do not move.** The hive index keys the root by
  `lineageKey([])`, which is still `''` on the wire. Only the local BAG
  address changed; the head sig a visitor resolves is the same layer.

## The seam — one line, and why it is safe

`HistoryService.sign` is where every read and write turns a path into a bag
address. The empty path used to hash to `sign('')`, the empty-content root.
Now:

```
key = lineageKey(segments) || homeMoleculeKey()
```

Everything downstream — render, commit, cursor, resolve, the bridge's
`layer-at []`, the deploy head — follows without knowing.

**Data never heals; the transition is a forward commit with two pointers.**

1. **Read**: `rawLineageKey([])` is `''` and the key is not, so `sign` records
   the legacy root bag as the raw ALIAS of the home bag. The existing
   `#promoteBag` bridge unions the alias bag into the home bag on first touch
   (per-marker copy, highest wins, nothing removed). A hive built before this
   change opens its home page with every marker it had.
2. **Write**: `commitLayer` mirrors each marker committed to the home bag —
   same name, same bytes — into the legacy `sign('')` bag
   (`#mirrorHomeMarker`). Both pointers advance to the SAME atom, so an
   older build keeps reading a live root. Best-effort: the home bag is the
   truth, the mirror is a courtesy.

Nothing is deleted. The legacy bag stays as a read-drained, still-advancing
remnant. The zero-byte-file collision repair on `sign('')` in `getBag` is
untouched and still applies to the legacy bag.

## Known costs, stated plainly

- **One-time copy on first touch.** A long-lived root bag can hold many
  hundreds of markers (the dev hive: 696). They are copied once into the home
  bag by the same per-entry drain every legacy source already uses.
- **The swarm channel for the root moves with the bag** where a channel is
  derived through `history.sign([])`. Older peers converge on `sign('')`, newer
  on `sign('root-entries')`. This is the mesh transition the lineage doc
  already lists as an owner decision (`hypergraph-molecule-lineage.md`, *The
  two open items*); nothing here decides it.
- **The reverse map is first-wins.** `sign` remembers segments per sig; the
  home sig is reached by `[]` and by `['root-entries']`, and whichever signs
  first names it. Both are the same place, so nothing resolves wrong, but a
  diagnostic may print one spelling for the other.
