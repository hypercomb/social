# Break repair loop

Every time something breaks on the client, it is queued. A cheap local tick
folds the queue into an ongoing issue list, and starts an agent only when there
is work: a locked, read-only one to interpret what is new, and — when there is
something to decide — a conversation where the participant chooses what gets
fixed. A fix that does not hold reopens itself. The loop repairs the hive it
runs in.

```
breaks and warnings ──► breaks:queue ──► tick (node only, fixed interval, no agent)
                                           │  compact: fold the queue into breaks:log
            new breaks? ───────────────────┼──► locked headless review → interpreted, `open`
 open breaks nobody was shown,             │
 or chosen issues left unfinished? ────────┴──► one repair conversation
                                                      │  checklist → the participant chooses
                                                      ▼
                                           fix / investigate ──► `fixed` | `open` + note
                                                      │
                         breaks again after the fix? the next compact reopens it
```

## 1. Capture — `breaks:queue`

**What counts as a break.** Uncaught errors (the window `error` event), unhandled
promise rejections, `<script>` and `<link>` load failures, and `console.error`
calls that carry an `Error` — Angular's ErrorHandler reports through that. Not
breaks: the ResizeObserver loop warning, `AbortError` (a cancellation is how work
is supposed to stop), the opaque cross-origin `Script error.`, and failing images.

**Warnings.** A `console.warn` that carries an `Error` is queued as a `warning`,
one severity below a break. A warning that is only words is not queued: the tree
warns in hundreds of places about conditions it expects, and queuing those would
bury the real failures. Warnings are fenced so they cannot crowd out breaks: at
most 50 distinct warnings per page load (breaks have their own 200), and a
warning is written only while the queue holds fewer than 200 of its 500 records.

**One failure, one record.** A throw in an Angular shell reaches two listeners —
the window `error` event and the ErrorHandler's `console.error` — and is recorded
once. Deduplication is by Error identity and by severity: a warning never hides a
later break of the same Error, because code that warned about an error and then
let it throw has broken. When a window error event carries no Error (a muted
cross-origin throw, `throw null`), Angular re-reports it as a NEW Error whose
cause is the event; that echo is recognised — by the event's identity, and by its
shape — and never becomes a second issue.

**Where the listeners live.** An inline script at the top of both shells'
`index.html` `<head>`, so they are on before any stylesheet, script or module can
fail. Until essentials load they only hold what they see in `window.__hcBreaks`,
and only candidates: a console call carrying an Error, a script or stylesheet that
failed, a runtime error, a rejection — so boot noise cannot fill the 100 slots,
and a warning is held only while half of them are free. Everything the script
does is guarded, so a console call whose arguments throw when inspected (a revoked
Proxy, a cross-origin window) still returns normally to its caller.
`hypercomb-essentials/src/assistant/break-capture.drone.ts` takes the buffer over
when essentials load and becomes the sink (`window.__hcBreak`). A page without the
inline script gets the same listeners from the drone. The array is the flag, so
only one set is ever installed.

**The fingerprint** is `sha256(type, normalized message, where)`, where the
message has signatures, ids, URLs and numbers taken out, and *where* is the top
three stack frames without positions, query strings, hosts or bundle hashes (for
a resource: its path). A rebuild does not split one break into two, and a warning
and a break of the same failure stay two issues.

