# Working in the debugger — the chat on a subdomain

**Status: spec, 2026-11-11. Steps 0 and 1 are done on `claude/subdomain-minimal-debug-9544be`: the page, the chat and its round loop were run on a `try-` subdomain of this machine, and the run is recorded below. jwize took the three recommended choices at the end ("Yes, go"). Not deployed.**

jwize, 2026-11-11: "we single click an editing tile to debug basically, It opens the subdomain and you are debugging. You then have access somehow to suggested tools like ai. Then you adopt by click and now you accept and have ai. You can develop from there."

The same day: "anything built in the debugger (subdomains) should not load angular. This will be our process to phase out angular." And: "I would love to see what it is like to do work on the new chat in a subdomain. We can then debug and create revisions on the fly and compare them just like cross domains. We should spec this out to be done minimal and cleanly."

## Revised the same day: one subdomain, and the key decides

jwize, 2026-11-11, on seeing `try-` in the name: "I thought try has been deprecated." Then: "just the subdomain name. If you have the key you get a different experience. If you don't you just have the host and the community. You can follow and add stuff and use it but you can't publish publicly. The private key allows you to adopt and then setup your ai and develop as well."

This replaces three things below. Where the text that follows still says `try-`, a pinned signer, the host's AI, or handing a revision to the opener, read this section instead; those parts are kept as the record of what was run, and are to be rewritten once the open question at the end of this section is answered.

- **The name.** There is no prefix. A tile's subdomain is `<name>.<zone>`. `try-` stays retired; records already signed under `try-` keys keep reading.
- **One page, two experiences.** Everyone gets the same page, with no Angular.
  - *Without the key:* the host and the community. You can follow, add things and use them. You cannot publish publicly.
  - *With the private key:* you can also adopt, set up your AI, and develop.
- **What that overturns.** The signer is not pinned off for a key holder: publishing from the subdomain is the point. The AI is your own, set up there, not the host's. A revision is published from the subdomain with the key, not handed back to another window.
- **What it keeps.** The page is the shim. The chat element, its round loop, the create commit as a module, and the order of the remaining steps (read, write a revision, revisions and compare, the Debug button) all stand.

**The key is the one you already publish with.** jwize, asked what "having the key" means on the page: "basically the same key as when you publish from your devices." The shim already answers that question, and nothing new is needed to ask it: a browser that accepted its owner's invite has its own key on the owner's list (`device-invite.ts`, `device-key.ts`, `device-binding.ts`), and a hive open beside the page answers as the owner too (`owner-bridge.ts`). The host card takes either (`eitherOwner` in `host-panel.ts`) and that is what turns its **Manage** side on ("This browser publishes for you now"). So the two experiences are the host card's two states, which exist: no owner, the host and the community; an owner, Manage. Adopting, setting up the AI and developing belong on the Manage side.

What is not yet said, and decides how this is built:

- **What a stranger sees at a name that is a published website.** Today `<name>.<zone>` with a published site answers the read-only website. "The host and the community" may replace that or sit beside it.

This page is that spec. It adds no new mechanism where one exists: the subdomain is the mission door of [build-debug-isolation.md](build-debug-isolation.md), a revision is a signature ([build-revisions.md](build-revisions.md)), and a change comes home through the brood ([module-sandbox.md](module-sandbox.md)).

## The same chat and the same tile navigation, with no Angular (2026-11-11)

jwize, the same day: "It is the same chat." "It is the minimal (meaning no angular)." "The idea is you have the same chat and tile nav so you can create and update the website or application."

So the page at a subdomain has the hypercomb.io chat and the hypercomb.io tile navigation, the same code with no Angular under it. "Minimal" means no Angular, never fewer features. Nothing is reimplemented beside the Angular version: each piece is ported, and the same change deletes the Angular copy. The cut-down chat written earlier that day (essentials `assistant/chat.view.ts`, `chat-work.ts`) duplicates parts of the Angular chat and is absorbed or deleted by the port, never grown.

