# Working in the debugger — the chat on a subdomain

**Status: spec, 2026-11-11. Steps 0 and 1 are done on `claude/subdomain-minimal-debug-9544be`: the page, the chat and its round loop were run on a `try-` subdomain of this machine, and the run is recorded below. jwize took the three recommended choices at the end ("Yes, go"). Not deployed.**

jwize, 2026-11-11: "we single click an editing tile to debug basically, It opens the subdomain and you are debugging. You then have access somehow to suggested tools like ai. Then you adopt by click and now you accept and have ai. You can develop from there."

The same day: "anything built in the debugger (subdomains) should not load angular. This will be our process to phase out angular." And: "I would love to see what it is like to do work on the new chat in a subdomain. We can then debug and create revisions on the fly and compare them just like cross domains. We should spec this out to be done minimal and cleanly."

This page is that spec. It adds no new mechanism where one exists: the subdomain is the mission door of [build-debug-isolation.md](build-debug-isolation.md), a revision is a signature ([build-revisions.md](build-revisions.md)), and a change comes home through the brood ([module-sandbox.md](module-sandbox.md)).

## The loop

1. In the tile editor, press **Debug** on a tile. Its subdomain opens: `try-<tile>.<zone>`.
2. The page there has no Angular. It offers the AI chat as a suggested tool. One press turns it on.
3. Ask the chat for a change. It reads the code, writes the new version, and the page runs it.
4. Every version it writes is a **revision**: a signature. The chat lists them, newest first, beside the versions other domains hold of the same file.
5. Check two revisions to **compare** them. Pick one and it is what runs.
6. Press **Take home**. The revision arrives in your own hive's brood and waits there until you accept it.

That is the whole experience. Everything below is what it takes to make those six lines true, and nothing else.

## Three facts the design rests on

- **A subdomain is its own origin.** Its storage is its own. Your provider keys, your grants, your tiles and your signing key are not there, and the worker pins the signer off before any module runs. A package on that page has full page power, which is why.
- **A debugger subdomain writes nothing to the host.** The worker refuses every write from a `try-` origin.
- **A revision is content-addressed.** Its bytes can be handed anywhere and checked against its signature by whoever receives them.

The first fact decides who answers the chat (decision 1). The second and third decide how a revision gets home (decision 2).

## What exists

| Piece | Where | State |
|---|---|---|
| A `try-` subdomain is served the framework-free shim, never the web shell | blossom-worker `serveSandboxShell` | built, specs pass, not deployed |
| The chat as an element: a conversation, a streamed answer, Stop | essentials `assistant/chat.view.ts` | built, specs pass |
| The chat changes the hive: granted behaviours, a Run list, the result back to the model | essentials `assistant/chat-work.ts`, `core/machine-plan.ts`, `core/work-instruction.ts` | built, specs pass |
| A suggested behaviour: off, offered once | `hc:behavior-suggested`, shared `features-viewer/behavior-enablement.ts` | built for a fresh web install only |
| The host card on the shim: open a package as folders, turn files off, choose a signature per folder, mint, pack | shim `bootstrap/branch-view.ts`, `branch-files.ts` | built 2026-10-29, local |
| A file's versions across domains, and picking one | runtime `acquire.ts` `revisionsOf`, essentials `sharing/host-directory.view.ts` | built |
| A change drawn file by file, added and removed lines | essentials `assistant/sandbox-change.view.ts` | built, an element already |
| A taken change held until accepted | the brood | built |
| The door's chat answered by the door's own host | worker `aiAsk`, commit `fb7afb014` | built 2026-11-10, taken out in `ae880bd6d`, recoverable |
| No Angular in core, the modules, the runtime or the shim | `doctrine.spec.ts` | guarded |

What the Angular chat has that the element does not: reading the hive, hive context, writing code, doctrine and files, Jev, putting a failed block's pages back.

## The build, in order

Each step is one small change and ends in something a person can see. A step is not started until the one before it has been seen working on a subdomain.

**Step 0 — the page (done).** A `try-` subdomain loads the shim. The chat element exists and can run granted behaviours.

**Step 1 — see it (done 2026-11-11).** The shim built from this branch, served at `try-chat.localhost:4275`, the chat opened by hand. What it showed is the next section. One thing it did not cover: the page was served by the shim's own reference host, not through the worker, so the worker's choice of page for a `try-` name is still proven only by its specs.

**Step 1b — a behaviour runs without the command line.** The run's main finding. `create` hands the tile to `command:create-cells`, and the only listener is the Angular command line, so on a debugger page creating a tile is refused. The commit a create performs moves into a module, and the command line becomes one caller of it. The same check is made for every behaviour a model may say: each either runs on the shim or says plainly that it cannot. *Done when:* the chat makes a tile on the subdomain, and a list names the granted behaviours that still need the shell.

**Step 2 — the chat is offered and answers.** On a debugger subdomain the host card lists the chat as a suggested tool. One press lights `word:chat` and opens `hc-chat`. Who answers is decision 1. *Done when:* a fresh subdomain, with nothing set up, answers a question after one press.

