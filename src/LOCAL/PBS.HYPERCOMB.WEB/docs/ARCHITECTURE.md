# 🟣 Architecture — Live Presence (Simple)

hypercomb is **live-only by default**. meaning is created by moving together in real time.  
there is **no global storage**, **no feeds**, and **no profiles**. **presence = permission**.

this page is the short version so anyone can “get it” in under a minute.

---

## 🌱 tl;dr

- one byte per step drives everything  
- only bees *present right now* receive steps  
- relay is stateless (forwards encrypted frames, stores nothing)  
- identity is visual (recognition, not accounts)  
- optional local memory (meadow log)  
- optional publishing (dna) when a path should persist

---

## 🐝 how it feels

1. **link** to a driver (consent to join)  
2. **move** together (driver emits tiny steps; linked bees follow)  
3. **unlink** any time (leaving ends access immediately)

that’s the whole loop.

---

## 🗺️ one picture

driver ── 1-byte steps ─▶ relay (stateless) ─▶ linked bees
│ ▲
└──────── presence-bound session key ──────┘

yaml
Copy code

- relay only forwards opaque frames  
- if you’re not present, you don’t receive them

---

## 📦 data you actually have

- **instruction byte**: the step (see [byte protocol](./byte-protocol.md))  
- **pheromone hint**: neutral / happy / danger / treasure (ephemeral)  
- **breadcrumb stack**: local inverse moves to go home (client-only)  
- **(optional) meadow log**: local record the driver may keep  
- **(optional) dna**: a tiny path capsule for public reuse

no urls, no user ids, no server addresses.

---

## 🔐 session security (nonce)

- a fresh **session nonce** is created when hosting starts  
- only linked bees receive it  
- it **rotates** on join and at short intervals  
- frames tied to old nonces are ignored

result: old bytes can’t be replayed outside presence.  
see: [session nonce](./session-nonce.md)

---

## 🧿 human-only gates (without profiles)

- **tempo guard**: reasonable step timing + a little natural jitter  
- **micro-gesture** (rare): tiny proof like a short pointer nudge

goal: keep bots out **without** building surveillance or accounts.

---

## 🏠 return home

- replay local inverse moves from the breadcrumb stack  
- stack is deleted on session end unless the driver keeps a meadow log  
see: [meadow log](./meadow-log.md)

---

## 🧬 optional persistence (dna)

- when a path should persist, the driver can publish a **path capsule (dna)**  
- it contains only the route bytes + an integrity commitment  
- optional attestations and optional blockchain anchor  
live behavior never changes whether dna exists or not.  
see: [dna](./dna.md)

---

## ✅ build checklist

- ❏ do **not** store steps, pheromones, or identities on the server  
- ❏ rotate session nonces regularly and on join  
- ❏ keep the instruction exactly **one byte** end-to-end  
- ❏ provide clear **link / unlink** controls  
- ❏ make meadow log + dna **explicit and opt-in**

---

## 📚 related docs

- [byte protocol](./byte-protocol.md) — the one-byte layout  
- [session nonce](./session-nonce.md) — live security layer  
- [social governance](./social-governance.md) — how behavior regulates itself  
- [dna](./dna.md) — optional path capsules for publishing  
- [meadow log](./meadow-log.md) — optional local memory

---

**simple, live, and human.**