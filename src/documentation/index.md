# Hypercomb Documentation

The complete reference. Every page is also reachable through `/help` in the app — each section below becomes a `/help <section>` drill target, each page a `/help <section> <name>`. Start with [getting-started.md](getting-started.md) if this is your first visit.

---

## Start

- [getting-started.md](getting-started.md) — Orientation: what Hypercomb is and where to go first
- [contributing.md](contributing.md) — Reading order, development setup, conventions
- [glossary.md](glossary.md) — Canonical vocabulary — metaphor to mechanism

## Concepts

- [dna.md](dna.md) — Path capsules: optional publishing with cryptographic commitment
- [emergence.md](emergence.md) — Brooding and eclosion — the visual lifecycle of tiles
- [simple-naming-initiative.md](simple-naming-initiative.md) — Verb-first, consistent, human-readable naming

## Primitives

- [signature-system.md](signature-system.md) — The primitive and its expansion doctrine — every fragment is signature-addressed
- [signature-algebra.md](signature-algebra.md) — Formal algebra: set operations, projections, reactive pipelines over signatures
- [signature-node-pattern.md](signature-node-pattern.md) — Plug-and-play implementation template for signature-addressed features
- [genome-primitive.md](genome-primitive.md) — Recursive Merkle root over subtrees — universal short-circuit for derived computations
- [collapsed-compute.md](collapsed-compute.md) — Network effect: memoized signatures eliminate redundant computation
- [deterministic-computation.md](deterministic-computation.md) — Authenticity layer: script + resource → deterministic result
- [layer-primitives.md](layer-primitives.md) — Layers as atomic snapshots of folders, content-addressed and signature-referenced
- [data-primitive.md](data-primitive.md) — History primitive: operation recording for shared AI systems
- [llm-primitive.md](llm-primitive.md) — Hypergraph primitive connecting signatures through LLM command transforms

## Architecture

- [architecture-fundamentals.md](architecture-fundamentals.md) — The runtime: hive, drones, effect bus, hex grid, OPFS, mesh
- [core-processor-architecture.md](core-processor-architecture.md) — `@hypercomb/core`: zero-dependency foundation and build pipeline
- [install-push-only.md](install-push-only.md) — Push-only install model: Hypercomb load is inert, DCP pushes updates, labels are branches

## Protocols

- [protocol-spec.md](protocol-spec.md) — Decentralized presence-based navigation protocol with Nostr relay transport
- [byte-protocol.md](byte-protocol.md) — One-byte wire format for hex grid movement
- [pheromone-protocol.md](pheromone-protocol.md) — Ambient signal annotations on content, signature-addressed
- [pollination-protocol.md](pollination-protocol.md) — Cross-domain contributions via signed pollen packets
- [dependency-signing.md](dependency-signing.md) — A single signature securing an entire package hierarchy
- [dependency-resolution.md](dependency-resolution.md) — How dependencies resolve across project types and layers

## Features

- [cell-rendering.md](cell-rendering.md) — How OPFS cells become hex tiles in Pixi.js
- [cell-localization.md](cell-localization.md) — Tile label translation via the I18nProvider
- [tile-overlay-architecture.md](tile-overlay-architecture.md) — Contextual actions, overlays, and particle animations
- [embedded-sites.md](embedded-sites.md) — Website bundles as cell decoration
- [revision-mode.md](revision-mode.md) — Undo, redo, and time-travel through the history clock
- [universal-history-plan.md](universal-history-plan.md) — Full history architecture: every op type, cross-hierarchy clock

## CLI & Commands

- [command-line-reference.md](command-line-reference.md) — All command-line operations: create, navigate, filter, batch, cut-paste, markers
- [slash-behaviour-reference.md](slash-behaviour-reference.md) — All `/slash` commands with aliases, grouped by category
- [slash-command-authoring.md](slash-command-authoring.md) — How to add a new slash command

## Operations

- [infrastructure.md](infrastructure.md) — Decentralized design: two relays, no centralized hosting
- [decentralized-angular-hosting.md](decentralized-angular-hosting.md) — Theoretical exploration of decentralized app hosting
- [lets-discover-meadowverse-pipeline.md](lets-discover-meadowverse-pipeline.md) — Authoring-runtime split: hypercomb.io → meadowverse.ca

## Security & Governance

- [security.md](security.md) — Presence-first security model: no accounts, expiring data
- [social-governance.md](social-governance.md) — Presence-based permission, consent, and content-addressed identity
- [code-of-conduct.md](code-of-conduct.md) — Community expectations for presence, consent, and recognition
- [meetings-and-quorum.md](meetings-and-quorum.md) — 1+6 Cascade template, quorum gathering, WebRTC signaling

## Legal

- [licensing.md](licensing.md) — Source code (AGPL-3.0-only) and documentation (CC BY-SA 4.0)
- [contributor-agreement.md](contributor-agreement.md) — Developer Certificate of Origin v1.1, sign-off format
- [trademarks.md](trademarks.md) — Trademark guidelines for Hypercomb marks and branding

## Narrative

The Bee Story — a nine-part series on the metaphor and meaning behind the architecture.

- [the-bee.md](bee-story/the-bee.md)
- [the-colony.md](bee-story/the-colony.md)
- [the-dance.md](bee-story/the-dance.md)
- [the-economy.md](bee-story/the-economy.md)
- [the-hive.md](bee-story/the-hive.md)
- [the-memory.md](bee-story/the-memory.md)
- [the-scent.md](bee-story/the-scent.md)
- [the-seal.md](bee-story/the-seal.md)
- [the-swarm.md](bee-story/the-swarm.md)

---

## Archive

Historical or non-canonical documents. Retained for reference, not part of the current help tree.

- [archive/architecture-critique.md](archive/architecture-critique.md) — Martin Fowler-lens critique of the architecture
- [archive/recommendations.md](archive/recommendations.md) — Ten architectural improvements proposed
- [archive/selection-as-history.md](archive/selection-as-history.md) — Incomplete sketch, superseded by universal-history-plan
