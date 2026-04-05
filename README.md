# Hypercomb

**This repository is the canonical origin of Hypercomb — a permanent, read-only reference implementation.**

Hypercomb is a signature-addressed, drone-based runtime for building community-owned software. Features live as signed, interchangeable modules; the shell is just a harness that loads them. Over time, the shell shrinks and the module ecosystem grows.

This repo is the snapshot of Hypercomb at the moment it became self-sustaining. It is preserved unchanged as a reference — a starting point anyone can clone, fork, and run on their own domain. Nothing flows back here. There is no roadmap, no release cycle, no issue triage. Your fork is your own.

---

## What this repository is

- **A canonical origin artifact.** The source of truth for what Hypercomb looked like at the moment of open release.
- **A reference implementation.** Read it, learn from it, study the architecture, use it as a starting template.
- **A seed.** Fork it, run your own instance on your own domain, build whatever you want on top of it.

## What this repository is not

- **Not actively maintained here.** No PRs will be merged. No issues will be triaged. The canonical repo is intentionally frozen.
- **Not a collaboration hub.** Collaboration happens in your own forks, in your own modules, and across the signature-addressed module network — not in this repo.
- **Not a product.** It is source. What you do with it is up to you.

---

## Running your own instance

1. Clone or fork this repository.
2. Install dependencies and build — see [src/CLAUDE.md](src/CLAUDE.md) for the build chain and project layout.
3. Point the web shell at your own storage and deploy wherever you like.
4. Sign and share your own modules. The merkle-tree sharing pattern means your work is content-addressed — others can import it by signature without asking anyone's permission.

## Documentation

All documentation lives in [src/documentation/](src/documentation/). Start with:

- [src/documentation/architecture-overview.md](src/documentation/architecture-overview.md) — high-level architecture
- [src/documentation/protocol-spec.md](src/documentation/protocol-spec.md) — the Hypercomb protocol
- [src/documentation/signature-algebra.md](src/documentation/signature-algebra.md) — the signature composition model
- [src/documentation/glossary.md](src/documentation/glossary.md) — terminology
- [src/CLAUDE.md](src/CLAUDE.md) — codebase orientation, project tiers, build commands

## Architecture in one paragraph

Signatures (SHA-256 hashes of canonical content) are the universal identity primitive. Drones are self-contained modules that self-register in an IoC container. The web shell loads signed drone bundles from OPFS at runtime, resolves dependencies via a dynamic import map, and composes features by reference, not inheritance. Everything that can be externalized, is.

## License

- **Code:** [GNU AGPL v3.0 only](LICENSE) (`SPDX-License-Identifier: AGPL-3.0-only`)
- **Documentation and media:** [CC BY-SA 4.0](src/documentation/license-docs.md)

Public instances running modified versions must link to their corresponding source, per the AGPL network clause.

---

*Hypercomb is a beehive. Each tile is a cell. Each drone is a specialized worker. The hive is the sum of what we bring to it.*
