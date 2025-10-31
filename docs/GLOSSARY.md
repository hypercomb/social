# 🗂️ Glossary — Words We Use

> quick map from metaphor → mechanics. comments are lowercase to match project style.

---

## hive
a live session (not a page, feed, or file). exists only while people are present.

## bee
a participant in the hive. identity is visual/social (recognizable avatar), not accounts.

## driver
the bee currently steering. emits 1-byte steps.

## link / unlink
consent to join/leave a driver’s live path. leaving ends access immediately.

## instruction byte
the single byte that encodes movement + intent.  
layout: `mm pp d nnn` (2 | 2 | 1 | 3 bits) → see [byte protocol](./byte-protocol.md)

## neighbor (nnn)
relative move within the hex layer (0–5). values 6–7 are invalid.

## direction (d)
`0=backward` (retracing), `1=forward` (exploring).

## pheromone (pp)
ephemeral ui hint, not a score:  
`00 neutral`, `01 happy/beacon`, `10 caution/avoid`, `11 treasure/priority`.

## mode (mm)
flow control: `00 end`, `01 continue`, `10 branch`, `11 reserved`.

## breadcrumb
tiny local stack of inverse moves for return-home. never leaves the device.

## meadow log
optional local record a driver may keep. used to publish dna. not synced by default.

## dna (path capsule)
a tiny byte stream + integrity commitment (and optional attestations/anchor) that makes a route publicly reproducible. not the hive itself. see [dna](./dna.md).

## relay
stateless forwarder for encrypted frames. stores nothing; can enforce minimal rate/jitter.

## session nonce
short-lived random value binding movement to the current moment; rotates on join/interval. see [session nonce](./session-nonce.md).

## tempo guard
edge checks on step timing/jitter to deter bots without profiling.

## micro-gesture check
rare, tiny human-presence proof (e.g., small pointer nudge) when behavior looks automated.

## attestation
signatures over a dna commitment (creator-only, creator+cohort, or community threshold).

## anchor
optional on-chain reference to prove when a dna commitment existed.

---