# 🤝 Contributing

thanks for helping the hive grow. this project is presence-first: live by default, no storage unless someone explicitly publishes dna. keep contributions small, human, and simple.

---

## 🌱 before you start

- read: [The Hive](./docs/hive.md), [Architecture](./docs/architecture.md)  
- understand the invariants: **1-byte steps**, **presence = permission**, **no server storage**, **optional dna only**

---

## 📁 repo conventions

- docs live in `./docs/` with **lowercase filenames** (e.g., `hive.md`, `dna.md`)
- links use **readable names** with paths hidden (e.g., `[The Hive](./docs/hive.md)`)
- comments in code/docs are **lowercase** to match project style
- do not add analytics, trackers, or persistent logs

---

## 🔧 code style (typescript)

- single-line imports
- prefer arrow async methods

```ts
// example style
export class Example {
  public start = async (): Promise<void> => {
    // do work
  }
}
keep helpers tiny and explicit

no global state for protocol data

pixi note: import named members instead of using global PIXI (e.g., import { Container } from 'pixi.js'), never Pixi.*

🧭 protocol invariants (do not break)
exactly 1 byte per navigation step (see: Byte Protocol)

no urls, no identities, no server addresses in protocol messages

relay is stateless: forwards opaque frames; stores nothing

session nonce rotates on join and interval (see: Session Nonce)

meadow log is local-only (opt-in) and not synced (see: Meadow Log)

dna is optional; publishing never changes live behavior (see: DNA)

✅ pull request checklist
❏ kept the 1-byte step intact (no extra payload in meaning layer)

❏ no server-side storage of steps/pheromones/identities

❏ session nonce handling unchanged (create → distribute → rotate → expire)

❏ ui changes treat pheromones as hints, not scores

❏ docs updated with lowercase filenames and readable link names

❏ added minimal tests or demo steps where helpful

❏ no analytics/telemetry introduced

🧪 local testing (minimal)
run the demo and link two clients

verify:

linking requires consent

steps flow live; leaving stops flow immediately

nonce rotation during join doesn’t break follow

optional meadow log stays local and can export to dna

📝 docs contributions
prefer short pages that branch deeper for details

keep metaphors consistent (bees, hive, pheromones)

show one diagram or snippet per concept

avoid timestamps or identity requirements in examples

🔒 security & privacy
no persistent logs, no profiling, no hidden data flows

any transport hardening must not reveal urls/ids

if you find a vulnerability, email the maintainers privately (responsible disclosure)

💡 proposing changes
open a discussion with:

the problem in one sentence

the smallest possible change to solve it

how it keeps invariants intact

a tiny demo (gif or steps)

🧭 commit messages (suggested)
pgsql
Copy code
feat(byte): add branch hint rendering (no protocol change)
fix(nonce): rotate on join edge-case
docs(hive): clarify breadcrumb is local-only
chore(repo): lowercase doc filenames and readable links
🐝 welcome
small improvements beat big rewrites. stay human, keep it live, and let the hive grow with us.