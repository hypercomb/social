# Swarm pools — a room is a pool, a subdomain only resolves

*jwize, 2026-10-14: "we need to use pools not subdomains. a subdomain is for
resolution not storage" · "no subfolders other than pools of meaning".*

**Status: plan.** Notes already swarm through the desk
([swarm-notes.md](swarm-notes.md)). This is where a swarm *lives* on a host, so
that it can come with its template, keep what was shared, and be reused next
time.

## The fixed rule

Storage has one shape everywhere, on a device and on a host:

- **Atoms.** Flat signature-named files at the root: `<root>/<sig>`.
- **Pools of meaning.** The only folders, addressed as `<root>/<sign(meaning)>/`.
  Lineage sig-bags are the other signature-named folders.

A swarm, a room, a lecture's shares and a template are therefore **pools on the
host's one root store**, never a domain, a path or a subfolder. A subdomain, an
entrance or a link only **resolves** to a pool address.

## The room pool

- **Address.** `sign('swarm:' + roomPreimage(room, secret, host))`. It is a colon
  meaning, so it is a system pool no tile names, and it derives through the pool
  registry like every other pool.
- **The address is the capability.** It contains the room's secret, so it can't
  be guessed. Whoever has it was given it (an invite, a QR code), which is the
  same convention that keeps branches hidden.
- **Flat members.** Each member is a file named by its own signature and holds a
  signed claim, for example `{ room, signer, head, seq, at }`, where `head` is the
  signature of what that member shares. There are no author subfolders.
- **The template.** The host's published branch is a member signed by the host
  key, and it is the room's starting tree. The template is the public hive you
  host the swarm on.
- **Participants' shares.** Each participant's shared head is a member signed by
  their key. Their atoms are ordinary flat atoms on the host, so they are stored
  once and reused next session.

**Presence and storage are separate.** Presence (who is in the room now, live
notes) stays on the relay, as today. The pool is what stays: the template plus
whatever was uploaded, so later sessions resolve from the host and not from the
mesh.

## Resolution

- **Joining.** A link, QR code or entrance carries the room's words. The shell
  derives the pool address, installs the host's package (the room's requirements:
  notes, swarm notes, keep-alive, and later the organizer), and replicates the
  template member first, as same-origin static atoms that are cached forever.
  Then it joins live. The mesh carries only new things.
- **Subdomains.** A subdomain is a door, never a store. `lecture.jwize.com` maps to
  a pool address plus a package, chosen by the `Host` header and never by the
  page address or the referrer. Doors are one level deep.
- **Projections per audience.** An entrance serves a root that does not name
  what that audience shouldn't see: a projection with its own signature that
  reuses shared atoms. Elevated heads require a request signed with a key the
  host has allowed.

## Privacy, in three layers

1. **Unguessable addresses with no listing above them.** You can only reach what
   a pointer you were given leads to. A private branch carries its own entropy,
   because a signature is deterministic and guessable content can be confirmed
   by hashing.
2. **Projections.** No served layer names what the audience shouldn't reach.
3. **Encryption with client-held keys.** This covers whatever must stay private
   after a signature leaks. A leaked signature can't be revoked; the only remedy
   is a forward move to a new head.

**Writes are gated by key.** The host's allowance (operators, friends, room
participants) decides who may write. CORS is an allowlist (the host's doors plus
followed community domains) against hotlinking; it is not security.

## What exists, what is missing

| Piece | State |
|---|---|
| Hosts serve `/<poolSig>/` listings (relay `readdir`, worker R2 prefix) | Exists. Listings are gated to the floor's meanings plus the operator's signed index, so room pools need their own rule (below). |
| Static shim serves a pool listing | Partial. It serves a shipped `index.html` but 404s a pool without one. |
| Participants write flat atoms (NIP-98, admitted through `host:grants`) | Exists. |
| Participants write a **pool member** | **Missing.** The relay returns 409 for pool addresses, and the worker's only pool write is the owner's own hive index. |
| Room identity as a 64-hex signature | Exists, but as a channel address, not a pool. The pool address above is new. |
| Reading a pool's members across hosts | Partial. It exists for `host:packages` only, and the first host to answer wins. |

## Build order

1. **Room pool on the host.** Admitted participants write members as
   `PUT /<poolSig>/<memberSig>` with NIP-98. The member must hash to its name and
   carry a claim signed by the writer. The pool is listed to anyone who asks its
   address, because an unknown address reads as "not held" and is
   indistinguishable from nothing. Build it in the worker, the relay and the
   shim's `serve.mjs`, plus a check in `check-host.mjs`.
2. **Room pool on the client.** Derive the address, write your share-head member
   when you share, and read the members (template first) on arrival. Generalize
   `probePool` beyond `host:packages`.
3. **The template.** Publishing a branch into a room pool makes it the
   host-signed template member.
4. **Arrive = join.** A link carries the room words; the shell installs the
   package, replicates the template, joins and opens the notes desk on the room
   tile.
5. **Doors.** A subdomain maps to a pool address plus a package via `Host`. This
   is optional, and every door is one level deep.
6. **Room requirements and take home.** The room tile's traits are checked on
   entry, and "take home" replicates what you took into your root hive by
   signature.
7. **Categories and organize.** These settle by count, with per-participant AI
   or manual organizing ([swarm-notes.md](swarm-notes.md) → next).
