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

A question typed in the hive is written as a durable **ask record** in your
hive's own storage. The responder polls for those records through the broker,
answers, and retires them. Close the laptop mid-question? The ask survives —
it is answered when a responder next connects.

**Trust model**: the broker binds to loopback only. Registration as a renderer
is *always* loopback-only. Nothing on your network can touch your hive unless
you deliberately bind wide **and** set a shared token (covered below).

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

One-shot smoke test instead of parking:

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
- `/atomize` asks for structure (the responder creates child tiles),
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

`_bop.cjs` sends any raw bridge op. The op vocabulary (36 verbs: `layer-at`,
`inflate`, `note-add`, `put-resource`, `decoration-add`, `submit`, …) lives in
`claude-bridge.worker.ts` — and `{"op":"submit","text":"/website"}` types into
the hive command line itself, so anything you can do by hand, a script can do.

### Optional · Unattended answering (no parked session)

Schedule this every few minutes (Task Scheduler / cron):

```bash
npm run bridge:drain
```

Zero pending asks costs nothing and exits silently. When asks are pending it
spawns `claude -p` once per model group, maps the hive's model hint
(opus/sonnet/haiku/fable) to a real model id, answers, and retires the asks.
`--dry` reports without answering.

### Optional · Remote answering session

The **renderer tab must stay on the broker's machine** — only the answering
session can be remote:

```bash
BRIDGE_HOST=0.0.0.0 HYPERCOMB_BRIDGE_TOKEN=<shared-secret> npm run bridge
```

on the hive machine, and on the remote machine:

```bash
BRIDGE_URL=ws://<hive-machine>:2401 HYPERCOMB_BRIDGE_TOKEN=<shared-secret> npm run bridge:watch
```

Without the token, remote senders are refused outright — that is the safe
default.

---

## Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| `no renderer connected` | Broker is up; tab isn't registered | Open/reload `http://localhost:4250/?claudeBridge=1`; close any duplicate tab |
| Connection refused on 2401 | No broker | `npm run bridge` |
| Port 2401 already bound | Broker already running | Use it — never start a second |
| Asks queue but nothing answers | No responder | Step 5 (park) or the drain schedule |
| Chat window says nothing is listening | Live truth from `bridge:status` | Same as above — start a session |
| Worked, then died after a tab reload | Renderer reconnects only if it had connected once | Reload the tab after the broker is up |
| Two browsers flapping connect/timeout | Two tabs fighting for one renderer slot | Windows: `Get-NetTCPConnection -RemotePort 2401` to find them; close one |

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
