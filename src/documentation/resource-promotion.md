# Resource Promotion — a file becomes a folder when something is said about it

How a content-addressed resource acquires meaning without acquiring a
schema, a migration, or a vocabulary. The determination is one runtime
check — **file or folder** — and it applies uniformly to every kind of
resource: pages, stylesheets, bundles, images, audio.

## The problem

Content is immutable, which is the whole point: the signature IS the
identity, same bytes dedupe to one address, and a held signature resolves
without a query. But immutability also means **there is nowhere to put
anything you want to say about the bytes.** Three symptoms:

1. **Type lives in the address.** `guessResourceContentType`
   (`hypercomb-web/public/hypercomb.worker.js:275`) is a ladder: the
   extension in the URL tail, then `request.destination`, then
   `Blob.type`, then `application/octet-stream`. Step 1 is type encoded
   in the address — the exact pattern the typed `__x__` folders were
   eradicated for; it survived in URL tails, which is why a bundle must
   be spelled `resource:<sig>/lounge-3d.js` to serve as JavaScript. Step
   3 leans on `Blob.type`, which is EMPTY for files read out of OPFS, so
   when nobody spelled an extension the ladder collapses to
   octet-stream. That is the adopted-CSS bug class.
2. **Judgments have no home.** "This is superseded", "this was
   hand-corrected", a note about where a photo came from — none of it is
   in the bytes and none of it can be.
3. **Garbage collection cannot decide.** A sweep looking for bloat (a
   superseded 550 kB bundle) cannot tell a recomputable artifact from
   something a person deliberately kept.

## What is NOT persisted, and why that comes first

**Facts derivable from the bytes are derived at runtime and never
stored.** `sig → intrinsic facts` is a pure function of immutable input,
so an in-memory memo keyed by signature needs *no invalidation logic at
all* — the property that usually makes such caches expensive to get right
costs nothing here.

The threshold is the cost of re-deriving, not tidiness:

| Fact | Cost | Where |
|---|---|---|
| kind / MIME | magic numbers, microseconds | runtime |
| byte length | `file.size`, free | runtime |
| image dimensions | header decode | runtime |
| thumbnails | full decode + resize + re-encode | persisted — `sign('thumbnails:hex')`, keyed by SOURCE sig, minted in the optimize phase |

A persisted derived record also **freezes a schema**: adding a field
later means a migration or a re-mint under a different key. A runtime
derivation has no schema, so extending it is one more line in the
resolver and nothing on disk to reconcile.

**Consequence, and it is the load-bearing one:** since derived facts are
never written, *anything found in a promoted folder is there because
someone said it.* The folder is truth by construction. Nothing has to
guess which persisted records are recomputable.

## The primitive

```
<root>/<sig>            a FILE   → the bytes, and nothing is said
<root>/<sig>/           a FOLDER → the bytes, and things are said
```

One check at one place — the resource read path in `Store` — and every
consumer downstream stays ignorant. The unpromoted majority costs
nothing: a plain file stays a plain file forever.

This is not a new mechanism. A lineage sigbag is already
`<lineageSig>/0000,0001,…`; a promoted resource is the same shape keyed
by a content signature instead of a location signature.

### P1 — no reserved names, ever

**The member whose name equals the folder name is the content. Every
other member is something said about it.**

```
<sig>/<sig>        the bytes
<sig>/<otherSig>   something said about them
```

`content` + `meta.json` would be legible and would quietly reintroduce
human filenames — the thing the typed-folder eradication was about.
Naming the content after its own signature keeps the address a hash all
the way down, makes promotion a pure move with no rename, and leaves the
folder able to hold variants later (a thumbnail under its own signature)
without a vocabulary appearing.

### P2 — promotion has a window; the reader closes it

`getFileHandle(name)` and `getDirectoryHandle(name)` share ONE OPFS
namespace: `<sig>` cannot be a file and a directory at the same time, and
OPFS has no atomic rename. Promotion is therefore unavoidably
remove-then-create, and during that window a concurrent read finds
neither.

Today a miss reads as "not held locally" and sends the caller to the host
fetch or the missing-resource path — which is how this would surface as
an intermittently unstyled page that never reproduces. So:

- the promoter holds the bytes in memory across the swap and writes them
  into the folder before releasing;
- the reader treats **neither kind present** as *retry once*, never as
  absence.

### P3 — intrinsic may sit with the bytes; relational may not

What a resource **is** — kind, dimensions — is identical for every
referrer and can sit with the signature. What a resource is **for** must
not: one `chrome.css` referenced by twelve pages is twelve purposes, and
a mark on the shared bytes would flatten them into one. Purpose rides the
**reference**, per the incidence rule.

The mechanism does not enforce this. It makes hanging purpose off bytes
exactly as easy as hanging identity off them, and only the first is
wrong. Review habit, not a guard.

### P4 — promotion is LOCAL; the wire format never learns about it

Hosts and the CDN serve `${host}/${sig}` as bytes. If a peer ever had to
know whether a copy was promoted, dedup and the O(1) root compare would
break — and two peers holding identical bytes would have different
`<sig>/` contents, so the address would stop naming one thing.

Meta that must travel cannot hang off the content signature at all. It
becomes its own signature-addressed record, referenced from the tree,
where the incidence rule already puts it.

### P5 — the registry must know before any root walker is trusted

The root is an untagged union of `{content file, lineage bag, pool}`, and
today `kind` alone separates content (files) from the other two
(directories). Promotion ends that: sig-named directories become a union
of three things.

Correctness survives — a content signature is `sha256(bytes)` and can
never coincide with `sha256(meaning)` or `sha256(lineageKey)` — but
anything that walks the root and assumes *sig-named directory = lineage
bag* will now eat promoted content. That is the `/flatten` data-loss
class. **`pool-registry.ts` must be able to answer "is this a promoted
resource" before the first promotion ships, not after.**

## What it buys

- **MIME answered by the resource, not the referrer.** The service worker
  sniffs the blob it is already holding; the URL-tail guess stops being
  load-bearing and octet-stream stops being reachable for anything with a
  recognisable header.
- **A home for judgments** about bytes, uniform across every resource
  type, with no per-type vocabulary.
- **A decidable sweep.** A plain signature file with no live reference is
  a pure orphan and safe to reclaim; a promoted one carries someone's
  words and needs a decision.

## Files this touches when built

- `hypercomb-shared/core/store.ts` — `putResource` (writes
  `hypercombRoot.getFileHandle`, ~:626) and `#loadResource` (walks its
  sources with `getFileHandle`, ~:1411): the file-then-directory fork,
  miss-only cost, plus the P2 reader contract.
- `hypercomb-web/public/hypercomb.worker.js` (and the `dist` copy) —
  sniff before the URL tail in `guessResourceContentType`.
- `hypercomb-core/src/core/pool-registry.ts` — P5.

## Related

- `known-location-pools.md` — closed root vocabulary; marks classify,
  never resolve.
- `optimize-phase.md` — the derived-cache contract the thumbnail pool
  obeys and this deliberately stays out of.
- `signature-system.md`, `signature-algebra.md`, `dna.md` — the
  content-addressed model underneath.
- `build-revisions.md` — grouping related changes; the seal that names a
  build says nothing about what the individual resources ARE, which is
  the gap this fills.
