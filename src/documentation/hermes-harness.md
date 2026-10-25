# Hermes as a harness — two records and a conversant

*Design, not built (2026-10-24). No code has changed for this document.*

jwize, 2026-10-24, on pairing Nous Research's Hermes Agent with the hive:

- *"we want to have bridgeless support for everything"*
- *"we need to divorce command line tools to update the hive but also retain
  bidirectional communication between desktop harnesses the same."*
- *"the operation can log it in the hive and then we can read it using the
  dialect"* — *"from windows or from hypercomb chat"*
- *"Make sure we are entirely encapsulated so we don't pollute when hermes is
  not being used."*
- *"we probably should be able to list available grants if we need to allow
  things and then toggle them somehow."*
- *"we should build things but teach the harness to use the hypercomb storage
  protocol to read and save data so it is context is not fragments(should
  always live in the hive)"*

**What Hermes Agent is.** An open-source (MIT) agent harness: a loop with
tools, memory, skills, a scheduler and chat-app gateways, that runs on any
model it can reach — OpenRouter, Anthropic, OpenAI, Nous Portal, or any
OpenAI-compatible endpoint, local ones included. It is the same kind of thing
as Claude Code or Codex, open and not tied to one vendor.

**What it cannot be.** It cannot live in the hive: it is a Python process with
its own loop and its own files, and the hive runs only signed modules in the
browser. Its loop cannot be copied in either. What the hive can hold is its
own harness record, set up the way jwize wants to run Hermes models, and the
model itself ([agent-harness](agent-harness.md): a harness is content). The
program on Windows becomes one more desktop harness that **speaks and reads,
and never changes the hive itself**; whatever it builds, and whatever it needs
to remember, is stored in the hive by signature.

Doctrine that binds this document: [speak-dont-bridge](speak-dont-bridge.md),
[permission-groups](permission-groups.md), [agent-harness](agent-harness.md),
[replayable-agent-loop](replayable-agent-loop.md),
[known-location-pools](known-location-pools.md),
[signature-system](signature-system.md).

## 1. The two records

In the hive, Hermes is two records in two pools, and nothing else.

| Record | Pool | What it carries |
|---|---|---|
| `harness@1` named `hermes` | `agent:harness` | The loop's policy: legs, budget, reads, handover, review, vocabulary, delegates — and, once gap 3 lands, the worker it runs on |
| `llm-provider@1` for a Hermes model | `llm:providers` | Where the model answers: Hermes 4 70B or 405B through OpenRouter, or a local Hermes through Ollama or LM Studio (openai shape, localhost endpoint) |

- **The harness record** is a policy, not a program. `parseHarness` already
  refuses a record that auto-runs a kind the participant holds (`do`,
  `write`, `table`), so a Hermes record can narrow the loop and can never
  widen it.
- **The provider record** is a spec, like every other model. Its key, if it
  needs one, is device-local and never travels with the spec.
- **Jev still judges.** A harness may name the judge; it may not remove the
  change gate ([agent-harness](agent-harness.md) §5). Hermes changes who does
  the work, not who decides what runs.

**Chosen per conversation, never per device.** In hypercomb chat,
`harness here hermes` puts the open conversation on it and
`harness here default` takes it off. `harness try hermes <request>` runs one
turn under it and files the receipt. **`harness use hermes` is not how Hermes
is chosen**: that word sets the device default, so every conversation would
run under it.

**Its record of work is already in the hive.** Every turn files a receipt in
`agent:receipts`, keyed by harness signature; `harness compare` reads them
(answered, rounds, tokens, seconds, legs). The run ledger in the conversation
records attempts; history records effects. All three are read in the dialect.

## 2. The Windows conversant

The Hermes program on Windows is a conversant: it says sentences, the hive's
own words perform them and record them, and it reads the outcome by saying a
word. Claude Code, Codex and Hermes on Windows, and hypercomb chat in the
browser, all use this one loop.

```
desktop harness (Hermes, Claude Code, Codex)        hypercomb chat
        │ says a sentence (files ride with it)            │ says a sentence
        ▼                                                 ▼
   the remote door ──────────────▶ the hive's command line ◀──
                                         │
                                         ▼
                     the word acts, under the actor's grants
                                         │
                                         ▼
          recorded in the hive: history (effects), the ledger (attempts),
                    receipts, the line's own record (gap 2)
                                         │
        ┌────────────────────────────────┘
        ▼
   any harness reads it back by saying a word
```

