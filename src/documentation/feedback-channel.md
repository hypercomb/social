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

The channel belongs to a **host** (a domain like `jwize.com`), **not** to any one
browser's ephemeral key. Its address is derived from the host domain:

```
channelId = sha256("hc:feedback-channel\0" + <hostDomain>)
```

- `hostDomain` is `localStorage['hc:nostrmesh:self-domain']` — the canonical host
  identity `runtime-initializer.ts` seeds from the page origin on a real host, or
  `DEV_DEFAULT_HOST` (`jwize.com`) on loopback. So the owner's app on **any** origin
  or device, a granted visitor's host, and the loop routine (which runs on
  `localhost:4250` but whose self-domain is also `jwize.com`) all derive the **same**
  channel id with **no key exchange**. This is what makes "the host receives all
  feedback for all messages" hold regardless of which OPFS submitted it. It also
  replaces the old per-owner-pubkey derivation, which silently diverged because
  `NostrSigner` mints a fresh random key per browser profile — so the owner and a
  headless routine never met.
- `localStorage['hc:feedback-channel:id']` (an explicit 64-hex id) still overrides
  the derivation when you need to target a specific channel; the own-pubkey
  derivation remains only as a fallback for a bare local dev with no host set.

`channelId` is the mesh `x`-tag both sides subscribe to. The relay returns every
author's events for that tag; each side filters by the optimization `kind` it
cares about.

> **Multi-tenant note.** A host-domain-scoped channel means everyone using that
> host shares one feedback channel — correct for a single-owner host like
> jwize.com (feedback from every device and every granted visitor converges to the
> owner + routine). If a host ever serves *independent* owners who must not see one
> another's feedback, scope the channel per-owner (derive from the owner pubkey or a
> per-owner salt) and gate the SUBSCRIBE side to the owner. Not needed today.

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

Every published item is also written to a durable local outbox:

```
__feedback_outbox__/<itemSig>     ← raw JSON text, survives offline + restart
```

- On submit: write the outbox file, then publish the ITEM event.
- An item is removed from the outbox only on a **confirmed read-back** — the
  relay actually serving it back to us — never a bare send-ok (host-sync's
  discipline). The subtlety: `relay.js` does **not** echo a publisher's own
  event back to it live (`broadcast(evt, client.ws)` excludes the sending
  socket), so a long-lived subscription never re-sees what it published. The
  drain therefore issues a one-shot **read-back query** (`mesh.query` — a fresh
  REQ on a transient subId that makes the relay replay its STORED matching
  events, including ours) and clears any outbox item the relay returns from a
  non-`local` relay.
- On a periodic timer (30s) the drain runs: (1) re-publish every pending item —
  this refreshes each event's `created_at` so the read-back REQ's 15-minute
  `since` window returns it, and is the reconnect flush (NIP-33 replace makes
  it idempotent); then (2) the read-back query clears confirmed items. A public
  `drain()` exposes an immediate flush. `feedback:channel-receipt` is emitted
  per cleared item.
- A backstop age-sweep drops outbox entries older than 24h (with a warning) so
  a never-reachable relay can't grow the queue without bound.

So if jwize.com is down when feedback is submitted, the item rests in the
outbox and is posted the instant the relay reconnects — and because the loop
re-reads the channel each cycle, the next routine iteration picks it up and
continues the improvement loop. Nothing is fire-and-forget.

## The drone

`FeedbackChannelDrone` (`diamondcoreprocessor.com/sharing/feedback-channel.drone.ts`)
owns the whole concern. The enable gate is **owner-default-on**:

```
localStorage['hc:feedback-channel:enabled']            // unset ⇒ ON for the owner on
                                                       //   their own hive, OFF for a
                                                       //   visitor of another hive
localStorage['hc:feedback-channel:enabled'] = 'true'   // force-on (routine, dev opt-in)
localStorage['hc:feedback-channel:enabled'] = 'false'  // force-off (dev opt-out)
```

Owner vs visitor is read from `SwarmDrone.subscribedTo()` (the host pubkey we're a
visitor of; null on our own hive). So submitting feedback on your own hive always
crosses and returned qa always renders — with no hidden flag a normal user would
never set — while a visitor's feedback rides the consent handshake
(`FeedbackSwarmDrone`) instead. A dev hot-reload still publishes nothing on its own,
because publishing only happens when a `feedback`/`qa`/`qa-answer` record is actually
written. `DashboardProducerDrone` reads the same effective gate, so the render side
follows automatically (and lazily mints the dashboard bag on the first arriving
question).

When enabled it:

1. Subscribes `optimization:wrote` (emitted by `Store.putOptimization` for the
   three syncable kinds) → write outbox + publish ITEM.
2. Subscribes the channel (`mesh.subscribe(channelId)`) → on any peer ITEM
   event: if we don't already hold the sig, verify `s` against `sha256(t)` and
   `putOptimization(blob([t]), {emit:false})` into local `__optimization__`.
   (A live real-relay echo of our own item also clears the outbox here, but
   most relays don't echo to the sender — the drain's read-back query above is
   the reliable receipt.)
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
5. Down-test: stop the relay, submit feedback, confirm it rests in
   `__feedback_outbox__/`; restart the relay, confirm it auto-posts and the routine
   picks it up next cycle.
6. Visitor path: a granted visitor's post now carries a 7-day expiration and a unique
   d-tag, so it survives on the relay until the host is next online (no more
   90-second loss window); the host ingests it idempotently (content-addressed).
```