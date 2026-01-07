# 🤝 Social Governance — How We Stay Human (Live-Only)

hypercomb is built on **presence, consent, and recognition**. there are no feeds or profiles; governance is social and local by design.

this page explains the **smallest set of norms and tools** that keep sessions healthy without building surveillance or central authority.

---

## 🌱 principles (short)

- **presence = permission** — only bees *here now* receive steps.
- **consent to link** — you choose who can follow you.
- **recognition over accounts** — unique avatars, not login reputations.
- **no storage by default** — nothing is saved unless someone *explicitly* publishes dna.
- **local first** — safety actions are local to you; communities add rules by policy, not by default logging.

---

## 🐝 roles in a session

- **driver** — emits 1-byte steps; chooses who can link.
- **linked bees** — co-navigate by consent; can unlink any time.
- **witnesses (optional)** — additional bees who co-sign a published path (see [dna](./dna.md)).

no moderators are required for live movement. the group itself chooses to link, continue, or leave.

---

## 💗 pheromones (soft signals, not scores)

pheromones are tiny, ephemeral hints that guide attention:

- **neutral** — just traveling  
- **happy** — meaningful / good  
- **caution** — take care  
- **treasure** — especially valuable

they **never** become stored rankings. ui applies gentle visuals only.

---

## 🛡️ safety tools (local + tiny)

**you always have agency, with minimal mechanics:**

- **unlink** — leave instantly; access ends.
- **mute** — hide a driver’s steps for this session.
- **ignore** — keep a local, device-only blocklist (not shared, not uploaded).
- **micro-gesture check (rare)** — tiny human-presence proof if the relay suspects automation.
- **tempo guard** — edge-rate limits + natural jitter checks to deter bots (no profiling, no storage).

> these protections are designed to be **human-first** and **storage-free**.

---

## ⚖️ publishing memory (optional dna)

most sessions vanish when they end — by design. sometimes a driver wants to **gift a route** to the world:

- publish a **path capsule (dna)** — a tiny byte stream + integrity commitment.  
- choose who decides (pluggable policy):  
  - **creator opt-in (default)**
  - **creator + cohort** (n-of-m co-signers)
  - **community threshold** (multisig attestation)

anchoring to a chain is optional. dna contains **no urls or identities**. see: [dna](./dna.md)

---

## 🧭 norms of the road (plain language)

- **ask to link** — don’t assume access; accept “no” gracefully.
- **move with care** — your path shapes others’ experience in real time.
- **signal honestly** — pheromones are for guidance, not labels on people.
- **no scraping or recording** — this is presence, not extraction.
- **leave kindly** — unlink if a path isn’t for you; don’t disrupt.

---

## 🧩 community policy knobs (optional)

communities can add lightweight rules **without** changing the core protocol:

- **invite-only join** (driver must approve every link)  
- **stricter tempo guard** (tighter min/max step intervals)  
- **attestation thresholds** (who can co-sign dna)  
- **encryption-on by default** (transport AEAD always on; it already is recommended)

policies are **project-level config**, not global infrastructure.

---

## 🧪 incident playbook (minimal, no logs)

| situation           | what you do                | what the system does                    |
|---------------------|----------------------------|-----------------------------------------|
| unwanted follower   | unlink / ignore            | drops access immediately                |
| disruptive driver   | unlink; others can too     | session dissolves socially              |
| bot-like behavior   | trigger micro-gesture      | passes → continue; fails → drop         |
| replay attempt      | ignore stale frames        | nonce rotation defeats the replay       |
| harmful route       | leave; don’t co-sign dna   | no memory unless someone publishes dna  |

no moderation queue. no storage. decisions happen **in the moment**.

---

## 🔒 privacy notes

- no accounts required; recognition is visual and social.  
- no urls/addresses in movement bytes.  
- no server-side path storage.  
- local blocklists stay on your device.  
- dna, if published, can be attested *without doxxing* (pseudonymous keys are fine).

---

## 📚 related docs

- live protocol overview — [architecture](./architecture.md)  
- 1-byte movement — [byte protocol](./byte-protocol.md)  
- session security — [session nonce](./session-nonce.md)  
- optional memory — [dna](./dna.md)  
- local logging — [meadow log](./meadow-log.md)

---

## ✨ summary

governance in hypercomb is **human, small, and live**: consent to link, move together, leave whenever, and only publish memory when you *choose*. everything else is culture.

