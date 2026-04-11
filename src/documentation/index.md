# Documentation Index

Central reference for all hypercomb documentation. Files are grouped by topic.

---

## Architecture & Core Design

- [architecture-overview.md](architecture-overview.md) — Live presence architecture with drone lifecycle, effect bus, and stateless design
- [architecture-critique.md](architecture-critique.md) — Review of core architecture through Martin Fowler's architectural principles
- [core-processor-architecture.md](core-processor-architecture.md) — Purpose and paradigm of @hypercomb/core as zero-dependency foundation
- [hive.md](hive.md) — How the hexagonal grid and live session presence model works
- [meetings-and-quorum.md](meetings-and-quorum.md) — 1+6 Cascade meeting template, quorum gathering, WebRTC signaling over the mesh
- [runtime.md](runtime.md) — Navigation primitives: hex grid, AxialCoordinate, AxialService
- [recommendations.md](recommendations.md) — Ten architectural improvements to strengthen existing design

## Cryptographic & Content Addressing

- [core-primitive.md](core-primitive.md) — Signature-payload pairs as foundational content-addressed identity
- [signature-algebra.md](signature-algebra.md) — Algebraic operations over content-addressed signatures
- [signature-expansion-doctrine.md](signature-expansion-doctrine.md) — Mandatory practice: every data structure must be signature-addressed
- [signature-node-pattern.md](signature-node-pattern.md) — Copy-paste implementation guide for signature-addressed features
- [collapsed-compute.md](collapsed-compute.md) — Signature caching eliminates redundant computation across the network
- [deterministic-computation.md](deterministic-computation.md) — Deterministic computation memoization with authenticity layer

## Protocol & Wire Format

- [byte-protocol.md](byte-protocol.md) — One-byte navigation wire format for hex grid movement
- [protocol-spec.md](protocol-spec.md) — Decentralized presence-based navigation protocol with Nostr relay transport
- [dependency-signing.md](dependency-signing.md) — Single signature securing entire package hierarchy

## Concepts & Domain Model

- [glossary.md](glossary.md) — Quick reference from metaphor to mechanics (bee, hive, drone, worker, etc.)
- [dna.md](dna.md) — Optional publishing mechanism for path capsules with cryptographic commitment
- [layer-primitives.md](layer-primitives.md) — Layers as atomic snapshots of folders, content-addressed and signature-referenced
- [data-primitive.md](data-primitive.md) — History primitive for shared AI system operation recording
- [llm-primitive.md](llm-primitive.md) — Hypergraph primitive connecting signatures through LLM command transforms
- [emergence.md](emergence.md) — Visual rendering lifecycle: brooding and eclosion of tiles on honeycomb

## UI & Rendering

- [cell-rendering.md](cell-rendering.md) — How OPFS cells become tiles rendered via Pixi.js on hex grid
- [tile-overlay-architecture.md](tile-overlay-architecture.md) — Contextual action system with overlays and animated particles

## Developer Guides & References

- [contributing.md](contributing.md) — Onboarding guide: reading order for vocabulary, architecture, glossary, protocols
- [command-line-reference.md](command-line-reference.md) — Pluggable command line behavior architecture
- [command-line-operations.md](command-line-operations.md) — Comprehensive reference table of all command line operations
- [slash-behaviour-reference.md](slash-behaviour-reference.md) — Complete reference of all `/slash` commands with aliases
- [simple-naming-initiative.md](simple-naming-initiative.md) — Human-readable naming conventions (verb-first, consistency)

## Dependency Management & Infrastructure

- [dependency-resolution.md](dependency-resolution.md) — How dependencies resolve across project types and layers
- [infrastructure.md](infrastructure.md) — Decentralized design with two relay servers, no centralized hosting
- [decentralized-angular-hosting.md](decentralized-angular-hosting.md) — Theoretical exploration of decentralized Angular app hosting

## Deployment & Pipeline

- [lets-discover-meadowverse-pipeline.md](lets-discover-meadowverse-pipeline.md) — Authoring-runtime pipeline: hypercomb.io (builder) to meadowverse.ca (runtime)

## Security & Governance

- [security.md](security.md) — Presence-first security: no accounts, data expires when participants leave
- [social-governance.md](social-governance.md) — Presence-based permission, consent, and content-addressed identity
- [code-of-conduct.md](code-of-conduct.md) — Community expectations for presence, consent, and recognition

## Legal & Licensing

- [license.md](license.md) — Source code: GNU AGPL v3.0
- [license-docs.md](license-docs.md) — Documentation: Creative Commons Attribution-ShareAlike 4.0
- [trademarks.md](trademarks.md) — Trademark guidelines for hypercomb marks and branding
- [developer-certificate.md](developer-certificate.md) — Developer Certificate of Origin for contributions
- [certificate-of-origin.md](certificate-of-origin.md) — Origin verification certificate structure

## Bee Story (narrative series)

- [the-bee.md](bee-story/the-bee.md)
- [the-colony.md](bee-story/the-colony.md)
- [the-dance.md](bee-story/the-dance.md)
- [the-economy.md](bee-story/the-economy.md)
- [the-hive.md](bee-story/the-hive.md)
- [the-memory.md](bee-story/the-memory.md)
- [the-scent.md](bee-story/the-scent.md)
- [the-seal.md](bee-story/the-seal.md)
- [the-swarm.md](bee-story/the-swarm.md)
