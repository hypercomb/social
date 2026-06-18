# the memory

bees do not write things down. a forager does not keep a journal of every flight. the colony's knowledge lives in the behavior of its members — in the dances, the scent trails, the worn paths on the comb surface. when the last bee who knew a flower patch dies, that knowledge is gone.

this is not a flaw. it is the design.

hypercomb is the same — but only about the *network*. by default, nothing crosses the wire. the hive exists in live presence, and the social moment is never broadcast. when the session ends, the navigation paths, the pheromone signals, the live drone interactions — all of it dissolves from the shared air. the gathering was real, but it was not transmitted.

locally, though, the comb itself remembers. everything you author is content-addressed and versioned in opfs — committed automatically to a merkle history — so your own tree is durable and persists across sessions. what dissolves is *presence*, not your work. nothing crosses the network unless you publish.

---

## choosing to remember

sometimes a forager finds something extraordinary. a field so rich, so reliable, that the colony should be able to find it again even if every current forager is gone. in nature, this is where genetics and environmental cues take over — the colony adapts over generations.

in hypercomb, this is where the **trail capsule** enters (its bee-metaphor synonym is the **waggle capsule** — the dance, written down). a drone operator can choose to publish a trail capsule — a minimal record of how to get somewhere. *publishing* is the explicit, conscious act; it never happens automatically. (your local content, by contrast, is committed and versioned automatically — see "what the comb keeps" below.)

> **status: vision / not yet implemented.** the trail capsule is a preserved specification, not shipped behavior. the capsule serializer/parser and recorder do not exist in the build. see [trail-capsule.md](../trail-capsule.md). not to be confused with **dna** — the merkle-versioned artifacts that *are* committed automatically; see [dna.md](../dna.md).

a trail capsule contains:

- **the route** — a sequence of 1-byte navigation steps (the dance, written down)
- **a content seal** — SHA-256 hash proving the route has not been altered
- **a start cell** — where the path begins (hashed, so it can be public or private)
- **a salt** — random bytes preventing dictionary reversal of the cell

that is all. no timestamps, no user ids, no server addresses. the smallest possible *route* a community can share.

---

## what the comb keeps

the trail capsule above is an *optional published route*. it is a different thing from the **opfs sig-pool** — the always-on local substrate where your authored content actually lives. this is the **dna** of your hive: the content-addressed, merkle-versioned artifacts that compose your tree (the genetic ladder is documented in [dna.md](../dna.md)).

this substrate is not opt-in. every change you make is committed automatically and durably to the browser's origin private file system (opfs): marker chains under `__history__/`, the signed layer bytes and content pools under `__layers__/`, `__resources__/`, `__bees__/`, `__dependencies__/`, and your tree under `hypercomb.io/`. a cell is identified by signing its path segments (the domain is discarded; the root signs as the empty path). nothing here leaves the device unless you publish.

what *is* ephemeral — and deliberately kept out of the signed layer so it never skews your lineage signature — is **presence**: your cursor, clipboard, selection, viewport, and who else is live in the session right now. that is the dance. it dissolves. the comb beneath it does not.

---

## from memory to gift

publishing a trail capsule is a gift, not an obligation. the flow:

1. **select** — choose a slice of your local path history
2. **normalize** — remove jitter and duplicates, keep the essential route
3. **seal** — compute the content hash
4. **publish** — share the capsule through any medium (nostr relay, static file, direct transfer)

the capsule can then be verified by anyone: re-hash the contents, compare the seal. if they match, the path is intact. if they don't, it was tampered with.

---

## what memory preserves

a trail capsule does not capture the experience. it captures the route. a waggle dance does not transmit the taste of nectar or the warmth of the sun on a flower. it transmits direction, distance, and quality.

a trail capsule is the same. it is sheet music, not a recording. anyone can replay the route in a new live session, but the social moment — who was there, what they felt, how they moved together — that belongs to the bees who were present.

**the hive is alive. the memory is a map back to where life happened.**

---

## what memory does not do

your own tree *is* remembered automatically and durably — that history is the merkle spine of the hive. but the colony's memory is yours alone until you choose to share it. so:

- it does not track who visited which cells, or surveil other bees' presence
- it does not broadcast your local history; the merkle chain stays in your opfs until you publish
- it does not create a feed, a timeline, or a profile *of others*
- it does not sync between devices over the network unless explicitly published
- it does not require identity, accounts, or credentials

the absence of *automatic broadcast* is not a missing feature. it is the most important feature. you remember everything you make; the network learns nothing you do not give it.

---

*a bee remembers the way to the flowers. it does not remember every wingbeat of every flight. memory is selective, and selection is an act of care.*
