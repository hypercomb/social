# The swarm link

**Status: CORE BUILT 2026-10-11, wiring at the merge.** Owner (jwize,
2026-10-11): "we host the payload and give the link with a signature" — "then
the swarm login is retrieved" — "build it as part of this merge".

Code: `hypercomb-essentials/src/sharing/swarm-link.ts` (pure functions, no
runtime) and its spec beside it.

## What it is

A **swarm login** is `{ host, location, secret, code? }`:

| Field | What |
|---|---|
| `host` | The meeting host the participant named. The single source of truth: the login says where the meeting is, nothing else does. Canonical lowercase `host[:port]` — `HyperComb.com`, `wss://hypercomb.com/` and `hypercomb.com:443` are all `hypercomb.com`. For a relay it is exactly the point the room hashes (nostr-mesh `swarmHost()` read through core `meetingPointKey`), and canonicalizing it again changes nothing. A host typed under any scheme but `ws`, `wss`, `http` or `https` names no host. |
| `location` | The room, exactly as typed. |
| `secret` | The room's secret, exactly as typed. |
| `code` | The host's access code — only when that host needs one. |

Case and Unicode folding happen where the room is hashed
([swarm-room-identity.md](swarm-room-identity.md)), not in the login.

The sharer **seals** the login and puts the sealed blob on the meeting host;
the link names the blob by its signature and carries the key that opens it.

## The dial rule

An opened login is dialled at `swarmRelayUrl(host)`: `wss://<host>`, and
`ws://` only on a loopback host. So a login only carries a meeting point it
can be dialled back to. A relay with a path (`wss://pluginthematrix.com/io`),
a query, or a scheme the rule would not choose (`ws://` to a public host,
`wss://` to a loopback one) is not sealed — the publish says `malformed`, and
the caller hands out a `#meet=` link, which names the relay whole.

## The link

```
<appOrigin>/#swarm=<sig>@<host>~<key>
```

- `appOrigin` — where the link lands: the meeting host's swarm door when it
  has one, else the sharer's page for `invite` and hypercomb.io for
  `room host`. It never enters identity.
- `sig` — sha256 of the hosted blob (64 hex).
- `host` — where the blob is fetched from: `https://<host>/<sig>` (plain http
  on a loopback host). The host *inside* the sealed login is the truth. The
  slot holds only what a minted host can (letters, digits, `.`, `-`, a port,
  an IPv6 bracket) — never a scheme, a `%` escape or a path, so the host the
  link shows is the host it fetches from.
- `key` — a 256-bit key, base64url without padding (43 characters). It is
  derived from the login itself (99e3a0381), so one login always makes the
  same link.
  Its last character is never `-` or `_`, so a link never ends in something a
  chat's linkifier trims off.

Reading a link tolerates what a sentence or a chat leaves on its end (`.`,
`,`, an unbalanced `)` — the same `trimLinkTail` the `#meet=` link uses), and
accepts the fragment alone. A body longer than any link's (512 characters) is
refused before it is trimmed, so a crafted link cannot hang the tab.

## What the host holds

Ciphertext only, at most 4 KB, named by its own sha256: the login sealed with
core's **door seal** (`sealToSecret` in `hypercomb-core/src/core/content-cipher.ts`)
under the link's key — the `HCS1` header with the secret flag, then AES-GCM.
One wire format for every sealed atom: core's `needsSecret()` sees a swarm
blob for what it is. The login's one byte form is JSON
`{ v: 1, host, location, secret, code? }` in that key order; a blob that
opens to anything else is refused.

Opening fetches the blob (no credentials, no referrer, no cache-busting
parameters, a 4 KB cap and a deadline), checks sha256(blob) = sig **before
anything else**, then opens the seal. Every outcome is a reason, never a
throw:

