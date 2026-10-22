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
| Participants write a **pool member** | **Built (step 1).** `PUT /<pool>/<member>` (kind 30567 claim) on the Cloudflare worker (`putRoomMember`) and the relay (`tryWriteRoomMember`). A static shim host takes no writes by design; it serves a *shipped* room pool (members plus the listing as `index.html`) unchanged. |
| Room identity as a 64-hex signature | Exists, but as a channel address, not a pool. The pool address above is new. |
| Reading a pool's members across hosts | Partial. It exists for `host:packages` only, and the first host to answer wins. |

## Build order

1. **Room pool on the host. BUILT.** Admitted participants write members as
   `PUT /<poolSig>/<memberSig>` with NIP-98. The member must hash to its name and
   carry a claim signed by the writer. The pool is listed to anyone who asks its
   address, because an unknown address reads as "not held" and is
   indistinguishable from nothing. Built in the worker and the relay, each
   with tests (`worker.spec.js`, `relay.room-pool.test.js`). The relay counts
   an address as a room pool only while every entry verifies as a member claim
   on it, so a history bag or an absent address still reads as "not held".
   The worker marks members with `member: '1'` metadata and refuses any
   address that already holds anything else. No `check-host.mjs` probe: a
   room's address is a capability the checker doesn't have.
2. **Room pool on the client. BUILT.** `sharing/room-pool.ts` (address,
   member shape and check, what stands) and `room-pool.service.ts`
   (`@diamondcoreprocessor.com/RoomPool`, registered by `room-pool.drone.ts`).
   - **Write.** When the relay takes this tab's word for a page, the word goes
     to the room's host as an atom (`putOne`), and a member
     `['head', sha256(word)] ['page', <room page sig>]` is signed and written,
     once per changed word, settled for a moment.
   - **Read.** On joining, the listing is read and every new member is fetched
     and verified; the newest member per signer per page stands.
   - **Address.** It is never derived through the pool registry, because that
     registry lists every meaning it derives and this one carries the secret.
     `probePool` stayed as it is: it is wired to `host:packages`, so the service
     fetches the listing itself.
   - **Older hosts.** A host that predates room pools refuses the member, and
     the room still works live.
   - **Proof.** `scripts/drive-swarm-room-pool.cjs` runs against a scratch relay
     of this tree, 7/7: the member is written, it names the exact word held on
     the host, a joiner reads it back, and it is still there after the sharer
     leaves.
   - **Template-first ordering** comes with step 3.
3. **The template. BUILT.** There is no separate publish step. A member signed
   by the HOST's own key is the template, and the host's key is the one it
   publishes as `_` at `/.well-known/nostr.json`, the signal both the relay
   and the worker give. The host shares a page in the room as anyone does
   (step two writes the member).
   - **On reading the pool,** `RoomPool` fetches each template word from the
     host, checks it against its signature, and hands it to
     `SwarmDrone.holdTemplate`. It is held apart from live peers, merged into
     `peerTilesAtSig` (so render, take and notes work unchanged), never
     counted as someone present, and never expires. The host's live word wins
     while they are in the room. Its tiles are pulled from the host so their
     files are local first.
   - **Proof.** `scripts/drive-swarm-room-template.cjs`, 7/7: a guest who
     arrives after the host has left gets the template tile and its notes,
     and the template does not count as someone present.