Two read-only maps were made of what has to move (236 parts of the chat window; the command line, controls bar, edit actions, publish panel, dialogs and the canvas). What already works on the Angular-free page: the canvas draws tiles, a click goes into a tile, right-click or Shift+click goes back out, pan, zoom and touch work. Everything else a builder uses is still Angular.

### The port, in order

Each step leaves the chat and the navigation working in both the Angular shells and the Angular-free page, and deletes the Angular code it replaces.

| # | Step | What a builder can do on the Angular-free page afterwards |
|---|---|---|
| 1 | Confirm dialog as an element (**done 2026-11-12**: runtime `confirm-dialog.ts`, same tag `hc-confirm-dialog`, mounted by every host on import; the Angular component is deleted. It is the host's, not a package's: a shell is deployed before the packages its participants hold, and a dialog that came with a package would leave a new shell over an older package with nobody to answer a yes) | Every act that waits on a yes (publish, remove, prune, keys) can finish. Until this moves, those acts wait forever there. |
| 2 | Toasts as an element | See every "saved", "published" and "could not" line. |
| 3 | Website view and the editor's pencil (three services move to the runtime; website-nav folds into the site view) | Enter the site being built, leave it, and open the tile editor from a tile. |
| 4 | Edit actions as an element | Undo, redo and the selection verbs by mouse. |
| 5 | The chat's pure logic moves down: the read grammar, withheld reads, context compiler, effort, plan transaction, owed step, execution line | Nothing visible yet; the chat logic is now reachable without Angular. |
| 6 | The host tier and its run registry move to the chat bee | Absorbs the cut-down chat's host fallback. |
| 7 | One work loop for both chats: the Angular chat's provider round (reads, changes, writes) becomes one module both use | The debugger chat reads the hive and acts like the hypercomb.io chat. Deletes `chat-work.ts`. |
| 8 | The rest of the chat engine (send, tiers, waits, stop, recovery, conversations, drafts, models, place, the workflow state) moves to a controller | One engine; the Angular window only draws it. |
| 9 | The chat's regions become elements one at a time: execution column, picture viewer, composer, references, transcript, workflow column, header, conversation list, setup | Each region looks and behaves as at hypercomb.io. |
| 10 | The frame ports; one chat element in both shells | `chat-window.component.ts` is deleted. `chat.view.ts` is gone. |
| 11 | The shared stores the command line and controls read move to the runtime | Tags, names and interests complete and persist there. |
| 12 | The command shell, then the command line, as elements | Type a name to make a tile, say any word (including `grant`), find with `?`, complete. |
| 13 | Publish panel as an element | Publish the site from the page. |
| 14 | The controls bar in four parts: viewport policy, breadcrumb and back, the tag strip, then the rail and phone bands | The whole hypercomb.io rail. The Angular controls bar is deleted. |
| 15 | Files viewer, icon picker | The last tools a site uses. |

Steps 1 to 4 are small and unblock the most. Steps 7 and 12 are the largest single changes. Steps 5 to 10 and 11 to 15 can be worked in either order after step 4.

### Open questions for jwize

1. Reactivity in the ported code: the house pattern (an EventTarget that says "change" and an explicit render), or a small reactive cell in core?
2. The chat sizes its text in em so it follows the panel text-size ladder; the rule is rem, never em. Keep em inside the chat's reading surface, or write every size as `calc(N rem × panel scale)`?
3. Code highlighting: carry highlight.js into the Angular-free page, or use the hive's own highlighter (`sharing/code-theme.ts`) so there is one?
4. The trial handoff code in the chat (try- labels) predates the retirement of try: delete it in the port?
5. Swarm and sharing (the mesh header) on the debugger page: wanted, and when?
6. The controls bar is 6,200 lines: may it leave in the four parts above, the Angular bar losing a region each time?

## The entrance (jwize, 2026-11-11)

"Remember the entrance is I have a host. I follow another host, then I allow an app and open it at its subdomain and now I enable ai chat and start development."

