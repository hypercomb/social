# 🛡️ Security Policy

hypercomb is presence-first and storage-free by design. this document explains how to report vulnerabilities responsibly.

---

## scope

in scope:
- live protocol: 1-byte navigation, session nonce, transport aead
- client apps and demo implementations in this org
- relay components referenced by this repo (stateless forwarders)

out of scope:
- third-party chains, wallets, or libraries we do not maintain
- user-operated deployments we don’t control
- social engineering against contributors or community members

---

## principles

- **presence = permission** — tests must not affect sessions you weren’t invited to
- **no extraction** — do not scrape, record, or publish other people’s paths
- **minimal impact** — avoid spam, floods, or denial-of-service
- **privacy first** — do not collect personal data during research

---

## testing guidelines

- use local/dev environments whenever possible
- respect rate limits; do not bypass tempo guard or micro-gesture checks at scale
- no automated mass scanning against production endpoints
- do not attempt to deanonymize participants
- do not persist captured traffic; store only what is required for a minimal proof

---

## how to report

email: **security@yourdomain**  
(or open a private GitHub security advisory)

include (as minimal as possible):
- affected component (repo / path)
- class of issue (e.g., replay, authZ bypass, aead misuse)
- exact steps to reproduce
- expected vs actual behavior
- small, self-contained PoC
- redacted screenshots if helpful

optional:
- a public key if you prefer encrypted reply

we’ll acknowledge receipt and coordinate a fix and disclosure timeline.

---

## coordinated disclosure

- allow time for verification and remediation
- do not publish proofs until a fix is available
- researchers may be credited (opt-in)

---

## safe harbor

we will not pursue legal action against **good-faith** research that:
- stays in scope
- avoids privacy violations, service disruption, or data exfiltration
- follows this reporting policy

when uncertain, ask first.

---

## cryptography notes

- aead: xchacha20-poly1305
- key derivation: hkdf-sha256 from session nonce
- no urls/ids in protocol payloads; relay remains stateless

if you find flaws, please report them.

---

## version

this policy evolves with the project.  
propose improvements via: `docs(security): ...`
