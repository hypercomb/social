# Deep names: a child's own address

Status: **deployed 2026-11-19 (PR 198); the token was set 2026-11-25.** The
first live publish after the token held the index and attached nothing: the
naming ran last, after a hive's eight-second write had hung up, so it is now
asked for the moment the index is held (below).

> "opening it up on a child going left is child.hyperdex that way we have a new
> revision that is more focused" — jwize, 2026-11-18
>
> "we need the domains for development contexts." — jwize, 2026-11-18

## The name is the route

A host name is the workspace location at any depth, leaf first, like DNS
(`worker.js` `resolveSite`, 2026-10-31):

| Route in the hive | Address |
|---|---|
| `/knowledge` | `knowledge.jwize.com` |
| `/knowledge/hyperdex` | `hyperdex.knowledge.jwize.com` |
| `/knowledge/hyperdex/part` | `part.hyperdex.knowledge.jwize.com` |

Each address is its own origin, so each is its own isolated place in the
browser: its own storage, its own service worker, its own page.

## Why a deep name did not load

The zone's `*` DNS record and its certificate reach **one label**. That is a
rule of certificates, not of the host: a wildcard is the leftmost label and
stands for exactly one level, and `*.*` does not exist. So a two-label name
under `jwize.com` reached the worker's edge and failed its TLS
handshake (checked 2026-11-18).

## The free answer: the exact name, attached

Cloudflare gives a DNS record and a certificate, at no cost and with no add-on,
to any exact host name attached to a Worker as a **custom domain**. Proved on
`jwize.com` (Free plan) on 2026-11-18: a two-label name was
attached through the API, and answered over HTTPS about three and a half
minutes later with the worker's own "nothing published" page.

What was weighed and set aside:

- a certificate add-on with one wildcard per parent (about $10 a month per
  zone, 100 certificates of 49 names each);
- writing the route in one label (`knowledge--hyperdex`), which needs no
  certificate at all but is a spelling somebody has to learn.

## Publishing is the naming step

`worker.js` `attachDeepNames`, called when a signed index is accepted (and
when the same index is sent again):

- every **nested** lineage the index publishes, whose segments are DNS labels,
  on every wildcard zone that carries its publisher and opens it, is attached
  by its exact name;
- the name goes to the **forwarder** (`CLAIM_SCRIPT`, `hypercomb-hosts`), never
  to the main worker: a deploy of the main worker replaces what is attached to
  it (`hosts-forwarder.js` says why for claimed domains; the same holds here);
- a name already attached, to any script, is left exactly as it is, and a zone
  whose list could not be read attaches nothing;
- **nothing is detached.** A name whose lineage went away answers "nothing
  published", like any name under the wildcard;
- a write attaches at most eight names; the next write carries on;
- it never blocks or fails the publish.
- it is asked for **the moment the index is held**, before the bookkeeping that
  follows, and handed to `waitUntil`. A hive gives the write eight seconds
  (`bounded-fetch.ts` `FETCH_DEADLINE_MS`); noting a large index takes longer,
  and a caller that hangs up cancels the handler, so a naming step that came
  last was never reached.

A top-level lineage needs nothing: the wildcard already serves it.

## What the operator sets up, once

1. **The forwarder.** `npm run deploy:hosts` in `hypercomb-relay/blossom-worker`
   (`wrangler.hosts.toml`). Done on the live account, 2026-11-18.
2. **The token.** The secret `CLAIM_API_TOKEN` on the main worker, with Zone
   Read and Workers Scripts Edit on the account (and Zone Edit, DNS Edit and
   Workers Routes Edit if the host also takes domain claims). `CF_ACCOUNT_ID`
   and `CLAIM_SCRIPT` are already vars. Without the token no call is made.
3. **The worker.** A deploy from a clean copy at the merged commit, staged and
   checked, as every worker deploy is.

## Not built

- **Telling the person the address is on its way.** A new name takes a few
  minutes to get its certificate; nothing says so yet, and a visit before then
  fails in the browser.
- **Detaching.** No count limit for attached names is documented; when one is
  met, retired names will need removing.
- **Entrances on a deep name** (`zone-door.ts` `boundLineage`): the hive still
  reads only the first label there.
- **The directory** lists one-label names only; a child is a workplace, not a
  plate on the front door.

## The hive side

The route reads parent first (`knowledge/hyperdex`); the address reads child
first (`hyperdex.knowledge.jwize.com`), each name inside the one to its right.
jwize, 2026-11-19, asked whether both should read left to right: no — the zone
has to stay on the right, so child first is the only order that is consistent
all the way across, and `knowledge.hyperdex.jwize.com` would sit under the
unrelated top-level place `hyperdex`.

- `zone-door.ts` `deepNameHost(zone, key)` is the name, when every segment of
  the key already is a DNS label.
- `deep-name-live.ts` says whether the name ANSWERS yet: one opaque request,
  remembered for the page, asked again at most once a minute while it fails.
- The Staging list (`publish-status.drone.ts` `#addressRow`) gives a nested
  place its own name once it answers, and until then keeps
  `<top>.<zone>/<the rest>`, which shares the top place's origin. A signed own
  address always wins.

Publish results, door links in copy, and the tree view's door still use the
path form.

`managedSiteZone` (essentials) and `siteDoorZone` (shim) find the zone under a
deep name from the site's own route; `putHiveManifest` climbs past each
read-only site to the zone root.

On the live account, 2026-11-19: `hyperdex.knowledge.jwize.com` is attached to
the forwarder by hand and answers over HTTPS ("nothing published" until
`knowledge/hyperdex` is in the signed index). A first test name, attached the
wrong way round, was removed. Cloudflare itself refuses to attach a name that
is already attached elsewhere unless the call says to override, so the "left
exactly as it is" rule holds on both sides.