- **The command-line tool is a mouth and an ear, never a hand.** It carries
  one sentence in (with any files that ride with it) and one reading out. No
  raw op (`add`, `put-resource`, `decoration-add`, `effect-emit`, `op`) is
  part of this loop.
- **One carrier remains, and it carries words.** Anything outside the browser
  needs something to bring its sentence into the tab. That is the remote door
  (`command-line:remote-submit`, reached through the broker on
  `ws://localhost:2401`), as [speak-dont-bridge](speak-dont-bridge.md) already
  says. It is the only part of the bridge this design keeps.
- **The reply is a record, not what happened to be heard.** Today a session
  learns the outcome from `heard`: the toasts and activity lines the door
  catches while it listens. That depends on timing, and three managers reading
  at once heard each other's answers. In this design each line leaves its own
  record in the hive and the harness reads that record by a word (gap 2), so
  the answer does not depend on who else was speaking.
- **It speaks as itself.** Hermes gets its own actor code (`bridge give
  hermes`, then `permit hermes add code hermes`), so the hive knows which
  harness said each line and applies that harness's grants
  ([permission-groups](permission-groups.md): identity is a fact the broker
  stamps).

**Hermes's own state stays in one Hermes profile.** It runs as
`hermes -p hypercomb`, so whatever Hermes itself keeps lives in
`~/.hermes/profiles/hypercomb/` and nowhere else. In that profile:

- `memory_enabled: false` and `user_profile_enabled: false` — the hive and the
  conversations are the memory (§3); Hermes keeps no private second copy.
- Self-written skills off (confirm the configuration key at install). A gap
  Hermes runs into is a missing word in the dialect, and the fix is the word
  ([speak-dont-bridge](speak-dont-bridge.md)), never a private Hermes skill.
- One skill, written by hand: the storage protocol in §3, say sentences, read
  by words, report what the hive answered, never retry around a hold.

**The messaging gateway is out of scope.** Hermes can answer on Telegram,
Signal, Discord and others. Nothing in hypercomb depends on that, and those
services are third parties; if jwize uses one, it talks to Hermes, and Hermes
still only says sentences.

## 3. Context lives in the hive — the storage protocol

A harness that builds things must not keep its work as fragments in its own
files. Everything it makes, and everything it needs to pick the work up again,
is stored in the hive by signature and read back by word. The protocol a
harness is taught:

| Act | How | State |
|---|---|---|
| **Send bytes** | Files ride with the sentence. The sender computes each file's SHA-256 and sends the bytes base64-encoded in the same message; the hive checks the bytes hash to that signature (a mismatch runs nothing), stores them sig-named at the OPFS root before the line runs, and leaves them inert until a word names them. In the sentence, `{<file name>}` becomes the signature. | Built (`say.cjs --file`, the remote door) |
| **Refer** | A sentence carries signatures, never inline content: `website page {meetups.html}`. What a signature names never changes, so a reference is exact forever. | Built |
| **Read a tile** | `read /<route>` — the tiles under it and its notes | Built |
| **Read bytes back** | `read <signature>` | The chat's read fence has it; the `read` word takes routes only — gap 2 |
| **Remember** | The harness's memory is its conversation in the hive: read it first, write it last — the way the managers already work ([hive-management-org](hive-management-org.md)). On every start it rebuilds its context by reading; nothing it needs is on the desktop. | Reading and writing a conversation are still bridge ops (`thread-read`, `chat-reply`) — gaps 2 and 5 |
| **Build code** | A module section is a file that rides with a line; a word makes it a draft, and drafts go through `module commit`, its trial door and `module promote`, all jwize's words | No word turns a file into a draft yet; drafts come only from the chat's write fence — gap 6 |

**Is the encoding necessary?** The bytes have to cross into the browser,
because the OPFS belongs to the browser and a desktop harness cannot write it —
and under this design must not. Base64 is only how a JSON message carries
bytes; the part that matters is the signature check, and it is already built.
Nothing new needs inventing. When the bytes already live on a host, the
sentence can carry the signature alone and the hive fetches it by
replication.

**Storing bytes is not changing the hive.** A file that rides with a line is
stored by its signature and does nothing until a word names it. The change
happens when the word runs, under the actor's grants, and that is what the
history and the line's record show.

## 4. Encapsulation — nothing left behind when Hermes is not used

The test: **with Hermes unused, the hive and the repo are exactly what they
would be if Hermes had never existed.**

