# Claude Code + the Hypercomb Bridge — Setup Tutorial

Connect a Claude Code subscription to a live hive. When you finish, you can
start an AI request **from inside Hypercomb** (the chat window or `/opus …`)
and have your own Claude Code session — running on your machine, on the
subscription you already pay for — read the hive, answer, and write the answer
back onto your tiles. You can also drive the hive **from the Claude Code side**
(or any terminal) with one-line commands.

No API key is required for this path. Your Claude Code login *is* the AI.
An API key is a separate, optional path — see [Path B](#path-b-api-keys-instead-of-a-subscription)
at the end.

---

## Lines only: the bridge is shut off by default (2026-11-01)

**To prove that a subscription agent needs nothing but the hive's language,
the bridge now carries command-line lines and nothing else.** Whatever
connects to it (Claude Code, an OpenAI tool, any agent) may send `submit`;
every other op is refused with `"<op>" is shut off`. Most of this tutorial
(reading the hive, answering chats, writing tiles from the responder) needs the
whole bridge, and works again only once you open it.

A `submit` is a call from outside, exactly as the say door's is
([hive-say.md](hive-say.md)):

- Each line of its `text` is one line of the call, and `from` names the caller
  (`say.cjs` sends `HIVE_CALLER`, or `say.cjs`).
- The command line shows it in its `$` stance, with who sent it; a toast says
  it is waiting. Nothing runs yet.
- **Enter** (after the call has been on the line for a second, so an Enter
  meant for your own line cannot run it) opens a new conversation on the
  layer you stand in and says each line through the machine door, judged
  against your `grant`. **Esc** declines.
- The reply comes when you have answered: `data.outcome` (`ran` with each
  line's verdict, `declined`, or `refused`) and `data.summary`.
- Files may not ride with a line while it is shut: they would be written
  before you answered.

Why every other op is shut: they read, wrote or emitted around the gate.
`effect-emit` could press Enter for you; `put-resource`, `bag-set`,
`hive-root-set` and `update` wrote straight to the hive; the reads handed your
tiles out without asking.

**What stops working while it is shut:** a parked Claude Code session
answering chats (`chat-reply`, `thread-read`), the responder's tile writes,
`publish:revision`'s stamp of `install:essentials` (it uses `hive-root-set`),
`hive-harness.cjs`, and the `_*.cjs` scripts that use any op but `submit`.

**Opening it again** is yours alone, in the hive tab's console:

```js
localStorage.setItem('hc:bridge:open', 'all')     // the whole bridge
localStorage.removeItem('hc:bridge:open')         // lines only again
```

No op writes that key, and it is read on every request, so it takes effect at
once.

---

## How it works (one diagram, three pieces)

```
 ┌──────────────────┐        ┌─────────────────┐        ┌─────────────────────┐
 │  Hypercomb tab   │  ws:// │     Broker      │  ws:// │  Claude Code        │
 │  (the renderer)  │◄──────►│  localhost:2401 │◄──────►│  session / scripts  │
 │  ?claudeBridge=1 │        │  (tiny relay)   │        │  (the responder)    │
 └──────────────────┘        └─────────────────┘        └─────────────────────┘
```

1. **The broker** — a tiny WebSocket relay on `ws://127.0.0.1:2401`. It
   interprets nothing; it forwards.
2. **The renderer** — your hive browser tab. Opened with `?claudeBridge=1` it
   dials the broker and executes bridge operations against its own storage
   (the storage itself stays local; what Claude reads to answer a question
   goes to Anthropic through your Claude Code session).
3. **The responder** — a Claude Code session (or a scheduled drain) that
   watches for questions and answers them.

A question to a named model (`/opus …`), from the ask screen, or from
`/break-apart`, `/expand` and `/organize` is written as a durable **ask
record** in your hive's own storage. The responder polls for those records
through the broker, answers, and retires them. Close the laptop mid-question?
The ask survives — it is answered when a responder next connects.

A plain chat question that no model took is different: it is written only
while a session is **parked** (Step 5). The broker being up is not that — the
managers ride it all day — so with no session parked the chat window shows the
failure at once ("no Claude session is parked on the bridge") and writes
nothing, instead of waiting for good.

**Trust model**: the broker binds to loopback only. Registration as a renderer
is *always* loopback-only, and only from the hive's own page — the origins in
`BRIDGE_RENDERER_ORIGINS`, by default the hive's dev and web ports (4200,
4250, 4251, 4253, 4254, 4260, 4264, 4450) on localhost — and a renderer that
holds the slot is never displaced by a stranger. The broker serves **this
machine's own tools** — a Node client on loopback that sends no `Origin` (your
scripts, your Claude Code sessions) — and nobody else unless they present a
**bridge code** you gave them from the hive
([Who may use the bridge — codes](#who-may-use-the-bridge--codes)). That
includes every web page: a browser always says which page opened a socket, so
the broker refuses any `Origin` that is not exactly localhost, 127.0.0.1 or
[::1] (`scripts/bridge/bridge-origin.cjs`) — a site, or a sandbox door you are
trying, cannot drive your bridge — and even a localhost page needs a code
before it may send an op. With no codes, nobody but this machine's own tools
gets in. Nothing on your network can touch your hive unless you deliberately
bind wide **and** give someone a code.

---

> **The hive walks you through this.** The chat window's setup state is a
> guided checklist of these same steps — each one checks itself off as it
> verifies (tab enabled, broker answering, first real answer landed). Open the
> chat and follow it; this page is the same path in full detail.

## Path A — Claude Code subscription (recommended)

### Step 0 · Prerequisites

- **Node.js ≥ 20.19** — [nodejs.org](https://nodejs.org)
- **Claude Code** with an active subscription:

```bash
npm install -g @anthropic-ai/claude-code
```

```bash
claude --version
```

- **The Hypercomb repository**, installed:

```bash
git clone https://github.com/hypercomb/social.git hypercomb-social
```

```bash
cd hypercomb-social/src && npm install && npm run build:packages
```

> Every command from here on runs from the repo's `src/` directory. The bridge
> scripts resolve their `ws` dependency from the workspace install, so a
> different working directory fails with `Cannot find module 'ws'`.

### Step 1 · Start the hive (terminal A)

```bash
npm run start:dev
```

Wait for the compile to finish; the hive serves at `http://localhost:4250`.

### Step 2 · Start the broker (terminal B)

```bash
npm run bridge
```

Expect:

```
[bridge] listening on ws://127.0.0.1:2401
[bridge] loopback-only bind — set BRIDGE_HOST=0.0.0.0 for remote answering sessions
```

### Step 3 · Open the hive tab — with the bridge flag

Open **exactly one** tab at:

```
http://localhost:4250/?claudeBridge=1
```

The broker's terminal prints:

```
[bridge] renderer connected
```

Three rules that save an hour of head-scratching:

- **One tab only.** The broker holds a single renderer slot, last-wins. A
  second bridge-enabled tab silently steals it (and a second tab on the same
  hive breaks the single-writer store anyway).
- **Order matters once.** If the tab was open *before* the broker started,
  reload the tab — a tab that never reached the broker does not retry.
- **Loopback only.** The flag does nothing on a non-localhost origin, by
  design.

### Step 4 · Verify the loop (terminal C)

```bash
npm run bridge:check
```

A tile listing means the whole loop works: your terminal → broker → hive tab →
back. If instead you see `no renderer connected`, the broker is fine and the
tab is the problem (wrong URL, second tab stole the slot, or it needs a
reload).

### Step 5 · Park a listening session

In a Claude Code session opened at the repo root, say:

```
listen for hive asks
```

(this invokes the **bridge-listen** skill — the session arms the watcher and
answers asks the moment they land). Or park the raw watcher in a terminal to
see asks arrive as JSON lines:

```bash
npm run bridge:watch
```

The watcher's poll is what tells the hive a session is parked: each poll says
how often it will come back (`parked: <ms>` on the `optimization-list` it
sends), and the claim lasts three polls — about 18 s at the default 6 s — and
lapses on its own when the watcher stops. `bridge:status` carries it as
`{ connected, listening }`; `connected` is the broker, `listening` is a
session.

One-shot smoke test instead of parking (it claims nothing):

```bash
npm run bridge:watch:once
```

### Step 6 · Ask from inside Hypercomb

In the hive command line:

```
/opus what is on this page?
```

- `/opus`, `/sonnet`, `/haiku`, `/fable` open the **chat window** on that
  model. Type there like any chat; each send becomes an ask record.
- Select tiles first and the answer lands as a **note on those tiles**.
- `/break-apart` asks for structure (the responder creates child tiles),
  `/expand` asks for new siblings, `/organize` asks for a grouping plan.

Your parked session (Step 5) wakes up, reads the tiles for context, and
answers — chat turns come back into the chat window; tile asks come back as
notes, live, no refresh.

### Step 7 · Drive the hive from the terminal (the other direction)

Any terminal — including inside a Claude Code conversation — can operate the
hive directly:

```bash
node scripts/bridge/bridge-cli.cjs list
```

```bash
node scripts/bridge/_bop.cjs '{"op":"note-add","segments":["my-tile"],"cell":"ideas","text":"hello from the terminal"}'
```

`_bop.cjs` sends any raw bridge op. The op vocabulary (every `case` of the
worker's `#route`: `layer-at`, `inflate`, `note-add`, `put-resource`,
`decoration-add`, `submit`, …) lives in `claude-bridge.worker.ts` — and
`{"op":"submit","text":"/website"}` types into the hive command line itself, so
anything you can do by hand, a script can do.

### Optional · Read a live swarm failure

A swarm that goes quiet on the hive tab cannot be watched from a second tab —
a second tab is a second member, and changes what it measures. Read the tab
itself instead, in one call:

```bash
npm run bridge:swarm
```

(`node scripts/bridge/swarm-debug.cjs`; add `--json` for the snapshot alone.)
It sends the read-only op `swarm-debug` (`assistant/swarm-debug.ts`) and prints
a summary, then the snapshot:

| Part | What it says |
|---|---|
| `swarm` | The swarm drone's `debug()`: the current page sig, subscriptions, peers per sig, the last 64 page walks (newest last) with their timings and outcome, the first announce after the join, the work in flight, the own-replay counts; how many participants stand on this page and in the zone; the tile names peers published here. A field `debug()` did not report reads null (never empty) and is named in `debugMissing` |
| `mesh` | The MEETING RELAY (`swarmHost` — the `{host}` of the banner's "Can't reach {host}"), the last `mesh:connection`, each relay and its socket's ready state, the counters (events and REQs sent, refusals), whether the relays' reads are addressed |
| `share` | Where the tiles' BYTES go, apart from the meeting: the last share line (`swarm:share-status`), each host's last `sync:state` word heard since the bridge module loaded and when, `hostTrouble()` for every host named, and where host sync is configured to write (backup, public host, publish nodes) |
| `membership` | Whether this tab is joined, and its zone as `{room, relay, host, hasSecret, hasCode}` |

It reads and does nothing else — no emit, no write, no dial (it never calls
the mesh's `getDebug()`, which starts the mesh, or `connectionState()`, which
can announce). And it never answers with a secret: no room secret, access code,
key, nsec, NIP-98 token, bridge code or storage dump; relay addresses lose any
login, query or fragment; a reason, refusal or error that holds the room
secret or the access code reads `[redacted]` WHOLE (never with a hole cut in
it, which would give the secret back by its place); a page path is shown up to
its first tile that is not public on this tab, which reads `[private]`. Hosts
and relay addresses are shown as they are. Lists stop at 64 and strings at 200
characters.

### Optional · Unattended answering (no parked session)

Schedule this every few minutes (Task Scheduler / cron):

```bash
npm run bridge:drain
```

Zero pending asks costs nothing and exits silently. When asks are pending it
spawns `claude -p` once per model group, maps the hive's model hint
(opus/sonnet/haiku/fable) to a real model id, answers, and retires the asks.
`--dry` reports without answering.

The drain is not a parked session: it comes back every few minutes at the
scheduler's pleasure, cannot promise an interval, and claims nothing. It
answers the asks that were already queued (a named model such as `/opus`, the
ask screen, `/break-apart`, `/expand`, `/organize`). A plain chat question with
no named model and no parked session is not queued for it; the chat window
tells you at once.

### Optional · Remote answering session

The **renderer tab must stay on the broker's machine** — only the answering
session can be remote:

```bash
BRIDGE_HOST=0.0.0.0 npm run bridge
```

on the hive machine, then `bridge give <their name>` in the hive tab, and on
the remote machine:

```bash
BRIDGE_URL=ws://<hive-machine>:2401 HYPERCOMB_BRIDGE_TOKEN=<their code> npm run bridge:watch
```

Without a code, remote senders are refused outright — that is the safe
default.

### Who may use the bridge — codes

The broker serves **this machine** without asking: a Node client on loopback
that sends no `Origin` header — your scripts, `npm run bridge:watch`, a parked
Claude Code session. **Everyone else needs a code**: a session on another
machine, and every browser page that sends ops, a localhost page included.
(Registering as the renderer needs no code, but it is loopback-only and only
from a hive page: `BRIDGE_RENDERER_ORIGINS`, comma-separated origins such as
`http://localhost:4267`, replaces the default list of the hive's dev and web
ports. While a renderer holds the slot, a second one is refused unless it is
another tab of the same origin, carries the same non-empty code list, or is
this machine's own tool; and an answer counts only from the socket its op was
sent to.)

You give codes from the hive, with one word:

| Say | What happens |
|---|---|
| `bridge` | Lists the codes by fingerprint (the first 8 characters of the code's hash) and name — or says there are none, and only this machine's tools can connect |
| `bridge give <name>` | Mints a code (`hcb-` and 32 base32 characters) and copies it to the clipboard. **It is shown once, never again**; if the clipboard is refused, a prompt holds it for you to copy |
| `bridge add <name>` | Holds a code someone already has — 1 to 256 letters, digits or ASCII symbols, no spaces, because a script sends it in a header. The hive asks for it in a prompt — never type a code on the command line, which keeps a history. A line that carries one (`bridge add susan <code>`) adds nothing and is cut back to `bridge add susan` in the history |
| `bridge withdraw <fingerprint\|name>` | That code stops working at once — on its holder's very next op, even on a socket that is already open |

Only you say it, at the keyboard: a model, and a bridge `submit`, are refused
every form.

- **The broker gets hashes, never codes.** The hive keeps each code's SHA-256
  under its name, on this device only (`hc:bridge:codes` — never a pool, a
  resource, an event or an export), and the renderer tab hands the broker the
  whole list of hashes when it registers and again whenever the list changes.
  The broker hashes what a sender presents and compares. The list belongs to
  the renderer's socket: when the tab goes, the broker forgets it — and with
  no renderer there are no ops anyway.
- **Default deny.** With no codes, nobody but this machine's own tools gets in.
- **Presenting a code.** A Node client sends `Authorization: Bearer <code>` on
  the handshake. Setting `HYPERCOMB_BRIDGE_TOKEN=<code>` makes these clients
  send it: `npm run bridge:watch` (`watch-asks`), `npm run bridge:drain`
  (`drain-tick`), and `manager`, `breaks`, `orchestrator-sweep`,
  `bridge-agents`, `_ask-drain`, `_bop`, `_chat-reply` and `_put-file` in
  `scripts/bridge/`, plus essentials' `stamp-install-channel`. **No other
  bridge script sends a code** — `npm run bridge:check` (`bridge-cli`), the
  one-off `scripts/bridge/_*` publish drivers, `scripts/drive-bridge-agents.cjs` — so
  they serve this machine only and are refused from anywhere else, code or
  not. A page sends `{"type":"code","code":"<code>"}` before its ops. Never
  in a URL or a subprotocol.
- **The env token is a fallback.** `HYPERCOMB_BRIDGE_BROKER_TOKEN` set on the
  *broker* admits whoever presents it — for a broker with no hive tab to give
  codes. It cannot be withdrawn without restarting the broker, so prefer
  codes. It is a different variable from `HYPERCOMB_BRIDGE_TOKEN` on purpose:
  that one is what *your* scripts present to someone else's broker, and a code
  you hold for another hive must never open yours. The broker says at start
  when it sees `HYPERCOMB_BRIDGE_TOKEN` and does not admit it.

---

## Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| `no renderer connected` | Broker is up; tab isn't registered | Open/reload `http://localhost:4250/?claudeBridge=1`; close any duplicate tab |
| Connection refused on 2401 | No broker | `npm run bridge` |
| Port 2401 already bound | Broker already running | Use it — never start a second |
| Asks queue but nothing answers | No responder | Step 5 (park) or the drain schedule |
| Chat says "Nothing is listening yet" | A question was queued (a named model) and no session is parked — live truth from `bridge:status` (`listening`) | Step 5 — park a session, or withdraw the question |
| Chat says "no Claude session is parked on the bridge" | No model took a plain question and nothing was queued (the broker is up; no watcher is visiting) | Step 5 — park a session, or fix the providers console; just after a reload give the watcher ~10 s |
| Worked, then died after a tab reload | Renderer reconnects only if it had connected once | Reload the tab after the broker is up |
| Two browsers flapping connect/timeout | Two tabs fighting for one renderer slot | Windows: `Get-NetTCPConnection -RemotePort 2401` to find them; close one |
| `unauthorized — this bridge serves its own machine…` | A page or a remote sender without a code | `bridge give <name>` in the hive tab; send it as `Authorization: Bearer <code>`, or from a page as `{"type":"code","code":"<code>"}` first |
| Broker logs `refused a renderer from page … not a hive page` | The hive runs on a port outside the default list | Start the broker with `BRIDGE_RENDERER_ORIGINS=http://localhost:<port>` |
| Broker logs `refused a second renderer … holds the slot` | Another hive tab, on another origin, is already the renderer | Close one tab; the other takes the slot on its next retry |
| Banner: "Can't reach {host}" — and {host} is not where your tiles go | `{host}` is the swarm's MEETING RELAY (the mesh's `swarmHost()`), never an upload host: the socket to it has not been open for 30 s. With no zone relay and no `hc:nostrmesh:relays`, a real host meets at the built-in `wss://jwize.com`, whatever the publish hosts are | `npm run bridge:swarm` — `mesh.swarmHost`, `mesh.relays`, `mesh.sockets` (ready states), `mesh.connection` (state, refusal) and `membership.zone.relay` |
| "{branch}: {host} can't be reached" or "Can't upload to {host}" | An UPLOAD host refuses this tab's bytes or cannot be reached | `npm run bridge:swarm` — `share.shareStatus.blocked`, `share.hostTrouble`, and `share.syncByHost`: each host's last `sync:state` word heard since the bridge module loaded (plus the one replayed at load, `heardAtMs: null`); `share.targets` says where host sync is configured to write |

---

## Path B: API keys instead of a subscription

Without Claude Code, the hive can still answer two ways:

1. **Host relay** — a hive host (e.g. your own deployment's content worker)
   fields `/ai/ask` with *its* key and streams the answer into the chat
   window's shallow tier. Nothing to install; the host operator configures it.
2. **Direct key** — a personal Anthropic API key stored locally in the
   browser (`hc:anthropic-api-key`) powers translation and lightweight
   features today.

Multi-provider keys (OpenAI, Gemini, Grok, DeepSeek, Mistral, local models)
and the in-hive guided key setup are the subject of the
[AI first-class plan](ai-first-class-plan.md) — the provider picker page will
walk you through each vendor's key the moment you first pick its tile.

---

## What the bridge is **not**

- It is **not** a cloud service. Every byte stays between your browser, a
  localhost relay, and a process you run.
- It is **not** Anthropic-specific *as a protocol* — the ask record carries a
  model hint, and any process that can speak a WebSocket and JSON can be a
  responder. Adapters for other agent CLIs are planned (same plan document).
- It does **not** need an API key on Path A. The subscription you already have
  is the whole engine.
