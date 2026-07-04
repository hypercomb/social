# Web clip extension — select on any page → queue → tile

Status: PLAN (not built). Concept evaluation 2026-07-04.

## The idea

A Chrome extension (Manifest V3). On any web page the user selects content,
right-clicks → **"Clip to Hypercomb"**, optionally types an instruction
("make this a tile under research/ai", "summarize into a tile"), and the clip
is queued. It surfaces as a card on the Hypercomb dashboard; answering the
card has the feedback-loop routine create the tile via the bridge.

## Why this is nearly free — the pipeline already exists

The feedback channel (`documentation/feedback-channel.md`, shipped) is a
durable, store-and-forward, content-addressed transport into the host's
optimization substrate (`Store.putOptimization` — folder-free once the
signature-pool migration lands; clips ride the Store API, so they move with
it), and the feedback loop already turns substrate records into dashboard
questions and EXECUTES creation tasks on answer.
The extension is nothing more than a **second contributor client** on that
same channel:

```
extension                    relay                     host browser / routine
─────────                    ─────                     ──────────────────────
select → clip record  ──►  kind-30213 ITEM event  ──►  FeedbackChannelDrone ingests
(kind:'clip', signed         x = channelId              → substrate record <sig>
 content-addressed)          d = i:<sig>                → feedback-loop mints kind:'qa'
                             wss://jwize.com            → DashboardProducerDrone renders card
                                                        → user answers → routine creates tile
                                                          via bridge (already the EXECUTE path)
```

What already works with **zero app changes**:

- **Transport**: kind-30213 ITEM events on the fixed community channel
  (`sha256("hc:feedback-channel\0hypercomb.io")`). The relay accepts publishes
  permissionlessly. The extension computes the identical channelId with Web
  Crypto — no key exchange, no pairing.
- **Ingest**: `FeedbackChannelDrone.#onChannelEvent` verifies
  `sha256(t) === s` and writes the bytes into the optimization substrate — it
  does **not** filter by record kind. A `kind:'clip'` record lands exactly
  like a `kind:'feedback'` one.
- **Durability**: relay retention + NIP-40 7-day expiration + the host-side
  content-addressed dedup. The extension replicates the outbox discipline
  locally (below).
- **Dashboard + execution**: `DashboardProducerDrone` renders qa cards;
  the feedback-loop skill's drain step already executes "CREATE something"
  answers via the bridge.

The genuinely new code is (a) one small MV3 extension and (b) one new record
kind handled by the feedback-loop skill (plus optionally the dashboard
producer). Nothing touches core, shared, or the web shell.

## The clip record

Same substrate conventions as `kind:'feedback'` (feedback-button.component.ts
writes `{ kind, appliesTo, payload, mark }`):

```json
{
  "kind": "clip",
  "appliesTo": [],
  "payload": {
    "id": "<uuid minted at capture>",
    "at": 1751600000000,
    "source": { "url": "https://example.com/article", "title": "Page title" },
    "selection": { "text": "…plain text…", "html": "…sanitized fragment…" },
    "instructions": "make this a tile under research/ai",
    "sender": "<extension pubkey hex>"
  },
  "mark": "persistent"
}
```

- `selection` is **inline in v1**, capped (~64 KB, truncate with notice) —
  the same inline-bytes choice the feedback records already make, because the
  relay event carries raw JSON text. Per the signature doctrine large/binary
  content (screenshots, images) belongs behind a `contentSig` resource
  reference — that requires the HTTP byte-rest hardening (writer-auth
  `PUT /<sig>` on jwize.com) and is deferred (Phase 3).
- Deterministic `id`/`at` at capture ⇒ content-addressed idempotence: retries
  and re-publishes dedup to the same sig on both sides.

## The extension (new project: `src/hypercomb-clip/`)

Plain MV3, esbuild-bundled TypeScript, no Angular. Not a drone module —
it runs in Chrome's extension sandbox, outside the hive — but it follows the
monorepo conventions (ESM, `#field`, minimalism).

- **manifest.json**: `contextMenus`, `activeTab`, `storage`, `alarms`;
  host permission for `wss://jwize.com`.
- **Content script** (injected on demand via `activeTab`): serialize the live
  selection — `getSelection().toString()` for text plus
  `Range.cloneContents()` → sanitized HTML — with page URL + title.
- **Popup / capture sheet**: shows the captured snippet, one free-text
  instructions field, Submit. (Right-click → clip with no popup = submit with
  empty instructions; zero-friction path.)
