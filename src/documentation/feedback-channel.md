# Durable feedback channel (the loop transport through jwize.com)

Status: v1 (relay-backed) building 2026-06-24. Hardening (HTTP byte rest) documented below as a follow-up.

## Why this exists

The self-feeding feedback loop (`.claude/skills/feedback-loop`, see
`project_feedback_loop`) reads `kind:'feedback'` items, mints `kind:'qa'`
dashboard questions, drains `kind:'qa-answer'` into notes, and re-feeds.
Every one of those records lives in the **optimization substrate**
(`__optimization__/<sig>`, `Store.putOptimization`).

The substrate is **strictly local OPFS**. It is deliberately excluded from
both sync paths:

- Host-sync's closure walk (`host-sync.service.ts #enqueueLayerRefs`) pushes
  only a layer's transitive closure — `__optimization__` is never referenced
  from a layer slot, so it is never pushed.
- The swarm lists `__optimization__` in `SYSTEM_DIR_NAMES`
  (`swarm.drone.ts`) — it is explicitly skipped during publish.

Consequence: feedback submitted in browser A is invisible to a feedback-loop
routine running in any other OPFS (a headless Playwright renderer, a second
device, the cloud). The routine reads an empty inbox and writes dashboard
cards into a profile the user never opens. **This is why the dashboard stays
empty.** There was no transport for the loop's own records.

The feedback channel is that transport: a durable, store-and-forward,
**round-trip** replication of the loop's optimization records through
jwize.com, so the submitter and the routine converge on the same set
regardless of which OPFS each runs in.

## What crosses, and what does not

Only the records that must reach the *other* side are replicated:

| kind | direction | why |
|------|-----------|-----|
| `feedback` | submitter → routine | the routine turns it into questions |
| `qa` | routine → submitter | the dashboard card the user answers |
| `qa-answer` | submitter → routine | the answer the routine drains to notes |

Routine-local bookkeeping stays put — it is meaningless to the other side:

- `feedback-seen`, `notes-digest` — **local only**, never published.

The channel is **add-only**. Retirement (removing a `qa` after it is
answered, marking feedback `seen`) stays local to each OPFS and is driven by
`feedback-seen` markers + content-addressed dedup. There is no distributed
delete — a record that has been ingested once is never re-ingested (same sig),
and each side retires its own copy on its own schedule. This sidesteps the
hard problem of distributed deletion entirely.

## Identity and the channel address

The channel is a **single fixed rendezvous** for the whole community — **not** tied
to any browser's ephemeral key or per-origin self-domain. Its address:

```
channelId = sha256("hc:feedback-channel\0" + <canonicalHost>)
```

- `canonicalHost` is a FIXED constant (`CANONICAL_FEEDBACK_HOST = 'hypercomb.io'`),
  overridable via `localStorage['hc:feedback-channel:host']`. Because it is fixed,
  every participant, the host, and the routine compute the **identical** channel id
  regardless of which origin loaded the app (hypercomb.io, localhost, a preview
  deploy…) — so all feedback converges to one place with **no key exchange and no
  origin-matching**. It is a rendezvous LABEL, not a fetch target; the transport is
  still the `wss://jwize.com` relay. (This replaces two earlier designs that each
  silently diverged: per-owner-pubkey — `NostrSigner` mints a random key per
  profile — and per-origin `self-domain` — participants on hypercomb.io and a
  routine defaulting to jwize.com never met.)
- `localStorage['hc:feedback-channel:id']` (an explicit 64-hex id) overrides the
  derivation entirely when you need to target a specific channel.

`channelId` is the mesh `x`-tag. The relay returns every author's events for that
tag; each side filters by the optimization `kind` it cares about.

> **Who receives.** The channel is public-by-derivation (anyone who knows the
> canonical host can compute it), but the ROLES keep it clean: participants only
> PUBLISH their own feedback, and only the host + routine SUBSCRIBE/ingest (see the
> two-role gate below). So a fixed community channel does **not** mean everyone sees
> everyone's feedback — only the host and its routine aggregate.

## Transport (v1 — relay-backed)

The relay **at** jwize.com (`wss://jwize.com`) accepts event publishes
permissionlessly today — that is how `FeedbackSwarmDrone` already delivers
visitor feedback. v1 rides that same relay. No operator action is required.

One NIP-33 parameterized-replaceable kind in v1 (must be added to
`SwarmDrone.configureKinds()` or the relay filters it out):

| kind | const | d-tag | content |
|------|-------|-------|---------|
| 30213 | `FEEDBACK_ITEM_KIND` | `i:<itemSig>` | `{ t:<raw JSON text>, s:<itemSig> }` |

