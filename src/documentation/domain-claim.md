# Claiming a domain — one word

**Status:** BUILT 2026-10-01 (jwize: "make it so: claim domain with one
command"). Live once the operator has set the claim token (below) and the
worker, the forwarder and an essentials revision are deployed.

## What the participant does

```
domain claim inspiredbyhumans.org
```

1. The hive asks its host for the domain and answers with two nameservers.
2. The participant sets them at their registrar. That change is the proof
   that they control the domain; nothing else is asked of them.
3. The hive keeps checking. When Cloudflare sees the nameservers, the domain
   is theirs: its apex is their front door, every `<name>.<domain>` is a place
   they can switch on in the Publish panel, and nobody else can publish there.

The key that claims is the key that publishes, so claim from the hive you
publish from. Keys live per origin.

## What the operator does

Once, ever: create a Cloudflare API token and store it on the worker.

| Permission | Why |
|---|---|
| Zone · Zone · Edit | create the claimed zone, read its status, ask for an activation check |
| Zone · DNS · Edit | the apex and `*` records |
| Zone · Workers Routes · Edit | route the domain to the forwarder |

Resources: all zones in the account. Then, from `hypercomb-relay/blossom-worker/`:

```bash
npx wrangler secret put CLAIM_API_TOKEN --config wrangler.pluginthematrix.toml
```

Nothing per participant: no binding to edit, no redeploy, no `connect`.

## How it works

### The forwarder

Every `wrangler deploy` replaces ALL of a script's routes (wrangler's own
comment: "PUT will delete previous routes on this script"). Routes a claim
adds to the main worker would vanish on its next deploy. So claimed domains
route to a second script, `hypercomb-hosts`, which only hands the request to
the main worker over a service binding:

```js
export default { fetch: (request, env) => env.HOST.fetch(request) }
```

Its config (`wrangler.hosts.toml`) declares no routes, so deploying it never
touches them. It is deployed once and changes only if forwarding does; the
main worker keeps deploying as it always has. The request URL survives the
binding, so the main worker resolves the claimed hostname exactly as if it
were routed there itself.

### The worker

**`POST /claim`** — NIP-98 signed (method `POST`, `u` = the URL, and a
`payload` tag holding the sha256 of the exact body, so a lifted header can
claim nothing else), body `{"domain":"<name>"}`. Taken on a host's write face
(`content.<zone>`), never on a published site, like every other write.

| Case | Answer |
|---|---|
| no `CLAIM_API_TOKEN` or `CF_ACCOUNT_ID` | 503 — this host takes no claims |
| not a domain name | 400 |
| the domain is, is under, or holds a zone in `SITE_BINDINGS` / `SITE_OPERATORS` | 409 — already served here |
| the zone exists in the account and no claim made it | 409 — ask this host's operator (a claim never adopts a zone) |
| this key already holds the claim | 200 — the claim as it stands (idempotent) |
| another key holds an ACTIVE claim | 409 — claimed |
| another key holds a PENDING claim, not expired | the claim becomes CONTESTED: neither key is bound until the operator decides |
| another key's pending claim is older than 7 days | it lapses; this key takes the claim and the zone it made |
| this key already has a different claim pending | 409 — one pending claim per key |
| `CLAIM_PENDING_MAX` (default 25) pending claims already | 429 — try later |
| the domain is under or above another claim | 409 — a claim already covers this name |
| otherwise | the zone is created (`type: full`, `jump_start: true`) — 200 `{domain, status:'pending', nameservers}` |

`jump_start` is Cloudflare's scan of the common records (mail among them), not
a transfer. What it misses stops answering once the nameservers move, and the
participant cannot add it back: the zone lives in the host's account. Anyone
with mail on the domain should check it the day the claim goes active.

Before a lapsed or contested claim changes hands, the worker asks public DNS
where the domain is delegated: if it already points at the zone's
nameservers, the holder has proved control and keeps it. The pending cap
counts every waiting claim (contested and lapsed too), and at the cap a new
claim prunes the longest-lapsed claim whose zone never activated.

**`GET /claim/<domain>`** — public. Answers `{domain, status, nameservers}`
(`pending`, `active` or `contested`, never the key; signed with NIP-98 GET it
adds `mine`). It asks Cloudflare at most every 5 minutes while pending and
every hour once active, so an anonymous caller cannot spend the token's rate
limit; between looks it answers the stored record. While pending it asks for
an activation check at most once an hour. The first time it reads the zone
active, it WIRES the domain,
idempotently: proxied `AAAA 100::` records for the apex and `*` unless a
record already answers that name (an existing A/AAAA/CNAME is switched to
proxied instead), and the routes `<domain>/*` and `*.<domain>/*` to the
forwarder unless they are there already (a route pointing at another script
is taken over only for a domain no operator serves). Then the claim is
`active`. Every look after that re-asserts the records and the routes, so
wiring lost to anything comes back within the hour.

**The record** is the member `sign(<domain>)` of the pool
`sign('host:claims')` in the content bucket:
`{v:1, domain, pubkey, zoneId, nameservers, status, claimedAt, activatedAt?,
contested?:[pubkeys], checkedAt?}`. The pool is not public: it is never
listed, and `GET /claim/<domain>` is the only reading of it.

**The binding.** Each active, uncontested claim is a binding exactly as an
operator would have written it:

```json
{ "<domain>": { "title": "<domain>", "lineage": "<domain>",
  "publishers": [{ "pubkey": "<claimant>", "primary": true }], "frontDoor": true } }
```

so the apex is the front door (the shim host card), every first-level
`<name>.<domain>` is an implicit site whose only publisher is the claimant,
and `content.<domain>` is a write face. Claims are merged into the bindings
the router reads (beside the operators' signed records) and held for a
minute per isolate; a failed read keeps the last view and never fails a
request. An operator's binding or signed record always wins, and a claim
that overlaps one is left out. A claimed domain appears in its own
directory (`/publications.json` on that domain), never in the operator's.
A claim does not admit its key to the host's AI, which spends the
operator's money.

### The hive

`domain claim <domain> [@<host>]` — the participant's word: the model channel
is refused it (the queen has no `machine` block), though the local bridge's
operator door can still say it. The host defaults to the public content
host; `@<zone>` is read as that zone's write face, `content.<zone>`.

- **pending** — a toast names the two nameservers, which are also copied to
  the clipboard when the browser allows it. The hive checks every minute
  while it is open, and again at every boot until the claim settles (kept in
  `localStorage` under `hc:domain-claims`; 7 days, then it stops asking).
  Saying the word again checks at once.
- **active** — the public reading never names the key, so before saying
  "yours" the hive asks again with the signed POST, which answers only the
  holder. Then a toast: the domain is yours. The domain is added to the
  hive's Hosts (`hosts:add`), so the Publish panel shows it as a switch.
- **contested** / **refused** — a toast with the reason.

## Contested and lost claims

A contest lapses 7 days after it began. Before that, the operator decides it
by editing the record (`sign('host:claims')/sign(<domain>)` in the content
bucket): set `pubkey` to the winner and drop `contested`. A participant who
lost their key is moved the same way, by setting `pubkey` to their new key.
Deleting the record does NOT free the domain: the zone stays in the account,
and a claim never adopts a zone. Releasing a claim, and moving a claim to
another key, are not words yet.

## Related

- [hosting-from-a-machine.md](hosting-from-a-machine.md) — the three ways to run a host
- [deployment-stages.md](deployment-stages.md) — sharing requires hosting
- `hypercomb-relay/blossom-worker/scripts/connect-domain.mjs` — the operator's
  manual path, still used for domains the operator runs themselves
