# Getting Started

*This page is an intentional starting point for the help system. It is deliberately short — drill into the linked sections for depth.*

---

## What Hypercomb is

Hypercomb is a live, presence-based workspace. A hexagonal grid of cells holds your content. Drones — small, autonomous modules — sense and act on every heartbeat to render, navigate, and coordinate. Identity is content-addressed via SHA-256 signatures. There are no accounts and no central server.

**Presence is permission.** Data exists while you are here. Publishing is optional and explicit.

## Three things to know first

1. **Everything is signature-addressed.** Same content, same identity. Share a signature to share the content. See [signature-system.md](signature-system.md).
2. **Drones communicate through effects, never direct calls.** The effect bus is pub/sub with last-value replay. See [architecture-fundamentals.md](architecture-fundamentals.md).
3. **The command line is the interface.** Type to create, navigate, filter, delete. Slash commands for verbs. See [command-line-reference.md](command-line-reference.md) and [slash-behaviour-reference.md](slash-behaviour-reference.md).

## Where to go next

- **Using the app** — [command-line-reference.md](command-line-reference.md) · [slash-behaviour-reference.md](slash-behaviour-reference.md) · [glossary.md](glossary.md)
- **Building a drone** — [signature-node-pattern.md](signature-node-pattern.md) · [architecture-fundamentals.md](architecture-fundamentals.md) · [core-processor-architecture.md](core-processor-architecture.md)
- **Understanding the theory** — [signature-system.md](signature-system.md) · [signature-algebra.md](signature-algebra.md) · [genome-primitive.md](genome-primitive.md) · [collapsed-compute.md](collapsed-compute.md)
- **Contributing** — [contributing.md](contributing.md) · [contributor-agreement.md](contributor-agreement.md) · [licensing.md](licensing.md)

For the full catalogue, see [index.md](index.md).
