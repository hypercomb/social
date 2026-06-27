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

The channel belongs to a **hive owner**. Both the owner's everyday browser and
the owner's routine address the same channel:

```
channelId = sha256("hc:feedback-channel\0" + <ownerPubkeyHex>)
```

- The owner's browser derives `ownerPubkeyHex` from its own `NostrSigner`.
- The routine targets a specific hive via `localStorage['hc:feedback-channel:id']`
  (an explicit 64-hex channel id) when it does **not** share the owner's key,
  or — recommended — runs with the owner's `hc:nostr:secret-key` injected, so
  it derives the identical channel id automatically and *is* the same identity
  (the multi-device case).

`channelId` is the mesh `x`-tag both sides subscribe to. The relay returns
every author's events for that tag; each side filters by the optimization
`kind` it cares about. Single concern per author → no manifest merge.

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
owns the whole concern and is **inert by default**, gated exactly like
host-sync so a casual visitor (or a hot-reload into a running dev session)
publishes nothing:

```
localStorage['hc:feedback-channel:enabled'] = 'true'   // opt-in gate
```

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

Consequence in the headless-routine topology: the routine builds its dashboard
in its OPFS; the user's browser receives the qa **data** but does not yet
auto-build the card page. Closing this needs an **in-app dashboard producer** —
a drone that runs the `renderDashboard` logic client-side on
`feedback:channel-ingested` (and on boot), so the user's browser rebuilds its
dashboard from local qa with no node runner, plus an auto-remount of the
`/dashboard` view when its layer changes. Until that lands, the cards become
visible by running the loop's `dashboard` step against the user's own hive
(Claude-in-Chrome, shared OPFS) — which works today because the qa data is
synced. Tracked as a follow-up.

## Operator + test checklist

1. Owner browser: `localStorage['hc:feedback-channel:enabled']='true'`, reload.
2. Routine renderer: same flag; either inject the owner's
   `hc:nostr:secret-key` (same identity) or set
   `hc:feedback-channel:id` to the owner's channel id.
3. Both must point at the same relay (`hc:nostrmesh:relays` includes
   `wss://jwize.com`, or `wss://localhost:7777` for local dev).
4. Submit a feedback item in the owner browser → confirm an ITEM event lands
   on the relay → run one feedback-loop cycle in the routine → confirm a `qa`
   ITEM comes back and the dashboard shows the card.
5. Down-test: stop the relay, submit feedback, confirm it rests in
   `__feedback_outbox__/`; restart the relay, confirm it auto-posts and the
   routine picks it up next cycle.
```