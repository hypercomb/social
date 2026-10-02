# Sealed audiences — one branch, a version per key

**Status:** DESIGNED 2026-10-02, not built. The three decisions below are DECIDED (jwize, the same day: "go with your recommendations").

jwize, 2026-10-02: *"We should have keys that also serve alternate content from
directories that have encrypted content so we can have a different build for
different keys or no key."* And: *"if nostr is already doing it let's not add
unneeded baggage."*

## The shape

A branch can be published in more than one version: a **public** head anyone
opens, and **sealed** heads that only the keys in an **audience** can open.
The host serves the same bytes to everyone and learns nothing; what a visitor
sees depends only on which seals their key can open.

- **Your private key signs** what you publish. Anyone checks it with your public key.
- **Each member's public key seals** the one secret that opens their version.
- **Their own private key unlocks it**, inside their signer. The key never
  reaches the page, and never reaches a host.

A visitor sees the version the publisher ranks first among those their key
opens, else the public one, else "this place is private".

Never the other way round: content "locked" with a private key and unlocked
with a public key is readable by anyone, because a public key is public. That
is a signature, not a seal.

## What Nostr already does — used as it is

| Need | Nostr standard | Here |
|---|---|---|
| Seal a secret to a person | **NIP-44** (v2) | `seal = nip44.encrypt(memberPubkey, doorSecret)`, made by the publisher's key; the member opens it with `nip44.decrypt(publisherPubkey, seal)` |
| Keep the key out of the page | **NIP-07** extensions (`window.nostr.nip44.encrypt/decrypt`), **NIP-46** remote signers (`nip44_encrypt`, `nip44_decrypt`) | `NostrSigner` gains `nip44Encrypt` / `nip44Decrypt` that pass straight through; the local-key fallback uses `nostr-tools/nip44` |
| Say who is in an audience | **NIP-51** follow sets: kind 30000, `d` tag = the audience's name, `p` tags = its members | the publisher's signed list; any Nostr client can edit it too |
| Approve on a phone | **NIP-46** | a signer change of its own (see Build order) |

## What Nostr does not do — and the core already does

`hypercomb-core/src/core/content-cipher.ts`, built and tested, with no
production consumer yet:

- **`sealAtom`** encrypts each atom convergently: the key comes from the
  content, so the signature names the ciphertext, mirrors stay byte-identical,
  replication changes by zero lines, and dedup survives.
- **`sealToSecret` / `openWithSecret`** is the **door**: a key derived from a
  secret alone opens ONE atom, the **key index**, which names the version's
  head and every atom's key. One secret, then bytes.

Today that secret is meant to travel in a link's `#fragment`. This design
adds the other way to hand it over: sealed to the people who should hold it.

## What is new — the whole list

1. **The envelope** — one atom per (branch version, audience):
   `{ seal: 1, audience: <sig of the NIP-51 list>, door: <sig of the sealed key index>, seals: { <member pubkey>: <NIP-44 payload> } }`.
   The publisher always seals to their own key too, so their other devices
   open it. Envelopes live in the pool `sign('keys:envelopes')` (the name
   decided 2026-08-31) and travel as ordinary atoms.
2. **The record** — the signed hive index gains
   `sealed: { [lineageKey]: [envelopeSig, …] }` beside `roots` and `doors`,
   in the same signed write, in the publisher's order (the first a visitor can
   open is the one they see). **Every index writer carries `sealed` through**,
   exactly as it carries `doors`: a writer that drops it withdraws every sealed
   version at once.
3. **The audiences** — the publisher's NIP-51 lists, the newest per name, in
   the pool `sign('keys:audiences')`.
4. **Publishing a sealed version**, in order: walk the closure (as publishing
   does today) → `sealAtom` each atom → the key index `{ head, keys: { sig → key } }`
   → a fresh random door secret → `sealToSecret(keyIndex, secret)` → the
   envelope with one NIP-44 seal per member → upload the ciphertexts, the door
   and the envelope (bytes are bytes; host-sync needs no change) → the index
   write. The public head, if the branch has one, is untouched.
5. **Opening one**: resolve the index as today. If the lineage has `sealed`
   entries and a signer is present, find the first envelope with a seal for
   this key → `nip44Decrypt` → the door secret → `openWithSecret` → the key
   index → open each atom as it is fetched, by its key. Plaintext is held in
   memory for the session and **never written under the ciphertext's
   signature**. No signer, or no seal for this key → the public head, or
   "this place is private".
6. **The acts, each with a word**: name an audience and add or remove members
   (writes its NIP-51 list); publish a branch to an audience; withdraw it. The
   words are settled when this is built (`every-act-has-a-word`), and the
   Publish panel shows one row per audience beside the per-domain switches.

Three levels then exist for any branch: **public** (no key), **link** (the
door secret in `#…`, "anyone with the link"), **audience** (the door secret
sealed to named keys). Links and audiences open the same door; only how the
secret arrives differs.

## Rules

