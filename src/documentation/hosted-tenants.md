# Hosted tenants — the paid on-ramp

**Status:** DESIGN, 2026-10-22. Nothing here is built unless a row says so.
Step 1 (head-only reads) BUILT the same day, behind `HEAD_ONLY`.

jwize, 2026-10-18: *"create a mesh on cloudflare that is shared but securely
have a multi tenant architecture… Then charge for hosting to get people
initiated and move them along to host their own servers after."* And: *"Only
the head identifier is exposed; we should be careful where the old signature
can be systematically cached by an attacker."* 2026-10-22: *"I want to be able
to help and streamline the setup of hosts so I can have many people get
started on the cloudflare network and charge subscriptions for hosting swarms
and publishing."*

## The ladder

| Rung | Who runs it | Pays | State |
|---|---|---|---|
| 1. Try it | the desktop app — a quick tunnel to this computer | free | BUILT, proven live 2026-10-21 (`hypercomb-client/app/src/tunnel.rs`) |
| 2. **Hosted** | the operator — one shared Cloudflare network, many tenants | **subscription** | this document |
| 3. Your own | the tenant — their server, or this computer on their own domain | nothing to the operator | tunnel BUILT; own-domain last hop unproven (below) |

Rung 2 is the product. Rung 1 shows someone what a host is in seconds; rung 3
is the way out, and the way out must always work — a tenant who can leave
with everything is a tenant who trusts the network enough to stay.

**Why rung 2 and not straight to rung 3.** Rung 3 needs a Cloudflare account,
a sign-in, DNS records and a machine left running. The 2026-10-22 live test
found the worst trap: a Worker route on the domain (`*.jwize.com/*`) answers
every name before a tunnel can, and nothing says so. On rung 2 the operator
owns every route, so that trap cannot happen.

## What a tenant gets

1. **An address the moment they sign up** — `<name>.hypercomb.com`, or the
   same under any zone the operator offers. Their hive's door opens there.
2. **Their own domain, when they want it** — one step, no Cloudflare account
   of their own (below).
3. **Publishing** — their pages served from the edge, read by anyone.
4. **Swarms** — always-on meeting points for their rooms, so a swarm does not
   need their computer awake.
5. **The way out** — move to rung 3 with one act, keeping every signature.

## What already exists (reused)

Inventory of `hypercomb-relay/blossom-worker/` as of 2026-10-22.

| Need | Already there | Where |
|---|---|---|
| Any subdomain is a site | a first-level label under a bound zone is an implicit site; `SITE_BINDINGS` / `explicitDoors` for named ones | `worker.js` `resolveSite` (~184-220), bindings ~96-150 |
| Zones | `*.hypercomb.com`, `*.pluginthematrix.com`, `*.realones.online`, `*.cafesociety.buzz`, `*.jwize.com`, `*.pointblanksolutions.ca` | `wrangler.pluginthematrix.toml` |
| Signed writes | NIP-98 (kind 27235, 60 s skew), Blossom kind 24242, every body checked against its sig | `worker.js` `verifyNip98` (~3377) |
| A tenant's key owns their domain | domain claim: the claiming key is the publishing key; the zone root is the write face | `worker.js` `writeClaim` (~4437); `documentation/domain-claim.md` |
| Their own domain | `domain claim <domain>` — the worker creates the zone in the operator's account, the tenant sets two nameservers, routes go to the forwarder | `worker.js` claim (~4290, ~4520-4600); `hosts-forwarder.js`, `wrangler.hosts.toml` |
| Storage allowance | `host:grants` ledger, per-key bytes and expiry | `worker.js` (~3405-3570); `DEFAULT_QUOTA_BYTES`, `PEOPLE_QUOTA_BYTES`, `GRANT_TTL_DAYS`, `AUTO_GRANT` |
| Always-on swarm meeting point | a Durable Object in the meet worker, reached by service binding | `MEET_OPEN` (`wrangler.pluginthematrix.toml` ~185; `worker.js` ~4986) |
| Storage | R2 `CONTENT` (`hypercomb-content`), KV `HIVES`, `ASSETS` | `wrangler*.toml` |
| Head-aware pieces | the hive index maps a lineage to its head; packs are built for the head only | `worker.js` ~3901-3987 |

