# Subscription endpoint — a CLI plan the hive can call

A frontier CLI signed in to a plan (Grok on grok.com) answers on money already
spent. The hive cannot spawn a CLI, but it can call a local model server — the
door Ollama uses — so a subscription endpoint is that door with the CLI behind
it.

```bash
npm run grok          # from src/: http://127.0.0.1:11435/v1
```

`scripts/subscription/grok-endpoint.cjs` speaks the OpenAI shape
(`/v1/chat/completions`, streaming or not, `/v1/models`). Each request is one
headless `grok` turn on the participant's own sign-in. No API key exists.

## What it is not

It is a CHAT model, not an agent. Every tool is removed, web search and
subagents are off, permissions deny anything left, and it runs in an empty
temp folder. A prompt from the hive can make Grok talk, never touch the
machine. The agent that reads and writes the hive is the bridge tier
(`scripts/bridge/agent-bridges.json`).

## Who may call it

Loopback bind only. A browser page is judged by its `Origin`: loopback pages,
`https://hypercomb.io` and `https://hypercomb.com` are admitted. Any other site
gets 403, so a page you happen to visit cannot spend your plan. `GROK_ORIGINS`
adds more. A caller with no Origin is this machine's own tooling.

## Into the hive

`GET /provider.json` (or `node scripts/subscription/grok-endpoint.cjs --spec`)
prints an `llm-provider@1` spec. Paste it into **/providers → Add provider**.

The spec names an `account`. That one field is what makes the row honest. A
keyless loopback endpoint is otherwise costed `local` ("runs on this machine,
nothing leaves"), but the prompt goes to xAI. With an account it is costed as
a bill already signed (`costOf` → `bridge`), so it sits on the **Subscription**
tab. The compiler refuses `account` on anything but a keyless loopback
endpoint: a remote server cannot vouch for a plan on your machine.

The liveness watch already probes every loopback provider, so the row reads
asleep while `npm run grok` is not running.

## Env

| var | default | |
|---|---|---|
| `GROK_PORT` | `11435` | beside Ollama's 11434 |
| `GROK_BIN` | `grok` on PATH, else `~/.grok/bin/grok` | |
| `GROK_EFFORT` | — | reasoning effort when a request names none |
| `GROK_CONCURRENCY` | `2` | turns at once; the rest queue |
| `GROK_ORIGINS` | — | extra page origins allowed to call |
