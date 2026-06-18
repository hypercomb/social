# Dependency Signing

How a single signature — the merkle root of a package's layer tree — secures the entire package for byte integrity, and why domain-aware installation creates a trustworthy package ecosystem. (The third-party vetting layer described later is aspirational design; today the trust gate is a binary domain allowlist.)

---

## Core Concept: One Signature, Full Hierarchy

Every installable package in Hypercomb is identified by a single cryptographic signature (a 64-character hex SHA-256 hash): its **`rootLayerSig`**. This signature is not the SHA-256 of a flat manifest --- it is the merkle root of the package's **layer tree**, where every artifact is named by the hash of its own bytes and every parent layer holds its children's signatures, so the root transitively covers every byte in the hierarchy.

### How It Works

The package signature is **not** the SHA-256 of a flat `file-path → hash` install manifest. It is the **`rootLayerSig`** — the merkle root of the package's layer tree, where each layer signs its own bytes and references its children by signature.

1. **Artifact hashing.** Each artifact is signed over the **raw bytes** that ship. Bees and dependencies are the raw compiled esbuild output, signed directly (`SignatureService.sign(bytes)`). Layers are signed via `signJson(layer)` — `JSON.stringify(layer)` with **no key sorting**, then hashed. The bytes that were signed are the only bytes that verify. (Do not "canonicalize" by re-serializing with sorted keys — a reader who sorts keys computes a *different* signature and breaks every cache hit.)

2. **Layer tree assembly.** Each layer is a small JSON document `{ name, cells, bees, dependencies }`. `cells` is the array of **child layer signatures**; `bees` and `dependencies` are signature arrays. A parent layer therefore *contains* its children's signatures, so its own signature is a function of theirs: `parent = f(child sigs)`.

3. **Signature derivation.** The signature of the top layer is the **`rootLayerSig`** — the package identity. This single value transitively secures the whole tree: change any bee, dependency, or layer, its signature changes, its parent layer's signature changes, and the change cascades to the root. The root *is* the merkle proof.

4. **Discovery + verification on install.** A `manifest.json` (see below) is keyed by `rootLayerSig` and lists every layer/bee/dependency signature the package comprises. The client downloads the manifest, fetches each listed signature, and verifies the fetched bytes hash back to the signature they were addressed by. Any mismatch aborts. No artifact can be tampered with, added, or removed without changing some signature and cascading to a different root.

### Why One Signature Is Enough

A traditional package manager might sign individual files or use a flat checksum list. The Hypercomb model is stronger because the signature is **merkle-hierarchical**: the root covers every layer, each layer covers its child layers and its bee/dependency signatures, and every artifact is named by the hash of its own bytes. Adding a malicious bee would change a layer, which changes its parent, which changes the root. Swapping bytes under an existing signature fails the hash-back check. There is no gap.

> **Sidecar metadata, not identity.** A package entry also carries `label` (a human-readable branch name), `previous` (the version it supersedes), and `at` (the deploy timestamp). These change `manifest.json`'s bytes but **never** enter `rootLayerSig` — naming or re-deploying a package never redefines it. See [the deploy branch-naming notes](#why-this-matters-for-deployment) below.

---

## Domain + Signature: The Install Contract

Installing a package requires two pieces of information:

- **Domain** --- the hosting origin: an operator's own domain (e.g., `jwize.com`)
- **Signature** --- the 64-character hex hash identifying the exact package version (the `rootLayerSig`)

The **primary** resource transport is HTTP-direct to an operator domain, where every signature is served as a flat path off the root:

```
https://{domain}/{signature}
```

The package's `manifest.json` (discovery) lists the `rootLayerSig`-keyed package and its constituent signatures; each listed signature is then fetched at `/{signature}`. There is **no hard-coded central CDN default** any more: `ContentBroker.#getFallbackDomains` returns empty unless an operator deliberately adds mirrors (`hc:fallback-domains`), and the old Azure CDN default has been retired. Cloudflare edge caching of the immutable `/{signature}` paths is embraced as a scale primitive — an immutable, content-addressed URL is safe to cache forever.

### Why Domain Matters

The domain is not just a convenience --- it is a trust boundary:

- **Multiple domains can host different packages.** A community member can host their own packages on their own domain. A corporate team can host internal packages on a private Azure blob. The protocol is the same; only the domain differs.

- **Domain pinning prevents substitution.** If a client expects a package from `storage.example.com`, a redirect to `evil.example.com` would be caught because the domain is part of the install contract. The signature alone is not enough --- you must also trust the origin.