**Step 3 — the chat reads.** The read fence moves out of the shell the way the change grammar did: `hypercomb-observation.ts` and `withheld-reads.ts` import nothing from Angular and move to core, and the round loop gains the read block. The list of tiles withheld from outside models (`ai:withheld`) must be reachable from a module before any outside model reads; where it is not, only the participant's own local model reads. *Done when:* "what does this file do?" is answered from the file's own lines.

**Step 4 — the chat writes a revision.** The write fence, for one kind only: a section of the running package, written back as a draft the page then runs. Doctrine and tile files stay in the shell. *Done when:* "make the title larger" changes the running page, and the answer names the new signature.

**Step 5 — revisions and compare.** A strip in the chat lists this tile's revisions: each draft written here, newest first, then each version another domain holds (`revisionsOf`, the same call the host directory makes). A row is a signature, where it came from, and when. Checking two opens the existing what-changed panel on them. Picking one makes it what runs. A local draft is one more row in the list cross-domain versions already use; it is not a second mechanism. *Done when:* two drafts and one other domain's version are listed, any two compare, and a pick changes the page.

**Step 6 — take home.** How the bytes leave is decision 2. They arrive in the home hive's brood under the same rule as any taken change: verified by signature, run nowhere until accepted. *Done when:* a draft made on the subdomain is accepted at home and runs there.

**Step 7 — the Debug button.** The tile editor gains one button, and the command line one word, `debug`. Both say the same thing: open this tile's subdomain. This comes last on purpose: until steps 1 to 6 work, the button leads somewhere that cannot do the job. *Done when:* one click in the editor lands in a working debugger.

## The first run (2026-11-11)

Built from this branch and opened at `http://try-chat.localhost:4275/`, a separate origin with nothing set up.

| What was tried | What happened |
|---|---|
| Open the page | The shim booted. No Angular on the page. It showed the host card with nothing installed. |
| Does the host card offer this origin's own package? | Yes. It listed the newest revision this host publishes, named by its branch, with **Replicate**. This was the spec's largest unknown. |
| Replicate it | About twenty seconds, then the page reloaded and mounted 25 element surfaces, the chat among them. 45 Angular surfaces stayed unreachable, the command line among them. |
| Open the chat | It opened beside an empty hive. On `/hosts` the host card covers it; on `/` it is in front. |
| Ask a question | "no callable AI provider is available for this request". The origin has no provider, as the first fact says. The question was kept in the thread. |
| Grant `create`, and stand in for the model's reply with a block that says `/create roadmap` | The lesson was taught, the block parsed, queued and run by the participant's policy. The behaviour refused: "Create command line is unavailable". The chat said so in the answer and did not claim a tile. |

Three things the run changes:

- **Nobody can grant anything there.** `grant allow <word>` is typed on the command line, and the debugger page has none. The grant in the run was said through the behaviour door by hand. The chat needs a way to ask for a grant and take a press as the answer, or the command line must exist as an element.
- **A behaviour is not Angular-free just because it is a module.** Step 1b.
- **The model's stand-in was the only thing faked.** Everything else ran as built: the census, the grant, the parser, the queue, the behaviour door.

## Not in this spec

- Parity with the Angular chat. Jev, the context compiler and the plan transaction move when something here needs them.
- Doing the journey on a phone by typing words. Phone work is the chat.
- The `swarm` subdomain, which is still served the web shell.
- A depth under a door (`try-<party>.try-<mission>.<zone>`). It waits on a certificate, as [build-debug-isolation.md](build-debug-isolation.md) says.
- Removing the web shell's workbench mode. It is unused now and is left alone.
- Any new store, pool or record kind. If a step seems to need one, the step is wrong.

## What could go wrong

- **Only the first half has been run**, and with a stand-in for the model. No real model has answered on a subdomain yet.
- **The worker has not served the page.** The run used the shim's reference host; the worker's `try-` routing is covered by specs only.
- **Core gained exports.** A shell serving an older core cannot load a package that uses them. The shell is deployed first.
- **A withheld tile read by an outside model** is the one failure here that cannot be taken back. Step 3 is closed by default for that reason.
- **The host's AI is metered.** A loop of twelve rounds spends twelve asks.

## Decisions (taken 2026-11-11: the three recommended choices)

1. **Who answers the chat on a subdomain.** Recommended: the door's own host, as built on 2026-11-10 (`fb7afb014`) — it needs no key and no setup, which is what makes step 2 one press. The chat's round loop is client-side, so the host's AI can act through it even though the host only returns text. The other choice is your own provider key, entered on each subdomain; keys never travel between origins.
2. **How a revision gets home.** Recommended: the subdomain hands the revision's bytes to the window that opened it, your hive checks them against the signature, and they wait in the brood. Nothing is published and the signer stays pinned off. The other choice is publishing from the subdomain, which means letting a page with full package power sign as you.
3. **What a tile's subdomain is called.** Recommended: `try-<tile name>`, one per tile, so the same tile always opens the same debugger and its drafts are still there. The label rule allows 57 characters of letters, digits and hyphens.