So the worker already **is** multi-tenant in the way that matters most:
many keys, each owning its own sites, writing into one deduplicated pool.
What it lacks is an **account** — a tenant who paid, what they paid for, and
what happens when they stop.

## What is new

### 1. The tenant record

One record per tenant, in its own pool of meaning on the host
(`host:tenants`), keyed by the tenant's public key:

```json
{ "pubkey": "<hex>", "plan": "<plan sig>", "sites": ["<name>.hypercomb.com", "example.org"],
  "standing": "active" | "grace" | "lapsed", "until": 1793000000 }
```

The plan is a signature of a plan resource (its allowance — below), so
changing a plan's terms is a new plan, and a tenant on the old one keeps it
until they move. The tenant record grows out of the grants ledger: a grant
becomes "what this tenant's plan allows", instead of a free 100 MB that any
new key can mint. That closes the hole recorded 2026-10-11 (new key = new
free quota).

The record holds no email, name or card. Billing identity lives with the
payment provider; the record holds only the provider's opaque customer id
if one is needed to match a webhook.

### 2. Sign-up, in the app

Per `feedback_automate_so_people_self_serve`: no terminal, no dashboard.

1. In the hosts window: **Host with Hypercomb** → pick a name → see the price.
2. The checkout page opens (the payment provider's own page — the app never
   sees a card).
3. The provider's webhook reaches the worker; the worker writes the tenant
   record and binds `<name>.<zone>` to the tenant's key.
4. The app sees the site come alive and says so — the same "Check it" the
   tunnel walkthrough already does (fetch the address, look for `hc-door`).

The name is taken the moment the checkout starts (held for 30 minutes), so
two people cannot pay for the same name.

### 3. Their own domain

Two ways; recommend the first as the default.

| | Domain claim (BUILT) | Custom hostname (Cloudflare for SaaS) |
|---|---|---|
| Tenant does | sets two nameservers at their registrar | adds one CNAME at their DNS |
| Their other records (mail, etc.) | move into the operator's account with the zone | untouched, stay where they are |
| Apex (`example.org`) | yes | needs CNAME flattening or a provider that supports apex aliases |
| Operator cost | a zone per tenant | per-hostname fee past the free allowance |
| Cloudflare account for the tenant | none | none |

Nameservers hand the operator the tenant's whole domain, mail included —
right for someone starting fresh, wrong for a business that already has
email on its domain. Custom hostnames leave everything else alone. Offer
both, defaulting to the claim for a new domain and the CNAME for one already
in use (the app can tell: a domain with MX records is in use).

### 4. Head only

Today `GET /<sig>` returns any stored signature, so every old version a
tenant ever published stays readable by anyone who saved its address, and an
attacker who walks old layers can harvest them systematically. Rung 2 must
close this before it takes money, because a paying tenant's edited-out
content is the thing they are paying to keep private.

**BUILT 2026-10-22, off until `HEAD_ONLY = "1"`** (`worker.js`, "head only").

The heap is shared by everything — packages, pools, room members, swarm
tiles — so the gate is not an allowlist of reached signatures (that would
refuse every byte that was never in a published head). It is a **withdrawn
mark on what a head move left behind**:

- When a publisher's signed index moves, the worker walks what the old heads
  reached and what the new heads reach (every 64-hex in a JSON member is a
  reference; large members are reached, not read). What only the old heads
  reached, and only this publisher put here, is marked `withdrawn` on the
  object. Its bytes stay — the publisher's history and the way out need them.
- A withdrawn object answers exactly as a miss (`404 sig not held`), so
  nothing tells it apart from bytes never held. A landing pack built for a
  withdrawn head goes with it.
- **Never withdrawn:** bytes another key also uploaded (`shared`), bytes
  stored before claims existed, anything a current head still reaches.
- **Served again** when reached again (a revert), or uploaded again by anyone.
- **The owner's signed read** (NIP-98 GET) still gets it, so undo and time
  travel keep working for them.
- **Complete or absent:** a walk that runs out of its read budget (2000
  members) withdraws nothing.