**Writes are coalesced per break.** The first record lands 5 s after the break;
each later write for the same break waits twice as long, up to 15 min. A record
(`break@1`) is one fingerprint, one page load, one window, with a count. Records
are content-addressed and append-only. The queue holds at most 500 records; past
that, new ones are dropped until a fold drains it, so a hive nobody folds (a
visitor's) holds a bounded amount. The room left is counted afresh by every flush
that writes, so a fold is noticed on the next flush; a store that is not up yet
is never mistaken for a full queue. A page being hidden lands everything it holds,
even if a flush was already running when it was hidden.

## 2. Fold — `breaks:log`

`breaks-compact` runs inside the hive. It groups queue records by fingerprint,
folds them into one `break-issue@1` document per fingerprint (the member is named
by the fingerprint), and for each one writes it, reads it back, and only then
removes the records it took in. A failed write leaves those records queued, so
nothing is counted twice. Unreadable queue members older than a minute are
half-written litter and are removed.

| status | meaning | set by |
|---|---|---|
| `new` | folded, not read yet | the fold |
| `open` | interpreted, waiting for a choice | `interpret` (new issues only); the participant putting a chosen issue back (`choose --release`); the fold when a fix didn't hold; repair when it couldn't fix |
| `chosen` | picked in triage, with a mode: `fix` or `investigate` | the participant |
| `fixed` | a fix landed (`fixedAt`) | the repair agent |
| `dismissed` | leave it — it keeps counting, silently | the participant |

An issue also carries its `type` (a break's kind, or `warning`), `rank` (the list
order, lower is higher), `count`, `sessions` (distinct page loads, approximate
past the last 50), `firstAt`, `lastAt`, recent `origins` and `routes`, the newest
`stack`, the review's `title`, `area`, `interpretation` and `files`, `offeredAt`
(when a conversation last showed it), and up to 30 `notes`.

**A fix is proved by silence.** A `fixed` issue that breaks again in a page load
that started after `fixedAt` is reopened by the fold with a note. A tab left open
across the fix is still running the old code, so it can't reopen anything.

Both pools are truth pools, colon-scoped, and never minted from the optimize
phase. The queue is drained by the fold and nothing else; nothing is ever deleted
from the log.

## 3. The tick — no agent until there is work

`node scripts/bridge/breaks.cjs tick`, run by Task Scheduler at a fixed interval
(`scripts/bridge/install-breaks-tick.ps1`, every 10 minutes by default,
`-Remove` to take it out) through `breaks-tick.vbs`, so no console flashes; its
log is `%TEMP%\hypercomb-breaks-tick.log`. The pattern is `drain-tick.cjs`'s: the
interval buys latency, not spend.

1. **Compact.** Node and one bridge round trip. No broker (a refused connection
   reads as `bridge-unreachable`), or no hive tab with the bridge, is a normal
   resting state: log a line, exit. The queue waits in the hive. `tick --dry`
   does not compact, and says so when records are waiting.
2. **Review.** New **breaks** → a headless agent, locked read-only (below),
   runs the skill's review section over every new issue, warnings included. A
   lock file keeps two ticks from reviewing at once. New warnings alone never
   start a review.
3. **Offer.** Open breaks nobody has been shown, reopened ones, or chosen issues
   offered longer than the gap ago → the breaks are marked offered first, then
   ONE repair conversation opens in a new Windows Terminal (`claude /break-repair`).
   If it cannot open, the marks are taken back (`offered: false`), so a failed
   spawn never hides a break. A take-back the bridge itself refused (the bridge
   is often what failed) is written to a local file beside the review lock and
   finished by the next tick that reaches the hive — but only while the issue
   still carries the exact mark this tick stamped; a mark renewed since by a
   triage, or an issue chosen since, is left alone. No second conversation opens
   within the gap (`BREAKS_GAP_MIN`, default 240). The warnings waiting are marked
   offered once the conversation that shows them has opened. A warning never
   opens one on its own; a chosen warning is different — a person chose it, so it
   is worked, and offered again if it sits.
4. **Can it run at all?** Neither a review nor a conversation starts while
   `claude auth status` says signed out. And a review that fails to sign in, or
   that the account refuses because a usage limit is reached, is decisive too:
   no conversation opens and nothing is marked offered, because the conversation
   would be refused the same way and still strand its issues for a gap.

**No API key unless asked.** The sign-in check, the review and the conversation
run without `ANTHROPIC_API_KEY` (`BREAKS_USE_API_KEY=1` allows it). The loop
runs on the CLI's own login (`claude auth login`); a key left in the environment
would otherwise win over that login — and bill it. A tick started from inside a
Claude session also drops the variables that session hands its children (its
endpoint included), so what it spawns is a session of its own.

Knobs: `BREAKS_GAP_MIN`, `BREAKS_REVIEW_MODEL` (default `sonnet`), `BREAKS_LOG`,
`BREAKS_TERMINAL` (default `wt.exe`), `BREAKS_USE_API_KEY`, `BRIDGE_URL`,
`HYPERCOMB_BRIDGE_TOKEN`. `planOffer`, `planChoose`, `planRollback`, `reviewable`
and `childEnv` are pure and pinned by `scripts/bridge/breaks.spec.ts`.

### The review's lock

Nobody watches the headless review, and what it reads — messages and stacks — was
written by a page. So it is locked to reading code and interpreting new issues,
and the lock is enforced by the CLI and the hive, not by the prompt.

It spawns from the bridge's `readOnlyArgv` in `scripts/bridge/agent-bridges.json`
(`agent-roster.cjs` `invocation(…, { readOnly: true, allow })`). For Claude Code:

| flag | why |
|---|---|
| `--restricted` | user, project and local settings files do not load. A machine's own settings can pre-approve `Edit`, `Write` or `git commit`, and an allowlist added on top cannot take those back. It also confines the file tools to the working directory. |
| `--tools Read,Grep,Glob,Bash` | no tool that writes exists in the session at all |
| `--permission-mode dontAsk` | anything not allowed is denied, never prompted |
| `--allowedTools {allow}` | Bash narrowed to `REVIEW_ALLOW` in `breaks.cjs`: `status`, `compact`, `list`, `list --all`, `show …`, `interpret …` |
| `--disallowedTools Edit,Write,NotebookEdit,WebFetch,WebSearch` | belt and braces |
| `--strict-mcp-config` | no MCP server loads |

The flags only lock anything if they arrive. On Windows `claude` from npm is a
`.cmd` shim, and a command line through cmd.exe cannot carry them safely: a line
break ENDS it, so every flag after the prompt is silently dropped and the
session runs unlocked; `%NAME%` is expanded even inside quotes; and a `"` inside
an argument flips cmd's quote state, so the rest of the argument is read as shell
syntax. So `agent-roster.cjs` never routes the review through cmd.exe: it reads
the npm shim and spawns the program it forwards to (`…\bin\claude.exe`) directly.
A batch file it cannot read that way is refused any argument carrying a line
break, `%` or `"`, rather than spawned as something other than what was built.

`choose`, `resolve` and `note` are deliberately not in the allowlist. They are the
participant's, and a review that could say them could mark an issue `chosen` —
skipping the one step a person has to take. `interpret` itself only takes a `new`
issue: the CLI refuses anything else, and the hive checks the same condition
(`onlyIfStatus: 'new'`) inside its serialized write, so a review can never rewrite
the interpretation a person chose from — not even by racing a `choose`. A bridge
that declares no `readOnlyArgv` is refused read-only work rather than run with
write access.

## 4. The conversation — the participant chooses

`.claude/skills/break-repair/SKILL.md`. It interprets anything still new, works
issues already chosen, then shows the open list as a checklist: tackle (checked)
by fixing or only investigating, and move each of the rest to the top or bottom,
or dismiss it. Breaks are listed first; warnings follow under a line of their
own. In the desktop app the checklist is a widget (`breaks.cjs triage`); in a
terminal it is an AskUserQuestion round of up to twelve issues, breaks first.
Either way the decision is one `choose`, and `--shown` records every issue that
was in front of the participant, so a place they chose to keep is not offered to
them again after the gap.

The page's fix-or-investigate choice applies only to newly checked rows. A row
already chosen stays chosen, in its own mode: moving it changes only its place,
unchecking it puts it back to `open`, and dismissing it dismisses it. To change a
chosen issue's mode, put it back and choose it again, or run
`breaks.cjs choose --tackle <id> --mode fix|investigate`.

The conversation is interactive and runs with the participant's own settings —
a person is there. It still reads page-written messages and stacks and
review-written interpretations, so the skill treats all of them as data and
re-derives a fix from the source the stack names. The agent never commits; the
participant does.

## Bridge verbs

| op | request | does |
|---|---|---|
| `breaks-compact` | — | fold the queue into the log |
| `breaks-list` | — | every issue, top first, plus `queued` |
| `break-issue-update` | `sig` = fingerprint, `payload` = `status` · `rank` · `title` · `area` · `interpretation` · `files` · `mode` · `note` · `offered: true`/`false` · `onlyIfStatus` | apply what was said; the hive stamps every time, and refuses the whole patch when `onlyIfStatus` no longer matches |

None of them is in `MUTATING_OPS`: none touches the surface, so none holds it
behind a quiet badge while a tick runs.

## Limits

- Only a hive open on localhost with the bridge can be folded. A visitor's
  breaks stay in their own hive, capped. A backgrounded hive tab can time the
  bridge out; the tick logs it and waits for the next run.
- The review and the conversation need `claude` signed in (`claude auth login`)
  and within the account's usage limits. Until then the tick folds and waits,
  logging why.
- Wrapping `console.error` and `console.warn` moves DevTools' call-site link to
  the capture script in `index.html`. The expanded trace still shows the real
  caller.
- The tick's conversation opens in Windows Terminal with Claude Code; the widget
  checklist needs the desktop app.
