# Hypercomb

**Your work lives with you. No account. No central platform.**

Hypercomb is a free, open-source platform for community-owned software. It
runs in the browser, keeps a participant's work on their own device, and moves
published content by verifiable signature. Features are signed,
interchangeable modules; a community can adopt, replace, or fork them without
asking a platform owner for permission.

[Try Hypercomb](https://hypercomb.io) · [Take the guided tour](https://hypercomb.com/tour/) · [Read the architecture](src/documentation/architecture-overview.md)

The Hypercomb platform is not for sale. The software is licensed under
AGPL-3.0-only and the documentation and media under CC BY-SA 4.0. Donations
and sponsorship sustain public product development and may help recover its
founder-funded development cost; they do not buy equity, repayment,
governance, preferential features, or exclusive access. The company behind
Hypercomb may separately charge for professional services such as
implementation, customization, hosting, training, and support. Those services
do not change the platform's free and open-source status.

## Why it is different

- **Local first.** A hive begins on the participant's device, not behind a
  service account.
- **Verifiable.** Content is named by the SHA-256 signature of its canonical
  bytes. The receiver checks what arrived instead of trusting an intermediary.
- **Forkable in practice.** Signed modules make implementations and forks
  identifiable byte for byte.
- **Community owned.** The shell is a harness; capabilities live in modules a
  community can carry and compose for itself.
- **Free and open.** There is no paid edition and no plan to sell the platform.
  Optional professional services are separate from the software license.

## See it before reading about it

The narrated [Hypercomb tour](https://hypercomb.com/tour/) uses live captures
from a working hive. To explore directly, open [hypercomb.io](https://hypercomb.io),
type a name, and press Enter. The in-app `/help` curriculum and `/tutorial`
take over from there.

## Repository status

The project has two deliberately different branch roles:

- **`development`** is the active integration branch. Task branches merge
  here through the owner-maintained workflow.
- **`main`** is the public release line. It advances only through an
  intentional publication from the integration work, and each published
  revision remains a reference anyone can clone, fork, and run independently.

Published releases remain usable without turning the origin repository into a
centralized gatekeeper. Development can continue while named revisions remain
durable reference points.

## Running your own instance

1. Clone or fork the repository.
2. Install dependencies and build; see [src/CLAUDE.md](src/CLAUDE.md) for the
   project layout and build chain.
3. Point the web shell at storage you control and deploy it on your own domain.
4. Sign and share modules. Merkle-tree composition makes the work
   content-addressed, so others can import it by signature without permission.

## Documentation

- [Architecture overview](src/documentation/architecture-overview.md)
- [Protocol specification](src/documentation/protocol-spec.md)
- [Signature algebra](src/documentation/signature-algebra.md)
- [Glossary](src/documentation/glossary.md)
- [Codebase orientation](src/CLAUDE.md)

## Architecture in one paragraph

Signatures are the universal identity primitive. Drones are self-contained
modules that register in an IoC container. The web shell loads signed bundles
from the browser's origin-private file system, resolves their dependencies,
and composes capabilities by reference rather than inheritance. Everything
that can be externalized is externalized.

## Support the product; hire services separately

The most useful support today is to try Hypercomb, share a demonstration,
study or fork the source, and introduce it to a community that values local
ownership. A channel for one-time donations and recurring sponsorship is being
prepared. [Read the support principles](SUPPORT.md). Support keeps the
complete platform free and open; it does not create gated features, financial
returns, or ownership rights.

Professional services from the company behind Hypercomb are a separate paid
commercial relationship. A donation does not purchase services, and buying a
service is not required to use, study, modify, or self-host the platform.

## License

- **Code:** [GNU AGPL v3.0 only](LICENSE) (`SPDX-License-Identifier: AGPL-3.0-only`)
- **Documentation and media:** [CC BY-SA 4.0](src/documentation/license-docs.md)

Public instances running modified versions must link to their corresponding
source, as required by the AGPL network clause.

---

*Hypercomb is a beehive. Each tile is a cell. Each drone is a specialized
worker. The hive is the sum of what we bring to it.*
