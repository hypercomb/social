# the swarm

when a honeybee colony outgrows its hive, something extraordinary happens. the queen and half the colony leave together — not in chaos, but in formation. thousands of bees lift off and move as a single body, a living cloud that thinks without a brain. scouts fly ahead, find candidates, return, and dance. the swarm deliberates through competing dances until consensus emerges. then ten thousand bees, none of whom have seen the destination, fly directly to it.

no leader chose the site. no vote was taken. the swarm decided by moving together.

hypercomb's public-facing experience is a swarm.

---

## the rendezvous

real bees swarm to a branch, a fence post, a lamppost — a temporary gathering point where the colony clusters while scouts search. the rendezvous is not the destination. it is the place where decision happens.

in hypercomb, the rendezvous is a **lineage path**. every participant who navigates to the same domain and path segments arrives at the same point in the hive:

```
hypercomb.io / science / chemistry / organic
```

that path is the branch. everyone who resolves to it is present in the same swarm. no sign-up, no invitation, no friend request. you are in the swarm because you went to the same place at the same time. presence is the only credential.

for private swarms, the path extends with a specifier that functions like a scent only colony members know — a custom segment, a hash, a key shared out of band. the architecture does not change. only the path changes. public swarms use public paths. private swarms use paths that are hard to guess.

---

## the cloud

a real swarm is not a static cluster. it is a dynamic, breathing mass. bees on the surface fan their wings to cool the interior. bees near the center vibrate to warm the queen. bees at the edges scout and return. the shape shifts constantly, but the swarm holds together because every bee responds to the same signals — the queen's pheromone, the thermal gradient, the vibration of its neighbors.

in hypercomb, the swarm is what you see when many participants share a rendezvous. your hive — your hex grid — becomes populated:

- **avatars in motion** — each participant is a bee flying across your grid. their icon is their avatar. they move in real time as they navigate. you see them arrive, explore, hover over cells, and leave. they are not profiles. they are presences.

- **tiles carried in** — when a bee is near you (sharing the same rendezvous point), their tiles appear on your grid. not because they sent them. because proximity made them visible. their content lands on your comb the way pollen lands on a flower — carried by the bee, deposited by proximity, without negotiation.

- **always different** — the swarm you see at noon is not the swarm at midnight. the bees change, the tiles change, the scents change. two people at the same rendezvous will see different swarm compositions if they arrive at different moments. there is no canonical state of the swarm. there is only who is here now.

---

## the mechanics

the swarm is built from primitives that already exist.

**NostrMeshDrone** provides the transport. each participant's client publishes lightweight presence events to nostr relays, tagged with the signature derived from their lineage path. the signature is the rendezvous key:

```
lineage path → SignatureService.sign() → 64-char hex → nostr tag ['x', signature]
```

every client subscribed to the same signature receives every other client's presence events. this is the pheromone cloud — broadcast, not addressed. the relays are stateless forwarders, not authorities. they store events temporarily (ttl-based), and old presences expire and vanish.

**the EffectBus** propagates swarm state locally. when the mesh drone receives presence events from the relay, it emits `'swarm:presence-updated'` carrying the current set of nearby bees. rendering drones subscribe and update the visual — avatars appear, move, and fade. tile drones subscribe and merge visiting content into the grid.

**Lineage** determines which swarm you're in. your `activeDomain` and `explorerSegments` hash to a signature. change your path, change your swarm. navigate deeper, enter a sub-swarm. navigate up, rejoin the broader swarm. the swarm is not a room you enter. it is a consequence of where you are.

---

## the avatar

in a real swarm, you cannot identify individual bees by name. but you can see them. their size, their movement patterns, the pollen on their legs — these are visual signals, not identity documents.

hypercomb avatars work the same way. your icon — whatever you chose — is what others see flying across their grid. there is no username attached. no follower count. no verification badge. just a small image moving through hex cells in real time.

if you recognize someone's avatar, that is social recognition — the same way a beekeeper recognizes a marked queen. the system did not tell you who they are. you know because you've seen them before.

this is identity without accounts. recognition without databases. reputation without scores.

---

## the tiles

when bees visit flowers, they don't just take nectar. they deposit pollen from the last flower they visited. pollination is incidental — a side effect of proximity, not an intentional act.

tiles work the same way. when a bee is in your swarm, their active tiles become visible on your grid. they did not share them with you. they did not choose you as a recipient. their tiles appeared because the bee is near, and nearness makes things visible.

this means the content of your hive is never static. when the swarm is thick — many bees at the rendezvous — your grid is rich with other people's tiles, other perspectives, other paths. when the swarm thins, your grid returns to your own content. the richness of the experience is a direct function of how many bees showed up.

no algorithm decided what you see. the swarm decided by being present.

---

## scale

a real swarm can be ten thousand bees or fifty thousand. the behavior scales because no bee needs to know about every other bee. each bee responds to local signals — the temperature of its immediate neighbors, the scent gradient in its vicinity, the vibration of adjacent bees. global coordination emerges from local awareness.

the mesh handles scale through its existing mechanics: per-signature capacity caps (default 128 items), ttl-based expiry (default 120 seconds), and deduplication by event id. at massive scale, the relay infrastructure naturally sheds old presences. the swarm is always current, never archival.

> **Future:** At higher participant counts, the client will prioritize by spatial proximity, recency, and pheromone strength — rendering nearby and active bees first, fading distant or idle ones. These visual scaling behaviors are not yet implemented.

---

## the ephemeral community

a real swarm is temporary by nature. once the colony finds a new home, the swarm dissolves. the bees that swarmed together become a colony, and the swarm as a formation ceases to exist.

hypercomb swarms are the same. there is no membership list. there is no "swarm history." when you leave the rendezvous point — navigate away, close the tab, dispose your drones — your presence event expires on the relay and your avatar fades from everyone else's grid. the swarm you were part of continues without you, or dissolves if enough bees leave.

communities in hypercomb are not containers you join. they are **patterns that form when enough bees navigate to the same place.** the pattern is real while it lasts. when it dissipates, nothing is lost, because nothing was stored. the meaning lived in the co-presence, not in a record of it.

---

## public and private

the only difference between a public swarm and a private swarm is the path.

**public**: `hypercomb.io / science / chemistry` — anyone who navigates here enters the swarm. the path is guessable, browsable, discoverable. scouts can find it and dance about it.

**private**: `hypercomb.io / science / chemistry / a7f3bc91` — the final segment is a key shared out of band (a link, a whisper, a qr code). the architecture is identical. the mesh subscription uses the same signature mechanism. the only privacy is the obscurity of the path.

deeper privacy layers can add encryption to presence events (the mesh supports arbitrary payloads), but the fundamental model does not change. the path is the door. knowing the path is the key. being at the path is presence. presence is permission.

---

## what the swarm is not

the swarm is not a chat room. there are no messages. there is movement, tiles, avatars, pheromones — but no text channel. communication happens through navigation and content, not conversation.

the swarm is not a social network. there are no followers, no feeds, no notifications. you see who is here. you see what they brought. when they leave, they're gone.

the swarm is not persistent. there is no "swarm state" saved to a server. the relay holds presence events for their ttl and then forgets. the swarm exists only in the overlap of simultaneous presence.

the swarm is not curated. no algorithm decides who appears on your grid. proximity and timing are the only filters. this means some swarms will be quiet and focused. others will be chaotic and overwhelming. this is not a bug. this is what happens when real bees gather.

---

*a swarm has no leader, no plan, and no memory. ten thousand bees move as one because each bee responds to what is nearest. the swarm is not organized. the swarm organizes itself.*
