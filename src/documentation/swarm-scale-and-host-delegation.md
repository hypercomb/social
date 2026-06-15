# Swarm scale — root announcements, location snapshots, and host delegation

> Status: design draft 2026-06-12 (session conclusions). Not yet built — see
> "Phasing" at the end. Builds on `domain-as-identity` (operator grid, host
> is a verb), `history-sigbag-as-root` (flat heap, announce roots), and
> `protocol-spec.md` §21.11 (host sync push channel + receipts). Replaces the
> per-node subtree broadcast in the swarm hot path; everything else in the
> public-navigation model (witness / adopt / create) is unchanged.

## Thesis in one line

**A swarm of any size costs each participant O(1) on the wire: announce your
root, follow the location snapshot, and fetch everything else as immutable
content through hosts.** Hosts are the unit of scale; delegation is how
duties find them — mechanically, without coordination.

---

## 1. Why the broadcast model cannot reach ten thousand

Today every participant republishes one event **per subtree node** (up to
200) every heartbeat (30 seconds), and the relay fans each event out to
every subscriber at that location. At 10,000 participants on a content-rich
location:

- inbound: 10,000 × 200 events / 30 s ≈ **67,000 events per second**
- fan-out: each matched against 10,000 subscribers ≈ **660 million
  deliveries per second**, roughly 66 GB/s of WebSocket traffic

This is a quadratic shape with a content-size multiplier. No rate limit,
heartbeat tuning, or bigger machine fixes it. (Small-scale preview: the
2026-06-12 incident where a single publish pass of 200 events tripped the
live relay's 100-messages-per-minute limiter and silently dropped every
subsequent frame.)

## 2. Principles already in force

The scale design introduces **no new primitives** — it is existing doctrine
applied to the swarm hot path:

1. **The mesh transports layer signatures only**; bytes travel over HTTPS.
2. **Announce roots, not cascades** (flood-smart).
3. **Immutable content at `GET /<sig>`** with `Cache-Control: immutable` —
   the Cloudflare edge caches the first fetch globally.
4. **Host is a verb**: capture → package → serve. Any domain doing the three
   steps is a host.
5. **Hosting ≠ attesting**: bytes spread permissionlessly; identity stays
   signature-verified; trust comes from the community graph.
6. **Two-phase acquisition**: knowing an address (a signature) is decoupled
   from having the bytes; everything resolves through the same cascade.

## 3. The wire contract

### 3.1 Root announcement (replaces the subtree broadcast)

One replaceable event per participant per location:

- d-tag = the composed location signature (same composition as today:
  lineage, room, secret)
- payload = `{ root: <layer sig>, domains: [<host domains>] }`
- NIP-40 expiration = time-to-live; refreshed when half the time-to-live has
  elapsed

Constant size **regardless of how much content the participant holds**. The
subtree underneath the root resolves through the normal signature-resolution
cascade — community hosts first, swarm fallback, recursive fan-out — exactly
as any other signature does today.

### 3.2 Location snapshot (the steward folds the union)

A steward host (see §6.1) folds the live announcements at a location into a
content-addressed snapshot in the same flat heap it already serves:

```
{
  location:      <composed location sig>,
  members:       [<member-chunk sig>, ...],
  presenceCount: n,
  previous:      <prior snapshot sig | null>,
  at:            <unix seconds>
}
```

A member chunk is a sorted array of `{ pubkey, root, domains, hosted }`
entries, bucketed by pubkey prefix, so one join or leave changes one chunk
and content addressing dedupes the untouched chunks across consecutive
snapshots. `previous` forms a delta chain: a receiver holding the prior
snapshot diffs chunks instead of re-reading the world. The snapshot is bytes
under its own signature — no new storage concept, no manifest.

### 3.3 Snapshot ping

A tiny replaceable event authored by the steward: d-tag = location
signature, content = the current snapshot signature. Coalesced to at most
one per second per location. A receiver holds **one subscription per
location regardless of crowd size**.

### 3.4 Receiver path

