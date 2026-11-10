# Public Content Endpoint — the CDN tier, speaking Blossom over R2

**Writes go to the zone root, and a refusal is readable (2026-11-10).** Every
site under a zone is read-only: a write there gets `405` with an `X-Reason`
("published Core hosts are read-only", "the host door is read-only — write at
the zone root"). The browser's `OPTIONS` preflight is answered on every host,
so that refusal reaches the hive as a status and a reason, never as a network
error it can only call "host unreachable". The hive's index write
(`putHiveManifest`, `sharing/hive-pointer.ts`) carries a write refused that
way from a site to its zone root once; any other failure stays as it was.

**Status: DEPLOYED 2026-07-09, smoke-tested live.** Code:
`hypercomb-relay/blossom-worker/` (worker.js + wrangler.toml + package.json).
Live at **`https://content.jwize.com`** (legacy since 2026-10-03 — writes and
index reads now go to a zone root such as `https://pluginthematrix.com`, which
serves the same bucket; this face keeps answering for installs that have not
updated) and
**`https://pluginthematrix.io`** (legacy-client alias — every deployed
client already probes it as a byte fallback, so old installs get public
reads with zero updates; zone moved from DreamHost NS 2026-07-09). Both
are `routes` custom domains in wrangler.toml; workers.dev is disabled. Served blobs carry `Content-Security-Policy:
sandbox` + `X-Content-Type-Options: nosniff`, so uploaded HTML/SVG renders
inert — strangers' bytes never act under the domain's authority. R2 bucket `hypercomb-content`, KV
`hypercomb-grants` (id `11e24dcda743413ab24397e936671641`), auto-grant 100MB /
pubkey / 90d. Smoke verified end-to-end: 401 unauth PUT · 200 signed BUD-02
upload (auto-grant minted) · GET /<sig> byte-identical with
`ETag:"<sig>"` + `immutable` cache header · 401 tampered body · 404 unknown
sig. First blob: `bcf0ecf3…8eb526` ("hypercomb first light").

## Doctrine

Swarms resolve around hosts; **public content posts to the CDN**. A host
(relay.js, consent-hosting.md) is a participant's living edge — it captures,
packages, serves, and can say no. The CDN tier is dumber and wider: a
Cloudflare Worker over an R2 bucket of sig-named blobs, edge-cached
worldwide, for content that is **already public**. Private and group content
never lands here — it stays host-tier, behind the consent handshake.

Content-addressing is what makes a dumb tier safe: every byte a reader pulls
is sha256-gated at the client (`ContentBroker.#verifyBytes`), so the bucket
can hold strangers' blobs without vouching for any of them. An abuser can
waste granted quota — never corrupt a reader.

## Why Blossom

Hypercomb's flat `GET /<sig>` heap and Blossom BUD-01's `GET /<sha256>` are
the *same URL* — a signature is a sha256 of the bytes. So the endpoint speaks
both dialects natively, on their natural routes, and any Blossom client can
read (and, with a grant, write) this bucket with zero Hypercomb code.

## Wire shapes accepted

| Route | Auth | Checks | Responses |
|---|---|---|---|
| `GET/HEAD /<sig>` | none | 64 lowercase hex only | 200/206 (Range per BUD-01), 304 (If-None-Match), 404 plain, 416. `Cache-Control: public, max-age=31536000, immutable`, `ETag: "<sig>"`, Content-Type from R2 metadata else `application/octet-stream` |
| `GET/HEAD /<sig>?held` | none | as `/<sig>` | a hit answers exactly as `/<sig>`; a miss answers **204** (no body, `Cache-Control: no-store`, `X-Reason: not held`) instead of 404. The same flag on the signed index, `GET /<sign('hive:indexes')>/<pubkey>?held`, answers a missing index 204. relay.js answers both the same way. See *The held probe* below |
| `PUT /<sig>` | NIP-98 (kind 27235), `Authorization: Nostr <base64-event>` | schnorr sig + event id; `u` tag == full request URL; `method` tag PUT; `created_at` ±60s; `payload` tag verified **when present**; then always `sha256(body) == <sig>` | 201 stored · 200 already held (no rewrite, no quota) · 400 hash mismatch · 401 auth · 403 quota |
| `PUT /upload` | Blossom BUD-02 (kind 24242) | schnorr sig + event id; `t` tag `upload`; some `x` tag == `sha256(body)`; `expiration` in future; `created_at` not in future | 200 blob descriptor `{url, sha256, size, type, uploaded}` (existing or fresh) · 401 · 403 quota |
| `HEAD /upload` | Blossom BUD-06 preflight | valid 24242 auth whose `x` tag matches `X-SHA-256`; `X-Content-Length` vs quota; nothing stored, no grant minted | 200 would-accept · 400 malformed headers · 401 · 403 grant missing/expired · 413 over quota. Verdict rides `X-Reason` (HEAD has no body) |
| `OPTIONS *` | none | CORS preflight | 204, permissive (GET/HEAD/PUT + Authorization/X-SHA-256/X-Content-Length/Range) |

Both write dialects share the two independent guards from the relay's writer
auth (protocol-spec §21.12): content-integrity (`sha256(body)` must equal the
declared sig — always computed server-side via `crypto.subtle`, never
trusted) and writer-authorization (schnorr-verified nostr event). Idempotent
by construction: same sig == same bytes, so an existing object returns 200
without a rewrite. Bodies are never logged or echoed.

### The held probe (2026-11-09)

A browser prints every non-2xx answer as a red console error, and "do you
hold this?" is asked of every host on every publish: the drain's pre-upload
check, the share gate, the receipt audit, publish status, the content
broker's read on a miss, and every read of a publisher's signed index (a home
relay at a domain's apex keeps none by design). jwize, 2026-11-09: "we can't
afford to ever have any errors popping up." So the question has its own
spelling: `?held` on the address. A miss answers 204; a hit is unchanged. A
query, not a header, so the probe stays a simple request with no preflight.
A host that does not know the flag ignores it and answers 404 as before, so
the hive asks it of every host and reads 204 and 404 as the same miss
(host-sync.service.ts `#probe`, hive-pointer.ts `fetchHiveIndex`, which also
remembers an index miss for five minutes).

**A pool's listing is asked the same way.** `GET /<sign(meaning)>/?held`
answers "no pool at this address" 204 instead of 404, on the worker, relay.js
and the native host (which answers every miss at or under a signature 204
when flagged); a listing that exists answers exactly as without the flag.
Every word, name and record is an address a hive derives and asks of every
host it follows, so that miss is the common answer: three names over twenty
hosts was sixty console errors. The hive asks through ONE function,
`sharing/pool-listing.ts` (`askPoolListing` / `readPoolListing`): it adds the
flag, asks the same host the same address once at a time, and remembers a
miss (204, 404 or 410) for five minutes. A new listing read goes through it —
never a bare `fetch` of `/<pool>/`.

**No route can forget the flag.** Each host shape also applies the rule once,
at its outermost answer (worker `quietMiss`, relay.js `quietMisses`, the
native host's `resolve_with`): any flagged GET or HEAD that would leave as a
404 leaves as a 204, with what the 404 said in `X-Reason` (exposed to
cross-origin readers). The readers that try two URL shapes for one atom
(`readBySig`, `readFromHost`: `/<sig>` and `/content/<sig>`) and the package
pool walk (`hypercomb-runtime/src/host-packages.ts`, which reads the reason
to tell "no pool on this host" from "not this base") ask with it.

**A relay says which code it is running.** A fix to a host changes nothing
until the host runs it, and a relay is a long-lived process: on 2026-11-09
the one behind jwize.com answered the old way for hours after the fix was
committed. relay.js takes the signature of its own code at start
(`hypercomb-relay/code-stamp.js`: the entry file and every local file it
imports) and says it in its NIP-11 document: `code`, `started_at`, and
`stale: true` once the files on disk no longer hash to it. `npm run
relay:check` compares a relay with the disk and fails when it is behind;
`npm run build:essentials` runs it as a warning every time. Started with
`--restart-when-stale` under a supervisor that restarts it, the relay leaves
on its own once the new code has settled and parses.

The bucket is **flat from birth** — no legacy typed-dir layout ever lands in
R2, so unlike relay.js there is no `__x__` fallback probing on reads.

### The question before the upload (2026-11-09)

jwize: "a server is not eligible for serving something and it still tries."
A hive had no way to learn whether a host takes ITS key except to send an
upload and read the refusal — real bytes on the wire, a red 401 in the
console, and (on the day) 1,042 atoms queued for a host that was never going
to take them. So the question has its own spelling:

`GET /<sig>?takes`, signed as the upload would be (NIP-98: method `GET`, `u` =
this exact URL; the carried `alive` beacon when the host said not-live). The
answer is **always a 200**, `Cache-Control: no-store`:

- `{"takes":true}` — this key's atom would be taken here;
- `{"takes":false,"status":<code>,"reason":"<words>"}` — the code and the
  words the upload itself would get (401 `not-live: …`, 403
  `participants-closed`, 409 for a reserved address, a missing or bad token).

The host runs the upload's own checks, in the upload's own order, up to the
point where bytes are read (relay.js `tryWriteContent`; worker `takesSig`,
whose `admit` only reads). Nothing is stored, granted or charged.

The hive asks once per host, before the first upload to it
(host-sync.service.ts `#askTakes`; the first upload to a host already goes
alone), and again only after an upload is refused for who sent it. A refusal
is classified by the same classifier as an upload's, so the backoff, the
status line and the kept "not here" pause are unchanged — the host is simply
never sent the bytes. A host that does not know the flag answers the read it
looks like (`&held` keeps that miss quiet), which says nothing, and the
upload goes and is answered as it always was.

## Quota — the auto-grant guest list

KV namespace `GRANTS`, keyed by pubkey → `{ quotaBytes, usedBytes,
expiresAt }`. Policy via env vars:

| Var | Default | Meaning |
|---|---|---|
| `AUTO_GRANT` | `1` | first valid upload from an unknown pubkey mints a grant |
| `DEFAULT_QUOTA_BYTES` | `104857600` (100 MB) | per auto-granted pubkey |
| `GRANT_TTL_DAYS` | `90` | grant lifetime |

- Existing-object PUTs consume nothing (the bytes are already here).
- Under `AUTO_GRANT`, an **expired** grant re-mints fresh, same as an unknown
  pubkey — the guest list forgets you, it doesn't ban you. With `AUTO_GRANT`
  off, missing and expired both 403 with a plain-language body.
- Grants are minted only when bytes actually land — preflight never mints.
- KV is last-write-wins; racing uploads can under-count for a moment. Fine
  for a throttle; the ceiling holds on the next read.

## Deliberate omissions

- **BUD-02 `GET /list/<pubkey>` and `DELETE /<sig>`** — skipped. Both need an
  ownership index (who uploaded what), and content-addressed blobs may have
  *many* uploaders — the same sig can be pushed by anyone who holds the
  bytes, so "owner" is a later, deliberate decision, not a free column.
- No per-upload size cap beyond the quota itself (the platform's request
  body limit is the hard backstop).

## Queued next (agreed 2026-07-09)

- ~~**`GET /grant` status endpoint**~~ — **SHIPPED 2026-07-09.** NIP-98
  (method tag GET, u = the /grant URL); a pubkey reads ITS OWN
  `{ state: none|expired|active, quotaBytes, usedBytes, expiresAt }`,
  no-store, never mints on read (`state:'none'` reports what an auto-grant
  would give). Verified live: none → 25-byte upload → active/usedBytes:25.
  Client meter in the share flow ("2.1 MB of 100 MB") consumes this.
- **Paid tier** — a payment (BUD-07 shape, lightning) writes a fatter,
  longer, pinned grant into the same KV; expiry-sweep cron worker evicts
  lapsed free-tier blobs (graceful: mesh renewal nudge first). Grants are
  leases; eviction is safe because OPFS holds truth and readers cascade.
- One-action sharing stays doctrine: the participant only ever clicks
  share — the multi-target drain fans out to self-host and/or public
  endpoint by receipts; "where bytes live" is never a user decision.
- **COLLECTIONS ARE NEVER-PUBLIC (Jaime, 2026-07-09):** collections are
  curation — sensitive by nature — and join the structural never-public
  class (clipboard, settings, presence, secrets): the publish walk never
  enumerates collection roots, markPublic refuses their lineages, and
  share-tile/share-branch actions don't render in collection contexts.
  Tiles a collection REFERENCES may be shared from the main tree; the
  curation itself never travels without a future deliberate
  consent-shaped feature. (Today they're safe by default-off flags;
  this doctrine upgrades default to structural — guards land with the
  polish pass.)
- **BYTES BEFORE BROADCAST (Jaime, 2026-07-09):** a hive must be posted
  and receipted at its tier's shelf BEFORE any share announcement
  propagates — public hive → public endpoint first, then swarm shares/
  invites/meeting-places; private/group hive → its swarm's anchor host
  first, NEVER the public endpoint. An announcement is a proof, not a
  promise: "content isn't reachable" becomes structurally impossible.
  Share UX shape: mark → drain → receipts ("proving… 12 of 37") →
  announce arms only on completion.
- **THE WORLDVIEW ICON IS THE SWITCH (Jaime, 2026-07-09):** one contract
  worn by the TWO existing scoped controls — share TILE (closure=false:
  proves the tile's own layer + resources, never children) and share
  BRANCH (closure=true: proves the whole subtree) — each with three
  honest states: off / proving… / on-and-proven (receipts arm it;
  "proving N of M" counts that scope's closure). Existing exclusivity
  (branch-on clears the tile flag and vice versa) carries over. OFF retracts per layer physics: mesh slots republish as EMPTY
  payloads immediately (#wipeSubtree, already built); the shelf can't be
  overwritten (content addressing — the integrity guarantee), so bytes
  go DARK instead: pushes stop, announcements stop, trails evaporate,
  the lease lapses. True prompt removal = the one legitimate future
  DELETE: author-requested eviction, the uploader's own signed key
  asking its own bytes off the shelf.

## Deploy checklist (in order)

1. `wrangler r2 bucket create hypercomb-content`
2. `wrangler kv namespace create GRANTS` → paste the id into wrangler.toml
3. Card on file in the Cloudflare account (R2 requires a billing method even
   inside free tier)
4. `wrangler deploy` from `hypercomb-relay/blossom-worker/`
5. Attach the custom domain in the dashboard (e.g. `content.hypercomb.io/*`)
   — Workers → hypercomb-content → Domains & Routes
6. **Then** add the domain to the client fallback list — a separate,
   deliberate client change; do **not** bundle it with the deploy.

## Scope

PUBLIC content only. The consent-hosting handshake (host tier) remains the
path for anything a participant hasn't published to the world: the CDN tier
has no consent surface, no revocation toast, no host identity — by design.
