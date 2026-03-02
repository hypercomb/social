# Dependency Signing

How a single signature secures an entire hierarchy of files for byte integrity, and why domain-aware installation and third-party vetting create a trustworthy package ecosystem.

---

## Core Concept: One Signature, Full Hierarchy

Every installable package in Hypercomb is identified by a single cryptographic signature (a 64-character hex SHA-256 hash). This signature is not computed over metadata or a manifest alone --- it is the root of a Merkle-like integrity tree that covers every byte in the package hierarchy.

### How It Works

1. **File hashing.** Each file in the package is hashed individually (SHA-256). The result is a fixed-length digest that changes if even a single byte is modified.

2. **Manifest assembly.** An `install.manifest.json` collects every file path and its hash into a single document. The manifest is itself a deterministic JSON structure (sorted keys, no whitespace variance) so its own hash is reproducible.

3. **Signature derivation.** The SHA-256 of the canonical manifest becomes the **package signature**. This single value transitively secures every file: if any file changes, its hash changes, the manifest changes, and the signature changes.

4. **Verification on install.** The client downloads the manifest, verifies its hash matches the expected signature, then verifies each file against the manifest. Any mismatch aborts the install. No file can be tampered with, added, or removed without invalidating the signature.

### Why One Signature Is Enough

A traditional package manager might sign individual files or use a flat checksum list. The Hypercomb model is stronger because the signature is **hierarchical**: it covers the manifest, which covers every file. Changing the manifest to add a malicious file would change the signature. Changing a file without updating the manifest would fail file-level verification. There is no gap.

---

## Domain + Signature: The Install Contract

Installing a package requires two pieces of information:

- **Domain** --- the hosting origin (e.g., `storagehypercomb.blob.core.windows.net`)
- **Signature** --- the 64-character hex hash identifying the exact package version

The install URL follows a predictable pattern:

```
https://{domain}/content/{signature}/install.manifest.json
```

### Why Domain Matters

The domain is not just a convenience --- it is a trust boundary:

- **Multiple domains can host different packages.** A community member can host their own packages on their own domain. A corporate team can host internal packages on a private Azure blob. The protocol is the same; only the domain differs.

- **Domain pinning prevents substitution.** If a client expects a package from `storage.example.com`, a redirect to `evil.example.com` would be caught because the domain is part of the install contract. The signature alone is not enough --- you must also trust the origin.

- **Self-hosting is first-class.** Any static file host (Azure Blob, S3, Cloudflare R2, even a plain Nginx server) can serve packages. There is no central registry that all packages must flow through.

### Install Flow

```
Client                          Domain
  |                               |
  |  GET /{sig}/install.manifest  |
  |------------------------------>|
  |  manifest JSON                |
  |<------------------------------|
  |                               |
  |  verify: sha256(manifest) === sig
  |                               |
  |  GET /{sig}/{file-path}       |  (for each file in manifest)
  |------------------------------>|
  |  file bytes                   |
  |<------------------------------|
  |                               |
  |  verify: sha256(file) === manifest[file-path]
  |                               |
  DONE --- all files verified
```

---

## Third-Party Vetting: Safe Signatures

Not every package hosted on a domain should be blindly trusted. Hypercomb supports a **vetting layer** where third-party contributors and community sites can mark specific signatures as safe for consumption.

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

1. The CI pipeline builds the package and computes its signature.
2. The signature is published to the hosting domain.
3. The `latest.txt` pointer is updated to point to the new signature.
4. Third-party vetters can independently verify the build and add the signature to their safe lists.
5. End users who trust those vetters get the update with confidence.

This means **deployment and trust are decoupled**. A publisher can deploy immediately while vetters verify asynchronously. Users who require vetter approval wait; users who trust the publisher directly do not.

---

## Security Properties

| Property | Guarantee |
|---|---|
| **Byte integrity** | Every file is verified against its hash in the manifest |
| **Hierarchy integrity** | The manifest itself is verified against the signature |
| **Tamper detection** | Any modification to any file invalidates the signature |
| **Origin binding** | Domain + signature together prevent cross-origin substitution |
| **Permissionless publishing** | Anyone can host packages; no central gatekeeper |
| **Layered trust** | Vetters and meta-vetters create a web of trust without a single point of failure |
| **Reproducible verification** | Any party can independently verify a signature by re-hashing the files |

---

## Summary

A single SHA-256 signature secures an entire file hierarchy through transitive hashing. Installation requires both a domain (trust boundary) and a signature (integrity proof). Third-party vetters add a human trust layer on top of the cryptographic one, allowing the ecosystem to scale without a central authority. Vetter sites can be verified by other vetters, creating trust chains that make the whole system resilient and decentralized.