- **Service worker**:
  1. Build the record, canonical JSON, `sig = sha256(bytes)` (Web Crypto).
  2. Write to a local outbox in `chrome.storage.local` FIRST (store-and-forward,
     mirroring the channel's pending-map discipline — bookkeeping only, never a
     typed folder).
  3. Connect, publish the kind-30213 event (`{t: <exact JSON text>, s: sig}`,
     tags `d=i:<sig>`, `expiration=+7d`), then issue a one-shot read-back REQ;
     only a relay-served echo clears the outbox entry — never a bare send-ok.
  4. `chrome.alarms` every ~5 min drains pending entries (MV3 workers are
     short-lived; one-shot connect→publish→confirm→close per drain, no
     long-lived socket).
- **Keys**: mint a fresh secp256k1 key into `chrome.storage.local` on first
  run (nostr-tools, already the project's stack). The relay is permissionless
  and ingest verifies the content hash, not the author — the pubkey is
  informational (`payload.sender`) until an allow-list is wanted.
- **Options page**: channel host override (mirror of
  `hc:feedback-channel:host`), relay URL override for local dev
  (`wss://localhost:7777`).

## Host-side changes (small)

1. **feedback-loop skill** — one new step: list `kind:'clip'` records the same
   way it lists `kind:'feedback'` (`fb.cjs` gains a `clips` command), and for
   each unseen clip mint a `kind:'qa'` card:
   > *"Clip from **Page title** (example.com): '…first 200 chars…' —
   > instructions: 'make this a tile under research/ai'. Create it?"*
   with answer choices (create as instructed / create under … / discard).
   Draining the answer reuses the existing EXECUTE path: bridge-create the
   tile — name from title/instructions, selection text into notes, source URL
   as a link note. `feedback-seen` markers retire processed clips, exactly as
   feedback items retire today.
2. **DashboardProducerDrone (optional, recommended)** — render pending
   `kind:'clip'` records as cards directly on `feedback:channel-ingested`, so
   a clip is *visible* on the dashboard seconds after capture instead of after
   the next routine cycle. The routine still does the creation; this only
   closes the latency gap on visibility.

**Consent discipline: v1 never auto-creates.** The channel is
public-by-derivation, so a clip is a *request*, and the dashboard answer is
the consent gate — the same human-in-the-loop shape the loop already enforces
for feedback. A trusted direct-create mode (clip from the host's own paired
extension skips the question) is a Phase 3 opt-in, gated on sender pubkey
allow-listing.

## Phases

**Phase 0 — spike, no extension code (half a day).** Publish a hand-built
`kind:'clip'` record as a kind-30213 event from a node script (reuse the
fb.cjs/mesh plumbing). Confirm: host browser ingests it into the optimization
substrate, one loop cycle mints a qa card, answering it creates a
tile via the bridge. This proves the entire pipeline before any extension
work — if this feels wrong in practice, stop here having spent nothing.

**Phase 1 — extension MVP.** Context menu + popup + publish + outbox/alarms
retry + options page. Text/HTML selections only, size-capped.

**Phase 2 — loop + dashboard integration.** `fb.cjs clips`, the qa-minting
step, the drain→create execution, optional direct clip cards in
`DashboardProducerDrone`. i18n keys for the card strings.

**Phase 3 — hardening (each independently optional).**
- Screenshots/images via HTTP byte rest (`contentSig` references) once
  writer-auth is configured.
- Per-participant clip channels + extension↔hive pairing (multi-user; today's
  fixed community channel means every clip lands on THE host's dashboard,
  which is correct for the current single-host reality).
- Trusted direct-create for allow-listed sender pubkeys.
- A dedicated clips review panel (the feedback-viewer pattern) if dashboard
  cards prove too coarse.

## Risks / honest caveats

- **Relay event size.** The clip rides inline in the event content; a large
  selection must be truncated in v1. Real articles usually survive a 64 KB
  text cap; rich media does not (Phase 3).
- **Latency.** Clip → *tile* requires a routine cycle (or answering the card
  and running the drain). Clip → *visible on dashboard* is seconds only if
  the optional DashboardProducer rendering is done; otherwise it also waits
  for the routine. Set expectations: this is a queue, not an instant clipper.
- **Spam surface.** Anyone who derives the channel can publish clips. Same
  exposure as feedback today, mitigated by the same two facts: only the host
  ingests, and nothing executes without the host's dashboard answer.
- **MV3 lifetime.** Service workers die mid-flight; the outbox-first +
  alarms-drain discipline exists precisely for this — no fire-and-forget.
- **Chrome Web Store.** Publishing publicly means store review + a privacy
  policy for "reads selected text". Unpacked/dev-mode sideload is fine for
  personal use indefinitely.

## Verdict inputs

For: extreme reuse (transport, ingest, dedup, dashboard, execution all
shipped and tested this cycle); small new surface (one sandboxed extension +
one skill step); fits the loop philosophy — clips are just another inbox kind
feeding the same self-improving cycle; Phase 0 costs ~nothing and proves the
whole spine. Against: the tile doesn't appear instantly (routine-mediated);
images need the deferred byte-rest hardening; a browser extension is a new
artifact class to maintain outside the drone/module system.
