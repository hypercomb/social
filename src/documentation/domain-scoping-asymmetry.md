# OPFS Pools, Markers, and Domain-Scoping

## TL;DR

Hypercomb's OPFS layout is **sig-keyed pools + marker-as-revision-pointer**. Every `__<thing>__/<sig>` directory is a content-addressed cache (a pool that answers "give me bytes for sig X"). Markers in `__history__/<lineage>/<NNNN>` are tiny pointer records that compose those pools into revisions. There is no "truth" pool — content is determined by its signature, and pools are how those bytes get served.

Domain only appears where it's semantically required (install manifests). User-content state never carries domain in its identity, because content-addressed lookup makes domain unnecessary for resolution.

## OPFS layout

```
/<opfs-origin>/
  __bees__/             # sig-keyed pool — bee bundle bytes
  __dependencies__/     # sig-keyed pool — namespace dep bundle bytes
  __layers__/<sig>      # sig-keyed pool — ALL layer bytes (PERIOD)
  __resources__/        # sig-keyed pool — content resource bytes
  __optimization__/     # sig-keyed pool — decoration bytes (Q&A, comms, future kinds)
  __history__/<sig>/    # marker bags keyed by lineage signature
                        #   <NNNNNNNN> = revision marker (pointer record into the pools)
  __manifests__/        # sig-keyed pool — children-manifest decorations
  __threads__/          # sig-keyed pool — thread state
  __receipts__/         # sig-keyed pool — receipt blobs
  __computation__/      # sig-keyed pool — computation receipts/state
  __clipboard__/        # sig-keyed pool — clipboard payloads
  __optimized__/        # legacy — drained as old data is touched; no live code reads or writes here
  __hive__/             # legacy — user-content folder mirror (pre-layer-as-primitive)
  0000                  # global config (substrate-registry, etc.)
```

### One pool, one location for layers

There is ONE `__layers__/` directory, at OPFS root. Every layer's bytes live there, with the filename equal to `hash(bytes)` — the layer's signature. No subdirectories, no per-domain partitions, no mirrors. The pool serves a layer's bytes when asked by sig; that's its entire job.

Markers in `__history__/<lineage>/<NNNN>` are pointer records — small JSON files naming which sigs apply at this revision. The marker is the revision; the pool serves the content.

Transitional state (cleared by ongoing access):
- `__layers__/` has no subdirectories. Period. All install pipelines (boot bundle, sentinel sync, runtime install, per-domain layer fetch) write directly to `__layers__/<sig>`. Domain is irrelevant to storage — sig identity is global, content-addressed bytes don't need partitioning.
- `__optimized__/` legacy mirror is no longer read or written by live code; entries drain via natural disuse.
- `__hive__/` is legacy from the pre-layer-as-primitive era; viewport state has already moved to `__history__/<sign('/')>/...` (`editor/viewport-store.ts`).
- The sentinel-sync's old cleanup walk (delete layers not in install set) has been removed — it can't safely run against a flat pool that also contains user commits. Pool GC needs a reachability sweep (mark over history markers + install set) implemented as a separate `/sweep` command.

## Pools are caches; caches are not "derived"

A pool entry's address IS the hash of its bytes. So:

- An entry can never be **stale** — bytes either hash to the sig you asked for or they don't.
- An entry can never be **wrong** — only **present** or **absent**.
- Pools are not "derived from truth" — the bytes ARE their content; "regenerating" them means receiving identical bytes from somewhere else, not computing them from a source.

This corrects earlier framing that called `__optimized__/` a "render cache" derived from "the truth in `__history__/`". Both directories held the same bytes for the same sig; neither was derivative. The cleanup that's happening retitles them: `__layers__/` is the canonical sig-keyed pool; `__history__/<lineage>/<NNNN>` markers point INTO that pool rather than carrying redundant byte payloads.

## Markers as revisions, not vessels

A marker file at `__history__/<lineage>/<NNNN>` is a small JSON record:

```json
{ "layer": "abc123…", "decorations": ["def…"], "context": "ghi…", "receipts": ["jkl…"] }
```

Each named field is a sig that resolves through the appropriate pool. The marker IS the revision; advancing the cursor advances the bundle. Anything that becomes a marker field is automatically:

- Versioned (per-revision sig)
- Undoable (rides the existing cursor)
- Time-travelable (jump to any marker N, see the full bundle at that point)
- Shareable (the marker IS the unit of share — sig everything reachable from it)

Legacy markers (pre-migration) contain the full layer JSON directly; readers self-heal by hashing those bytes to derive the sig, depositing them in `__layers__/<sig>`, and (on next write to that lineage) rewriting the marker as a pointer record.

## The two "layers" in the codebase

The word **layer** still refers to two distinct things at different points in the pipeline:

1. **History layers (user state)** — the merkle layer state for the user's work. Bytes live in `__layers__/<sig>` (the pool); revisions live as marker pointer records in `__history__/<lineage>/<NNNN>`. No domain involvement.

2. **Install manifests (deployment)** — per-domain bundles describing what drones/bees/resources comprise a domain's install. Live at `__layers__/<domain>/<sig>`. Per-domain by design.

Rendering walks history; installing walks installs. They share a top-level directory by convenience but not by purpose.

## How resolution works

`HistoryService.getLayerBySig(sig)`:

```
parsed cache → preloader cache → __layers__/<sig> → preloadAllBags walks markers
```

Every step is sig-keyed and flat. `HistoryService.sign(lineage)` explicitly drops the `domain` parameter (`history.service.ts:117`):

```ts
// Domain is a display namespace (not part of identity).
void domain
const key = explorerSegments.join('/')
```

A marker references a layer-sig; the renderer finds that layer in the pool. The lookup doesn't care which domain authored the bytes — sig identity is global within an origin.

## What's NOT in the codebase

- **No `__root__` directory.** Despite the `__*__` symmetry, there is no top-level `__root__`. The closest thing is `ROOT_NAME = '/'` in `history.service.ts:79` — the constant for "root's lineage display name." Imported by `editor/viewport-store.ts` so root rides through `__history__/<sign('/')>/...` like any other location.

- **No reflected-signature sidecars in the marker-as-bundle model.** The earlier convention "for any sig s, reverse(s) names a sidecar" is superseded by explicit marker fields. The marker now NAMES what's attached, instead of attaching implicitly via address-space tricks. Same composability, better discoverability, supports multiple attachment kinds per revision.

## Where domain DOES matter

- `__layers__/<domain>/` — install manifests, properly per-domain.
- **Display labels** — `domain` is still extracted for UI display even though it's discarded from sig identity.
- **Mesh / sharing** — domain may matter at the peer-sharing layer when identity crosses participants. Not a local-OPFS-storage concern.

## Lessons learned

- "Cache vs truth" is the wrong dichotomy for content-addressed storage. A sig-keyed pool isn't a cache OF something; it IS the cache (in the lookup-by-key sense).
- For user-authored content, the right question is rarely "should this be domain-scoped?" — it's "is this content-addressed?" If content-addressed, domain falls out for free.
- The marker is the unit of revision. Putting supporting data (context, decorations, receipts) on the marker as named fields gets them versioning, undo, and share-ability automatically — no per-feature retrofitting.