The ITEM event carries the record's **exact stored bytes as a string** in `t`,
not a re-serialized object — `putOptimization` is content-addressed, so the
receiver must reconstruct identical bytes. The string round-trips losslessly
through the event's `content` (the mesh JSON-parses content back to `payload`,
so `t` is preserved verbatim); the receiver re-encodes `t`, writes it with
`putOptimization(blob, { emit:false })`, and asserts the resulting sig equals
`s`. A mismatch is dropped (tampered / non-canonical). Because the event is
NIP-33 replaceable keyed `(pubkey, kind, d=i:<sig>)`, re-publishing the same
item is idempotent.

A late reader (the routine starting after the user submitted) still receives
every **non-evicted** ITEM event: NIP-33 relays return stored matching events
on a fresh REQ. The durable outbox keeps recent items fresh on the relay across
its retention window. The one residual gap — an ITEM event evicted before the
reader connected — is exactly what the **HEAD manifest** (deferred to the HTTP
hardening below) closes, because only then can the evicted **bytes** actually
be recovered (HTTP GET). v1 logs such a gap rather than pretending to heal it.

## Store-and-forward (the "jwize.com is down" requirement)

The substrate already holds every record's bytes — `putOptimization` wrote
them, and that write is what fires `optimization:wrote`. So the durable outbox
is **bookkeeping only**: a pending map in localStorage, never an OPFS folder
(typed folders are banned — signature pools are the only structure, see
`sign-meaning-pool-migration-plan.md`):

```
localStorage['hc:feedback-channel:pending'] = { "<itemSig>": <firstAttemptMs>, … }
```

(An earlier build persisted a `__feedback_outbox__/` folder; the drone absorbs
any leftover entries into the pending map and deletes that folder on sight.)

- On submit: record the sig in the pending map, then publish the ITEM event.
- A sig leaves the pending map only on a **confirmed read-back** — the
  relay actually serving the item back to us — never a bare send-ok
  (host-sync's discipline). The subtlety: `relay.js` does **not** echo a
  publisher's own event back to it live (`broadcast(evt, client.ws)` excludes
  the sending socket), so a long-lived subscription never re-sees what it
  published. The drain therefore issues a one-shot **read-back query**
  (`mesh.query` — a fresh REQ on a transient subId that makes the relay replay
  its STORED matching events, including ours) and clears any pending item the
  relay returns from a non-`local` relay.
- On a periodic timer (30s) the drain runs: (1) re-read each pending sig's
  bytes from the substrate and re-publish — this refreshes each event's
  `created_at` so the read-back REQ's 15-minute `since` window returns it, and
  is the reconnect flush (NIP-33 replace makes it idempotent); then (2) the
  read-back query clears confirmed items. A public `drain()` exposes an
  immediate flush. `feedback:channel-receipt` is emitted per cleared item.
- A backstop age-sweep drops pending entries older than 24h (with a warning) so
  a never-reachable relay can't grow the queue without bound. A record retired
  locally (resolved/removed) while still pending drops out too — there is
  nothing left to sync.

So if jwize.com is down when feedback is submitted, the sig rests in the
pending map and the bytes are republished from the substrate the instant the
relay reconnects — and because the loop re-reads the channel each cycle, the
next routine iteration picks it up and continues the improvement loop. Nothing
is fire-and-forget.

## The drone

`FeedbackChannelDrone` (`diamondcoreprocessor.com/sharing/feedback-channel.drone.ts`)
owns the whole concern. It has **two roles**, keyed off one flag
(`hc:feedback-channel:enabled`) plus owner/visitor context:

- **CONTRIBUTE** (publish MY feedback to the host) — default ON on your own hive;
  a visitor of another hive uses the consent handshake (`FeedbackSwarmDrone`)
  instead; explicit `…enabled='false'` opts out. Publishing only happens when a
  `feedback`/`qa`/`qa-answer` record is actually written, so a dev hot-reload sends
  nothing. Owner vs visitor is read from `SwarmDrone.subscribedTo()` (the host
  pubkey we're a visitor of; null on our own hive).
- **HOST** (subscribe + ingest + render the aggregated dashboard) — OFF unless
  `…enabled='true'` (you + the routine; `/feedback-host on` sets it). So a
  participant PUBLISHES their feedback but never INGESTS anyone else's — only the
  host and its routine aggregate. `DashboardProducerDrone` reads the same host gate
  (renders only for the host) and lazily mints the dashboard bag on the first
  arriving question.

When in a role it:

1. Subscribes `optimization:wrote` (emitted by `Store.putOptimization` for the
   three syncable kinds) → record the sig in the pending map + publish ITEM.
2. Subscribes the channel (`mesh.subscribe(channelId)`) → on any peer ITEM
   event: if we don't already hold the sig, verify `s` against `sha256(t)` and
   `putOptimization(blob([t]), {emit:false})` into local `__optimization__`.
   (A live real-relay echo of our own item also clears its pending entry here,
   but most relays don't echo to the sender — the drain's read-back query above
   is the reliable receipt.)
3. Emits `feedback:channel-state` (`{ pending, ingested }`) for UI/telemetry.

Both the owner browser and the routine renderer run the same drone; the only
difference is which optimization kinds each *originates* vs *consumes*.

## Hardening (follow-up — needs operator writer-auth)

Relay events can be evicted under load. For multi-month durability the item
bytes should also rest on jwize.com's **HTTP content store** (`PUT /<sig>`,
self-verifying, `relay.js tryWriteContent`). That endpoint is writer-auth
gated: the authoring pubkey must be in the relay's `--writers` list
(`configure-writers.bat` / the elevated add-writer script on the host). Once a
channel host + writer-auth are configured
(`localStorage['hc:feedback-channel:host'] = 'jwize.com'`), the outbox drain
also PUTs each item blob and confirms it with a read-back GET (reusing the
host-sync transport shape). The relay event then degrades to a pure pointer —
"mesh carries the sig, HTTP carries the bytes." This is intentionally **not**
wired through host-sync's `self-domain` knob, which is also Tier-0 of the
essentials installer and the content broker (pointing it at jwize.com has
historically 404'd the installer — see `project_jwize_content_not_essentials_routing`).
The feedback channel keeps its own isolated host config.

## Rendering the dashboard from synced data (the remaining half)

The channel syncs the **data** (the qa optimization records). The dashboard
**page** — the Material card HTML — is built by `renderDashboard()` in
`scripts/bridge/_dashboard-refresh.cjs`, a pure function of the *local* qa
optimizations, written back as a `put-resource` HTML blob + an `update` of the
`/dashboard` layer's `context` slot. The `/dashboard` bag is **participant-local**
(`DashboardBee` mints a hidden `dash-<locSig>-<salt>` bag pinned in
localStorage), so the routine's `/dashboard` layer cannot simply be layer-synced
onto the user's — each side must render its OWN dashboard from its OWN (now
channel-synced) qa records.

This is now closed by **`DashboardProducerDrone`**
(`diamondcoreprocessor.com/dashboard/dashboard-producer.drone.ts`, shipped): it runs
the `renderDashboard` logic client-side on `feedback:channel-ingested` (and on boot),
rebuilding the participant-local `/dashboard` bag from local `qa` with no node runner,
and **lazily mints the bag on the first arriving question** so a user who never ran
`/dashboard` still sees cards. It reads the same owner-default-on gate as the channel.
One residual polish item remains: an **auto-remount** of the `/dashboard` view when
its layer changes, so a user already staring at the dashboard sees a new card without
a nav-away/back or reload (until then, re-open the toggle to refresh).

## Operator + test checklist

1. Owner browser: nothing to set — the channel is **owner-default-on** (submitting
   feedback on your own hive publishes automatically). To force-disable, set
   `localStorage['hc:feedback-channel:enabled']='false'`.
2. Routine renderer: `ensure-renderer.cjs` auto-injects the preflight (enabled +
   `hc:nostrmesh:self-domain=jwize.com` + live relay) before the page loads, so it
   converges on the owner's channel with no key injection. Assert with
   `node .claude/skills/feedback-loop/fb.cjs channel-status` →
   `{ enabled:true, channelId:<64-hex> }`.
3. Both derive the channel from `hc:nostrmesh:self-domain` (default `jwize.com`) and
   ride the same relay (`wss://jwize.com`, or `wss://localhost:7777` — the same relay
   via cloudflared for a local host).
4. Submit a feedback item in the owner browser → confirm a kind-30213 ITEM event
   lands on the relay (a raw `REQ {"#x":[channelId],"kinds":[30213]}` on
   `wss://jwize.com`) → run one feedback-loop cycle in the routine → confirm a `qa`
   ITEM comes back and the dashboard shows the card.
5. Down-test: stop the relay, submit feedback, confirm its sig rests in
   `localStorage['hc:feedback-channel:pending']`; restart the relay, confirm it
   auto-posts and the routine picks it up next cycle.
6. Visitor path: a granted visitor's post now carries a 7-day expiration and a unique
   d-tag, so it survives on the relay until the host is next online (no more
   90-second loss window); the host ingests it idempotently (content-addressed).
```