- **Hosts stay dumb** (decision 2026-08-31). Same bytes to everyone, no
  session, no authorization, fully cacheable. No host ever sees a door secret
  or an atom key. A host serving a different folder per key is ruled out:
  it breaks caching and puts secrets on the host.
- **Per branch, never global.**
- **No revocation backward.** Removing a member governs future versions:
  republish with a new door secret. Whatever they already fetched, they keep.
  This is inherent to replication (`content-cipher.ts`), not a gap.
- **Membership is visible.** An envelope's seals are keyed by member pubkey,
  so anyone reading it sees who is in the audience, never what they can read.
- **The confirmation oracle is accepted for now.** Convergent atoms let
  someone who can guess a plaintext confirm it is present. `sealAtom` already
  takes a salt for a branch that needs it closed, at the cost of dedup for
  that branch.

## Not adopted, and why

- **NIP-59 gift wrap** (hides who an envelope is for): each visitor would have
  to try every seal, one signer prompt per try. Revisit only if membership
  itself must be private.
- **NIP-29 relay groups**: the relay becomes the authority over who is in.
  That contradicts a dumb host.
- **MLS / Marmot groups**: built for ongoing group messaging, not for
  publishing a version once. Far more machinery than an envelope.

## Decisions (jwize, 2026-10-02: "go with your recommendations")

1. **Membership is visible** in the envelope. Gift wrap is not adopted.
2. **A visitor sees the publisher's first openable version automatically.**
3. **Sealed atoms stay convergent** (dedup kept, oracle accepted); a branch
   that needs the oracle closed is salted on its own.

## Names — who a key is, seen with its host

jwize, 2026-10-02: *"maybe we can introduce publisher participant names so
they can be seen with your host for yourself."* Nostr already has both halves:

- **A profile** — kind 0, `{ name, display_name, picture, about }`, signed by
  the key. Anyone can write any name into their own profile, so on its own it
  proves nothing.
- **NIP-05** — `name@domain`, true when `https://<domain>/.well-known/nostr.json`
  answers `{ "names": { "<name>": "<hex pubkey>" } }`. The DOMAIN vouches.
  `_@domain` is the domain's own key and shows as just `domain`.

A host is a domain, so a participant's name is their name **at their host**:
`leanne@cafesociety.me`, `jwize@jwize.com`. What is new:

1. **Every host answers `/.well-known/nostr.json`**, derived from the keys it
   already serves, never a second list to keep: the worker from each binding's
   publishers (their `label`) and each active claim; a relay from its writers.
   The domain's primary publisher is `_`. CORS `*`, as NIP-05 requires.
2. **The hive shows a name wherever it shows a key** (audience members, a
   host's publishers, the Publish panel): a NIP-05 name verified against its
   host first; else the profile's name, marked unverified; else a short npub.
3. **A participant sets their own profile** with one word. The signed kind-0
   event is an atom, named in their index as `nostr:profile`.

**A key per host, when the content differs.** jwize, the same day: *"That
way if they interleave they can be filtered even if one or the other is being
served. This would be important if I have multiple of my domains hosting
different content with the same names."* One key's index holds one head per
name, so ONE key publishing different content under the same names on two
domains collides — the last publish wins that name. Each such host gets its
own key instead: `jwize@jwize.com` and `jwize@pluginthematrix.com` are two
keys, two indexes, no collision. Where both are served together, same names
STACK (superimposition, never a merge — `superimposition.md`), and each layer
wears its author's `name@host`, so a reader filters by it whichever host is
serving. The hive then signs a domain's publishes with that domain's key; a
signer that holds several keys (a NIP-46 bunker does) carries them all.

Build order for names: (1) hosts answer NIP-05; (2) the hive shows verified
names and filters stacked layers by them; (3) the profile word; (4) a key per
domain — the publish path signs with the key bound to the domain it writes.

## Build order

1. `NostrSigner`: `nip44Encrypt` / `nip44Decrypt` (NIP-07 first, local key via
   `nostr-tools/nip44`), with a spec.
2. `sharing/sealed-audience.ts`: mint and open an envelope and its key index,
   pure, with the signer injected; a round-trip spec with two members and a
   stranger who must open nothing.
3. The index `sealed` field: `putHiveManifest` and every writer carry it.
   Check that the worker and the relay keep an unknown field (they store the
   signed index; it must stay under the worker's 64 KB index cap, which it
   does because envelopes are named by signature).
4. The publish path for a sealed version.
5. The read path: the hive and the visitor door, opening in memory.
6. The words and the Publish panel's audience rows.
7. NIP-46 remote signing (the phone), separately.

## Related

- `hypercomb-core/src/core/content-cipher.ts` — the cipher and the door
- [deployment-stages.md](deployment-stages.md) — the signed index and its writers
- [hypercomb-communication-layer.md](hypercomb-communication-layer.md) — notes
  that `infrastructure.md:214` describes a different scheme than the code; this
  design builds on the code
