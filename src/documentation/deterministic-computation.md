# deterministic computation & authenticity layer

> **status: design — not built (as of 2026-06-18).** the memoization layer
> described here is a proposal: there is no authenticity-marker store, no
> result-pointer file, no `execute()` bypass, and no `verification` token in
> the codebase today. the signature primitives it composes (`SignatureService.sign`,
> `SignatureStore`) and the install/verification path it leans on (DCP) are
> real; this document specifies how they would extend into deterministic
> compute caching.

extends hypercomb's content-addressing into deterministic computation memoization
with a community authenticity layer. builds on the primitives defined in
[core-processor-architecture.md](core-processor-architecture.md) and the
verification model in [security.md](security.md).

**related critical documents:**
- [signature-system.md](signature-system.md) — the signature-payload pair and the mandatory expansion doctrine for all data structures
- [collapsed-compute.md](collapsed-compute.md) — how deterministic computation + signature caching eliminates redundant work across the network
- [signature-node-pattern.md](signature-node-pattern.md) — plug-and-play implementation guide
- [signature-algebra.md](signature-algebra.md) — algebraic operations over signatures

---

## signature composition

every computation is identified by three inputs: the script that runs, the
resource it operates on, and the result it produces.

```
script-sig   = sign(script-bytes)
resource-sig = sign(resource-bytes)
authenticity = sign(concat(script-sig, resource-sig))
```

`authenticity` binds a specific script to a specific resource. the two 64-char
hex signatures are concatenated (128 chars), utf-8 encoded, and hashed via
`SignatureService.sign()` — producing a single 64-char hex token. this is the
computation's identity.

---

## deterministic execution

```
result-bytes = execute(script, resource)
result-sig   = sign(result-bytes)
```

execution is deterministic: same script + same resource = same result bytes,
always. the result is content-addressed — its signature is its identity.

---

## two-file storage model

the core design problem: `authenticity` identifies the *computation*,
`result-sig` identifies the *output*, but nothing connects them. without a
bridge, you'd have to re-run the script to discover the result — defeating
the bypass.

solution: marker + result files.

```
marker file (the index)
  filename:  authenticity
  contents:  result-sig              // 64-char hex pointer

result file (the data)
  filename:  result-sig
  contents:  result-bytes            // the actual output
```

### lookup flow

```
1. authenticity = sign(concat(script-sig, resource-sig))
2. open marker[authenticity] → read result-sig
3. open result[result-sig]   → read result-bytes
4. verify: sign(result-bytes) === result-sig  ✓
```

### why two files

- **the marker is 64 bytes.** the result can be arbitrarily large. loading the
  marker is cheap; loading the result is only done when needed.
- **natural dedup.** different (script, resource) pairs that produce identical
  output point to the same result file. one copy, many markers.
- **discovery is safe.** publishing `authenticity` lets anyone look up the
  result pointer, but verification still requires possessing the actual result
  bytes and confirming `sign(result-bytes) === result-sig`.

---

## resource verification (marker integrity)

```
verification = sign(concat(authenticity, result-sig))
```

proves that a specific result was produced by a specific script operating on a
specific resource. three signatures collapse into one verification token: script
identity, resource identity, result identity.

this also serves as the integrity check on the marker itself — proving the
pointer hasn't been tampered with. if someone modifies the marker to point at
different result bytes, the verification token breaks.

---

## discovery without compromise

- `authenticity` and `resource-sig` can be freely published and discovered by
  anyone.
- knowing them does **not** compromise the integrity of the result bytes.
- verification requires possessing the actual result bytes and confirming the
  hash.
- altering any input (script, resource, or result) breaks the verification
  signature.
- the chain is tamper-proof regardless of discoverability.

---

## use cases

### bypass processing

if you already have the script bytes and the resource bytes, you can compute
`authenticity` without executing anything. if a marker file exists for that
`authenticity`, read the `result-sig`, load the cached result bytes, verify
them, done. no re-execution.

```
have script-bytes, resource-bytes
  → authenticity = sign(concat(sign(script-bytes), sign(resource-bytes)))
  → marker[authenticity] exists? → result-sig
  → result[result-sig] → verify → use cached result
```

### deterministic payload publishing

once a (script, resource) pair is in the public domain, the result signature
becomes the permanent reference for that computation. anyone can verify the
result without running the script again — ever.

### community authenticity layer

volunteers audit scripts for maliciousness or danger. they maintain a simple
directory of approved signatures. this prevents installation of dangerous
payloads before they execute.

