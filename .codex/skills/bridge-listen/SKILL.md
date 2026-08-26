---
name: bridge-listen
description: Park this Codex session on the Hypercomb bridge and handle live hive asks. Use when the user invokes /bridge-listen, asks Codex to listen for hive asks, or wants Codex available as a local orchestrator provider.
---

# Bridge listen

Turn this Codex session into a live Hypercomb responder. Run bridge commands from the repository's `src` directory so Node can resolve the workspace dependencies.

## Canonical bridge protocol

Before listening, read `src/.claude/skills/bridge-listen/SKILL.md` completely. It is the shared protocol for ask payloads, chat replies, structural tasks, progress, feedback summaries, stopping, and retirement. Follow it exactly, interpreting references to "this Claude Code session" as this Codex session. Do not copy or fork the transport logic: use the existing scripts in `src/scripts/bridge/`.

## Start listening

1. From `src`, run `node scripts/bridge/bridge-agents.cjs --announce` so every installed local agent CLI, including Codex, is registered in the hive provider list.
2. Run `node scripts/bridge/watch-asks.cjs --once` and handle any pending records according to the canonical protocol.
3. Run the feedback-loop summary required by the canonical protocol and report who is waiting before saying the session is parked.
4. Start exactly one persistent `node scripts/bridge/watch-asks.cjs` process and keep its execution session open. Silence means healthy. Wait for output rather than polling in a new process.
5. For every emitted record, follow the canonical protocol and use the existing drain/chat/bridge helpers to deliver and retire it. Continue listening until the user asks to stop.

When a chat turn genuinely attains the conversation's goals, follow the canonical protocol's `chat-goal-reached` step and name the attained goals, one per line. Do not mark ordinary answers, plans, or partial progress as completion.

If the broker is unreachable, start `node scripts/bridge/run-bridge.cjs` as a persistent process, then retry. If the renderer is missing, tell the user to open or reload exactly one `http://localhost:4250/?claudeBridge=1` tab; do not open it without permission.

## Provider identity

Codex is declared by `src/scripts/bridge/agent-bridges.json` as `codex-bridge`. Do not create a duplicate provider spec. The announce command probes the installed CLI and registers that existing spec alongside `claude-bridge`, giving the orchestrator both choices.