4. **Arrive = join. BUILT.**
   - **The link lands on the door.** When the meeting host has opened its swarm
     door, the meeting link the `invite` word hands out lands on
     `swarm.<host>` (`sharing/swarm-door-landing.ts`, which asks the door
     what package it names). So the guest's first load installs the room's
     pinned package. Without a door, the link lands where it always did.
   - **Joining asks first.** The link asks before it joins and joins on yes,
     the same as any meeting link. The template arrives first, because the
     room pool is read as the zone completes (step 3).
   - **Arriving opens no window.** A window opens only from its own door. On a
     swarm door, arriving shows a toast that stays until answered, says where
     everyone's notes are, and carries the notes desk's door ("Open the
     notes").
   - **The desk opens on the room's tile.** A guest who holds no tile here
     yet takes the room's tile: the shared tiles on the page, the host's
     template first. Their first line there starts their copy of it and
     reaches the room.
   - **Proof.** `scripts/drive-swarm-arrive.cjs`, 9/9. A host on `localhost`
     and a fresh guest on `swarm.localhost`, which follows the same door rule
     as `swarm.<host>`: the link asks, the guest joins, nothing pops up, the
     toast opens the desk on `lecture` with the host's note in it, and the
     guest's line reaches the host. `swarm-door-landing.spec.ts` covers where
     a link lands.
5. **Doors. BUILT (before step 4).** One door per host: `swarm.<zone>`.
   - **What it serves.** The full participant shell, pinned to the package
     the zone's publisher signed as `install:swarm`. Everyone in a room runs
     the same code before they attach. The room comes from the link's words,
     so one door serves every room on that host.
   - **How a host opens it.** Publish a revision under the name `swarm`
     (`npm run publish:revision -- swarm`). A host that signed no
     `install:swarm` answers "nothing here" at the door, because the live
     channel never opens it.
   - **Worker.** `SWARM_DOOR_LABEL` is served exactly as a sandbox door is
     (`serveSandbox`: the shell from `SANDBOX_SHELL_ORIGIN`, and a one-member
     `host:packages` pool). It is never a site, an own address or a card door.
   - **Shell.** `packageDoorOf` (core `sandbox-door.ts`, the one door rule) is
     true for both kinds of door. A cold install takes the door's package, and
     the update scout follows the door rather than the follow record's channel,
     so an update means the door now names a different root.
   - **It is no sandbox.** Its origin is the participant's own hive: it holds
     keys and signs, because a room is written in by everyone.
   - **Proof.** Unit tests only: `worker.spec.js` (swarm door), core
     `swarm-door.spec.ts`, and `update-scout.service.spec.ts` (package door).
     There is no live check until the worker is deployed and a host has
     published `install:swarm`.
6. **Room requirements and take home. BUILT.** jwize chose both shapes on
   2026-10-21.
   - **A requirement is a behaviour.** `room asks notes keep-alive`, said with
     the room's tile selected, writes the words into that tile's layer as an
     `asks` slot (`sharing/room-asks.ts`). The words travel with the tile like
     its notes. `room asks ~ <word>` drops one, and `room asks =` clears them.
     The word keeps its whole line (`rawArgs`), because the asked words are
     behaviour words themselves.
   - **On arrival (`room-asks.drone.ts`).** Once per room, the room's tiles
     (the host's template first) are read for what they ask. A toast lists the
     words with one button each: `notes` is the notes desk's door, and any
     other word is run as if typed. Words this hive lacks are named plainly.
     Nothing is turned on by itself.
   - **Take home (`sharing/take-home.ts`, the `room home` word).**
     - `room home <address>` names your own hive once. It is remembered on
       this device under `hc:my-hive`, the key the visitor door already reads.
     - `room home` puts the room tile's closure (its layer, children, notes,
       their envelopes and its category tree) on the room's host. Every atom
       is checked against its name (`HostSync.publishAtoms`).
     - It then puts a hive-link bundle there `{ segments: [tile], rootSig,
       hosts: [room host] }` and offers "Open my hive" in a sticky toast. The
       tab opens inside that click, because the upload outlives the word's own
       keypress.
     - Your hive opens at `#take=<bundle sig>@<host>`. The shell stashes it
       (`invite-capture.ts`), the invite worker reads the bundle from that
       host and checks it against its signature, and it is taken as any hive
       link: offered at your top level and adopted as you enter it.
   - **Proof.** `scripts/drive-swarm-room-step-six.cjs`, 11/11. The host's
     `room asks` lands on the tile. A guest on `swarm.localhost` is offered
     both behaviours with nothing turned on, and the keep-alive button runs
     the word. `room home <address>` remembers home, and `room home` puts the
     tile on the room's host. "Open my hive" opens the home hive at `#take=`,
     which is offered `lecture`, whose head and note are on the host.
     `room-step-six.spec.ts` covers the pure parts.
7. **Categories and organize. BUILT.** Each participant organizes their own
   tree by hand, with their own AI, or with Jev
   ([swarm-notes.md](swarm-notes.md), "Categories").
   - **Settling by count** (`note-categories.ts` `settledOutline`). A category
     settles when at least 2 people, and at least half of everyone present,
     hold one of its name at that place, at every level of the tree.
   - **On the desk.** A settled category wears `verified`. Settled ones you
     lack come first under "In the room". "Take the room's structure" takes
     every settled category you lack, nested as the room holds them, and only
     adds. The count never moves anything into anyone's tree.
   - **Proof.** `scripts/drive-swarm-categories-settle.cjs`, 10/10, with three
     browsers. Energy (Ana, Ben) and Genetics (Ana, Cy) settle. Ben is offered
     the structure with one missing and Genetics first, and one tap gives him
     Genetics with nothing else moved.