- a participant subscribes to as many volunteer auditors as they like.
- auditors publish lists of approved `script-sig` values.
- before installing a new script, the system checks whether its signature
  appears in any subscribed auditor's approved list.
- the auditor layer is advisory — participants choose their own trust threshold.

this is complementary to the existing `AuditorService` in the diamond core
processor (`diamond-core-processor/src/app/core/auditor.service.ts`), which
already fetches approval lists from configurable endpoints, verifies each list's
own signature against its url filename, and audits a script-sig against a
participant-set threshold of subscribed auditors.

the auditor layer is advisory. the load-bearing gate that actually decides
whether bytes run is the verify-then-trust path: dcp's `SentinelHandler`
orchestrates the install, `DcpInstallerService` downloads and sha256-verifies
every file, and the resulting sigs are recorded in `SignatureStore` (core).
`SignatureStore.isTrusted(sig)` is then the runtime allowlist check — a sig in
the store is allowed to run without re-hashing. the trusted set is seeded from
install/sync manifests (`trustAll`) and persisted/restored through localStorage,
so the gate survives reloads.

### installation flow (diamondcoreprocessor.com)

diamondcoreprocessor.com is the proxy that verifies all bits before they run
inside hypercomb.

1. participant provides `domain/path-to-package` and clicks install.
2. dcp fetches all files from the source.
3. dcp verifies every file's signature (`SignatureService.sign(bytes) === expectedSig`).
4. dcp stores a private copy in opfs for local installation.
5. hypercomb loads from the local copy at runtime, re-verifying on every load
   (three-layer verification: install, bee load, dep load).

### manifest freshness (O(1) root-sig compare)

update detection is a single signature comparison, not an HTTP conditional
request. a package's identity is its `rootLayerSig` — the merkle root of its
layer tree. dcp fetches `manifest.json` (keyed by root signature under
`packages[rootSig]`) and compares the freshly-discovered root against the one
already installed:

```
installedSig === rootSig  → already current, nothing to install
installedSig !== rootSig  → a new generation exists, install the delta
```

this is exactly the short-circuit in `SentinelHandler.#handleInstall`: if the
caller passes `installedSig` and it equals the discovered `rootSig`, dcp
replies `install-done` immediately with zero file transfer. because the root
signature is a merkle root, one comparison settles the whole tree — any change
anywhere below the root produces a different `rootSig`. (the same pattern drives
`sync`, which short-circuits on `syncSig`, and the `SignatureStore.storeSig`
freshness check for the trusted allowlist.) the `manifest.json` bytes can still
change without changing the signature — sidecar fields like `label`, `at`, and
`previous` are deploy metadata that ride alongside but do not feed the root.

---

## relationship to existing primitives

| primitive | defined in | role here |
|-----------|-----------|-----------|
| `SignatureService.sign()` | `hypercomb-core/src/core/signature.service.ts` | all hashing — script, resource, result, marker, verification |
| `SignatureStore` | `hypercomb-core/src/core/signature-store.ts` | the runtime trust allowlist — `isTrusted(sig)` gates whether bytes run; `trustAll` seeds it from manifests; `storeSig` is its O(1) freshness token |
| `AuditorService` | `diamond-core-processor/src/app/core/auditor.service.ts` | advisory community authenticity — fetches + self-verifies approval lists, audits a sig against a subscribed-auditor threshold |
| `SentinelHandler` | `diamond-core-processor/src/app/sentinel/sentinel-handler.ts` | orchestrates install/sync; short-circuits on the O(1) `installedSig === rootSig` compare |
| `DcpInstallerService` | `diamond-core-processor/src/app/core/dcp-installer.service.ts` | install-time download + sha256 verification of every layer/bee/dep |
| `LayerInstaller` | `hypercomb-shared/core/layer-installer.ts` | hive-side install-time verification of downloaded bytes |
| `ScriptPreloader` | `hypercomb-shared/core/script-preloader.ts` | bee load-time verification from opfs |
| `DependencyLoader` | `hypercomb-shared/core/dependency-loader.ts` | dep load-time verification from opfs |

---

## full signature chain summary

```
script-sig    = sign(script-bytes)
resource-sig  = sign(resource-bytes)
authenticity  = sign(concat(script-sig, resource-sig))

result-bytes  = execute(script, resource)
result-sig    = sign(result-bytes)

store:
  marker[authenticity] = result-sig           // the bridge
  result[result-sig]   = result-bytes         // the data
  verification         = sign(concat(authenticity, result-sig))  // marker integrity
```