| Reason | Meaning |
|---|---|
| `unreachable` | The host did not answer (or the transport failed). |
| `missing` | The host does not hold that blob (404/410, or an app's fallback page). |
| `too-large` | Over 4 KB. |
| `tampered` | The bytes do not hash to the link's signature. |
| `locked` | The key does not open it. |
| `malformed` | The link, the blob or the login inside is not one (a blob not sealed to a secret is not one). |

## On a front page

`room host <domain>`, typed inside the room, puts the room's sealed link on
the domain's front page as "Join the swarm", at the top
(jwize 2026-10-24: "the way to host a swarm should be a link on the home page
at the top of a domain it sets the credentials for the meet. That way we can
obfuscate the location and password").

- **The link rides the domain's signed card.** It is the `swarm` field of the
  `welcome:<zone>` card (`host-welcome.ts`), kept with the card's title and
  tagline. The worker writes the card into the page (`#hc-welcome`), and the
  shim draws the button above the domain's name.
- **One shape only.** The worker (`worker.js` `WELCOME_SWARM_RE`), the module
  and the shim each accept only an https page with a `#swarm=<sig>@<host>~<key>`
  fragment. A `#meet=` link, which spells the room and secret out, is never
  carried.
- **It is public by design.** Anyone who opens the page holds the link, and so
  holds the login. The link hides the room (the login's `location`), its
  secret, its access code and the page it opens on from the address bar and
  the page text. It does not hide where it meets: the meeting host is named in
  the link (`@<host>`) and in the swarm door it lands on, because a visitor's
  browser has to know where to fetch the sealed login. It does not keep any of
  them from a visitor who joins. That is the owner's choice for a front-page
  room.
- **Whose room it is.** The first of the zone's publishers, in order, who
  signs a card at all decides whether the page shows a room. A card without
  one, even an empty card, shows none, so a later publisher can never put a
  room on a page whose first publisher took theirs down. A publisher whose
  index or card the worker could not read, or whose held index does not
  verify, decides the same: no room, even if they may sign no card. Only the name falls through to a
  later card.
- **Taking it down.** `room host off <domain>` signs the card without it. A
  card's history is never deleted, so an older card still holds the old link:
  to close the room for good, change its secret.
- **Where it lands.** On the room's swarm door when its host has one, else on
  hypercomb.io. Never on the page the sharer happens to stand on.
- **It says what the page shows.** After signing, the word reads the page
  back and reports only what the page shows, for `on` and for `off` alike. The
  page is the domain's front page, else its door at `host.<domain>`: that is
  where the card answers when the apex is its own site (an origin host such as
  hypercomb.com), opens on a creation, or will not answer a hive's read. A
  door holds a publisher's index for a few seconds (`INDEX_EDGE_SECONDS`), so
  a read-back that does not yet show the card just signed reads once more
  after that window. No card seen is an answer only when both pages answered;
  otherwise the word names the page it could not check. A reason names only
  what the page shows: a room this card does not carry, the room the card
  carried before, or a door that does not read this card first. It never says
  whose room a page shows (one login is one link, on anyone's card), only
  whether this card carries it. `host.<domain>` typed as the domain names the
  domain: the door reads the zone's card.
- **A card it could not read is never written over.** If the current card
  cannot be read, nothing changes (the same holds for `hosts welcome`, which
  keeps a card's room when it changes the title).
- **The name stays the domain's.** A card that only carries a room never
  takes the page's name; the worker keeps the name from the card or the file
  that gives one, and adds the room beside it.
- **A coded room carries its code.** The sealed login includes the meeting
  point's access code, as every invite does; a visitor could not get in
  without it. Closing such a room means recycling the code as well.

## When it fails: the `#meet=` link

Publishing goes through an injected uploader (the merge wires host-sync's
signed PUT of one atom to the meeting host) and comes back `refused`,
`unreachable`, `no-host` or `malformed`. On any of them the caller hands out
today's `#meet=` link instead ([swarm-host.md](swarm-host.md)) — the meeting
still happens; only the secret is spelled out in that link.

## Privacy

- **Anyone who holds the link holds the login.** The link is the invitation,
  exactly as a `#meet=` link is. Share it where you would share the secret.
- **The host can never read an invite's link.** The key lives only in the
  `#fragment`, which a browser never sends to any server; the host serves
  bytes it cannot open. A front-page room is the owner-accepted exception
  ("On a front page"): its card carries the whole link, key included, in the
  public pool sign('welcome:<zone>'), so the card's host and anyone who reads
  that pool can open its login.
- A secret or an access code is never readable in any pool, resource, event,
  log or export, except through a link its owner put on a front page. Nothing
  derived from the secret goes on the EffectBus, and the module logs nothing.
- One login makes one sealed fragment: the key is derived from the login
  (99e3a0381), so the same room, code and page always seal to the same
  `#swarm=` fragment. The page it lands on can differ between `invite` and
  `room host`.