ping → `GET /<snapshot sig>` (immutable, edge-cached) → diff against the
previous snapshot → resolve changed member roots via the normal cascade →
witness visuals exactly as today. Late joiners need no replay: **the
snapshot is the catch-up.** Departures are chunk diffs: an expired
announcement falls out of the next fold.

## 4. Scale arithmetic after the change

At 10,000 participants on one location:

- inbound to the steward: 10,000 × 1 tiny event / 60 s ≈ **170 events per
  second**
- folding: at most one snapshot rebuild per second per hot location
- WebSocket outbound: 10,000 pings × ~100 bytes per coalescing interval
- all heavy reads (snapshots, chunks, layers, resources) served from the
  Cloudflare edge, not the host machine

A home machine behind a tunnel carries this comfortably. Every additional
host multiplies it (§6).

## 5. Hosts — the unit of scale

### 5.1 Encouraging hosts: ship the recipe, make the reasons structural

The recipe is proven (the jwize.com playbook): relay + content heap +
Cloudflare tunnel + service wrapper — **zero dollars per month, no port
forwarding, IP cloaked, runs on any home machine**. Goal: a one-command
installer so "become a host" is a single decision, not a project.

The incentives are structural, not monetary:

1. **Durable presence** — a hosted participant's tiles stay live in swarms
   when their tab closes (§6.2). Unhosted participants are ephemeral. This
   is the single strongest everyday reason to want a host.
2. **Trust accrual** — a domain that serves verifiable content becomes a
   witness in the community graph; reach follows contribution.
3. **Proximity** — your community resolves signatures fastest through hosts
   that already hold them; hosting your community's content makes you their
   best path.
4. **Stewardship** — hosts carry the commons; the delegation pattern (§6)
   assigns duty fairly and visibly.

Every host added is capacity added 1:1 — the grid self-distributes with no
central cost-bearer.

### 5.2 Host cards and the host registry

A host announces itself with a content-addressed **host card**:

```
{ domain, pubkey, capabilities: [serve, steward, relay],
  capacityHint, at }
```

signed by the domain's key. The registry is nothing central: it is the
union of host cards a participant has adopted, seeded from
`hc:community:domains` and grown by federation — host cards propagate
exactly like any other content.

## 6. The delegation pattern

Delegation answers two questions mechanically: **which host folds a
location** (stewardship), and **which host stands in for a participant**
(home host).

### 6.1 Stewardship by rendezvous — who folds a location

For every (host, location) pair anyone can compute
`score = sha256(hostDomain || locationSig)`; the top-K scoring hosts among
known cards with the `steward` capability are that location's stewards.

- **Deterministic and coordination-free** — no election, no lease, no
  registry write. The host set plus the location signature IS the
  assignment.
- **Verify-don't-trust** — any participant recomputes the assignment and
  knows whether a snapshot author is a legitimate steward.
- **Minimal movement** — when a host joins or leaves, only the locations it
  scores into change stewards (the rendezvous-hashing property).
- **Capacity-weighted** — `capacityHint` scales the score so small hosts
  carry proportionally less.
- **K ≥ 2** — participants announce to all K stewards and follow the
  best-ranked reachable one; cross-checking K snapshots bounds omission
  (§6.3). Failover is "next rank," not a protocol event.

### 6.2 Home-host delegation — durable presence for participants

A participant delegates to a home host through the existing push channel
(host sync: HTTP PUT, signature auth, read-back receipts — protocol-spec
§21.11). A content-addressed **delegation object**, signed by the
participant's key:

```
{ delegate: <domain>, scopes: [serve, announce], from, until }
```

