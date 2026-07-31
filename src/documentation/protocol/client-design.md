# `hypercomb-client` — design, pass two

Scope of this pass: the two crates that carry no product risk and are provable
against the conformance vectors — **`protocol`** and **`store`**. Everything
above them (mesh, platform, app shell) is sketched in
`documentation/protocol/conformance.md` and deferred.

Companion documents:
- `conformance.md` — the protocol contract both implementations must satisfy
- `hypercomb-client/conformance/vectors.json` — the machine-checkable vectors

---

## 0. Product scope this design serves

v1 is a native window on **your own hive**. Separate from the web shell's hive —
not a mirror, not a viewer. Boot in about a second; navigate, create, edit, move,
select, copy, undo, all instant; restore a hive from a folder and export one back
out. One-click install, self-updating.

Explicitly out: mesh, sharing, games, websites, AI, tutorials, and every OS
showpiece (cfapi, Explorer integration, USN journal, TPM). Each layers on later
without revisiting anything here.

Because the two hives are separate, there is **no concurrent writer**, and
therefore no marker-collision problem, no lock file, and no writer-scoped marker
naming. That entire branch is out of scope.

---

## 1. Crate layout

```
src/hypercomb-client/
├── crates/
│   ├── protocol/      pure. bytes in, signatures out. no I/O.
│   ├── store/         content-addressed storage. depends on protocol.
│   ├── mesh/          (deferred)
│   ├── platform/      (deferred) OS capabilities behind a trait
│   └── host/          composition + the IPC surface
├── app/               Tauri shell
└── conformance/       vectors + the test harness that runs them
```

**The one dependency rule** — the same shape as the existing
modules-depend-only-on-core doctrine:

> `protocol` depends on nothing. Everything depends inward. `platform` is a trait
> with per-OS implementations, never imported by `protocol`, `store`, or `mesh`.

Windows is the first target, not the only one. Nothing outside `platform` may
name an operating system.

---

## 2. `protocol`

Pure functions and types. No filesystem, no network, no clock, no globals. This
is what makes it testable against the vectors and compilable to `wasm32` for the
web shell to adopt later.

### Newtypes — the drift fix

The TypeScript tree addresses everything as a bare 64-hex `string`, and that is
the direct cause of the worst class of bug it has: a pool address and a lineage
bag address are indistinguishable, so code that prunes bags can destroy a pool.
`/flatten` on a colliding bare-word address hard-deleted one.

```rust
pub struct Sig([u8; 32]);          // any content signature
pub struct LayerSig(Sig);          // a signature known to address a layer
pub struct BagAddr(Sig);           // sha256(lineage_key(segments))
pub struct PoolAddr(Sig);          // sha256(meaning)
```

These do not convert into one another implicitly. A function that prunes bags
takes a `BagAddr` and **cannot be handed a `PoolAddr`**. The bug class stops
being a discipline problem and becomes a compile error.

`Sig` is 32 raw bytes, not a hex string — half the memory, no per-comparison
parsing, and hex is a display concern (`Display`/`FromStr` at the edges only).

### Surface

```rust
pub fn sign(bytes: &[u8]) -> Sig;

pub fn canonicalize_segment(raw: &str) -> String;   // NFC, separator fold, trim
pub fn lineage_key(segments: &[&str]) -> String;    // incl. the symbol-only guard
pub fn raw_lineage_key(segments: &[&str]) -> String; // legacy, READ ONLY
pub fn bag_addr(segments: &[&str]) -> BagAddr;

pub struct PoolRegistry { /* seeded + self-extending */ }
impl PoolRegistry {
    pub fn address(&mut self, meaning: &str) -> PoolAddr;  // deriving registers
    pub fn meaning_of(&self, sig: Sig) -> Option<&str>;
    pub fn is_pool(&self, sig: Sig) -> bool;
}

pub struct Layer { pub name: String, pub slots: BTreeMap<String, Value> }
impl Layer {
    pub fn canonical_json(&self) -> String;  // name first, slots sorted, empties dropped
    pub fn sig(&self) -> LayerSig;
}

pub enum Marker { Pointer { layer: LayerSig, fields: Map }, LegacyInline { layer: LayerSig } }
pub fn parse_marker(bytes: &[u8]) -> Marker;
```

`BTreeMap` for slots gives the required alphabetical ordering structurally — the
canonical form cannot be got wrong by forgetting to sort.

### Correctness notes carried from the vectors

- **Do not normalize Unicode inside `sign`.** NFC happens in
  `canonicalize_segment` and nowhere else. Composed and decomposed `café` are
  *different signatures* but the *same bag*. Both halves are asserted.
- **The symbol-only guard is not optional.** A segment that canonicalizes to `""`
  falls back to its trimmed raw form. Omit it and the first tile named `🐝`
  writes its history into the root's bag.
- **`children` is just a slot.** No positional special-casing. Child order is
  content and is never sorted.
- **Bee payloads use insertion-order canonicalization**, unlike layers. Two
  different rules; keep them in separate functions so they cannot be confused.
- **Do not port `EMPTY_LAYER_CONTENT_SIG`.** It does not match the canonicalizer.

### Testing

One integration test reads `conformance/vectors.json` and asserts every entry.
It is the crate's definition of done — 69 vectors, all green, before `store`
begins.

---

## 3. `store`

### The problem being solved

Content addressing produces enormous numbers of tiny records. Measured on the
existing tree: **603 bags, 8,006 markers**, a marker being ~77 bytes.

