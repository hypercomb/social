# the colony

a honeybee colony has no manager. no bee tells another bee what to do. the queen does not command — she emits pheromones that signal her presence, and the colony organizes around that signal. guard bees station themselves at the entrance not because they were assigned, but because they sensed the need. nurse bees feed larvae not because of a schedule, but because the brood pheromone drew them.

fifty thousand bees. zero central planning. the colony works because each bee follows simple rules and responds to local signals.

hypercomb is built on the same principle.

---

## the registry

when a bee emerges as an adult, it enters the colony's workforce. other bees can find it by scent, by location, by role. it is discoverable.

the ioc container serves this purpose. when a drone registers, it becomes visible to the colony:

```
window.ioc.register('@diamondcoreprocessor.com/AxialService', axialService)
```

any drone that needs the axial service can resolve it by name. no drone needs to know where the service was created, who created it, or how it works internally. it asks the colony, and the colony provides.

the registry has four operations: `register`, `get`, `has`, `list`. that is the entire coordination mechanism. fifty-three lines of code. the simplest thing that could possibly work.

---

## self-organization

real bees allocate labor through feedback loops. if there is too much nectar and not enough processing, more bees switch to processing. if there are too many nurses and not enough foragers, bees age into foraging earlier. no one decides this. the colony's chemical signals create pressure, and individual bees respond.

drones self-organize through the effect bus. when `PixiHostWorker` emits `'render:host-ready'`, it is not addressing `ShowCellDrone` by name. it is broadcasting a colony-wide signal: *the rendering infrastructure is available.* any drone that cares about rendering responds. any drone that doesn't, ignores it.

adding a new drone to the colony does not require modifying any existing drone. this is the open-closed principle expressed as biology: the colony grows by addition, not by surgery.

---

## consent

bees have a mechanism that hypercomb elevates to a first principle: **consent to link.**

in a real hive, a bee can leave. it can stop responding to the waggle dance. it can ignore pheromones. it cannot be forced to forage, or to nurse, or to guard. the colony is voluntary in the sense that matters most — each bee's participation is its own.

in hypercomb, presence is permission. linking is a choice. unlinking is immediate. when a drone disposes, its connections sever instantly. there is no "are you sure?" dialog. there is no grace period. leaving means leaving.

---

## the guards

a hive entrance has guard bees. they check returning foragers by scent — colony members are recognized, intruders are challenged. this is security without surveillance. no database of approved bees. no id check. just: *do you smell like us?*

hypercomb's guards work the same way:

- **tempo guard** — step timing must feel natural. too fast, too regular, too mechanical = challenged. this is the equivalent of a guard bee noticing that something moves wrong.
- **micro-gesture check** — a rare, tiny proof of humanness. a small pointer movement. a brief pause. the lightest possible challenge that a bot cannot easily fake.
- **nonce rotation** — session keys rotate on join and at intervals. old frames are rejected. this prevents replay attacks the way a colony's shifting pheromone blend prevents old scent from fooling guards.

no profiles. no accounts. no stored identity. just: *are you here, now, behaving like a real participant?*

---

## the packages

real bee colonies have structure. brood in the center, honey on the periphery, pollen in between. the architecture serves the biology — the warmest spot for growing larvae, the most accessible spot for frequently used stores.

hypercomb's package structure follows the same logic:

```
@hypercomb/core          the brood chamber. zero dependencies.
                         lifecycle, effects, ioc, signatures.
                         the things the colony cannot exist without.

@hypercomb/essentials    the pollen frames. depends on core.
                         concrete drones, axial grid, pixi rendering.
                         the things that make the hive functional.

@hypercomb/sdk           the royal jelly. facade for external consumers.
                         re-exports core types and build API.

@hypercomb/cli           the waggle dance encoder. terminal tool.
                         hypercomb build, hypercomb inspect.

@hypercomb/shared        the honey bridge. angular integration.
                         connects the framework layer to the app layer.

hypercomb-web            the outer comb. the production shell.
                         where humans interact with the hive.

hypercomb-dev            the nursery comb. the development shell.
                         where drones are tested before deployment.
```

dependencies flow inward, never outward. the brood chamber does not depend on honey. core does not depend on essentials. the innermost layer is the most protected, the most stable, and the most essential.

---

## what the colony is not

the colony is not a company. there is no ceo bee. there is no product roadmap pheromone. there is no quarterly review of nectar targets.

the colony is not a platform. it does not extract value from its members. it does not sell attention. it does not optimize for engagement.

the colony is not a service. it does not promise uptime. it does not store your data. it does not remember you between visits unless you choose to be remembered.

the colony is a living system. it exists because its members are present and contributing. when they stop, it rests. when they return, it resumes. this is the only contract.

---

*fifty thousand bees. zero managers. the colony thrives not because someone is in charge, but because every bee knows what to sense, what to do, and when to let go.*
