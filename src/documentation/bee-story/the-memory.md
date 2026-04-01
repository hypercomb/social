# the memory

bees do not write things down. a forager does not keep a journal of every flight. the colony's knowledge lives in the behavior of its members — in the dances, the scent trails, the worn paths on the comb surface. when the last bee who knew a flower patch dies, that knowledge is gone.

this is not a flaw. it is the design.

hypercomb is the same. by default, nothing is stored. the hive exists in live presence. when the session ends, the navigation paths, the pheromone signals, the drone interactions — all of it dissolves. the hive was real, but it was not recorded.

---

## choosing to remember

sometimes a forager finds something extraordinary. a field so rich, so reliable, that the colony should be able to find it again even if every current forager is gone. in nature, this is where genetics and environmental cues take over — the colony adapts over generations.

in hypercomb, this is where **dna** enters. a drone operator can choose to publish a **path capsule** — a minimal record of how to get somewhere. this is an explicit, conscious act. it never happens automatically.

a path capsule contains:

- **the route** — a sequence of 1-byte navigation steps (the dance, written down)
- **a content seal** — SHA-256 hash proving the route has not been altered
- **a start cell** — where the path begins (hashed, so it can be public or private)
- **a salt** — random bytes preventing dictionary reversal of the cell

that is all. no timestamps, no user ids, no server addresses. the smallest possible memory a community can share.

---

## local memory first

before publishing, a drone can keep a local record in the browser's origin private file system (opfs). this is the **meadow log** — a private notebook that never leaves the device.

the opfs directory mirrors the lineage path: `domain/path/cell` becomes a directory structure. each entry is a sealed payload. the drone decides what to write and what to discard.

this is like a bee's personal familiarity with a route — repeated flights reinforce the memory. but the memory belongs to that bee alone. it is not shared with the colony unless the bee dances.

---

## from memory to gift

publishing dna is a gift, not an obligation. the flow:

1. **select** — choose a slice of your local path history
2. **normalize** — remove jitter and duplicates, keep the essential route
3. **seal** — compute the content hash
4. **publish** — share the capsule through any medium (nostr relay, static file, direct transfer)

the capsule can then be verified by anyone: re-hash the contents, compare the seal. if they match, the path is intact. if they don't, it was tampered with.

---

## what memory preserves

a path capsule does not capture the experience. it captures the route. a waggle dance does not transmit the taste of nectar or the warmth of the sun on a flower. it transmits direction, distance, and quality.

dna is the same. it is sheet music, not a recording. anyone can replay the route in a new live session, but the social moment — who was there, what they felt, how they moved together — that belongs to the bees who were present.

**the hive is alive. the memory is a map back to where life happened.**

---

## what memory does not do

- it does not track who visited which cells
- it does not build a history of the hive's state over time
- it does not create a feed, a timeline, or a profile
- it does not sync between devices unless explicitly published
- it does not require identity, accounts, or credentials

the absence of automatic memory is not a missing feature. it is the most important feature.

---

*a bee remembers the way to the flowers. it does not remember every wingbeat of every flight. memory is selective, and selection is an act of care.*