One file per record costs, per record: an open/close syscall pair, an MFT record,
a directory entry, and — on Windows — a trip through the on-access antivirus
filter. That last is frequently the dominant cost and is invisible to an
application profiler. It is a large part of why the current cold scan takes
13.6 seconds. The bytes are trivial; the *file operations* are not.

Meanwhile the total volume is small: 8,006 × 77 B ≈ **600 KB** of markers, and
even 10,000 layers at ~1 KB is ~10 MB. **The entire navigable structure of a hive
is a few megabytes.** It should simply be resident, permanently.

Images are the only genuinely large content, and they are exactly what should
*not* be resident.

### The split

| Content | Storage | Rationale |
|---|---|---|
| Markers, layers, pool records, small resources | **`redb`** — one memory-mapped B-tree file | Thousands of records → one file open, zero per-record syscalls, no per-record AV |
| Blobs above the threshold (images, media) | **Loose files**, mmap'd on demand | Already large; per-file overhead is noise; streams straight to the GPU |

Threshold: **64 KiB**, configurable. Membership is decided by size at write time
and recorded, so a read never has to guess.

`redb` is the Rust-native choice — memory-mapped, zero-copy reads, ACID, single
file. LMDB is the equivalent if a C dependency is acceptable. Either turns the
cold scan into one mmap.

mmap is also the answer to "keep everything in memory": a mapped file *is*
memory, with the kernel's page cache doing the work. No load step, no
deserialization, no separate cache to invalidate, no doubled RAM, and pages
shared across processes.

### Tables

```
content   : Sig                  -> bytes         small content, by signature
blobs     : Sig                  -> BlobLoc       large content -> loose file
markers   : (BagAddr, u32)       -> bytes         composite key; ordered
pools     : (PoolAddr, PoolKey)  -> bytes         pool members
meanings  : PoolAddr             -> String        registry persistence
```

Loose blobs live at `blobs/<first 2 hex>/<sig>` — fanned out so no directory
grows unbounded.

### Head lookup becomes a range query

The head rule is *"the maximum marker in the bag"*. With a composite `(BagAddr,
u32)` key that is a **single B-tree range scan, last entry** — O(log n), no
directory enumeration, no listing 8,006 files.

This deletes a workaround rather than optimizing one. The persisted
`localStorage` head-index cache exists purely to avoid the multi-second bag
enumeration; here there is nothing to cache, because the lookup was never
expensive. **Do not port the head index.**

Boot therefore performs no scan at all: open one mmap, and every head is a range
query away.

### Write path

Content-addressed writes are idempotent by construction:

```
put(bytes):
  sig = sign(bytes)
  if index contains sig: return sig        // already have it; nothing to do
  if len < THRESHOLD: content[sig] = bytes
  else: write blobs/<aa>/<sig>; blobs[sig] = loc
  return sig
```

No conflict resolution, ever — identical content produces an identical
signature and identical bytes.

Marker append is `markers[(bag, head + 1)] = record`, inside a redb write
transaction.

### Interchange — restore and export

The canonical sig-named layout (`conformance.md` §7) is the **import/export
format**, not the internal one. This is what makes the internal representation
legal, so it is a v1 feature rather than a convenience.

**Restore is the legacy drain generalized to an arbitrary source directory** —
the same semantics, parameterized:

- **Content** — insert if absent. Signature-addressed, so this is dedup by
  construction and re-importing costs nothing.
- **Bags** — union the markers; the highest wins.
- **Pools** — union by member.

Idempotent: a second run imports nothing. Overlapping hives merge rather than
collide. One code path serves restore, legacy drain, and backup ingest.

**Export** walks the tables and emits the canonical layout — which is also the
backup format, and is readable by the web shell.

### Trait

```rust
pub trait ContentStore {
    fn put(&mut self, bytes: &[u8]) -> Result<Sig>;
    fn get(&self, sig: Sig) -> Result<Option<Bytes>>;      // zero-copy where possible
    fn head(&self, bag: BagAddr) -> Result<Option<Marker>>;
    fn append(&mut self, bag: BagAddr, marker: &Marker) -> Result<u32>;
    fn markers(&self, bag: BagAddr) -> Result<impl Iterator<Item = (u32, Marker)>>;
    fn pool_put(&mut self, pool: PoolAddr, key: &PoolKey, bytes: &[u8]) -> Result<()>;
    fn pool_list(&self, pool: PoolAddr) -> Result<impl Iterator<Item = PoolKey>>;
}
```

One trait, two implementations later: the native `redb` backend now, and an OPFS
backend if the web shell adopts the wasm core. The shell's `Store` is already an
interface behind IoC, so that swap happens at a seam that already exists.

---

## 4. Open decisions

1. **`redb` vs LMDB.** Leaning `redb` — pure Rust, no C toolchain, actively
   maintained. LMDB has two more decades of production hardening. Reversible;
   the trait hides it.
2. **Blob threshold.** 64 KiB is a starting guess. Should be measured against a
   real hive, not chosen from taste.
3. **Does `substrate/` come back into v1 scope?** It was cut, but it may drag
   tile *images* out with it. If backgrounds and reference images render wrong
   without it, it returns.
4. **`quickmenu/`** — cut for v1 as a judgment call. Built, verified, only 6
   files. Easy to reverse.

## 5. Definition of done for this pass

- `protocol` compiles to native and `wasm32`, and passes all 69 vectors.
- `store` round-trips a real exported hive: restore → export → byte-identical.
- Cold open of a 603-bag hive is measured, with a target of **< 200 ms** to first
  head lookup.
