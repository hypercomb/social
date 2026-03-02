# the scent

bees communicate primarily through pheromones — volatile chemical signals that spread through the hive and decay over time. a queen's mandibular pheromone tells the colony she is alive. an alarm pheromone at the entrance mobilizes guards. a nasonov pheromone marks the hive entrance for returning foragers. no bee addresses another bee directly. the scent is broadcast, and every bee that can smell it responds according to its role.

the effect bus is hypercomb's pheromone system.

---

## how it works

the `EffectBus` is a pub/sub channel. any drone can emit a scent. any drone can subscribe to a scent. there are no direct connections between drones — no imports, no references, no knowledge of who else is listening.

```
drone A  --emitEffect('render:host-ready', payload)--> EffectBus
                                                           |
drone B  <--onEffect('render:host-ready', handler)--------+
drone C  <--onEffect('render:host-ready', handler)--------+
```

drone A does not know drone B exists. drone B does not know drone A exists. both know the scent.

---

## last-value replay

real pheromones linger. a bee arriving at the hive entrance an hour after the nasonov pheromone was deposited can still smell it. the signal outlasts the signaler's presence.

the effect bus does the same thing. when a drone emits an effect, the bus stores the most recent value. when a new drone subscribes, it immediately receives the last emitted value — even if the emitter has moved on or disposed.

this solves the timing problem that plagues most pub/sub systems. a drone does not need to "arrive early" to receive a critical signal. the scent is still in the air.

---

## auto-decay

pheromones are volatile. they evaporate. a scent left by a dead bee does not persist forever — it fades, and the colony moves on.

when a drone is disposed, all of its effect subscriptions are automatically severed. the `_effectSubs` array is cleared in `markDisposed()`. no ghost listeners. no phantom responses. the scent fades with the bee.

this is the dual of last-value replay: signals persist long enough to be useful, but listeners do not persist longer than their bee.

---

## the vocabulary

real pheromones are chemically specific. alarm pheromone is not queen substance. nasonov is not brood pheromone. each has a distinct chemical signature and a distinct meaning.

effects are typed the same way:

| effect type  | what it signals |
|-------------|-----------------|
| render      | something visual changed |
| filesystem  | storage was accessed |
| history     | navigation occurred |
| network     | external communication happened |
| memory      | internal state shifted |
| external    | something outside the hive responded |

within each type, specific scents are namespaced: `'render:host-ready'`, `'network:mesh-connected'`, `'history:path-changed'`. the vocabulary is structured, not arbitrary.

---

## no central dispatcher

a queen bee does not decide which bees receive which pheromones. the chemistry handles it. bees with the right receptors respond. bees without them do not.

the effect bus has no routing logic. it does not decide who gets what. every subscriber to a given effect key receives the payload. every non-subscriber ignores it. the bus is a medium, not a controller.

this is how colony intelligence emerges. no single point decides. every bee senses for itself.

---

*a scent is not a command. it is an invitation. the colony responds not because it was told to, but because it was ready.*
