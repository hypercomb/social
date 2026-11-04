# Promoting from a phone

Status: **built and proved against the worker, 2026-11-04** (run locally; see
step 5 of the build order). `device-owner.spec.ts` keeps the worker's rules in
a fake; `device-owner.live.spec.ts` asks the worker itself.

> "once in our community we can promote it by clicking to go live" — jwize,
> 2026-11-04

## The gap

A phone goes to the .com. The page it sees is the front door (the shim's
showcase), not the hive. While managing, a tap brings a followed domain's tile
into your community, and that choice is kept in this browser's
`community:tiles` pool. The next step, **going live**, changes the domain's
signed showcase record. Something has to sign that, and today the only signer
is the hive's key. The hive is not on the phone. The page says so instead of
doing nothing, but it cannot promote.

## The answer is already designed: the phone is a place

`becoming-a-host.md`, *Letting another place publish for you*, settles this.
**Every place is a device, with its own key. The key never moves. An allowance
does.** Your desktop hive writes an invite into your anchor's signed key list.
The phone accepts it with a key it makes itself. From then on a host takes the
phone's publishes as yours. The core check, the worker, and the hive's client
and `keys` words were all built on 2026-10-24. The phone needs three things
that do not exist yet.

### 1. The front door accepts an invite

- On the desktop: `keys allow hypercomb.com` (already built) shows a QR code
  for `https://hypercomb.com/#invite=<host>/<anchor>/<secret>`.
- On the phone, the front door sees `#invite=`, takes it out of the address,
  and holds it. It never spends it on arrival: opening a link must not make
  a place publish as somebody else. The page shows one card: *"This phone is
  invited to publish for <label>. Allow"*. Tapping **Allow** is the
  participant's word. The shim has no command line, so on this page that tap
  plays the role `keys accept` plays in the hive.
- Allow does the following:
  - makes this browser's key if it has none (`hc:nostr:secret-key`, the
    credential's only home: this device's localStorage);
  - reads the chain from `<host>` and signs the next list with the invite
    secret (its own key in, the invite out);
  - `PUT`s the chain, signed with NIP-98 as itself;
  - forgets the secret and records the anchor in `keys:binding`.

### 2. Going live writes the anchor's index from the phone

A tap on a gray community tile in your row does what `signShowcase` does in
the hive, using the phone's key:

1. Read the anchor's index and the current `showcase:<zone>` record.
2. Toggle the item and upload the new record. The upload is a NIP-98 `PUT`
   tagged `["anchor", <anchor>]`.
3. Write the index with the new root. It is signed by the phone's key and
   tagged `["anchor", <anchor>]` and `["prev", <event id it replaces>]`. If
   the host refuses a stale `prev`, read again and retry once.

The worker already enforces all of this (`blossom-worker/key-lists.js`).

### 3. The front door reads what a listed key signed

`showcase-record.ts` `readZoneOwners` accepts only an index signed by the
pinned key (`event.pubkey !== pubkey` counts as failed). This is one of the
readers `becoming-a-host.md` lists under *Not yet reached*.

**This is a latent bug today, not only a missing feature.** The first time
any listed place publishes your index, every visitor's front door reads it as
a failed owner and shows "Could not read what is published here."

The fix: when the signer is not the anchor, read
`sign('keys:lists')/<anchor>` once. Accept the index only if both of these
hold:

- the event's `anchor` tag names the anchor;
- core's `verifyKeyListChain` says the signer is current.

## Where the code lives

The first draft said the hive's writers would move down to `hypercomb-runtime`.
They cannot: essentials may import only core, so runtime is no home both can
share. What both share is in **core**, and the front door's writer is its own:

| Piece | Where |
|---|---|
| The chain check, the invite rule, the invite's spelling (`parseInvite`, `inviteLink`) | core `key-list.ts` (essentials re-exports them) |
| The NIP-98 envelope (`nip98Template`, `nip98Authorization`) | core `nip98.ts` (the hive's `nip98Header` uses it) |
| This browser's key, its one credential home | shim `device-key.ts` |
| The binding, the same `keys:binding` document the hive keeps | shim `device-binding.ts` |
| Holding the invite, and Allow | shim `device-invite.ts`; the card in `host-panel.ts` |
| Going live: an `OwnerBridge` answered by this browser's key | shim `device-owner.ts` |
| Reading an index a listed key signed | shim `showcase-record.ts` `readOwnerIndex` |

The phone's index write is deliberately smaller than the hive's
`putHiveManifest`. It sets ONE root and carries every other field of the index
it read moments before, so it has no stale copy to rebase and signs no power
the owner turned off. The showcase record's bytes are written by both; a spec
holds the shim's `showcaseBytes` to the hive's, byte for byte.

The page asks the hive beside it first (`owner-bridge.ts`), and only then this
browser's key (`eitherOwner`).

**Deploying it.** The front door's installer imports `@hypercomb/core` at run
time. A host whose core predates `bareInviteHost` and `nip98Template` refuses
the new installer and keeps running the last one that worked. So the shim's
core copy (`npm run build:vendor` in hypercomb-shim) ships with it.

## What changes in the doctrine

The front door's rule today is *"a front door holds no key and no signing
code"* (`owner-bridge.ts`, `showcase-link.ts`). With this design:

- A browser that accepted an invite holds its own key and signs on this
  page.
- A visitor still holds nothing, and the page still draws only what the
  owners signed.
- The signing code is in the bundle for everyone. It runs only for a
  browser that is on the list.

## What it costs

These costs are the same as for any listed place, as `becoming-a-host.md`
says:

- **A stolen phone that is still listed can publish as you.** Every key is
  equal, so it can also take your other keys off the list, until a recovery
  path exists. Taking it off is one line: `keys off phone` from any listed
  place.
- **The phone's key sits in plaintext in that browser's localStorage**, like
  every place's key today.

## Not chosen

- **Copying the hive's secret to the phone.** Refused in
  `becoming-a-host.md`: a secret never travels.
- **NIP-46 remote signing.** The desktop would sign for the phone over a
  relay. It would have to be online for every promote. NIP-46 stays the path
  for approving sealed-audience decrypts on a phone (`sealed-audiences.md`,
  step 7), not for publishing.
- **Handing off to the hive by link (`showcase-link.ts`).** That is what
  the page tried before. On a phone, the hive's address sends you back to the
  .com, so the link can never land.

## Build order

1. **Reader** (part 3), with specs: an index signed by the anchor; signed by a
   listed key; signed by an unlisted key (refused); signed by a listed key
   with no `anchor` tag, or the wrong one (refused); no list, or a forged
   one (refused). **Built.**
2. **The shared pieces in core** (invite spelling, NIP-98 envelope); the hive
   uses them, and its key-list and index specs pass unchanged. **Built.**
3. **The front door's invite card and Allow** (part 1). **Built**: seen at
   phone width on `localhost:4270`, where Allow refuses in words and leaves no
   key, because that static server holds no list.
4. **Promote from the phone** (part 2). **Built**, with a retry on a stale
   `prev`.
5. **Proved against the worker** (2026-11-04), run locally with
   `wrangler dev --local --local-upstream localhost:8787` (without
   `--local-upstream` the worker sees the route's hostname and refuses every
   NIP-98 `u` tag). `device-owner.live.spec.ts`, skipped unless
   `HC_LIVE_HOST` is set, passes all four: Allow puts the phone's key on the
   list the worker keeps; the spent invite refuses a second browser and leaves
   it no key; a tap uploads the showcase and the worker takes the index the
   phone signs for the anchor, which every reader reads back; a stale `prev`
   is refused with 409 and the next tap reads fresh and goes through. In the
   browser at phone width, the card on `localhost:4270` took an invite the
   local worker held, and Allow left the worker's list naming the browser's
   key as `phone`.
   Not proved: the page and the zone on one origin, as in production. The
   worker serves the front door only from an `https` `HOST_DOOR_ORIGIN`, so
   that needs a deploy.