- **Bytes one key uploaded and another key's page uses:** each walk marks
  what the publisher's heads reach as shared when another key put it here.
  Before turning the flag on, the operator walks every held index once —
  `POST /reach` (operator NIP-98, one index per call, `{after}` cursor) — so
  no page loses bytes it borrowed.
- **Edge cache:** the worker never puts content into the edge cache (only the
  hive index, for seconds), and Cloudflare does not cache a Worker's own
  answers, so a withdrawn signature stops answering at once. A browser that
  already fetched it keeps its own copy — it already had the bytes.

**To turn it on:** deploy, run `POST /reach` until `next` is null, then set
`HEAD_ONLY = "1"` and deploy again. Withdrawal starts with the next head
move; history from before the flag is not walked back.

### 5. Swarms

The meeting point is already a Durable Object. A plan sets how many rooms a
tenant may keep open and how many people a room holds at once — concurrent
counts, the only kind of number this project keeps (`feedback_no_tracking_
only_concurrent_counts`). A room over its limit refuses the next joiner with
a plain message; nobody is recorded.

### 6. Plans and the money

Bill by **allowance**, never by usage records. A plan is:

| Allowance | Measured as |
|---|---|
| stored bytes | the sum of the tenant's reached signatures — a size, not a log |
| sites | how many names and domains |
| swarm rooms open at once | a concurrent count |
| people per room | a concurrent count |
| AI tokens per day (if host AI ships) | the existing `AI_DAILY_TOKENS` ceiling, per tenant |

No per-request log, no bandwidth meter tied to a person. Cloudflare does not
bill R2 egress, so bandwidth does not need to be metered to be affordable.
A tenant over a byte allowance cannot publish more until they free space or
move up; nothing they already published goes dark.

Payment provider: Stripe Checkout + webhooks is the shortest path (a hosted
checkout page, a signed webhook to the worker, a customer portal for cancel
and card changes, all without the app touching payment data).

### 7. Lapse and the way out

- **Grace:** a failed payment gives 14 days at full service and a notice in
  the hosts window.
- **Lapsed:** writes stop; reads keep working for another 30 days, so the
  tenant's visitors are not stranded while they decide.
- **Leaving:** **Move to my own server** in the app downloads everything the
  tenant's key wrote (every head and its reach set, plus their history) into
  their hive, then walks them into rung 3. Their signatures do not change, so
  every link anyone holds still resolves wherever they host next.
- **Never deleted while shared:** bytes reached by another active tenant stay.

## Rung 3, the open item

The own-domain tunnel works up to its last hop (live 2026-10-22 on
`tunnel-test.jwize.com`: sign-in reused, tunnel created, name routed, set up
twice without change, connected). It fails when a Worker route covers the
name. Before rung 3 is offered as the way out:

- the app checks, before routing, whether a Worker route answers the name,
  and says so in plain words;
- for an operator-owned zone, the operator adds a Worker-less route for that
  one name (the more specific route wins).

## Order of work

1. **Head-only reads** in the worker — it protects the content already there,
   paid or not.
2. **The tenant record + plans**, replacing the open grants as the source of
   allowance (behind a flag; `AUTO_GRANT` stays as it is until jwize says).
3. **Sign-up in the app** with Stripe Checkout and the webhook, ending at a
   working `<name>.hypercomb.com`. This is the smallest thing someone can
   pay for.
4. **Own domain** — wire the existing claim into the hosts window; add custom
   hostnames.
5. **Swarm allowances** on the meeting point.
6. **Move to my own server.**

## Decisions

jwize 2026-10-22: "go with your recommendations, start with head-only reads."

- **Payment provider:** Stripe (Checkout + webhooks + customer portal).
- **Own domain:** the claim (nameservers) for a new domain, a custom hostname
  (one CNAME) for a domain already in use.
- **Edge caching:** nothing to choose — the worker's content answers are not
  edge-cached (see Head only).
- **Lapse terms:** 14 days' grace, then 30 days of reads after writes stop.

Still open, needed before sign-up (step 3):

1. **Which zone(s) tenants get names under** — `hypercomb.com` was called a
   test host on 2026-10-11 ("may be retired"); paid tenants need a zone
   that will not be.
2. **Plans and prices** — how many tiers, and what each allows.