With `serve`, the host answers signature queries from the participant's
heap (this is today's backup/co-hosting, named). With `announce`, the host
re-announces the participant's roots at their locations with
`hosted: true` — the snapshot distinguishes **live** presence (browser open,
announcement fresh) from **hosted** presence (the home host vouches the
content remains reachable). Tiles persist; the presence banner can render
the difference honestly.

Revocation is an appended delegation with empty scopes — append-only, never
destructive, the same shape as history. The browser remains the only
authoring surface; the host is the always-on half.

### 6.3 Trust boundaries preserved

- **Stewards cannot fabricate** — every member entry resolves to
  signature-verified content under the member's own key. A steward's only
  misbehavior is omission, bounded by K stewards, by announcements being
  visible to all K, and by participants noticing their own absence.
- **The adoption invariant is untouched** — snapshots deliver witness
  visuals only. A layer is never unlocked without participant action;
  nothing un-adopted ever executes.
- **The community graph is the trust lens** over stewards and home hosts,
  exactly as over any host today. Delegation chooses *who does the work*,
  never *what is true*.

## 7. The need matrix — demand-side delegation

The presence snapshot (§3.2) is the supply side: what exists at a location.
The **need matrix** is the demand side: what is missing, and who wants it.
Same fold machinery, same heap, same delegation pattern.

### 7.1 Demand announcements — the laundry list, broadcast once

A participant announces each unresolved signature **once**: a tiny
replaceable event (d-tag = needed sig, scoped to the location or community
channel), refreshed at half its time-to-live **only while still wanted**.
The local egg remains durable regardless (the failure model stays "not yet
delivered, never failed") — only the wire demand is ephemeral. If the
participant cares again later, the need re-enters the matrix on the next
announce.

### 7.2 The fold — rows of demand

The steward folds live demand announcements into a content-addressed
**need snapshot**: rows keyed by signature, each row carrying a recipient
count, age, and (steward-visible) recipient chunks. Ten thousand
participants wanting the same signature collapse into one row. Fulfilled
and silent rows fall out of the next fold — **cancellation is silence**,
not a message.

### 7.3 Mining by rendezvous — who discovers a row

Work assignment reuses §6.1 at row granularity:
`score = sha256(hostDomain || neededSig)` over hosts with the `steward` (or
a dedicated `mine`) capability. The top-ranked host is the row's assigned
discoverer; on timeout the next rank takes over. Because each host searches
with **its own** community and address graph, the rank order IS the search
schedule — a progressively widening search across the grid with zero
coordination. Anyone can recompute who should be working a row, so shirking
is as visible as fabrication is impossible.

### 7.4 Fulfillment — broadcast zero

The discoverer fetches the bytes through its normal cascade, writes them
into its own heap, and publishes a tiny **fulfillment note**
(`{ sig, domains }`). Every recipient resolves via `GET /<sig>` —
immutable, edge-cached, so one fetch serves any number of wanters. The
bytes never ride the mesh at all. The row clears on the next fold and the
miner advances to its next row: the laundry list works itself.

### 7.5 Prioritization and fairness

Rows order by recipient count × age — most-wanted-first, computable by
anyone from the snapshot. Hosts work at their own capacity; the matrix
gives the whole grid visibility of the backlog, which is what makes pacing
("timing the distributions") possible without a scheduler.

### 7.6 Open edge — recipient privacy

A public matrix listing pubkeys per row exposes who wants what. Default
inclination: **counts only** in the public fold; recipient chunks held by
stewards for delivery verification. Not yet decided — flagged, not settled.

(The bee reading: needs are scouts in flight, mining hosts work the list,
fulfillment notes are the waggle dance.)

## 8. Phasing

- **Phase 0 — relief (current code):** refresh unchanged layer events at
  half the time-to-live instead of every heartbeat; cap idle-refresh depth.
  Buys headroom into the hundreds, not thousands.
- **Phase 1 — announcements + snapshots on one relay:** the live relay
  (jwize.com) folds; clients publish root announcements and follow pings.
  Single-steward, no registry yet.
- **Phase 2 — host cards + rendezvous stewardship:** K stewards per
  location; relays federate by exchanging snapshot signatures (cheap,
  content-addressed). The need matrix rides this phase — same fold, second
  snapshot kind.
- **Phase 3 — home-host delegation:** requires the host-sync write endpoint
  (PUT + signature auth) already specified for backup; adds the `announce`
  scope and the hosted-presence flag.

## 9. What does not change

Witness / adopt / create semantics; eggs and the not-yet-delivered failure
model; navigation by the children's naming convention; empty-layer-as-
removal; per-participant lineage pointers; layer purity; the signature as
the only universal primitive.
