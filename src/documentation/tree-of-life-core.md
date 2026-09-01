# Tree of Life — Core participation doctrine

## The rule

> To take part in Hypercomb's Tree of Life, a node MUST have Hypercomb Core.

Core is the mitochondria of Hypercomb: the minimum living machinery that turns
signed material into activity. Signature stores can preserve the material and
relays can carry signals about it, but neither can interpret, express, adopt or
create it. Only a Core can participate.

In compact form:

> Stores hold DNA. Relays carry signals. Core metabolizes signatures into
> beehavior.

The biological language is an explanatory model; the protocol rule is exact.
A Hypercomb application, client or application domain MUST boot Core. A server
that only serves immutable objects or forwards events is supporting
infrastructure, not a living node in the tree.

## Metaphor to mechanism

| Tree-of-Life language | Hypercomb mechanism |
|---|---|
| DNA | Signature-addressed layers, resources, dependencies, bees and content |
| Mitochondria / metabolism | Hypercomb Core: signatures, IoC, EffectBus, resolution and execution boundary |
| Expression | Beehaviors resolving and acting through Core |
| Organism | A running Core with a signed creation and a capability profile |
| Habitat and public identity | The browser origin or domain hosting that Core |
| Nutrient store | An immutable `GET /<signature>` content host or mirror |
| Signals | Signed relay and mesh events |
| Reproduction and assembly | DCP inspecting, composing, signing and publishing trees |

A parked application is signed potential life: immutable, portable and safe to
mirror, but it does nothing by itself. It becomes active only when a Core
resolves it and grants its beehaviors an execution capability.

## What counts as participation

A node participates when it can perform the Core cycle appropriate to its
capability profile:

1. receive or select a signed coordinate;
2. resolve the referenced tree;
3. verify every object against its signature;
4. interpret the tree through the common Core model;
5. express permitted beehaviors;
6. emit only the signed references or effects its profile authorizes.

Not every Core has the same authority:

- **Personal Core (`hypercomb.io`)** — owns the participant's client-local hive,
  installations and explicit trust decisions.
- **Published read-only Core** — resolves and renders a publisher's public tree
  using session memory and public reads, without authoring or persistence.
- **Publisher/provider Core** — represents a domain and may offer additional
  origin-scoped services that consumers choose to trust.
- **DCP Core** — specializes in inspection, composition, signing, installation
  and publishing.

These are one organism model with different capability profiles, not separate
application paradigms. A signed creation that works in one Core remains
meaningful in every other Core; unavailable authority fails closed.

## Infrastructure is necessary but not alive

The distinction prevents infrastructure vocabulary from silently granting
authority:

- A **content host** answers `GET /<signature>`. It can supply DNA but cannot
  decide what that DNA means.
- A **relay** distributes signed signals. It can connect nodes but cannot act as
  one merely by forwarding their events.
- A **CDN or cache** improves availability. It is interchangeable transport.
- An **application host** delivers Core and a signed creation. It is a living
  entrance because the visitor actually runs Core there.

One domain may perform all of these roles, but the application role begins only
where Core begins.

## Trust and privacy

Sharing Core creates protocol compatibility, not shared custody. A publisher's
Core cannot read the personal store belonging to `hypercomb.io`; browser-origin
separation prevents it. A consumer may view a public tree without granting
storage, adoption or authoring authority. Data crosses between Cores only by an
explicit, scoped consumer action.

Trust remains attached to the relationship:

- signatures prove which immutable bytes were selected;
- the publisher key proves who signed the current tree;
- the domain identifies the provider and runtime the visitor chose to use;
- capability grants define what that running Core may do;
- the consumer decides whether to view, adopt, store, publish or transfer.

Client-local storage means `hypercomb.io` does not hold a server-side copy of a
personal hive. Because same-origin client code can access its own local store,
the personal Core should converge on parked, signed runtime revisions,
default-denied egress and explicit updates. Immutability bounds the continuing
trust placed in the origin that initially delivered Core.

## Architectural test

When adding a new Hypercomb-facing service, ask:

1. Does it merely store DNA or carry signals? Call it infrastructure.
2. Does it interpret or express a creation? It MUST do so through Core.
3. What capability profile does that Core receive?
4. Which origin owns its state?
5. What explicit act moves data or authority across that origin boundary?

If an application interprets a Hypercomb tree without Core, it is a forked
runtime and does not participate in the common Tree of Life.

Related: [core-processor-architecture.md](core-processor-architecture.md) ·
[everything-is-a-beehavior.md](everything-is-a-beehavior.md) ·
[network-architecture.md](network-architecture.md) ·
[read-only-deployment.md](read-only-deployment.md)