| Rule | How it holds |
|---|---|
| No code names it | The harness words and the provider registry act on records by name or signature. No source file mentions Hermes; only this document and its line in the index do. |
| Nothing is seeded | Only `default` is minted at boot. A Hermes record arrives by jwize's own `harness import`, or by `harness sync` from a host, where it is held until chosen. |
| No device default | Hermes is chosen with `harness here`, per conversation, never `harness use`. |
| No automatic routing | The provider stays switched off for routing, so `chooseProvider` never picks it for another conversation; explicit naming still reaches it (`configuredProviders` filters by activation, naming wins). Once gap 3 lands, the harness record names it. A local Hermes left on would otherwise be picked by `preferFree` for every conversation. |
| No widening | Its grants are its own group's (§5), which start manual. Its record can narrow the census and cannot widen it. |
| No roster entry yet | No line in `scripts/bridge/agent-bridges.json` until gap 2 lands. Then one entry, which is data, and which the probe does not announce on a machine without Hermes installed. |
| No state outside its profile | Hermes writes only under `~/.hermes/profiles/hypercomb/`, outside the repo — and with learning off, nothing there matters (§3). |
| Removal | Hide the two records (hide first, delete second — both jwize's), dissolve the `hermes` group (its actor moves to `held`), and delete the profile folder on Windows. What Hermes built stays in the hive, by signature, like anything else. |

## 5. Grants — listed, and switched on and off

**What exists today.** `grant` sets one ceiling for every machine on the
device:

| Word | Does |
|---|---|
| `grant` | What is granted now, and what that admits |
| `grant additive` / `grant destructive` | How much a machine may change |
| `grant page` | How far a change may travel |
| `grant none` | A machine may say nothing here |
| `grant verbs` | The catalogue a model is taught under the grant, line by line — the list of what can be allowed |
| `grant allow <verb>…` / `grant deny <verb>…` | Switches a verb a behaviour offers on or off (or `all`) |

That is a list and a switch, but it is shared by every machine. Granting
`file` to the managers grants it to Hermes too.

**What Hermes needs: grants per actor.** The `permit` words in
[permission-groups](permission-groups.md) are designed and not built — no
`permit` word exists in code. With them, Hermes gets a group of its own:

```
bridge give hermes
permit hermes add code hermes
permit hermes                  the group: mode, kinds, members, what ran by policy
permit hermes read             reads run on arrival; everything else waits for a hand
permit hermes read additive    additions also run; editing still waits
permit hermes manual           nothing runs by itself again
```

- A new group starts manual. Destructive lines always wait for a hand, and
  nothing lifts the Execution holds (`needsGrant`, leaves, foreign).
- **Listing is a word, switching is a word.** `grant verbs` lists the verbs,
  `permit` lists each group with its kinds; `grant allow`/`grant deny` and
  `permit <group> <kind>…` switch them. The Execution window's Always button
  stays a second way to say the same thing for one kind.
- **The harness narrows further.** The record's `vocabulary.deny` takes verbs
  away from whoever runs under it — a read-only Hermes denies every `do`. It
  can never add a verb the grant does not hold.

## 6. The gaps, in build order

Hermes itself is almost no work once these exist. Each one helps every
harness, not only Hermes, and each one retires a bridge op or fills a missing
word.

### Gap 1 — `permit`: grants per actor

Build the `permit` words and the group records exactly as
[permission-groups](permission-groups.md) lays them out (its "Implementation
steps"). Done when: a `hermes` group exists, `permit hermes` lists it, a
`read` line from Hermes's code runs on arrival, an `editing` line waits for a
hand, and the managers' group is unaffected by any change to Hermes's.

### Gap 2 — read back by words

The readings a session still takes over the bridge, or cannot take at all,
become words:

| Reading | Today | Owed |
|---|---|---|
| What happened to the line I said | `heard`, caught while listening | Each line gets a record (the `decision@1` shape in [permission-groups](permission-groups.md), not in code yet): who said it, ran / waiting / refused, by policy or by hand, and a pointer to the effect in history. A word reads an actor's last lines. |
| What waits for a hand | `manager.cjs held` → `effect-last agent:held` | A word that lists the waiting lines. |
| A conversation, and a delegated answer | `manager.cjs thread` → `thread-read`; `manager.cjs ask` polling `chat-asked` | The turns are already stored in the conversation; a word reads its turns, its last answer and its receipt. |
| Bytes by signature | Only the chat's read fence | `read <signature>` as a word. |

The line's record is not a save: no human act causes it, so it adds no kept
version (jwize, 2026-10-03: *"saves never happen without human intent"*).
Done when a session can say a line, then read what it did, what waits, what a
conversation holds and what a signature names, with no bridge op and no
listen window.

### Gap 3 — the harness names its worker

A harness record cannot say which model it runs on today; tier pins are
per device (`hc:llm:pin:<tier>`). So `harness here hermes` would change the
policy and leave the model to the device. Add a field that names the worker
by the provider spec's signature and a model that spec lists:

```json
"worker": { "provider": "<signature of the llm-provider@1 spec>", "model": "<a model the spec names>" }
```

- A signature, not a vendor name ([signature-system](signature-system.md)).
- If the named worker cannot answer on this device (no key, endpoint down,
  provider removed), the turn stops and says so. It does not fall through to
  another vendor, which would spend the participant's money on a model
  nobody chose.
- Jev, the change gate and the Execution window are unchanged.

### Gap 4 — vocabulary narrowing is applied

`parseHarness` reads `vocabulary.allow` and `vocabulary.deny`, but no code
that builds a turn's census was found reading them. Wire them where the turn's
powers are assembled, and also at admission, so a denied verb is neither
taught to the model nor accepted if the model says it anyway. Done when a
spec proves both.

### Gap 5 — a harness writes its own conversation by a word

A manager reports with `manager.cjs report`, which is the `chat-reply` bridge
op. Owed: a word that adds a turn to a conversation the actor owns, so a
harness writes its memory last by saying it. It may write only its own
conversations, never a participant's. Done when Hermes can end a pass by
saying its report and begin the next by reading it (gap 2), with nothing kept
on the desktop.

### Gap 6 — a file that rode with a line becomes a module draft

Drafts come only from the chat's write fence today. Owed: a word that takes a
file that rode with the line, by its signature, and makes it the draft at a
module path. It is code that runs, so it always waits for a hand, whatever
the actor's group permits — the way the model's doctrine writes always go to
review. Commit, trial and promotion stay jwize's words (`module commit`,
`module promote`). Done when a desktop harness can propose a module change
entirely in sentences and the draft shows in `module` before anything runs.

### Then — the pairing itself

1. Hermes 4 as an `llm-provider@1` spec in `llm:providers`, switched off for
   routing.
2. `harness import` of the `hermes` record naming that worker.
3. `bridge give hermes`, the `hermes` group, its first permits.
4. On Windows: install, the `hypercomb` profile with learning off, the one
   skill (§3).
5. A trial: `harness try hermes <request>` on a few of jwize's own requests,
   then `harness compare`. Hermes earns a place by its receipts.

## 7. Decisions for jwize

1. The names of the owed words (gaps 2, 5 and 6).
2. A named worker that cannot answer: stop and say so (proposed), or fall
   through to the device's policy.
3. The `hermes` group's first permits: `read` (proposed), or manual.
4. Which Hermes model: Hermes 4 70B through OpenRouter (cheap, keyed), or a
   local Hermes (free, needs the machine's own model server).
5. Whether the messaging gateway is used at all.

## 8. Facts about Hermes, as checked on 2026-10-24

- MIT licensed, from Nous Research, released February 2026.
- Any model: `--provider` accepts OpenRouter, Nous, Anthropic, OpenAI, Gemini,
  DeepSeek, xAI, Bedrock, LM Studio, Ollama Cloud and `custom`;
  `--provider custom --base-url <url>` reaches any OpenAI-compatible endpoint.
  How well it works depends on the model's tool use; small local models do
  worse.
- One-shot mode: `hermes -z "<prompt>"` prints only the final reply; exit code
  0 on completion, 2 on failure, 130 on interrupt, 1 when no text came back.
  `-m` chooses the model.
- Profiles: `hermes -p <name>` keeps a profile's memory under
  `~/.hermes/profiles/<name>/`. Built-in memory is `MEMORY.md` (2,200
  characters) and `USER.md` (1,375 characters); sessions are SQLite with FTS5
  at `state.db`. `memory_enabled` and `user_profile_enabled` turn the built-in
  stores off.
- No flag was found that removes its write tools, so the bridge roster's
  read-only work would refuse it as things stand.
- Windows: a native installer exists but support is early; the gateway is
  documented on WSL. This machine had neither Hermes nor WSL installed when
  this was written.

Sources: [Hermes Agent docs](https://hermes-agent.nousresearch.com/docs/) ·
[CLI reference](https://hermes-agent.nousresearch.com/docs/reference/cli-commands) ·
[Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory) ·
[OpenRouter: Nous Research models](https://openrouter.ai/nousresearch/hermes-3-llama-3.1-405b:free)
