# the bee

a honeybee lives through stages. egg, larva, pupa, adult. each stage has a purpose and a boundary. an egg cannot forage. a forager cannot return to being a larva. the transitions are one-directional and irreversible. this is not a limitation — it is what makes the colony work. every bee knows what it is, what it can do, and when it is done.

hypercomb's drones follow the same lifecycle.

---

## the stages

```
created --> registered --> active --> disposed
```

**created** — the egg. a drone exists but has not been placed in the hive. it has no connections, no responsibilities. it is potential.

**registered** — the larva. the drone has been added to the colony's registry (the ioc container). other drones can now find it by name. it is being fed — receiving the services it declared as dependencies. but it has not yet acted.

**active** — the adult. the drone has encountered its first grammar, passed its relevance check (`sense()`), and executed its first heartbeat. it is now a working member of the colony. it emits effects, responds to stimuli, and participates in the hive's life.

**disposed** — death, but clean death. the drone's effect subscriptions are automatically severed. its resources are released. it cannot be reactivated. the colony reclaims what it gave. no ghost signals, no phantom listeners, no lingering state.

---

## the roles

real bees specialize. nurse bees tend brood. foragers collect nectar. guard bees defend the entrance. scouts find new flower patches. none of them do everything. each bee does one thing well.

hypercomb drones specialize the same way:

- **PixiHostDrone** — the architect. sets up the rendering infrastructure and announces it to the colony.
- **ShowHoneycombWorker** — the builder. receives the architect's signal and draws the hex grid.
- **NostrMeshDrone** — the scout. connects to external relays and brings back messages from other colonies.
- **PanningDrone** — the navigator. translates human gestures into movement across the grid.

no drone tries to do everything. each one declares what it needs, what it listens for, and what it emits. the colony emerges from the sum of simple, focused behaviors.

---

## the encounter

when a bee encounters a stimulus — a scent, a vibration, a returning scout's dance — it decides whether to respond. not every bee responds to every signal. a nurse bee ignores the waggle dance. a forager ignores the brood pheromone.

drones work identically. every drone has a `sense()` method that receives a grammar string and returns true or false: *is this relevant to me?* only if the answer is yes does the drone execute its `heartbeat()`.

this is declarative sensing. the colony broadcasts. each bee decides for itself.

---

## the contract

a bee cannot choose to un-die. a disposed drone cannot reactivate. a bee cannot forage before it matures. a created drone cannot emit effects before it registers.

these constraints are not bureaucracy. they are what make the system trustable. when you see a drone in the Active state, you know it has been registered, its dependencies are resolved, and its effects are live. when you see it Disposed, you know its subscriptions are gone and its resources are freed.

the lifecycle is a promise.

---

*a bee does not ask what it should be. it becomes what the colony needs, does its work, and when the work is done, it lets go.*