1. You have a host.
2. You follow another host.
3. You allow an app.
4. You open it at its subdomain.
5. You enable the AI chat, and start developing.

The loop below is what happens after step 5. Steps 1 to 4 are the host card's own acts (follow a domain, allow a package, open it); this spec does not rebuild them.

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

**Step 1b — a behaviour runs without the command line.** The run's main finding. `create` hands the tile to `command:create-cells`, and the only listener is the Angular command line, so on a debugger page creating a tile is refused. The commit a create performs moves into a module, and the command line becomes one caller of it. The same check is made for every behaviour a model may say: each either runs on the shim or says plainly that it cannot. *Done when:* the chat makes a tile on the subdomain and the tile is on the page, and a list names the granted behaviours that still need the shell. *State:* done for `create` (third run, below). The list of other behaviours is not made.

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

### The second run, the same day — after step 1b's first half

The create commit moved out of the Angular command line into a module (essentials `commands/create-cells.ts`); the command line now calls it, and where no command line is mounted the create word's own bee answers the request. Rebuilt, replicated as a new revision (the host card showed "Loaded here" beside the newer one, then moved to it), and asked again.

| What was tried | What happened |
|---|---|
| The same stand-in reply, `/create roadmap` | It ran. The chat showed "Ran: /create roadmap" and the hive told the model so. |
| Is the tile there? | `/roadmap` reads back as a tile with its own layer signature, and still does after a reload. |
| Is it on the page? | No. The root page reads "not found", so nothing lists the tile and no hexagon is drawn. |

So a behaviour could make a tile's own record on a debugger page, and nothing listed it.

### The third run — why, and the fix

The guess above (a missing first-run flow) was wrong. The cause was simpler and wider: **the shim had no lineage and no navigation service.** Both lived in `hypercomb-shared/core`, which the shim never loads, so the page had no "where you stand". The layer committer returns without writing when it finds no lineage, and says nothing, so `/create` committed nothing and reported that it ran. The `/roadmap` record seen in the second run was only the empty seed a read mints.

- `lineage.ts`, `navigation.ts` and the two helpers they need (`completion-utility.ts`, `home-root.ts`) moved to `hypercomb-runtime/src`; the shell files re-export them; the shim imports them at boot. None of the four imports Angular.
- The create commit now refuses, for a caller that must not report a tile nothing committed, when the page has no lineage ("this page does not know where it stands").

| What was tried | What happened |
|---|---|
| The same stand-in reply, `/create atlas` | It ran. |
| Is it on the page? | Yes. The root page lists `atlas`, and its hexagon is drawn beside the chat. |

Step 1b's first half is done: a behaviour makes a tile on the Angular-free page and the tile is there. Its second half, the list of granted behaviours that still need the shell, is not done.

### Setting up an AI there (2026-11-11, "let's just get it working on desktop first")

The providers console was already framework-free (essentials `assistant/providers-window.view.ts`) and opens on the debugger page; nothing led to it. Now, when nobody can answer — no provider the router can call and no host named — the chat says "No AI is set up on this page yet" and offers **Set up AI**, which opens the console. The offer leaves once a provider can answer. On `try-chat.localhost` the console opened over the chat with its three tabs (Subscription, API with OpenRouter, Swarm). A real answer still needs a provider set up on that origin: a key pasted by the participant, a bridged CLI session, or a local model. No answer from a real model has been seen there yet.

The page then had no way to open the chat at all: no command line, no rail. The chat now brings its own **Chat** button, bottom right, on any page where no Angular chat is registered and the chat word is lit. Checked on a fresh `studio.localhost:4275` by clicks only: Replicate on the host card, then Chat, Set up AI, the API tab, the OpenRouter row, and the key field is there. One trap on the way: the bee asked for the element from above the function's declaration, and `whenReady` answers at once when the registry is already up, so it threw and was swallowed.

**Still no way to grant** a behaviour on that page, so a model there can answer but not act until it can.

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
