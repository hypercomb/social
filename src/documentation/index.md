# Hypercomb Documentation

The complete reference. Every page is also reachable through `/help` in the app — each section below becomes a `/help <section>` drill target, each page a `/help <section> <name>`. Start with [getting-started.md](getting-started.md) if this is your first visit.

---

## Start

- [getting-started.md](getting-started.md) — Orientation: what Hypercomb is and where to go first
- [contributing.md](contributing.md) — Reading order, development setup, conventions
- [glossary.md](glossary.md) — Canonical vocabulary — metaphor to mechanism

## Concepts

- [concepts.md](concepts.md) — The hive is a computer: junction-as-computer, the byte-sandwich dataflow, six-pile radix scheduling, geometry-as-processor, and nested exponential reach
- [emergence.md](emergence.md) — Brooding and eclosion — the visual lifecycle of tiles
- [simple-naming-initiative.md](simple-naming-initiative.md) — Verb-first, consistent, human-readable naming

## Primitives

- [dna.md](dna.md) — Distributed Network Artifacts: the content-addressed, merkle-versioned substrate — layers, dependencies, bees, resources, content
- [signature-system.md](signature-system.md) — The primitive and its expansion doctrine — every fragment is signature-addressed
- [signature-algebra.md](signature-algebra.md) — Formal algebra: set operations, projections, reactive pipelines over signatures
- [signature-node-pattern.md](signature-node-pattern.md) — Plug-and-play implementation template for signature-addressed features
- [genome-primitive.md](genome-primitive.md) — *(design — concept only)* Recursive Merkle root over subtrees — universal short-circuit for derived computations
- [collapsed-compute.md](collapsed-compute.md) — Network effect: memoized signatures eliminate redundant computation
- [deterministic-computation.md](deterministic-computation.md) — Authenticity layer: script + resource → deterministic result
- [history-sigbag-as-root.md](history-sigbag-as-root.md) — *(design — aspirational)* History sigbag as root: store, discovery, self-heal, and integrity
- [llm-primitive.md](llm-primitive.md) — Hypergraph primitive connecting signatures through LLM command transforms

## Architecture

- [core-processor-architecture.md](core-processor-architecture.md) — `@hypercomb/core`: zero-dependency foundation and build pipeline
- [network-architecture.md](network-architecture.md) — Canonical reference: participants, hosts, installers, and content flow
- [install-push-only.md](install-push-only.md) — *(design — aspirational)* Push-only install model: Hypercomb load is inert, DCP pushes updates, labels are branches
- [drone-installer-contract.md](drone-installer-contract.md) — The contract a drone follows so the installer can disable it cleanly
- [capability-tags.md](capability-tags.md) — Seed vocabulary for the `capability` tag — marking only the bees that genuinely compete for one slot

## Protocols

- [protocol-spec.md](protocol-spec.md) — Decentralized presence-based navigation protocol with Nostr relay transport
- [byte-protocol.md](byte-protocol.md) — One-byte wire format for hex grid movement
- [trail-capsule.md](trail-capsule.md) — *(design — not built)* Replayable navigation route, optional publishing (formerly "DNA")
- [pheromone-protocol.md](pheromone-protocol.md) — Ambient signal annotations on content, signature-addressed
- [pollination-protocol.md](pollination-protocol.md) — Cross-domain contributions via signed pollen packets
- [dependency-signing.md](dependency-signing.md) — A single signature securing an entire package hierarchy
- [sync-paired-channel.md](sync-paired-channel.md) — Paired-channel sync: sharing tree branches across browsers and devices
- [swarm-resource-streaming.md](swarm-resource-streaming.md) — Share bundles: layer payload plus transitively referenced resources
- [swarm-scale-and-host-delegation.md](swarm-scale-and-host-delegation.md) — Root announcements, location snapshots, and host delegation
- [file-transit.md](file-transit.md) — *(design — phased plan)* Moving signature-addressed content across the wire

## Features

- [cell-localization.md](cell-localization.md) — Tile label translation via the I18nProvider
- [tile-overlay-architecture.md](tile-overlay-architecture.md) — Contextual actions, overlays, and particle animations
- [embedded-sites.md](embedded-sites.md) — Website bundles as cell decoration
- [revision-mode.md](revision-mode.md) — Undo, redo, and time-travel through the history clock
- [universal-history-plan.md](universal-history-plan.md) — Full history architecture: every op type, cross-hierarchy clock
- [tag-pools.md](tag-pools.md) — *(design — partially built)* A tag as a deterministic meaning-pool
- [zoomable-widgets.md](zoomable-widgets.md) — Participant-local per-widget scaling for floating UI (Shift-hover)
- [arkanoid-theme-authoring.md](arkanoid-theme-authoring.md) — Authoring a pluggable Arkanoid scene theme (palette + two painters)

## CLI & Commands

- [command-line-reference.md](command-line-reference.md) — All command-line operations: create, navigate, filter, batch, cut-paste, markers
- [slash-behaviour-reference.md](slash-behaviour-reference.md) — All `/slash` commands with aliases, grouped by category
- [slash-command-authoring.md](slash-command-authoring.md) — How to add a new slash command

## Operations

- [infrastructure.md](infrastructure.md) — Decentralized design: two relays, no centralized hosting
- [lets-discover-meadowverse-pipeline.md](lets-discover-meadowverse-pipeline.md) — Authoring-runtime split: hypercomb.io → meadowverse.ca
- [feedback-channel.md](feedback-channel.md) — Durable feedback transport — the loop routed through jwize.com

## Design & Plans

Forward-looking proposals and migration plans — not yet built. Retained so the intended direction is legible before any code lands.

- [feature-tuning-garage.md](feature-tuning-garage.md) — Installer feature-gating, two-lens review, capability dedup, and signature-addressed tuning recipes
- [sign-meaning-pool-migration-plan.md](sign-meaning-pool-migration-plan.md) — Removing the underscore folders in favour of `sign(meaning)` pools
- [three-js-migration-plan.md](three-js-migration-plan.md) — Pixi.js → three.js feasibility and strategy evaluation

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
- [visuals-pool-of-meaning-plan.md](visuals-pool-of-meaning-plan.md) — Superseded/parked visuals build plan — replaced by sign-meaning-pool-migration-plan
