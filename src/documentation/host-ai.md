# Host AI — talking to your hive

**Status: BUILT (client + host route), 2026-07-24. Not deployed — needs the
`ANTHROPIC_API_KEY` secret on the worker.**

Two tiers answer questions, and they are deliberately different animals.

| | **Host AI** (this doc) | **Claude Code bridge** |
|---|---|---|
| Where | The operator's Cloudflare worker (`content.jwize.com`) | Home server, `ws://localhost:2401` |
| Model | Haiku (`AI_MODEL`) | Whatever Claude Code runs |
| Latency | First tokens ~sub-second, streamed | Agent turn |
| Can it write? | **No** — read-only, answers only | Yes — full hive authorship |
| Needs home server awake? | **No** | Yes |
| Reachable from a phone on mobile data? | **Yes** | Only on the LAN |

The host tier is the *immediate* one: ask a question anywhere, get an answer
now. The bridge stays the *deep* one. They do not overlap and neither
replaces the other.

## The route — `POST /ai/ask`

Added to `hypercomb-relay/blossom-worker/worker.js` (the same worker that
already serves the public sig heap, so there is no new deployment target).

```
POST https://content.jwize.com/ai/ask
Authorization: Nostr <base64(kind-27235 event)>
Content-Type: application/json

{ "question": "what is this hive about?",
  "context": ["<sig>", "…"],     // optional, ≤8
  "stream": true }               // default
```

Replies `text/event-stream` — Anthropic's SSE passed straight through, so the
client sees `content_block_delta` text as it is produced.

### Auth — the same envelope as byte writes

A NIP-98 (kind 27235) Nostr event signed by the participant's own key, binding
method + full URL + freshness (±60s). No secret ever leaves the device; the
worker verifies the schnorr signature. This is exactly what `host-sync` PUTs
already carry, so identity is one concept across the whole host surface.

### Who may spend the operator's API money

- `AI_WRITERS` set (comma-separated pubkeys) → **allowlist**; nobody else.
  This is the right setting for a personal host.
- `AI_WRITERS` empty → open to any valid signer, throttled by a per-pubkey
  per-day token estimate in `GRANTS` KV (`ai:<pubkey>:<yyyymmdd>`, expires in
  two days). An anti-abuse ceiling, not billing — same doctrine as the byte
  quota.

### Context is signatures, never inline bytes

`context` holds **content sigs already on the host**. The worker resolves them
from its own R2 heap, caps them (8 sigs · 16 KB each · 48 KB total), and
inlines the text server-side. Bytes never ride the request twice, and the
signature doctrine holds end to end.

### Safety properties

- The API key is a **Wrangler secret**, never a var, never logged. Without it
  the route answers `503` and costs nothing.
- The worker never echoes the upstream error body (it may contain request
  echoes) — status plus a terse reason only.
- Read-only by construction: this route resolves sigs and calls the model. It
  cannot write a layer, mint a tile, or touch OPFS.

## The client

`hypercomb-essentials/src/diamondcoreprocessor.com/assistant/host-ai.service.ts`
— `HostAiService`, IoC `@diamondcoreprocessor.com/HostAi`.

```ts
const ai = window.ioc.get('@diamondcoreprocessor.com/HostAi')
for await (const chunk of ai.ask('what changed today?')) render(chunk)
const answer = await ai.askText('summarise this page')   // one-shot
ai.setHost('my.domain')                                   // default content.jwize.com
```

Every chunk is mirrored onto the EffectBus as
`ai:answer {id, chunk?, text?, done, error?}`, so any surface — the command
line, a future chat sheet, the mobile shell — can render answers without
importing the service. Loopback hosts use `http`, real domains `https` (the
same rule host-sync applies).

`/ask <question>` is the slash surface (`commands/ask.queen.ts`): streams,
then shows the answer as a sticky toast with the full text on the console.
`/ask host <domain>` repoints it; `/ask host` reports it.

## Verified (2026-07-24)

Against a local stand-in worker that performs the **real** schnorr
verification (so the auth result is meaningful, not a lenient stub):

- Server-side checks all passed: `kind27235`, `sigValid`, `methodTag`,
  `uTag`, `fresh` — the signing envelope genuinely works.
- Streaming: first chunk **138 ms**, incremental deltas, correct reassembly
  ("Your hive has two tiles: alpha and beta.").
- `/ask` rendered the answer in the UI; `/ask host` reported the host.
- Unsigned request → `401`. Worker `node --check` clean. Doctrine 81/81.

Not yet exercised against the real Anthropic API — that needs the secret.

## Deploying it

```bash
cd src/hypercomb-relay/blossom-worker
wrangler secret put ANTHROPIC_API_KEY      # paste the key
# lock it to your own keys (recommended for a personal host):
#   edit wrangler.toml → AI_WRITERS = "<your pubkey hex>"
wrangler deploy
```

Then from the app: `/ask host content.jwize.com` (or leave the default) and
`/ask what is this hive about?`.

## Not built yet

Voice input (Web Speech → `/ask`; the mobile bar already has a mic button
wired to push-to-talk effects); a chat surface over `ai:answer` (currently a
toast); conversation memory (each ask is independent); letting answers write
back into the hive (deliberately excluded — that is the bridge's job, behind
the ask-gate).