- **Self-hosting is first-class.** Any static file host that can serve immutable bytes at `/{signature}` (a plain Nginx server, an operator's own box behind a Cloudflare tunnel, S3, R2) can serve packages. There is no central registry that all packages must flow through.

### Install Flow

```
Client                          Domain
  |                               |
  |  GET /manifest.json           |
  |------------------------------>|
  |  { packages: { <rootSig>: … } }
  |<------------------------------|
  |                               |
  |  look up packages[rootSig] — its layer/bee/dep sig arrays
  |                               |
  |  GET /{sig}                   |  (for each listed signature)
  |------------------------------>|
  |  bytes                        |
  |<------------------------------|
  |                               |
  |  verify: sha256(bytes) === sig (the address it was fetched by)
  |                               |
  DONE --- every artifact hashes back to its signature
```

---

## Third-Party Vetting: Safe Signatures

> **status: design — not built (as of 2026-06-18).** The vetter / safe-signatures / meta-vetter web-of-trust below is aspirational. What ships today is a **binary domain allowlist**: trust is granted per-host (community-trusted / writer domains), and the only cryptographic gate is the sha256 hash-back check on fetched bytes. There is no signature-level vetter list, no endorsement chain, and no transitive trust engine in the current build.

Not every package hosted on a domain should be blindly trusted. The longer-term design adds a **vetting layer** where third-party contributors and community sites can mark specific signatures as safe for consumption.

### How Vetting Works

1. **Contributors publish packages.** Anyone can create a package, compute its signature, and host it on their domain. Publishing is permissionless.

2. **Vetters review and approve.** Trusted individuals or organizations (vetters) review a package's contents. If they determine it is safe, they add the signature to their public **safe-signatures list**.

3. **Clients check vetter lists.** Before installing a package, a client can consult one or more vetter lists. If the signature appears on a trusted vetter's list, the client proceeds. If not, the client warns the user or blocks the install.

### Vetter Sites

A vetter site is any publicly accessible endpoint that serves a list of approved signatures. The simplest form is a JSON file:

```json
{
  "vetter": "hypercomb-community",
  "updated": "2026-03-01T00:00:00Z",
  "safe": [
    "a1b2c3d4e5f6...64-char-hex-signature",
    "f6e5d4c3b2a1...64-char-hex-signature"
  ]
}
```

Vetter sites can also verify signatures **by the signatures they endorse**. This creates a web of trust:

- **Level 1:** A vetter reviews the package source and marks the signature safe.
- **Level 2:** A meta-vetter reviews the vetter's track record and endorses the vetter's list.
- **Level 3:** A client trusts the meta-vetter, which transitively trusts the vetter, which transitively trusts the package.

This is analogous to certificate chains in TLS, but applied to package integrity rather than transport security.

### Trust Model

| Actor | Role | Action |
|---|---|---|
| Publisher | Creates packages | Computes signature, hosts files on their domain |
| Vetter | Reviews packages | Adds safe signatures to their public list |
| Meta-vetter | Reviews vetters | Endorses vetter lists, creating trust chains |
| Client | Installs packages | Checks signature against vetter lists before install |

### Why This Matters for Deployment

When Hypercomb deploys a new version:

1. The build computes the package's `rootLayerSig` (the merkle root of the layer tree).
2. The constituent signatures are published to the hosting domain at `/{signature}`, and `manifest.json` is updated so its single package entry is keyed by the new `rootLayerSig`. `label`/`previous`/`at` sidecar metadata record the branch name, the version superseded, and the deploy time without altering the identity.
3. A client detects the update in **O(1)**: it compares its installed root against the manifest's root (`installedSig === rootSig`). A match means up-to-date; a mismatch lights the update affordance. There is no `latest.json` pointer to chase and no HTTP `304` round-trip — the root signature *is* the version check.
4. *(design)* Third-party vetters could independently verify the build and add the signature to their safe lists; today the trust gate is the per-host domain allowlist (see the status banner above).

This means **deployment and trust are decoupled**. A publisher can deploy immediately; consumers pull, verify each signature against its bytes, and replay. Whether a deployed package is *adopted* is a separate, host-allowlist decision.

---

## Security Properties

| Property | Guarantee |
|---|---|
| **Byte integrity** | Every artifact is verified by hashing its bytes back to the signature it was fetched by |
| **Merkle integrity** | Each layer covers its child layers + bee/dependency signatures; the `rootLayerSig` covers the whole tree |
| **Tamper detection** | Any modification to any artifact changes a signature and cascades to a different root |
| **Origin binding** | Domain + signature together prevent cross-origin substitution |
| **Permissionless publishing** | Anyone can host packages; no central gatekeeper |
| **O(1) update detection** | `installedSig === rootSig` compares the merkle root, not a pointer file or HTTP `304` |
| **Layered trust** *(design)* | Vetter / meta-vetter web of trust — aspirational; today trust is a binary domain allowlist |
| **Reproducible verification** | Any party can independently verify a signature by re-hashing the bytes it names |

---

## Summary

A single signature — the `rootLayerSig`, the merkle root of the package's layer tree — secures the whole package through cascading hashes: each artifact is named by the hash of its own bytes, each layer references its children by signature, and a change anywhere cascades to the root. Discovery is a `manifest.json` keyed by that root; installation fetches each listed signature at `/{signature}` (HTTP-direct to an operator domain, no central CDN) and verifies the bytes hash back. Update detection is an O(1) root-sig compare. The trust gate today is a binary domain allowlist; the vetter / meta-vetter web of trust described above is aspirational design, not yet built.
