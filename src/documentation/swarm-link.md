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

- `appOrigin` — the page the sharer stands on. It only says where the link
  lands; it never enters identity.
- `sig` — sha256 of the hosted blob (64 hex).
- `host` — where the blob is fetched from: `https://<host>/<sig>` (plain http
  on a loopback host). The host *inside* the sealed login is the truth. The
  slot holds only what a minted host can (letters, digits, `.`, `-`, a port,
  an IPv6 bracket) — never a scheme, a `%` escape or a path, so the host the
  link shows is the host it fetches from.
- `key` — a fresh 256-bit key, base64url without padding (43 characters).
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

## When it fails: the `#meet=` link

Publishing goes through an injected uploader (the merge wires host-sync's
signed PUT of one atom to the meeting host) and comes back `refused`,
`unreachable`, `no-host` or `malformed`. On any of them the caller hands out
today's `#meet=` link instead ([swarm-host.md](swarm-host.md)) — the meeting
still happens; only the secret is spelled out in that link.

## Privacy

- **Anyone who holds the link holds the login.** The link is the invitation,
  exactly as a `#meet=` link is. Share it where you would share the secret.
- **The host can never read it.** The key lives only in the `#fragment`,
  which a browser never sends to any server; the host serves bytes it cannot
  open.
- A secret or an access code is never readable in any pool, resource, event,
  log or export. Nothing derived from the secret goes on the EffectBus, and
  the module logs nothing.
- Every seal takes a fresh key: sharing one login twice makes two unrelated
  blobs, so a blob says nothing about who else meets where.
